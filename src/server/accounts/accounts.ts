import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { officeHome, officeRanIn } from '../config.js';
import { stateDb, stateDoc, type Doc } from '../db/state.js';
import { forgetUser } from './user-config.js';
import type { AccountInvite, AccountRole, AccountsState } from '../../shared/protocol.js';

/** Where a database-backed office kept its accounts before each office had documents of its own; read when there's nothing else. */
const LEGACY_KEY = 'accounts';
/** How often the office re-reads its accounts, so `agent-office accounts` (a separate process) is
 * picked up while the office runs. */
const POLL_MS = 4000;

export const NAME_MAX = 24;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 512;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_INVITES = 100;

export interface Account {
  id: string;
  name: string;
  role: AccountRole;
  /** scrypt(password, salt), hex. */
  hash: string;
  salt: string;
  createdAt: number;
  createdBy: string;
  lastSeenAt?: number;
}

interface Saved {
  accounts: Account[];
  invites: AccountInvite[];
  /** Whether the office password lets people register an account of their own. Missing means on. */
  registration?: boolean;
}

/** Collapses whitespace and drops control characters, so "Ada" and " Ada​" are one name. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

function hash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, (err, key) => (err ? reject(err) : resolve(key))));
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Everyone's own sign-in, in the office's database: the accounts people registered or made from
 * single-use invite links, and whether the office password lets more people register. Every
 * session is one of these accounts. `agent-office accounts` edits the same document while the
 * office runs, so the office re-reads it every few seconds (`watch`).
 */
export class Accounts {
  private data: Saved = { accounts: [], invites: [] };
  private doc: Doc<Partial<Saved>>;

  constructor(
    private dataDir: string,
    opts: { watch?: boolean } = {},
  ) {
    this.doc = stateDoc(dataDir, 'accounts');
    this.load(this.doc.read() ?? stateDb().get<Partial<Saved>>(LEGACY_KEY));
    if (opts.watch) {
      setInterval(() => {
        this.doc.refresh().then(
          (saved) => saved && this.load(saved),
          (err: Error) => console.error(`agent-office: couldn't read the accounts from the database: ${err.message}`),
        );
      }, POLL_MS).unref();
    }
  }

  /** Resolves once the changes made so far are in the database. */
  flush(): Promise<void> {
    return stateDb().flush();
  }

  private load(saved: Partial<Saved> | undefined) {
    this.data = {
      accounts: Array.isArray(saved?.accounts) ? saved.accounts.filter((a) => a && typeof a.id === 'string' && typeof a.hash === 'string') : [],
      invites: Array.isArray(saved?.invites) ? saved.invites.filter((v) => v && typeof v.token === 'string') : [],
      ...(saved?.registration === false ? { registration: false } : {}),
    };
  }

  /** Whether the office password lets people register. The first account can always be made with it. */
  get openRegistration(): boolean {
    return !this.any || this.data.registration !== false;
  }

  /** Whether anyone has an account yet. */
  get any(): boolean {
    return this.data.accounts.length > 0;
  }

  get(id: string | undefined): Account | undefined {
    if (!id) return undefined;
    return this.data.accounts.find((a) => a.id === id);
  }

  /** Every account. */
  list(): Account[] {
    return [...this.data.accounts];
  }

  byName(name: string): Account | undefined {
    const n = cleanName(name);
    return n ? this.data.accounts.find((a) => sameName(a.name, n)) : undefined;
  }

  state(online: Set<string>): AccountsState {
    this.dropExpired();
    return {
      accounts: this.data.accounts.map(({ hash: _h, salt: _s, ...a }) => ({ ...a, online: online.has(a.id) })),
      invites: this.data.invites,
      openRegistration: this.data.registration !== false,
    };
  }

  /** The account for a name and password, or undefined. Takes as long either way. */
  async check(name: string, password: string): Promise<Account | undefined> {
    const a = this.byName(name);
    const pw = password.slice(0, PASSWORD_MAX);
    const derived = await hash(pw, a ? Buffer.from(a.salt, 'hex') : randomBytes(16));
    return a && timingSafeEqual(derived, Buffer.from(a.hash, 'hex')) ? a : undefined;
  }

