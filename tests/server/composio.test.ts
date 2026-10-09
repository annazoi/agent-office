// The Composio integrations: the hub's key and per-account connections (on a fake SDK), what each
// station's action sends Composio and makes of the answer, the workers' MCP configs, and the HTTP
// routes against the office's own request handler, as the signed-in person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../../src/server/accounts/accounts.js';
import { Auth } from '../../src/server/accounts/auth.js';
import { ComposioHub, composioUserId, type ComposioSdk, type ComposioSession } from '../../src/server/integrations/composio.js';
import { calendar, gmail, linear, linearBucket, notion, slack } from '../../src/server/integrations/composio-actions.js';
import { COMPOSIO_HEADER_ENV, codexComposioMcp, describeComposioTool, openCodeComposioMcp, claudeComposioMcp } from '../../src/server/integrations/composio-mcp.js';
import { composioRoutes } from '../../src/server/http/composio.js';
import { requestHandler } from '../../src/server/http/router.js';
import { authRoutes } from '../../src/server/http/routes/auth.js';
import type { Ctx } from '../../src/server/office/context.js';
import { stationFootprint, stationObstacles, STATION_SPOTS } from '../../src/shared/integrations/integrations.js';
import type { ServerMsg } from '../../src/shared/protocol.js';
import { stateDoc } from '../../src/server/db/state.js';

const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `ao-${name}-`));
const KEY = 'ak_test_0123456789abcdef';

/** A Composio that answers from a table of tool results and remembers what it was asked. */
function fakeSdk(answers: Record<string, unknown> = {}, connected: string[] = ['linear']) {
  const calls: { slug: string; args: Record<string, unknown> }[] = [];
  const users: string[] = [];
  const deleted: string[] = [];
  const session = (uid: string): ComposioSession => ({
    sessionId: `s-${uid}`,
    mcp: { type: 'http', url: `https://backend.composio.dev/api/v3/tool_router/session/s-${uid}/mcp`, headers: { 'x-api-key': KEY } },
    authorize: async (toolkit, options) => ({ id: 'ca_new', redirectUrl: `https://connect.composio.dev/link/${toolkit}?cb=${encodeURIComponent(options?.callbackUrl ?? '')}` }),
    toolkits: async () => ({ items: ['linear', 'notion', 'slack', 'googlecalendar', 'gmail', 'github'].map((slug) => ({ slug, connection: connected.includes(slug) ? { isActive: true, connectedAccount: { id: `ca_${slug}`, status: 'ACTIVE' } } : slug === 'gmail' ? { isActive: false, connectedAccount: { id: 'ca_g', status: 'INITIATED' } } : undefined })) }),
    execute: async (slug, args = {}) => {
      calls.push({ slug, args });
      const a = answers[slug];
      if (a instanceof Error) return { data: {}, error: a.message };
      return { data: (a as Record<string, unknown>) ?? {}, error: null };
    },
  });
  const sdk: ComposioSdk = {
    create: async (uid) => {
      users.push(uid);
      return session(uid);
    },
    connectedAccounts: {
      list: async ({ userIds, toolkitSlugs }) => ({ items: (toolkitSlugs ?? connected).filter((t) => connected.includes(t)).map((t) => ({ id: `ca_${t}_${userIds[0]}`, status: 'ACTIVE', toolkit: { slug: t } })) }),
      delete: async (id) => {
        deleted.push(id);
      },
      // Each account's token, as Composio keeps it ('masked' accounts get the kind git can't use).
      get: async (id) => ({ state: { val: { access_token: id.endsWith('masked') ? 'gho_ab...yz' : `gho_token_of_${id.replace(/\W/g, '_')}_0123456789` } } }),
    },
    toolkits: { get: async () => ({}) },
  };
  return { sdk, calls, users, deleted };
}

