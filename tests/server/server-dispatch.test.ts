// Boots the real office the way cli.ts does (a throwaway home and project, an ephemeral port, the
// tests' in-memory database), then talks to it as a browser would: its HTTP routes before and after
// registering and signing in, a WebSocket with the welcome and a few messages each way, and the
// loopback hook server the workers call.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { loadConfig } from '../../src/server/config.js';
import { startServer } from '../../src/server/server.js';
import type { ServerMsg } from '../../src/shared/protocol.js';

type Office = Awaited<ReturnType<typeof startServer>>;
type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

let tmp = '';
let office: Office;
let base = '';
let hooks = '';
let cookie = '';
/** Each person's session cookie, once they've registered. */
const cookies: Record<string, string> = {};
const PASSWORD = 'dispatch-test';
/** Everyone's own password (they're each at least 8 characters). */
const own = (name: string) => `${name.toLowerCase()}-password`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** A browser's end of the office's WebSocket: everything it was sent, taken in order by type. */
class Browser {
  private inbox: ServerMsg[] = [];
  private wake: (() => void) | undefined;
  closed = false;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      this.inbox.push(JSON.parse(raw.toString()));
      this.wake?.();
    });
    ws.on('close', () => (this.closed = true));
  }

  /** A browser signed in as `who` (Ada, the office's admin, when not given). */
  static as(who: string, query = ''): Promise<Browser> {
    return Browser.open(query, { cookie: cookies[who], origin: base });
  }

  static open(query = '', headers: Record<string, string> = { cookie, origin: base }): Promise<Browser> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws${query}`, { headers });
      const b = new Browser(ws);
      ws.once('open', () => resolve(b));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`refused: ${res.statusCode}`)));
    });
  }

  send(msg: unknown) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** The first message of type `t` (that `ok` accepts) not taken yet, waiting for it if need be. */
  async take<T extends ServerMsg['t']>(t: T, ok: (m: Msg<T>) => boolean = () => true, ms = 5000): Promise<Msg<T>> {
    const until = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && ok(m as Msg<T>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Msg<T>;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms}ms; got ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = undefined;
    }
  }

  /** Every message of type `t` received so far and not taken. */
  pending(t: ServerMsg['t']): ServerMsg[] {
    return this.inbox.filter((m) => m.t === t);
  }

  /** Waits for what's still on its way (the elevator's list goes out a moment later), then forgets all of it. */
  async drain(ms = 400) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    this.inbox = [];
  }

  /** The types of the next `n` messages, in the order they came, leaving out the elevator's list and the dog, who goes about its day. */
  async next(n: number, ms = 5000): Promise<string[]> {
    const until = Date.now() + ms;
    for (;;) {
      const got = this.inbox.filter((m) => m.t !== 'floors' && m.t !== 'dog');
      if (got.length >= n) {
        this.inbox = [];
        return got.slice(0, n).map((m) => m.t);
      }
      const left = until - Date.now();
      if (left <= 0) throw new Error(`only ${got.map((m) => m.t).join(', ')} within ${ms}ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = undefined;
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

const get = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { headers, redirect: 'manual' });
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-dispatch-'));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  const publicDir = path.join(tmp, 'public');
  const bin = path.join(tmp, 'bin');
  for (const d of [home, project, publicDir, path.join(publicDir, 'assets'), bin, path.join(tmp, 'projects')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# dispatch\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']]) {
    execFileSync('git', args, { cwd: project });
  }
  // A client bundle of its own, so the test needn't build one.
  for (const page of ['index', 'login', 'claim', 'join', 'lite']) writeFileSync(path.join(publicDir, `${page}.html`), `<!doctype html><title>${page}</title>`);
  writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(publicDir, 'assets', 'app.js'), 'export {};\n');
  // A stand-in for Claude Code, so reading the plan's limits never runs the real one.
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n');
  chmodSync(claude, 0o755);

  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];
  const port = await freePort();
  const cfg = loadConfig([project, '--home', home, '--projects', path.join(tmp, 'projects'), '--port', String(port), '--password', PASSWORD, '--no-open', '--weather', 'clear', '--agent', claude]);
  office = await startServer(cfg, { publicDir });
  base = `http://127.0.0.1:${port}`;
  hooks = `http://127.0.0.1:${office.hookPort}`;
});