  invite(by: string, role: AccountRole, name?: string): AccountInvite | string {
    this.dropExpired();
    const n = cleanName(name);
    if (name && !n) return 'That name has no letters in it';
    if (n) {
      const taken = this.nameTaken(n);
      if (taken) return taken;
    }
    if (this.data.invites.length >= MAX_INVITES) return 'Too many open invites — cancel some first';
    const now = Date.now();
    const invite: AccountInvite = {
      id: randomBytes(5).toString('hex'),
      token: randomBytes(24).toString('base64url'),
      ...(n ? { name: n } : {}),
      role: role === 'admin' ? 'admin' : 'member',
      createdBy: by,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    };
    this.data.invites.push(invite);
    this.save();
    return invite;
  }

  cancel(inviteId: string): AccountInvite | undefined {
    const i = this.data.invites.findIndex((v) => v.id === inviteId);
    if (i < 0) return undefined;
    const [v] = this.data.invites.splice(i, 1);
    this.save();
    return v;
  }

  /** The open invite for a link's token. */
  findInvite(token: string): AccountInvite | undefined {
    this.dropExpired();
    if (!token) return undefined;
    const want = digest(token);
    return this.data.invites.find((v) => timingSafeEqual(digest(v.token), want));
  }

  /** Uses up an invite: makes the account and returns it, or says what's wrong. */
  async join(token: string, name: string, password: string): Promise<Account | string> {
    const invite = this.findInvite(token);
    if (!invite) return 'This invite link has expired or was already used. Ask for a new one.';
    const useInvite = () => {
      // Hashing took a moment: someone else may have used the link meanwhile.
      const i = this.data.invites.findIndex((v) => v.id === invite.id);
      if (i < 0) return 'This invite link was just used. Ask for a new one.';
      this.data.invites.splice(i, 1);
      return undefined;
    };
    return this.create(invite.name ?? cleanName(name), password, invite.role, invite.createdBy, useInvite, invite.id);
  }

  /**
   * Someone registering an account of their own: they knew the office password, or opened the
   * office's sign-in link. The office's first account is its admin, so somebody can manage it.
   */
  register(name: string, password: string): Promise<Account | string> {
    return this.create(cleanName(name), password, 'member', 'themselves');
  }

  private async create(n: string, password: string, role: AccountRole, by: string, claim?: () => string | undefined, exceptInvite?: string): Promise<Account | string> {
    if (!n) return 'Pick a name';
    if (password.length < PASSWORD_MIN) return `Pick a password of at least ${PASSWORD_MIN} characters`;
    if (password.length > PASSWORD_MAX) return 'That password is too long';
    const early = this.nameTaken(n, exceptInvite);
    if (early) return early;
    const salt = randomBytes(16);
    const derived = await hash(password, salt);
    // Hashing took a moment: someone else may have taken the name meanwhile.
    const taken = this.nameTaken(n, exceptInvite);
    if (taken) return taken;
    const err = claim?.();
    if (err) return err;
    const account: Account = {
      id: randomBytes(8).toString('hex'),
      name: n,
      role: this.any ? role : 'admin',
      hash: derived.toString('hex'),
      salt: salt.toString('hex'),
      createdAt: Date.now(),
      createdBy: by,
    };
    this.data.accounts.push(account);
    this.save();
    return account;
  }

  /** Deletes an account and everything it kept. Its sessions stop working on their next request. */
  revoke(id: string): Account | undefined {
    const i = this.data.accounts.findIndex((a) => a.id === id);
    if (i < 0) return undefined;
    const [a] = this.data.accounts.splice(i, 1);
    this.save();
    forgetUser(this.dataDir, a.id);
    return a;
  }

  setRole(id: string, role: AccountRole): Account | undefined {
    const a = this.get(id);
    if (!a) return undefined;
    a.role = role === 'admin' ? 'admin' : 'member';
    this.save();
    return a;
  }

  setOpenRegistration(on: boolean) {
    if (on) delete this.data.registration;
    else this.data.registration = false;
    this.save();
  }

  seen(id: string) {
    const a = this.get(id);
    if (!a) return;
    a.lastSeenAt = Date.now();
    this.save();
  }

  private nameTaken(n: string, exceptInvite?: string): string | undefined {
    if (this.data.accounts.some((a) => sameName(a.name, n))) return `There's already an account called ${n}`;
    if (this.data.invites.some((v) => v.id !== exceptInvite && v.name && sameName(v.name, n))) return `${n} already has an open invite`;
    return undefined;
  }

  private dropExpired() {
    const now = Date.now();
    const keep = this.data.invites.filter((v) => v.expiresAt > now);
    if (keep.length === this.data.invites.length) return;
    this.data.invites = keep;
    this.save();
  }

  private save() {
    this.doc.write(this.data);
  }
}