test('the hub keeps the key to itself, checks it before saving, and tells browsers only that one is set', async () => {
  const dir = tmp('hub');
  const states: boolean[] = [];
  let loads = 0;
  const { sdk } = fakeSdk();
  const hub = new ComposioHub(dir, (s) => states.push(s.configured), () => {}, async () => (loads++, sdk));
  assert.equal(hub.configured, false);
  assert.match(hub.blocked('a1')!, /no Composio API key/);
  assert.equal(await hub.setKey('nope', 'Sam'), "That doesn't look like a Composio API key");
  assert.equal(await hub.setKey(KEY, 'Sam'), undefined);
  assert.deepEqual(states, [true]);
  const state = hub.state();
  assert.equal(state.configured, true);
  assert.equal(state.by, 'Sam');
  assert.deepEqual(state.toolkits, ['linear', 'notion', 'slack', 'googlecalendar', 'gmail', 'github']);
  assert.ok(!JSON.stringify(state).includes(KEY), 'the state never carries the key');
  // Never in the database: the key is the server's environment's. A fresh hub has none until it's given one.
  const saved = stateDoc<{ apiKey?: string; toolkits?: string[] }>(dir, 'composio');
  assert.equal(saved.read()?.apiKey, undefined);
  assert.ok(!JSON.stringify(saved.read()).includes(KEY));
  assert.equal(new ComposioHub(dir, () => {}, () => {}, async () => sdk).configured, false);
  // Toolkits can be narrowed, never to something that isn't one, and that pick is kept for the next start.
  assert.equal(hub.setToolkits(['gmail', 'bogus', 'linear']), undefined);
  assert.deepEqual(hub.state().toolkits, ['linear', 'gmail']);
  const again = new ComposioHub(dir, () => {}, () => {}, async () => sdk);
  assert.equal(await again.setKey(KEY, 'the server'), undefined);
  assert.deepEqual(again.state().toolkits, ['linear', 'gmail']);
  assert.match(hub.blocked(undefined)!, /Sign in with your account/);
  assert.equal(hub.blocked('a1'), undefined);
  // '' removes it.
  assert.equal(await hub.setKey('', 'Sam'), undefined);
  assert.equal(hub.configured, false);
  assert.match(hub.blocked('a1')!, /COMPOSIO_API_KEY/);
});

test("a key an older office stored in the database isn't used, and is gone once the server's key is set", async () => {
  const dir = tmp('hub-old');
  const { sdk } = fakeSdk();
  stateDoc<unknown>(dir, 'composio').write({ apiKey: KEY, toolkits: ['slack'], by: 'Sam', at: 1 });
  const hub = new ComposioHub(dir, () => {}, () => {}, async () => sdk);
  assert.equal(hub.configured, false, 'only the environment gives the office its key');
  assert.equal(await hub.setKey('ak_from_the_environment_42', 'the server'), undefined);
  assert.deepEqual(hub.state().toolkits, ['slack'], 'the toolkit pick carries on');
  assert.ok(!JSON.stringify(stateDoc<unknown>(dir, 'composio').read()).includes(KEY), 'the old key is dropped');
});

