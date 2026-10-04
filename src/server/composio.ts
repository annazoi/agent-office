// Composio: Linear, Notion, Slack, Google Calendar and Gmail for the office, through one API key the
// admins set and a connection each person makes for themselves (docs.composio.dev). The key lives
// in .agent-office/composio.json (mode 0600) and never leaves the server; browsers only hear
// whether one is set. Each account is its own Composio user ("ao-<accountId>"), so coworkers
// connect their own Linear, Slack or Gmail and nobody sees anyone else's.
//
// The SDK (@composio/core) is ESM and needs Node 22.22 or newer, while the office runs on 20+, so
// it's loaded only when a key is set and the failure to load is just a state the office reports.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COMPOSIO_TOOLKITS, isComposioToolkit, type ComposioConnection, type ComposioConnections, type ComposioState, type ComposioToolkit } from '../shared/protocol.js';
import type { ComposioForWorkers, ComposioMcp } from './composio-mcp.js';

const TIMEOUT_MS = 20_000;
/** Composio project keys look like "ak_…"; anything printable and keylike is accepted, the API decides. */
const KEY_RE = /^[A-Za-z0-9_\-.]{16,256}$/;

interface Saved {
  apiKey: string;
  toolkits: ComposioToolkit[];
  by: string;
  at: number;
}

/** The slice of the SDK the office uses, so the rest of the server never imports it. */
export interface ComposioSdk {
  create(userId: string, config: { toolkits: string[]; mcp: true }): Promise<ComposioSession>;
  connectedAccounts: {
    list(query: { userIds: string[]; toolkitSlugs?: string[] }): Promise<{ items: { id: string; status: string; toolkit: { slug: string } }[] }>;
    delete(id: string): Promise<unknown>;
  };
  toolkits: { get(query: Record<string, never>, options?: { signal?: AbortSignal }): Promise<unknown> };
}

export interface ComposioSession {
  sessionId: string;
  mcp: { type: 'http' | 'sse'; url: string; headers?: Record<string, string> };
  authorize(toolkit: string, options?: { callbackUrl?: string }): Promise<{ id: string; redirectUrl?: string | null }>;
  toolkits(options?: { toolkits?: string[] }): Promise<{ items: { slug: string; connection?: { isActive: boolean; connectedAccount?: { status: string; id: string } } }[] }>;
  execute(slug: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ data: Record<string, unknown>; error: string | null }>;
}

/** Loads the real SDK. Tests hand in their own. */
export type SdkLoader = (apiKey: string) => Promise<ComposioSdk>;

export const loadComposioSdk: SdkLoader = async (apiKey) => {
  const mod = (await import('@composio/core')) as { Composio: new (cfg: { apiKey: string; allowTracking?: boolean }) => unknown };
  return new mod.Composio({ apiKey, allowTracking: false }) as unknown as ComposioSdk;
};

/** A user id Composio sees for an account: stable, and never the account's name. */
export const composioUserId = (accountId: string) => `ao-${accountId}`;

export class ComposioHub implements ComposioForWorkers {
  private saved?: Saved;
  private error?: string;
  private available = true;
  private path: string;
  private sdk?: Promise<ComposioSdk>;
  private sdkKey?: string;
  /** One session per account, made on first use; it's the account's connections and its MCP endpoint. */
  private sessions = new Map<string, Promise<ComposioSession>>();
  /** Each account's endpoint once its session exists, and whether it has connected anything, for the workers (see mcpCached). */
  private endpoints = new Map<string, ComposioMcp>();
  private connected = new Set<string>();

  constructor(
    dataDir: string,
    private onState: (state: ComposioState) => void,
    /** Tells one account its connections changed. */
    private onConnections: (accountId: string, connections: ComposioConnections) => void,
    private load: SdkLoader = loadComposioSdk,
  ) {
    this.path = path.join(dataDir, 'composio.json');
    this.restore();
  }

  state(): ComposioState {
    return {
      configured: !!this.saved,
      available: this.available,
      toolkits: this.saved?.toolkits ?? [],
      by: this.saved?.by,
      at: this.saved?.at,
      error: this.error,
    };
  }