after(() => {
  office?.shutdown();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('answers the open routes before anyone signs in', async () => {
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.deepEqual(await (await get('/api/login')).json(), { accounts: false, registration: true });
  assert.deepEqual(await (await get('/api/claim')).json(), { claimable: false });

  const login = await get('/login');
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.match(await login.text(), /<title>login<\/title>/);
  assert.equal((await get('/favicon.svg')).headers.get('content-type'), 'image/svg+xml');
  const asset = await get('/assets/app.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/assets/missing.js')).status, 404);

  // Everything else waits for a session.
  const home = await get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  assert.equal((await get('/lite')).headers.get('location'), '/login?next=/lite');
  const whoami = await get('/api/whoami');
  assert.equal(whoami.status, 401);
  assert.deepEqual(await whoami.json(), { error: 'Not logged in' });
  assert.equal((await get('/%zz')).status, 400);
  assert.match(await (await get('/claim')).text(), /<title>claim<\/title>/);
  assert.match(await (await get('/join.html')).text(), /<title>join<\/title>/);
  assert.deepEqual(await (await fetch(base + '/api/health', { method: 'POST' })).json(), { ok: true });
  // A route for another method is passed over, on to the sign-in check.
  const put = await fetch(base + '/api/login', { method: 'PUT' });
  assert.equal(put.status, 401);
  assert.deepEqual(await put.json(), { error: 'Not logged in' });
  assert.deepEqual(await (await post('/api/claim', { token: 'nope' })).json(), { error: 'This office has already been claimed. Sign in, or register with the password you saved.' });
  assert.equal((await post('/api/link', { key: 'nope' })).status, 410);
  assert.equal((await post('/api/join', { token: 'nope' })).status, 410);
});

const cookieOf = (res: Response) => {
  const set = res.headers.get('set-cookie') ?? '';
  assert.match(set, /^ao_session_\d+=/);
  return set.split(';')[0];
};