test("a key Composio refuses isn't saved, and an SDK that won't load is a state, not a crash", async () => {
  const dir = tmp('hub-bad');
  const refusing: ComposioSdk = { ...fakeSdk().sdk, toolkits: { get: async () => Promise.reject(new Error('401 Unauthorized')) } };
  const hub = new ComposioHub(dir, () => {}, () => {}, async () => refusing);
  assert.match((await hub.setKey(KEY, 'Sam'))!, /didn't accept that key: 401/);
  assert.equal(hub.configured, false);
  const noSdk = new ComposioHub(dir, () => {}, () => {}, async () => Promise.reject(new Error('Node 22.22 needed')));
  assert.match((await noSdk.setKey(KEY, 'Sam'))!, /Couldn't load the Composio SDK/);
  assert.equal(noSdk.state().available, false);
});

test('each account is its own Composio user, with its own connections, link, and MCP endpoint', async () => {
  const dir = tmp('hub-users');
  const { sdk, users, deleted, calls } = fakeSdk({ LINEAR_LIST_LINEAR_ISSUES: { issues: [] } });
  const told: string[] = [];
  const hub = new ComposioHub(dir, () => {}, (id, c) => told.push(`${id}:${c.toolkits.linear}`), async () => sdk);
  await hub.setKey(KEY, 'Sam');
  assert.deepEqual(await hub.connections(undefined), { toolkits: {}, blocked: hub.blocked(undefined) });
  const mine = await hub.connections('a1');
  assert.deepEqual(mine, { toolkits: { linear: 'connected', notion: 'off', slack: 'off', googlecalendar: 'off', gmail: 'pending', github: 'off' } });
  assert.deepEqual(users, [composioUserId('a1')]);
  await hub.connections('a2');
  assert.deepEqual(users, ['ao-a1', 'ao-a2'], 'one session per account, made once');
  await hub.connections('a1');
  assert.equal(users.length, 2);
  // Connecting hands back Composio's link, with the office's callback on it.
  const link = await hub.connect('a1', 'notion', 'http://localhost:4600/api/composio/callback?toolkit=notion');
  assert.match(link, /^https:\/\/connect\.composio\.dev\/link\/notion\?cb=http/);
  // Running a tool goes through that account's session; an error is Composio's own words.
  assert.deepEqual(await hub.execute('a1', 'linear', 'LINEAR_LIST_LINEAR_ISSUES', { first: 5 }), { issues: [] });
  assert.deepEqual(calls, [{ slug: 'LINEAR_LIST_LINEAR_ISSUES', args: { first: 5 } }]);
  hub.setToolkits(['linear']);
  await assert.rejects(hub.execute('a1', 'gmail', 'GMAIL_FETCH_EMAILS', {}), /switched off/);
  // The workers' endpoint: only for an account that connected something, and only what the hub already made.
  assert.equal(hub.mcpCached('a1'), undefined, 'the toolkit change forgot the sessions');
  await hub.connections('a1');
  assert.deepEqual(hub.mcpCached('a1'), { type: 'http', url: 'https://backend.composio.dev/api/v3/tool_router/session/s-ao-a1/mcp', headers: { 'x-api-key': KEY } });
  assert.equal(hub.mcpCached('a3'), undefined);
  // Disconnecting deletes that account's connected accounts on the toolkit, and tells them.
  await hub.disconnect('a1', 'linear');
  assert.deepEqual(deleted, ['ca_linear_ao-a1']);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(told.some((t) => t.startsWith('a1:')));
});

test('the actions call the right Composio tools with the right parameters, and keep what the panels show', async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const answers: Record<string, unknown> = {
    LINEAR_LIST_LINEAR_ISSUES: { issues: [{ id: 'i1', identifier: 'ENG-1', title: 'Fix login', url: 'https://linear.app/x/ENG-1', state: { name: 'In Progress' }, assignee: { name: 'Sam' }, team: { name: 'Eng' }, priority: 2 }, { id: 'i2', identifier: 'ENG-2', title: 'Ship', state: { name: 'Done' } }, { id: 'i3', identifier: 'ENG-3', title: 'Todo', state: { name: 'Backlog' } }] },
    LINEAR_LIST_LINEAR_TEAMS: { teams: [{ id: 't1', name: 'Eng', members: [] }] },
    LINEAR_CREATE_LINEAR_ISSUE: { id: 'i9', issue_title: 'New one', ticket_url: 'https://linear.app/x/ENG-9' },
    LINEAR_UPDATE_ISSUE: { success: true, issue: { id: 'i1', identifier: 'ENG-1', title: 'Fix login now', state: { name: 'Done' } } },
    NOTION_SEARCH_NOTION_PAGE: { results: [{ object: 'page', id: 'p1', url: 'https://notion.so/p1', icon: { type: 'emoji', emoji: '📝' }, last_edited_time: '2026-10-01T10:00:00Z', properties: { Name: { type: 'title', title: [{ plain_text: 'Roadmap' }] } } }, { object: 'database', id: 'd1', title: [{ plain_text: 'Tasks' }] }] },
    NOTION_RETRIEVE_PAGE: { object: 'page', id: 'p1', properties: { title: { type: 'title', title: [{ plain_text: 'Roadmap' }] } } },
    NOTION_GET_PAGE_MARKDOWN: { markdown: '# Roadmap\n\nQ4', truncated: false },
    NOTION_CREATE_NOTION_PAGE: { object: 'page', id: 'p2', url: 'https://notion.so/p2', properties: {} },
    SLACK_LIST_ALL_CHANNELS: { ok: true, channels: [{ id: 'C2', name: 'random', is_member: false, num_members: 9 }, { id: 'C1', name: 'general', is_member: true, is_private: false, num_members: 12 }] },
    SLACK_FETCH_CONVERSATION_HISTORY: { ok: true, messages: [{ ts: '2.0', user: 'U1', text: 'later' }, { ts: '1.0', user: 'U2', text: 'earlier', reply_count: 2 }] },
    SLACK_SEND_MESSAGE: { ok: true, ts: '3.0' },
    GOOGLECALENDAR_EVENTS_LIST: { items: [{ id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-05T09:00:00+03:00' }, end: { dateTime: '2026-10-05T09:15:00+03:00' }, htmlLink: 'https://cal/e1', attendees: [{}, {}] }, { id: 'e2', status: 'cancelled', summary: 'Gone', start: {}, end: {} }, { id: 'e3', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } }] },
    GMAIL_FETCH_EMAILS: { messages: [{ messageId: 'm1', threadId: 't1', subject: 'Hi', sender: 'Ann <ann@x.io>', messageTimestamp: '2026-10-04T08:00:00Z', labelIds: ['UNREAD', 'INBOX'], preview: 'hello' }, { messageId: 'm2', threadId: 't2', subject: 'Later', sender: 'bob@x.io', messageTimestamp: '2026-10-04T09:00:00Z', labelIds: ['UNREAD'] }] },
    GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: { messageId: 'm1', threadId: 't1', subject: 'Hi', sender: 'Ann <ann@x.io>', messageText: 'hello there', labelIds: [] },
    GMAIL_SEND_EMAIL: { id: 's1' },
    GMAIL_CREATE_EMAIL_DRAFT: { id: 'd1' },
    GMAIL_REPLY_TO_THREAD: { id: 'r1' },
  };
  const run = async (_toolkit: string, slug: string, args: Record<string, unknown>) => {
    calls.push([slug, args]);
    return answers[slug] as Record<string, unknown>;
  };
  const last = () => calls[calls.length - 1];

  assert.equal(linearBucket('In Review'), 'progress');
  assert.equal(linearBucket('Canceled'), 'done');
  assert.equal(linearBucket('Todo'), 'mine');
  const issues = await linear.issues(run);
  assert.deepEqual(issues.teams, [{ id: 't1', name: 'Eng' }]);
  assert.deepEqual(issues.issues.map((i) => [i.identifier, i.bucket, i.assignee]), [['ENG-1', 'progress', 'Sam'], ['ENG-2', 'done', undefined], ['ENG-3', 'mine', undefined]]);
  const created = await linear.create(run, { title: 'New one', teamId: 't1', description: 'd', priority: 7 });
  assert.deepEqual(last(), ['LINEAR_CREATE_LINEAR_ISSUE', { title: 'New one', team_id: 't1', description: 'd', priority: 4 }]);
  assert.equal(created.issue.url, 'https://linear.app/x/ENG-9');
  assert.match(created.summary, /created Linear issue “New one”/);
  await assert.rejects(linear.create(run, { title: 'x' }), /Missing teamId/);
  const updated = await linear.update(run, { issueId: 'ENG-1', title: 'Fix login now' });
  assert.deepEqual(last(), ['LINEAR_UPDATE_ISSUE', { issueId: 'ENG-1', title: 'Fix login now' }]);
  assert.equal(updated.issue.bucket, 'done');

  const pages = await notion.search(run, 'road');
  assert.deepEqual(last(), ['NOTION_SEARCH_NOTION_PAGE', { page_size: 25, direction: 'descending', timestamp: 'last_edited_time', query: 'road' }]);
  assert.deepEqual(pages.map((p) => [p.title, p.kind, p.icon]), [['Roadmap', 'page', '📝'], ['Tasks', 'database', undefined]]);
  const page = await notion.page(run, 'p1');
  assert.equal(page.markdown, '# Roadmap\n\nQ4');
  assert.equal(page.title, 'Roadmap');
  const made = await notion.create(run, { parentId: 'Roadmap', title: 'Notes', markdown: 'hi' });
  assert.deepEqual(last(), ['NOTION_CREATE_NOTION_PAGE', { parent_id: 'Roadmap', title: 'Notes', markdown: 'hi' }]);
  assert.equal(made.page.title, 'Notes');

  const channels = await slack.channels(run);
  assert.deepEqual(last(), ['SLACK_LIST_ALL_CHANNELS', { limit: 200, types: 'public_channel,private_channel', exclude_archived: true }]);
  assert.deepEqual(channels.map((c) => c.name), ['general', 'random'], "the ones you're in first");
  const history = await slack.history(run, 'C1');
  assert.deepEqual(last(), ['SLACK_FETCH_CONVERSATION_HISTORY', { channel: 'C1', limit: 20 }]);
  assert.deepEqual(history.map((m) => m.text), ['earlier', 'later'], 'oldest first');
  const sent = await slack.send(run, { channel: 'C1', channelName: 'general', text: 'hey *there*' });
  assert.deepEqual(last(), ['SLACK_SEND_MESSAGE', { channel: 'C1', markdown_text: 'hey *there*' }]);
  assert.equal(sent.summary, '💬 posted to Slack #general');

  const events = await calendar.events(run, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  assert.deepEqual(last(), ['GOOGLECALENDAR_EVENTS_LIST', { calendarId: 'primary', timeMin: '2026-10-05T00:00:00Z', timeMax: '2026-10-12T00:00:00Z', singleEvents: true, orderBy: 'startTime', maxResults: 100 }]);
  assert.deepEqual(events.map((e) => [e.title, e.allDay, e.attendees]), [['Standup', false, 2], ['(no title)', true, undefined]], 'cancelled ones left out');

  const unread = await gmail.unread(run);
  assert.deepEqual(last(), ['GMAIL_FETCH_EMAILS', { query: 'is:unread', label_ids: ['INBOX'], max_results: 25, include_payload: false, verbose: true }]);
  assert.deepEqual(unread.map((m) => m.id), ['m2', 'm1'], 'newest first');
  const msg = await gmail.message(run, 'm1');
  assert.equal(msg.text, 'hello there');
  await gmail.send(run, { to: 'ann@x.io', subject: 'Re', body: 'ok' });
  assert.deepEqual(last(), ['GMAIL_SEND_EMAIL', { recipient_email: 'ann@x.io', subject: 'Re', body: 'ok' }]);
  await gmail.draft(run, { to: 'ann@x.io', body: 'later', threadId: 't1' });
  assert.deepEqual(last(), ['GMAIL_CREATE_EMAIL_DRAFT', { recipient_email: 'ann@x.io', body: 'later', thread_id: 't1' }]);
  const reply = await gmail.reply(run, { threadId: 't1', to: 'ann@x.io', body: 'thanks' });
  assert.deepEqual(last(), ['GMAIL_REPLY_TO_THREAD', { thread_id: 't1', recipient_email: 'ann@x.io', message_body: 'thanks' }]);
  assert.equal(reply.summary, '✉️ replied to ann@x.io');
});

test("the workers' MCP configs carry the endpoint, and never its header on a command line", () => {
  const mcp = { type: 'http' as const, url: 'https://backend.composio.dev/api/v3/tool_router/session/s1/mcp', headers: { 'x-api-key': KEY } };
  // Claude: the config on its command line names the header's variable; the key is in the environment.
  const claude = claudeComposioMcp(mcp);
  assert.deepEqual(JSON.parse(claude.config), { mcpServers: { composio: { ...mcp, headers: { 'x-api-key': `\${${COMPOSIO_HEADER_ENV}_0}` } } } });
  assert.deepEqual(claude.env, { [`${COMPOSIO_HEADER_ENV}_0`]: KEY });
  assert.ok(!claude.config.includes(KEY));
  const codex = codexComposioMcp(mcp);
  assert.deepEqual(codex.args, ['-c', `mcp_servers.composio.url="${mcp.url}"`, '-c', `mcp_servers.composio.env_http_headers={ "x-api-key" = "${COMPOSIO_HEADER_ENV}" }`]);
  assert.deepEqual(codex.env, { [COMPOSIO_HEADER_ENV]: KEY });
  assert.ok(!codex.args.join(' ').includes(KEY));
  assert.deepEqual(openCodeComposioMcp(mcp), { composio: { type: 'remote', url: mcp.url, headers: mcp.headers, enabled: true } });
  assert.equal(describeComposioTool('mcp__composio__LINEAR_CREATE_LINEAR_ISSUE'), 'Creating Linear issue…');
  assert.equal(describeComposioTool('mcp__composio__GMAIL_FETCH_EMAILS'), 'Reading Gmail emails…');
  assert.equal(describeComposioTool('mcp__composio__SLACK_SEND_MESSAGE'), 'Sending Slack message…');
  assert.equal(describeComposioTool('mcp__composio__GOOGLECALENDAR_EVENTS_LIST'), 'Listing Calendar list…');
  assert.equal(describeComposioTool('mcp__composio__NOTION_SEARCH_NOTION_PAGE'), 'Searching Notion page…');
  assert.equal(describeComposioTool('Bash'), undefined);
  assert.equal(describeComposioTool('mcp__agent-office__list_workers'), undefined);
});

test('the stations stand clear of each other', () => {
  const prints = STATION_SPOTS.map((s) => stationFootprint(s));
  for (let i = 0; i < prints.length; i++)
    for (let j = i + 1; j < prints.length; j++) {
      const [a, b] = [prints[i], prints[j]];
      assert.ok(a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2], `${STATION_SPOTS[i].toolkit} overlaps ${STATION_SPOTS[j].toolkit}`);
    }
  assert.equal(stationObstacles().length, 3, 'the three on the floor are in the way; the two on the wall are not');
});

// ---------------------------------------------------------------- The routes

function request(port: number, method: string, pathname: string, body?: unknown, cookie?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }, agent: false }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d)).on('end', () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function office() {
  const salt = randomBytes(16);
  const dir = tmp('routes');
  const accounts = new Accounts(dir);
  const invite = accounts.invite('test', 'member', 'Fay');
  assert.ok(typeof invite !== 'string');
  const fay = await accounts.join(invite.token, 'Fay', 'fay-password-1');
  assert.ok(typeof fay !== 'string');
  const auth = new Auth(scryptSync('hunter2', salt, 32), salt, 'secret', accounts);
  const { sdk, calls } = fakeSdk({
    LINEAR_LIST_LINEAR_ISSUES: { issues: [{ id: 'i1', identifier: 'ENG-1', title: 'Fix', state: { name: 'Todo' } }] },
    LINEAR_LIST_LINEAR_TEAMS: { teams: [] },
    LINEAR_CREATE_LINEAR_ISSUE: { id: 'i2', issue_title: 'Made', ticket_url: 'https://linear.app/x/ENG-2' },
    SLACK_SEND_MESSAGE: new Error('channel_not_found'),
  });
  const sent: { to: string; msg: ServerMsg }[] = [];
  const floor = { id: 'f1', def: { name: 'acme' } };
  const clients = new Map([['c-fay', { id: 'c-fay', accountId: fay.id, out: false, peer: { floor: 'f1' } }], ['c-other', { id: 'c-other', accountId: 'nobody', out: false, peer: { floor: 'f1' } }]]);
  const cfg = { port: 0, trustProxy: false };
  const hub = new ComposioHub(dir, () => {}, () => {}, async () => sdk);
  const ctx = {
    cfg,
    accounts,
    auth,
    composio: hub,
    clients,
    floors: new Map([['f1', floor]]),
    // Everyone sees the one floor (see floorParam).
    meOf: () => ({ admin: false }),
    sees: () => true,
    toFloor: (f: unknown, msg: ServerMsg) => sent.push({ to: (f as { id: string }).id, msg }),
  } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [authRoutes.login, authRoutes.loginOptions, composioRoutes.composio]));
  cfg.port = await new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
  const cookieFor = (token: string) => `ao_session_${cfg.port}=${token}`;
  const close = () => {
    server.close();
    server.closeAllConnections();
  };
  return { port: cfg.port, hub, calls, sent, fay, gone: cookieFor(auth.issue('nobody0')), asFay: cookieFor(auth.issue(fay.id)), close };
}