  /** The toolkits switched on (every one, before an admin narrows them). */
  get toolkits(): readonly ComposioToolkit[] {
    return this.saved?.toolkits ?? [];
  }

  get configured(): boolean {
    return !!this.saved;
  }

  /**
   * Sets the office's key ('' removes it), checking it against Composio first. Resolves to why it
   * can't, if it can't.
   */
  async setKey(raw: string, by: string, toolkits: readonly ComposioToolkit[] = this.saved?.toolkits ?? COMPOSIO_TOOLKITS): Promise<string | undefined> {
    const apiKey = raw.trim();
    if (!apiKey) {
      this.saved = undefined;
      this.error = undefined;
      this.reset();
      this.persist();
      this.onState(this.state());
      return undefined;
    }
    if (!KEY_RE.test(apiKey)) return "That doesn't look like a Composio API key";
    const err = await this.check(apiKey);
    if (err) return err;
    this.saved = { apiKey, toolkits: [...toolkits], by, at: Date.now() };
    this.error = undefined;
    this.reset();
    this.persist();
    this.onState(this.state());
    return undefined;
  }

  /** Which toolkits the office shows stations for. */
  setToolkits(toolkits: unknown): string | undefined {
    if (!this.saved) return 'Set the Composio API key first';
    if (!Array.isArray(toolkits)) return 'Bad toolkit list';
    const list = COMPOSIO_TOOLKITS.filter((t) => toolkits.includes(t));
    this.saved = { ...this.saved, toolkits: list };
    this.reset();
    this.persist();
    this.onState(this.state());
    return undefined;
  }

  /** Why `accountId` can't use the integrations right now, if they can't. */
  blocked(accountId: string | undefined): string | undefined {
    if (!this.saved) return 'The office has no Composio API key yet (an admin sets it in ⚙️ Settings → Connections)';
    if (!this.available) return this.error ?? 'Composio needs Node 22.22 or newer';
    if (!accountId) return 'Sign in with an account of your own to connect your tools (the shared password has none)';
    return undefined;
  }

  /** This account's connections: one line per toolkit the office shows. */
  async connections(accountId: string | undefined): Promise<ComposioConnections> {
    const blocked = this.blocked(accountId);
    if (blocked || !accountId) return { toolkits: {}, blocked };
    const toolkits: Partial<Record<ComposioToolkit, ComposioConnection>> = {};
    for (const t of this.toolkits) toolkits[t] = 'off';
    try {
      const session = await this.session(accountId);
      const { items } = await session.toolkits({ toolkits: [...this.toolkits] });
      for (const it of items) {
        if (!isComposioToolkit(it.slug)) continue;
        const status = it.connection?.connectedAccount?.status;
        toolkits[it.slug] = it.connection?.isActive ? 'connected' : status === 'INITIATED' || status === 'INITIALIZING' ? 'pending' : 'off';
      }
    } catch (err) {
      return { toolkits, blocked: this.describe(err) };
    }
    if (Object.values(toolkits).includes('connected')) this.connected.add(accountId);
    else this.connected.delete(accountId);
    return { toolkits };
  }

  /** Starts connecting a toolkit; the link to send the person to. */
  async connect(accountId: string, toolkit: ComposioToolkit, callbackUrl?: string): Promise<string> {
    this.assertOn(accountId, toolkit);
    const session = await this.session(accountId);
    const req = await session.authorize(toolkit, callbackUrl ? { callbackUrl } : undefined);
    if (!req.redirectUrl) throw new Error(`Composio gave no link to connect ${toolkit}`);
    this.announce(accountId);
    return req.redirectUrl;
  }

  /** Removes every connected account this person has on a toolkit. */
  async disconnect(accountId: string, toolkit: ComposioToolkit): Promise<void> {
    this.assertOn(accountId, toolkit);
    const sdk = await this.client();
    const { items } = await sdk.connectedAccounts.list({ userIds: [composioUserId(accountId)], toolkitSlugs: [toolkit] });
    for (const it of items) await sdk.connectedAccounts.delete(it.id);
    this.announce(accountId);
  }