const HELP = `agent-office accounts — who can sign in to the office

Usage:
  agent-office accounts [list]                 Accounts, open invites, and whether people may register
  agent-office accounts invite [name] [--admin]
                                               Make a single-use invite link (valid 7 days)
  agent-office accounts revoke <name>          Delete an account; it's signed out at once
  agent-office accounts role <name> admin|member
  agent-office accounts registration on|off    Whether the office password lets people register

Options:
  -d, --dir <dir>   The office's directory: the project it was started in, or its
                    home (default: the current directory if an office ran there,
                    else ~/agent-office or $AGENT_OFFICE_HOME)
  -h, --help        Show this help

Needs the office's database, as the office does (--database-url or DATABASE_URL).
Works while the office runs: it picks up the changes within seconds.
`;

const day = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

/** `agent-office accounts`: exits 0 when done, 1 when it couldn't, 2 for a usage error. */
export async function accountsCommand(argv: string[]): Promise<number> {
  // An office started in this project keeps its accounts there; one started anywhere else, in its home.
  let dir = officeRanIn(process.cwd()) ? process.cwd() : officeHome();
  let admin = false;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '-d' || a === '--dir') {
      if (!argv[i + 1]) return usage('--dir needs a value');
      dir = path.resolve(argv[++i]);
    } else if (a === '--admin') admin = true;
    else if (a.startsWith('-')) return usage(`unknown option ${a}`);
    else args.push(a);
  }
  if (!officeRanIn(dir)) {
    console.error(`agent-office accounts: no office has run in ${dir} yet — start it once with \`agent-office\` there`);
    return 1;
  }
  const accounts = new Accounts(path.join(dir, '.agent-office'));
  const [cmd = 'list', arg, arg2] = args;
  switch (cmd) {
    case 'list': {
      const s = accounts.state(new Set());
      console.log(`Registering with the office password: ${s.openRegistration ? 'on' : 'off'}`);
      console.log(`\nAccounts (${s.accounts.length}):`);
      for (const a of s.accounts) {
        console.log(`  ${a.name.padEnd(NAME_MAX)}  ${a.role.padEnd(6)}  since ${day(a.createdAt)}  ${a.lastSeenAt ? `last seen ${day(a.lastSeenAt)}` : 'never signed in'}`);
      }
      if (!s.accounts.length) console.log('  none yet: the first person to register in the office is its admin');
      if (s.invites.length) {
        console.log(`\nOpen invites (${s.invites.length}):`);
        for (const v of s.invites) console.log(`  ${(v.name ?? '(they pick)').padEnd(NAME_MAX)}  ${v.role.padEnd(6)}  by ${v.createdBy}, until ${day(v.expiresAt)}  /join#${v.token}`);
      }
      await accounts.flush();
      return 0;
    }
    case 'invite': {
      const v = accounts.invite('the terminal', admin ? 'admin' : 'member', arg);
      if (typeof v === 'string') return fail(v);
      console.log(`Invite ${v.name ? `for ${v.name} ` : ''}(${v.role}), single use, valid for 7 days:\n\n  /join#${v.token}\n`);
      console.log(`Open it on the office's own address, e.g. http://localhost:4600/join#${v.token}`);
      await accounts.flush();
      return 0;
    }
    case 'revoke':
    case 'role': {
      if (!arg) return usage(`${cmd} needs a name`);
      const a = accounts.byName(arg);
      if (!a) return fail(`there's no account called ${arg}`);
      if (cmd === 'revoke') {
        accounts.revoke(a.id);
        console.log(`Revoked ${a.name}'s account. They're signed out of the office within seconds.`);
        await accounts.flush();
        return 0;
      }
      if (arg2 !== 'admin' && arg2 !== 'member') return usage('role takes admin or member');
      accounts.setRole(a.id, arg2);
      console.log(`${a.name} is ${arg2 === 'admin' ? 'an admin' : 'a member'} now.`);
      await accounts.flush();
      return 0;
    }
    case 'registration': {
      if (arg !== 'on' && arg !== 'off') return usage('registration takes on or off');
      accounts.setOpenRegistration(arg === 'on');
      console.log(arg === 'on' ? 'Anyone with the office password can register an account again.' : 'Nobody can register with the office password now; invite people instead.');
      await accounts.flush();
      return 0;
    }
    default:
      return usage(`unknown command ${cmd}`);
  }
}

function usage(msg: string): number {
  console.error(`agent-office accounts: ${msg}\n`);
  process.stderr.write(HELP);
  return 2;
}

function fail(msg: string): number {
  console.error(`agent-office accounts: ${msg}`);
  return 1;
}