test('the routes run as the signed-in person, refuse an account that is gone, and tell the floor what was done', async () => {
  const o = await office();
  try {
    const { port } = o;
    // Signed out: no.
    assert.equal((await request(port, 'GET', '/api/composio/status')).status, 401);
    // No key yet: status says so, and nothing runs.
    let r = await request(port, 'GET', '/api/composio/status', undefined, o.asFay);
    assert.equal(r.status, 200);
    let status = JSON.parse(r.body);
    assert.equal(status.office.configured, false);
    assert.match(status.mine.blocked, /no Composio API key/);
    assert.equal((await request(port, 'GET', '/api/composio/linear/issues', undefined, o.asFay)).status, 502);

    await o.hub.setKey(KEY, 'test');
    r = await request(port, 'GET', '/api/composio/status', undefined, o.asFay);
    status = JSON.parse(r.body);
    assert.equal(status.office.configured, true);
    assert.ok(!r.body.includes(KEY), 'the key never reaches a browser');
    assert.deepEqual(status.mine.toolkits, { linear: 'connected', notion: 'off', slack: 'off', googlecalendar: 'off', gmail: 'pending', github: 'off' });

    // An account that's gone is signed out: nothing at all.
    assert.equal((await request(port, 'GET', '/api/composio/status', undefined, o.gone)).status, 401);
    assert.equal((await request(port, 'GET', '/api/composio/linear/issues', undefined, o.gone)).status, 401);

    // Fay's issues, through her session.
    r = await request(port, 'GET', '/api/composio/linear/issues', undefined, o.asFay);
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body).issues.map((i: { identifier: string }) => i.identifier), ['ENG-1']);

    // Creating one: the answer, and a line over her head for everyone on her floor.
    r = await request(port, 'POST', `/api/composio/linear/issues/create?floor=f1`, { title: 'Made', teamId: 't1' }, o.asFay);
    assert.equal(r.status, 200, r.body);
    const done = JSON.parse(r.body);
    assert.equal(done.toolkit, 'linear');
    assert.equal(done.result.url, 'https://linear.app/x/ENG-2');
    assert.deepEqual(o.sent, [{ to: 'f1', msg: { t: 'composio:activity', user: 'Fay', peer: 'c-fay', toolkit: 'linear', summary: '📐 created Linear issue “Made”' } }]);
    assert.deepEqual(o.calls.at(-1), { slug: 'LINEAR_CREATE_LINEAR_ISSUE', args: { title: 'Made', team_id: 't1' } });

    // A POST from another site, even with her cookie, is refused.
    const cross = await new Promise<number>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/composio/linear/issues/create', headers: { host: `localhost:${port}`, origin: 'https://evil.example', cookie: o.asFay, 'content-type': 'application/json' } }, (res) => resolve(res.statusCode ?? 0));
      req.end('{}');
    });
    assert.equal(cross, 403);

    // Missing fields, unknown toolkits and Composio's own errors come back as such; nothing is announced.
    assert.equal((await request(port, 'POST', '/api/composio/linear/issues/create', { title: 'x' }, o.asFay)).status, 502);
    assert.equal((await request(port, 'POST', '/api/composio/connect', { toolkit: 'jira' }, o.asFay)).status, 400);
    r = await request(port, 'POST', '/api/composio/slack/send?floor=f1', { channel: 'C9', text: 'hi' }, o.asFay);
    assert.equal(r.status, 502);
    assert.match(JSON.parse(r.body).error, /switched off|channel_not_found/);
    assert.equal(o.sent.length, 1);

    // Connecting: Composio's link, with the office's own callback on it; the callback page needs no body.
    r = await request(port, 'POST', '/api/composio/connect', { toolkit: 'notion', origin: `http://localhost:${port}` }, o.asFay);
    assert.equal(r.status, 200);
    const link = new URL(JSON.parse(r.body).url);
    assert.equal(link.host, 'connect.composio.dev');
    assert.equal(link.searchParams.get('cb'), `http://localhost:${port}/api/composio/callback?toolkit=notion`);
    r = await request(port, 'GET', '/api/composio/callback?toolkit=notion&status=success', undefined, o.asFay);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] ?? '', /text\/html/);
    assert.match(r.body, /Connected notion/);
    assert.equal((await request(port, 'GET', '/api/composio/nothing', undefined, o.asFay)).status, 404);
  } finally {
    o.close();
  }
});

