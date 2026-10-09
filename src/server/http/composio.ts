// The Composio stations' API: /api/composio/… (see src/shared/integrations/composio-api.ts for the answers).
// Every call runs as the signed-in person, on their own connected accounts, and whatever changes
// something tells everyone on their floor with a `composio:activity` so a line floats over their
// head. The office's API key and the OAuth tokens stay on the server: nothing here answers with them.
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { Session } from '../accounts/auth.js';
import { str } from '../office/input.js';
import { readBody, sameOrigin, send } from './util.js';
import type { Route, RouteRequest } from './router.js';
import { COMPOSIO_API, type ComposioDone, type ComposioStatus } from '../../shared/integrations/composio-api.js';
import { isComposioToolkit, type ComposioToolkit } from '../../shared/protocol.js';
import { calendar, gmail, linear, notion, slack, type Run } from '../integrations/composio-actions.js';
import { floorParam } from './routes/files.js';

type Body = Record<string, unknown>;
type Req = RouteRequest & { session: Session };

async function body(r: Req, limit = 256 * 1024): Promise<Body> {
  try {
    const b = JSON.parse(await readBody(r.req, limit)) as unknown;
    return b && typeof b === 'object' ? (b as Body) : {};
  } catch {
    return {};
  }
}

/** The person's connections on this floor: their browser(s) here, to put the floating text over. */
function peersOf(ctx: Ctx, accountId: string, floorId: string | undefined): Client[] {
  return [...ctx.clients.values()].filter((c) => c.accountId === accountId && !c.out && c.peer.floor === floorId);
}

/** Tells the floor what `who` just did, over their head. */
function announce(ctx: Ctx, r: Req, toolkit: ComposioToolkit, summary: string) {
  const account = r.session.account;
  if (!account) return;
  const floor = floorParam(ctx, r.url, r.session);
  if (!floor) return;
  const me = peersOf(ctx, account.id, floor.id)[0];
  ctx.toFloor(floor, { t: 'composio:activity', user: account.name, peer: me?.id, toolkit, summary });
}

/** A date range: today, or the next days, in the browser's own zone (it sends ISO instants). */
function range(url: URL): { timeMin: string; timeMax: string } {
  const from = new Date(url.searchParams.get('from') ?? '');
  const to = new Date(url.searchParams.get('to') ?? '');
  const start = Number.isNaN(from.getTime()) ? new Date() : from;
  const end = Number.isNaN(to.getTime()) ? new Date(start.getTime() + 7 * 86_400_000) : to;
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

const done = <T>(toolkit: ComposioToolkit, result: T, summary: string): ComposioDone<T> => ({ toolkit, result, summary });

/** The small page the OAuth dance comes back to, in the tab Composio opened. */
function callbackPage(ok: boolean, toolkit: string): string {
  const title = ok ? `Connected ${toolkit}` : `Couldn't connect ${toolkit}`;
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#fffaf3;color:#2b2d42;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${ok ? '✅' : '✗'} ${title}</h1><p>You can close this tab and go back to the office.</p></div></body>`;
}

export const composioRoutes = {
  composio: {
    prefix: `${COMPOSIO_API}/`,
    auth: 'session',
    async handle(ctx, r) {
      const { req, res, url, session } = r;
      const p = url.pathname.slice(COMPOSIO_API.length + 1);
      const hub = ctx.composio;
      const account = session.account;
      const post = req.method === 'POST';
      if (post && !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });

      // Where the OAuth dance lands; the person is back in the office with their cookie.
      if (p === 'callback') {
        const toolkit = url.searchParams.get('toolkit') ?? 'the account';
        const ok = url.searchParams.get('status') !== 'failed';
        if (account) hub.announce(account.id);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(callbackPage(ok, toolkit));
      }

      if (p === 'status') return send(res, 200, { office: hub.state(), mine: await hub.connections(account?.id) } satisfies ComposioStatus);

      if (!account) return send(res, 403, { error: hub.blocked(undefined) });
      const run: Run = (toolkit, slug, args) => hub.execute(account.id, toolkit, slug, args);

      try {
        if (p === 'connect' && post) {
          const b = await body(r, 4096);
          const toolkit = b.toolkit;
          if (!isComposioToolkit(toolkit)) return send(res, 400, { error: 'Unknown toolkit' });
          const origin = str(b.origin, 300);
          const callbackUrl = /^https?:\/\/[^/\s]+$/.test(origin) ? `${origin}${COMPOSIO_API}/callback?toolkit=${encodeURIComponent(toolkit)}` : undefined;
          return send(res, 200, { url: await hub.connect(account.id, toolkit, callbackUrl) });
        }
        if (p === 'disconnect' && post) {
          const b = await body(r, 4096);
          if (!isComposioToolkit(b.toolkit)) return send(res, 400, { error: 'Unknown toolkit' });
          await hub.disconnect(account.id, b.toolkit);
          return send(res, 200, { ok: true });
        }

        // Linear
        if (p === 'linear/issues') return send(res, 200, await linear.issues(run));
        if (p === 'linear/issues/create' && post) {
          const out = await linear.create(run, await body(r));
          announce(ctx, r, 'linear', out.summary);
          return send(res, 200, done('linear', out.issue, out.summary));
        }
        if (p === 'linear/issues/update' && post) {
          const out = await linear.update(run, await body(r));
          announce(ctx, r, 'linear', out.summary);
          return send(res, 200, done('linear', out.issue, out.summary));
        }

        // Notion
        if (p === 'notion/search') return send(res, 200, await notion.search(run, str(url.searchParams.get('q'), 200)));
        if (p === 'notion/page') {
          const id = str(url.searchParams.get('id'), 100);
          if (!id) return send(res, 400, { error: 'Missing id' });
          return send(res, 200, await notion.page(run, id));
        }
        if (p === 'notion/pages/create' && post) {
          const out = await notion.create(run, await body(r));
          announce(ctx, r, 'notion', out.summary);
          return send(res, 200, done('notion', out.page, out.summary));
        }

        // Slack
        if (p === 'slack/channels') return send(res, 200, await slack.channels(run));
        if (p === 'slack/messages') {
          const channel = str(url.searchParams.get('channel'), 100);
          if (!channel) return send(res, 400, { error: 'Missing channel' });
          return send(res, 200, await slack.history(run, channel, 20));
        }
        if (p === 'slack/send' && post) {
          const out = await slack.send(run, await body(r));
          announce(ctx, r, 'slack', out.summary);
          return send(res, 200, done('slack', { ts: out.ts }, out.summary));
        }

        // Google Calendar
        if (p === 'calendar/events') {
          const { timeMin, timeMax } = range(url);
          return send(res, 200, await calendar.events(run, timeMin, timeMax));
        }

        // Gmail
        if (p === 'gmail/unread') return send(res, 200, await gmail.unread(run));
        if (p === 'gmail/message') {
          const id = str(url.searchParams.get('id'), 100);
          if (!id) return send(res, 400, { error: 'Missing id' });
          return send(res, 200, await gmail.message(run, id));
        }
        for (const [path, act, verb] of [
          ['gmail/send', gmail.send, 'send'],
          ['gmail/draft', gmail.draft, 'draft'],
          ['gmail/reply', gmail.reply, 'reply'],
        ] as const) {
          if (p === path && post) {
            const out = await act(run, await body(r));
            announce(ctx, r, 'gmail', out.summary);
            return send(res, 200, done('gmail', { id: out.id, verb }, out.summary));
          }
        }
      } catch (err) {
        return send(res, 502, { error: (err as Error).message || 'Composio failed' });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