test('the first account is registered with the office password and runs the office; then everyone signs in', async () => {
  // Nobody has an account yet: there's nobody to sign in as.
  assert.deepEqual(await (await post('/api/login', { password: PASSWORD })).json(), { error: 'Nobody has an account yet: register the first one' });
  const wrong = await post('/api/register', { name: 'Ada', password: own('Ada'), officePassword: 'nope' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "That isn't the office password" });
  assert.equal((await post('/api/register', 'not json')).status, 400);
  assert.deepEqual(await (await post('/api/register', { name: 'Ada', password: 'short', officePassword: PASSWORD })).json(), { error: 'Pick a password of at least 8 characters' });
  assert.deepEqual(await (await post('/api/register', { name: 'Ada', password: own('Ada'), key: 'nope' })).json(), { error: 'That link was already used. Register with the office password instead.' });

  const ada = await post('/api/register', { name: 'Ada', password: own('Ada'), officePassword: PASSWORD });
  assert.equal(ada.status, 200);
  assert.deepEqual(await ada.json(), { ok: true, name: 'Ada', role: 'admin' });
  cookie = cookies.Ada = cookieOf(ada);
  // The rest register as members; a name can't be taken twice.
  for (const name of ['Bo', 'Cy', 'Di', 'Eve']) {
    const r = await post('/api/register', { name, password: own(name), officePassword: PASSWORD });
    assert.deepEqual(await r.json(), { ok: true, name, role: 'member' });
    cookies[name] = cookieOf(r);
  }
  assert.deepEqual(await (await post('/api/register', { name: 'ada', password: own('Ada'), officePassword: PASSWORD })).json(), { error: "There's already an account called ada" });
  assert.deepEqual(await (await get('/api/login')).json(), { accounts: true, registration: true });

  const nameless = await post('/api/login', { password: own('Ada') });
  assert.deepEqual(await nameless.json(), { error: 'Type your name too' });
  const bad = await post('/api/login', { name: 'Ada', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { error: 'Wrong name or password' });
  assert.equal((await post('/api/login', 'not json')).status, 400);
  const ok = await post('/api/login', { name: 'ada', password: own('Ada') });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  cookie = cookies.Ada = cookieOf(ok);
});

test('each account keeps its own settings in the database', async () => {
  const ada = { cookie: cookies.Ada, origin: base };
  const bo = { cookie: cookies.Bo, origin: base };
  assert.deepEqual(await (await get('/api/me/config', ada)).json(), { config: {} });
  assert.deepEqual(await (await post('/api/me/config', { 'agent-office.settings': '{"volume":0.5}', 'agent-office.floor': 'f1' }, ada)).json(), { ok: true });
  assert.deepEqual(await (await post('/api/me/config', { 'agent-office.floor': null }, ada)).json(), { ok: true });
  assert.deepEqual(await (await get('/api/me/config', ada)).json(), { config: { 'agent-office.settings': '{"volume":0.5}' } });
  // Nobody else sees it.
  assert.deepEqual(await (await get('/api/me/config', bo)).json(), { config: {} });
  assert.equal((await post('/api/me/config', { 'not a key!': 'x' }, ada)).status, 400);
  assert.equal((await post('/api/me/config', { 'agent-office.n': 3 }, ada)).status, 400);
  assert.equal((await post('/api/me/config', '[]', ada)).status, 400);
  assert.equal((await post('/api/me/config', { 'agent-office.big': 'x'.repeat(600 * 1024) }, ada)).status, 413);
  assert.equal((await get('/api/me/config')).status, 401);
  // Only from the office's own pages.
  assert.equal((await post('/api/me/config', { 'agent-office.floor': 'x' }, { cookie: cookies.Ada })).status, 403);
  assert.equal((await post('/api/me/config', { 'agent-office.floor': 'x' }, { cookie: cookies.Ada, origin: 'https://evil.example' })).status, 403);
});

test('answers the signed-in routes', async () => {
  const me = { cookie };
  assert.deepEqual(await (await get('/api/whoami', me)).json(), { ok: true, me: { account: { name: 'Ada', role: 'admin' }, admin: true } });
  assert.match(await (await get('/', me)).text(), /<title>index<\/title>/);
  assert.match(await (await get('/lite', me)).text(), /<title>lite<\/title>/);
  const floor = office.floors()[0].id;
  assert.deepEqual(await (await get(`/api/search?q=zzzz&floor=${floor}`, me)).json(), { q: 'zzzz', chat: [], terminals: [], more: false });
  assert.deepEqual(await (await get('/api/search?q=z', me)).json(), { q: 'z', chat: [], terminals: [], more: false });

  const bad = async (res: Response, status: number, error: string) => {
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), { error });
  };
  await bad(await get('/api/gh/pull?number=0', me), 400, 'Bad number');
  await bad(await get('/api/gh/pull?number=3&floor=nope', me), 404, 'No such floor');
  await bad(await get('/api/docs?floor=nope', me), 404, 'No such floor');
  await bad(await get('/api/whiteboard/file?floor=nope', me), 404, 'No such floor');
  await bad(await get(`/api/whiteboard/file?floor=${floor}&id=nope`, me), 404, 'No such picture');
  await bad(await get('/api/term/drop', me), 405, 'Method not allowed');
  await bad(await post('/api/term/drop', '', me), 403, 'Forbidden');
  await bad(await get('/api/changes/file', me), 400, 'Bad request');
  await bad(await get(`/api/docs/file?floor=${floor}`, me), 400, 'Bad request');
  await bad(await get(`/api/docs/other?floor=${floor}&path=x`, me), 404, 'Not found');
  assert.deepEqual(await (await fetch(base + '/api/whoami', { method: 'POST', headers: me })).json(), { ok: true, me: { account: { name: 'Ada', role: 'admin' }, admin: true } });
  for (const [method, p] of [['GET', '/nothing-here.txt'], ['PUT', '/api/login'], ['POST', '/api/docs'], ['POST', '/api/search']]) {
    const missing = await fetch(base + p, { method, headers: me });
    assert.equal(missing.status, 404, `${method} ${p}`);
    assert.equal(await missing.text(), 'Not found');
  }

  const out = await post('/api/logout', {}, me);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('refuses a WebSocket from another site or without a session', async () => {
  await assert.rejects(Browser.open('', { cookie }), /refused: 401/);
  await assert.rejects(Browser.open('', { origin: base }), /refused: 401/);
});

test('welcomes a browser and dispatches what it sends', async () => {
  const floor = office.floors()[0];
  const a = await Browser.open('?name=Someone&color=%23ff8a5b');
  const welcome = await a.take('welcome');
  assert.equal(welcome.floor, floor.id);
  assert.equal(welcome.project?.name, floor.project.name);
  assert.deepEqual(welcome.me, { account: { name: 'Ada', role: 'admin' }, admin: true });
  assert.deepEqual(welcome.workers, []);
  assert.equal(welcome.floors.length, 1);
  assert.equal(welcome.floors[0].id, floor.id);
  const ada = welcome.peers.find((p) => p.id === welcome.you);
  assert.equal(ada?.name, 'Ada');
  assert.equal(ada?.color, '#ff8a5b');
  assert.equal(ada?.floor, floor.id);
  assert.deepEqual(Object.keys(welcome).slice(-17), ['floor', 'project', 'workers', 'issues', 'pulls', 'queue', 'decor', 'plan', 'services', 'dog', 'ball', 'cars', 'jail', 'jukebox', 'whiteboard', 'meeting', 'cabinet']);

  a.send({ t: 'ping', at: 42 });
  const pong = await a.take('pong');
  assert.equal(pong.at, 42);
  assert.equal(typeof pong.now, 'number');

  // Someone else walks in: each sees the other. Everyone goes by their account's name.
  const b = await Browser.as('Bo');
  const bWelcome = await b.take('welcome');
  const joined = await a.take('peer.join');
  assert.equal(joined.peer.id, bWelcome.you);
  assert.equal(joined.peer.name, 'Bo');

  b.send({ t: 'move', x: 1.5, y: 0, z: -2, rotY: 0.5, moving: true });
  const moved = await a.take('peer.move');
  assert.deepEqual(moved, { t: 'peer.move', id: bWelcome.you, x: 1.5, y: 0, z: -2, rotY: 0.5, moving: true });

  a.send({ t: 'chat', text: '  hello there  ' });
  for (const who of [a, b]) {
    const line = await who.take('chat');
    assert.equal(line.text, 'hello there');
    assert.equal(line.name, 'Ada');
  }

  a.send({ t: 'profile', name: 'Ada L', color: '#123456', look: {} });
  for (const who of [a, b]) {
    const { peer } = await who.take('peer.update', (m) => m.peer.id === welcome.you);
    assert.deepEqual([peer.name, peer.color], ['Ada', '#123456']);
  }

  // A sign over a desk: the floor sees the plan change and hears who hung it.
  a.send({ t: 'desk.label', deskId: 'desk-1', text: 'Payments' });
  assert.equal((await b.take('plan')).plan.labels['desk-1']?.text, 'Payments');
  for (const who of [a, b]) assert.equal((await who.take('toast', (m) => m.text.includes('Payments'))).text, '🪧 Ada hung a sign over Desk 1: “Payments”');

  a.send({ t: 'leaveOnMerge.set', on: true });
  for (const who of [a, b]) {
    assert.equal((await who.take('leaveOnMerge')).state.on, true);
    assert.match((await who.take('toast', (m) => m.text.includes('go home'))).text, /^🏠 Ada set workers to go home/);
  }

  // Only for Ada: a floor that isn't there, her own sign-ins, and the accounts list (she's the admin).
  a.send({ t: 'floor.go', floor: 'nope' });
  assert.deepEqual(await a.take('toast', (m) => m.level === 'warn'), { t: 'toast', text: 'No such floor', level: 'warn' });
  a.send({ t: 'signins.get' });
  assert.ok((await a.take('signins')).state.claude);
  a.send({ t: 'accounts.get' });
  const accounts = (await a.take('accounts')).state;
  assert.equal(accounts.openRegistration, true);
  assert.deepEqual(accounts.accounts.map((x) => [x.name, x.role]), [['Ada', 'admin'], ['Bo', 'member'], ['Cy', 'member'], ['Di', 'member'], ['Eve', 'member']]);
  // A member can't manage accounts.
  b.send({ t: 'accounts.get' });
  assert.equal((await b.take('toast', (m) => m.level === 'warn')).text, 'Only admins can manage accounts');

  // Frames that aren't messages, or whose type isn't one, are dropped; the office carries on.
  for (const odd of ['not json', '42', 'null', '"text"', '[]', {}, { t: 'nope' }, { t: 'constructor' }, { t: '__proto__' }, { t: 'toString' }, { t: 'hasOwnProperty' }, { t: '__defineGetter__' }, { t: 7 }, { t: ['ping'], at: 99 }]) a.send(odd);
  a.send({ t: 'ping', at: 43 });
  assert.equal((await a.take('pong')).at, 43);
  assert.deepEqual(a.pending('toast'), []);

  await b.close();
  assert.equal((await a.take('peer.leave')).id, bWelcome.you);
  await a.close();
});

test('the toys on a floor, and letting go of them on leaving the floor or the office', async () => {
  const floor = office.floors()[0];
  const a = await Browser.as('Cy');
  const cy = (await a.take('welcome')).you;
  const b = await Browser.as('Di');
  await b.take('welcome');
  await a.take('peer.join');
  // Their own sign-ins come in on their own, a moment after the welcome.
  await b.drain();

  a.send({ t: 'jukebox.skip' });
  assert.equal((await b.take('jukebox')).state.on, true);
  assert.match((await b.take('toast', (m) => m.text.startsWith('⏭️'))).text, /^⏭️ Cy skipped to “.+”$/);
  a.send({ t: 'jukebox.stop' });
  assert.equal((await b.take('jukebox')).state.on, false);
  assert.equal((await b.take('toast', (m) => m.text.startsWith('🔇'))).text, '🔇 Cy turned the jukebox off');
  a.send({ t: 'dog.name', name: 'Rex' });
  assert.equal((await b.take('toast', (m) => m.text.startsWith('🐶'))).text, '🐶 Cy named the dog Rex');

  // The gong once, not twice in a row; no air horn off the roof, and no golf without a club.
  a.send({ t: 'gong' });
  a.send({ t: 'gong' });
  a.send({ t: 'horn' });
  a.send({ t: 'golf', yaw: 0, loft: 0.5, power: 0.5 });
  a.send({ t: 'act', golf: true });
  a.send({ t: 'golf', yaw: 0.25, loft: 0.5, power: 0.5 });
  assert.deepEqual(await b.next(3), ['gong', 'peer.act', 'golf']);

  a.send({ t: 'wb.open' });
  assert.deepEqual((await b.take('wb.people')).people, [cy]);
  b.send({ t: 'wb.open' });
  assert.equal((await a.take('wb.people', (m) => m.people.length === 2)).people.length, 2);
  a.send({ t: 'wb.pointer', x: 1, y: 2, tool: 'laser', button: 'down' });
  assert.deepEqual(await b.take('wb.pointer'), { t: 'wb.pointer', id: cy, x: 1, y: 2, tool: 'laser', button: 'down' });

  const holdEverything = async () => {
    a.send({ t: 'wb.open' });
    a.send({ t: 'ball.take' });
    assert.equal((await b.take('ball')).ball.holder, cy);
    a.send({ t: 'car.enter', car: 0, seat: 'driver' });
    await a.take('cars', (m) => m.answer === true);
    await b.take('cars');
    a.send({ t: 'cabinet.play' });
    assert.equal((await b.take('cabinet')).state.player?.id, cy);
    await b.drain();
  };
  await holdEverything();
  // Up to the roof: the floor sees the arcade free up, Cy go, and then the whiteboard, the ball and the car.
  a.send({ t: 'floor.go', floor: '@roof' });
  assert.equal((await a.take('floor.enter')).floor, '@roof');
  assert.deepEqual(await b.next(5), ['cabinet', 'peer.update', 'wb.people', 'ball', 'cars']);

  a.send({ t: 'floor.go', floor: floor.id });
  assert.equal((await a.take('floor.enter')).floor, floor.id);
  await holdEverything();
  // Out of the office: the whiteboard, the arcade, the ball and the car, then Cy's gone.
  await a.close();
  assert.deepEqual(await b.next(5), ['wb.people', 'cabinet', 'ball', 'cars', 'peer.leave']);
  await b.close();
});

test('settings, accounts and the boards answer as before', async () => {
  // Eve is made an admin, so she may manage the accounts too.
  office.accounts.setRole(office.accounts.byName('Eve')!.id, 'admin');
  const a = await Browser.as('Eve');
  await a.take('welcome');
  const warned = async (text: string) => assert.equal((await a.take('toast', (m) => m.level === 'warn')).text, text);
  const told = async (start: string) => (await a.take('toast', (m) => m.level === 'info' && m.text.startsWith(start))).text;

  a.send({ t: 'theme.set', pick: 'nope' });
  a.send({ t: 'theme.set', pick: 'off' });
  assert.equal((await a.take('theme')).state.pick, 'off');
  assert.equal(await told('Eve took'), 'Eve took the holiday decorations down');
  a.send({ t: 'map.set', map: 'nowhere' });
  await warned('There’s no map by that name, or it won’t load: see ⚙️ Settings');
  a.send({ t: 'machine.limit', limit: 0 });
  await warned('The worker limit is a whole number from 1 to 500');
  a.send({ t: 'machine.limit', limit: 3 });
  assert.equal((await a.take('machine', (m) => m.state.limit === 3)).state.limit, 3);
  assert.equal(await told('⚙️'), '⚙️ Eve set the worker limit to 3');
  a.send({ t: 'prompts.set', id: 'nope', text: 'x' });
  a.send({ t: 'prompts.agent', choice: null });
  assert.equal(await told('🤖'), '🤖 Eve put the office’s default worker back to claude');
  a.send({ t: 'notify.webhook', url: 'not a url' });
  assert.match((await a.take('toast', (m) => m.level === 'warn')).text, /./);
  a.send({ t: 'upgrade.check' });
  a.send({ t: 'limits.refresh' });

  a.send({ t: 'accounts.invite', name: 'Fay', role: 'member' });
  const invite = (await a.take('accounts.invited')).invite;
  assert.equal(invite?.name, 'Fay');
  assert.equal((await a.take('accounts', (m) => m.state.invites.length > 0)).state.invites[0].name, 'Fay');
  a.send({ t: 'accounts.cancel', inviteId: invite?.id });
  await a.take('accounts', (m) => m.state.invites.length === 0);
  a.send({ t: 'accounts.revoke', accountId: 'nobody' });
  a.send({ t: 'accounts.registration', on: false });
  await a.take('accounts', (m) => !m.state.openRegistration);
  assert.match(await told('🔑'), /^🔑 Eve closed registration/);
  // Closed: the office password registers nobody, though everyone already in signs in as before.
  assert.equal((await post('/api/register', { name: 'Gus', password: own('Gus'), officePassword: PASSWORD })).status, 403);
  assert.equal((await post('/api/login', { name: 'Bo', password: own('Bo') })).status, 200);
  a.send({ t: 'accounts.registration', on: true });
  await a.take('accounts', (m) => m.state.openRegistration);
  await told('Eve let people register');

  a.send({ t: 'gh.merge', number: 0, method: 'squash', deleteBranch: false });
  a.send({ t: 'gh.close', kind: 'nope', number: 3 });
  a.send({ t: 'gh.comment', kind: 'issue', number: 3, body: '  ' });
  assert.deepEqual(await a.take('gh.commented'), { t: 'gh.commented', kind: 'issue', number: 3, error: 'The comment is empty' });
  a.send({ t: 'gh.labels', kind: 'pull', number: 3, add: [], remove: [''] });
  assert.deepEqual(await a.take('gh.labeled'), { t: 'gh.labeled', kind: 'pull', number: 3, error: 'No labels to change' });
  a.send({ t: 'queue.add', prompt: 'x', provider: 'nope' });
  await warned('Unknown agent provider');
  a.send({ t: 'meeting.start', pattern: 'debate', prompt: 'x', roles: [], provider: 'nope' });
  await warned('Unknown agent provider');
  a.send({ t: 'queue.move', taskId: 'nope', delta: 1 });
  a.send({ t: 'changes.watch', workerId: 'nope' });
  a.send({ t: 'changes.unwatch', workerId: 'nope' });
  a.send({ t: 'changes.diff', workerId: 'nope', path: 'a.ts' });
  assert.deepEqual(await a.take('changes.diff'), { t: 'changes.diff', workerId: 'nope', path: 'a.ts', diff: '', truncated: false, error: 'No such worker' });
  a.send({ t: 'worker.resume', workerId: 'nope' });
  await warned('No such worker');
  a.send({ t: 'worker.prompt', workerId: 'nope', prompt: 'hi' });
  await warned('No such worker');

  a.send({ t: 'worker.spawn', deskId: 'desk-1', provider: 'nope' });
  await warned('Unknown agent provider');
  a.send({ t: 'worker.spawn', deskId: 'desk-1', kind: 'shell', repos: ['nope'] });
  await warned('That project is no longer in the building');
  a.send({ t: 'worker.kill', workerId: 'nope' });
  a.send({ t: 'worker.detach', workerId: 'nope' });
  a.send({ t: 'worker.attach', workerId: 'nope' });
  a.send({ t: 'term.input', workerId: 'nope', data: 'ls' });
  a.send({ t: 'term.typing', workerId: 'nope' });
  a.send({ t: 'term.resize', workerId: 'nope', cols: 80, rows: 24 });
  a.send({ t: 'floor.expand' });
  assert.equal((await a.take('plan')).plan.wing, 1);
  assert.match(await told('🔨'), /^🔨 Eve knocked out the back wall: Desk \d+ and Desk \d+ are ready for workers$/);
  a.send({ t: 'floor.shrink' });
  assert.equal((await a.take('plan')).plan.wing, 0);
  assert.match(await told('🧱'), /^🧱 Eve walled the back office back up, and Desk \d+ and Desk \d+ went with it$/);
  a.send({ t: 'floor.projectsDir', dir: 'relative/dir' });
  await warned('Use a full path, like ~/Workspace');
  a.send({ t: 'floor.remove', floor: 'nope' });
  assert.match((await a.take('toast', (m) => m.level === 'warn')).text, /./);
  a.send({ t: 'floor.go', floor: office.floors()[0].id });

  // The last word: nothing else came back for any of it.
  a.send({ t: 'ping', at: 44 });
  assert.equal((await a.take('pong')).at, 44);
  assert.deepEqual([...a.pending('toast'), ...a.pending('gh.merged'), ...a.pending('gh.closed')], []);
  a.send({ t: 'machine.limit', limit: null });
  await a.take('machine', (m) => m.state.limit === undefined);
  await a.close();
});

test('the hook server answers only workers, with their own token', async () => {
  const hook = (p: string, init: RequestInit = {}) => fetch(hooks + p, init);
  assert.equal((await hook('/hooks/claude?worker=nobody', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await hook('/hooks/codex?worker=nobody', { method: 'POST', body: 'not json' })).status, 400);
  assert.equal((await hook('/hooks/claude?worker=nobody')).status, 404);
  assert.equal((await hook('/elsewhere')).status, 404);
  for (const p of ['/office/queue?worker=nobody', '/office/workers?worker=nobody']) {
    const res = await hook(p, { headers: { authorization: 'Bearer nope' } });
    assert.equal(res.status, 401);
    assert.match(((await res.json()) as { error: string }).error, /AGENT_OFFICE_WORKER_ID/);
  }
});