test("GitHub through Composio: the elevator's repository list and lookup, for an account that connected it", async () => {
  const { ComposioGitHub } = await import('../../src/server/integrations/github-composio.js');
  const dir = tmp('gh');
  const page1 = Array.from({ length: 100 }, (_, i) => ({ full_name: `annazoi/repo-${i}`, private: i % 2 === 0, description: i ? `d${i}` : '', pushed_at: '2026-10-01T00:00:00Z' }));
  const page2 = [{ full_name: 'annazoi/last', private: false }, { full_name: 'annazoi/repo-1', private: false }];
  const calls: Record<string, unknown>[] = [];
  const { sdk } = fakeSdk({}, ['github']);
  const session = await sdk.create('x', { toolkits: [], mcp: true });
  const execute = session.execute;
  session.execute = async (slug, args = {}) => {
    calls.push({ slug, ...args });
    if (slug === 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER') return { data: { repositories: args.page === 1 ? page1 : page2 }, error: null };
    if (slug === 'GITHUB_GET_A_REPOSITORY') return args.repo === 'missing' ? { data: {}, error: 'Not Found' } : { data: { full_name: 'AgentSystemLabs/agent-office', size: 0 }, error: null };
    return execute(slug, args);
  };
  sdk.create = async () => session;
  const hub = new ComposioHub(dir, () => {}, () => {}, async () => sdk);
  await hub.setKey(KEY, 'test');
  const github = new ComposioGitHub(hub);
  assert.equal(await github.blocked('a1'), undefined, 'its connections are looked at when asked');
  assert.equal(await github.blocked(undefined), 'Sign in with your account to connect your tools');
  // The account's own token, for git; and nothing at all for one that hasn't GitHub connected.
  assert.match((await github.token('a1')) ?? '', /^gho_token_of_ca_github_ao_a1_/);
  assert.notEqual(await github.token('a1'), await github.token('a2'), "each person's own");
  const repos = await github.list('a1');
  assert.equal(repos.length, 101, 'two pages, the duplicate dropped');
  assert.deepEqual(repos[0], { name: 'annazoi/repo-0', description: undefined, private: true, pushedAt: '2026-10-01T00:00:00Z' });
  assert.deepEqual(calls.filter((c) => c.slug === 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER').map((c) => c.page), [1, 2]);
  assert.deepEqual(await github.view('a1', 'agentsystemlabs/agent-office'), { repo: 'AgentSystemLabs/agent-office', empty: true });
  await assert.rejects(github.view('a1', 'annazoi/missing'), /Not Found/);
  await assert.rejects(github.view('a1', 'nonsense'), /owner\/name/);
});

test("GitHub through Composio asks for a connection first, and a masked token is no token", async () => {
  const { ComposioGitHub } = await import('../../src/server/integrations/github-composio.js');
  // Only linear connected: GitHub is not.
  const { sdk } = fakeSdk({}, ['linear']);
  const hub = new ComposioHub(tmp('gh2'), () => {}, () => {}, async () => sdk);
  const github = new ComposioGitHub(hub);
  assert.match((await github.blocked('a1')) ?? '', /no Composio API key/);
  await hub.setKey(KEY, 'test');
  assert.match((await github.blocked('a1')) ?? '', /Connect your GitHub first/);
  hub.setToolkits(['linear']);
  assert.match((await github.blocked('a1')) ?? '', /GitHub is switched off/);
  // A project that masks connection secrets gives git nothing to use.
  const masked = fakeSdk({}, ['github']);
  masked.sdk.connectedAccounts.list = async () => ({ items: [{ id: 'ca_masked', status: 'ACTIVE', toolkit: { slug: 'github' } }] });
  const hub2 = new ComposioHub(tmp('gh3'), () => {}, () => {}, async () => masked.sdk);
  await hub2.setKey(KEY, 'test');
  assert.equal(await new ComposioGitHub(hub2).token('a1'), undefined);
});