  /** Runs one Composio tool as this person. Throws with Composio's own words when it fails. */
  async execute(accountId: string, toolkit: ComposioToolkit, slug: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertOn(accountId, toolkit);
    const session = await this.session(accountId);
    const res = await session.execute(slug, args, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.error) throw new Error(res.error);
    return res.data;
  }

  /** The MCP endpoint a worker of this account's gets: the person's own connections, nobody else's. */
  async mcpFor(accountId: string): Promise<{ type: 'http' | 'sse'; url: string; headers: Record<string, string> } | undefined> {
    if (this.blocked(accountId) || !this.toolkits.length) return undefined;
    const session = await this.session(accountId);
    return { type: session.mcp.type, url: session.mcp.url, headers: session.mcp.headers ?? {} };
  }

  /**
   * The endpoint a worker hired by this account gets, when the account has connected something: what
   * the hub already made (a worker's launch can't wait on the network), so it's there once the person
   * has opened the office, which asks for their connections.
   */
  mcpCached(accountId: string): ComposioMcp | undefined {
    if (!this.connected.has(accountId) || this.blocked(accountId)) return undefined;
    return this.endpoints.get(accountId);
  }

  /** Tells the account its connections now (after a connect, a disconnect or the OAuth callback). */
  announce(accountId: string) {
    void this.connections(accountId).then((c) => this.onConnections(accountId, c));
  }

  private assertOn(accountId: string, toolkit: ComposioToolkit) {
    const blocked = this.blocked(accountId);
    if (blocked) throw new Error(blocked);
    if (!this.toolkits.includes(toolkit)) throw new Error(`${toolkit} is switched off in this office`);
  }

  private session(accountId: string): Promise<ComposioSession> {
    let s = this.sessions.get(accountId);
    if (!s) {
      s = this.client()
        .then((sdk) => sdk.create(composioUserId(accountId), { toolkits: [...this.toolkits], mcp: true }))
        .then((session) => {
          this.endpoints.set(accountId, { type: session.mcp.type, url: session.mcp.url, headers: session.mcp.headers ?? {} });
          return session;
        });
      s.catch(() => this.sessions.delete(accountId));
      this.sessions.set(accountId, s);
    }
    return s;
  }

  private client(): Promise<ComposioSdk> {
    const key = this.saved?.apiKey;
    if (!key) return Promise.reject(new Error('No Composio API key is set'));
    if (!this.sdk || this.sdkKey !== key) {
      this.sdkKey = key;
      this.sdk = this.load(key).catch((err) => {
        this.sdk = undefined;
        throw err;
      });
    }
    return this.sdk;
  }

  /** Asks Composio something cheap with the key, to see it works. */
  private async check(apiKey: string): Promise<string | undefined> {
    let sdk: ComposioSdk;
    try {
      sdk = await this.load(apiKey);
    } catch (err) {
      this.available = false;
      this.error = `Couldn't load the Composio SDK (it needs Node 22.22 or newer): ${(err as Error).message}`;
      this.onState(this.state());
      return this.error;
    }
    this.available = true;
    try {
      await sdk.toolkits.get({}, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      return `Composio didn't accept that key: ${this.describe(err)}`;
    }
    return undefined;
  }

  /** Forgets sessions and the client: the key or the toolkits changed. */
  private reset() {
    this.sessions.clear();
    this.endpoints.clear();
    this.connected.clear();
    this.sdk = undefined;
    this.sdkKey = undefined;
  }

  private describe(err: unknown): string {
    const e = err as Error & { cause?: Error };
    if (e?.name === 'TimeoutError') return 'Composio did not answer in time';
    const msg = e?.message ?? String(err);
    // The SDK's errors can quote the request, headers included; keep the key out of the logs and toasts.
    return msg.replace(this.saved?.apiKey ?? '\u0000', '***').split('\n')[0].slice(0, 200);
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.path)) return;
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Saved>;
      if (typeof s.apiKey === 'string' && KEY_RE.test(s.apiKey)) {
        const toolkits = Array.isArray(s.toolkits) ? COMPOSIO_TOOLKITS.filter((t) => s.toolkits!.includes(t)) : [...COMPOSIO_TOOLKITS];
        this.saved = { apiKey: s.apiKey, toolkits, by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : Date.now() };
      }
    } catch {
      // a broken file just means no key
    }
  }
}
