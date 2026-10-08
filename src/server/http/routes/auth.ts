// Signing in and out, and registering. Everyone signs in with an account of their own; an account is
// made with the office password (registering), an invite link, or the one-time link printed in the
// office's terminal. The claim link shows a generated office password, once.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { clientIp, isSecure, readBody, send } from '../util.js';
import type { Route } from '../router.js';

const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again in a few minutes.';

/**
 * A password, claim-token or invite guess: counts it against the IP, then reads the small JSON
 * body. Undefined once it has already answered (rate limited, or a bad body).
 */
async function readGuess(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): Promise<{ ip: string; body: Record<string, unknown> } | undefined> {
  const ip = clientIp(req, ctx.cfg.trustProxy);
  // Counted before the body is read, so parallel guesses can't all slip under the limit.
  if (!ctx.auth.allowAttempt(ip)) return void send(res, 429, { error: TOO_MANY_ATTEMPTS });
  try {
    const body = JSON.parse(await readBody(req, 4096));
    if (body && typeof body === 'object') return { ip, body };
  } catch {
    // answered below
  }
  send(res, 400, { error: 'Bad request' });
}
const signedIn = (ctx: Ctx, req: http.IncomingMessage, accountId: string) => ({ 'set-cookie': ctx.auth.cookie(req, ctx.auth.issue(accountId), isSecure(req, ctx.cfg)) });

/** Signs in with an account's name and its own password. */
export async function login(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  const { accounts, auth } = ctx;
  const guess = await readGuess(ctx, req, res);
  if (!guess) return;
  const name = str(guess.body.name, 64).trim();
  const password = str(guess.body.password, 512);
  if (!name) return send(res, 400, { error: accounts.any ? 'Type your name too' : 'Nobody has an account yet: register the first one' });
  const account = await accounts.check(name, password);
  if (!account) return send(res, 401, { error: 'Wrong name or password' });
  auth.recordSuccess(guess.ip);
  return send(res, 200, { ok: true }, signedIn(ctx, req, account.id));
}

/**
 * Registers an account and signs it in: with the office's one-time link from its terminal (`key`),
 * or with the office password while registration is open. The office's first account is its admin.
 */
async function register(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  const { accounts, auth } = ctx;
  const guess = await readGuess(ctx, req, res);
  if (!guess) return;
  const key = str(guess.body.key, 128);
  if (key) {
    if (!auth.hasLinkKey(key)) return send(res, 410, { error: 'That link was already used. Register with the office password instead.' });
  } else {
    if (!accounts.openRegistration) return send(res, 403, { error: 'This office takes new people by invite only. Ask an admin for an invite link.' });
    if (!(await auth.checkPassword(str(guess.body.officePassword, 512)))) return send(res, 401, { error: "That isn't the office password" });
  }
  const r = await accounts.register(str(guess.body.name, 64), str(guess.body.password, 1024));
  if (typeof r === 'string') return send(res, 400, { error: r });
  // Used up only now, so a name that was taken doesn't cost the link.
  if (key && !auth.useLinkKey(key)) {
    accounts.revoke(r.id);
    return send(res, 410, { error: 'That link was just used. Register with the office password instead.' });
  }
  auth.recordSuccess(guess.ip);
  console.log(`  ${r.name} registered${r.role === 'admin' ? ", the office's admin" : ''}`);
  ctx.accountsChanged();
  return send(res, 200, { ok: true, name: r.name, role: r.role }, signedIn(ctx, req, r.id));
}

/** Which fields the sign-in forms ask for: whether anyone has an account, and whether the office password registers one. */
export const loginOptions = (ctx: Ctx) => ({ accounts: ctx.accounts.any, registration: ctx.accounts.openRegistration });

/**
 * An invite link: `peek` says who it's for; otherwise it makes the account and signs it in.
 * Counted like a password guess, since the token is one.
 */
async function join(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  const { accounts, auth } = ctx;
  const guess = await readGuess(ctx, req, res);
  if (!guess) return;
  const token = str(guess.body.token, 128);
  const invite = accounts.findInvite(token);
  if (!invite) return send(res, 410, { error: 'This invite link has expired or was already used. Ask whoever sent it for a new one.' });
  auth.recordSuccess(guess.ip);
  if (guess.body.peek === true) return send(res, 200, { name: invite.name, role: invite.role, by: invite.createdBy, project: ctx.officeName });
  const r = await accounts.join(token, str(guess.body.name, 64), str(guess.body.password, 1024));
  if (typeof r === 'string') return send(res, 400, { error: r });
  console.log(`  ${r.name} joined the office with an invite from ${r.createdBy}`);
  ctx.accountsChanged();
  return send(res, 200, { ok: true, name: r.name }, signedIn(ctx, req, r.id));
}

// One-time reveal of the generated password. After this the plaintext is gone for good.
const claimable = ({ cfg }: Ctx) => !!cfg.claimToken && !cfg.claimed && !!cfg.password;

export const authRoutes = {
  login: { method: 'POST', path: '/api/login', auth: 'public', handle: (ctx, { req, res }) => login(ctx, req, res) },
  loginOptions: { method: 'GET', path: '/api/login', auth: 'public', handle: (ctx, { res }) => send(res, 200, loginOptions(ctx)) },
  register: { method: 'POST', path: '/api/register', auth: 'public', handle: (ctx, { req, res }) => register(ctx, req, res) },
  join: { method: 'POST', path: '/api/join', auth: 'public', handle: (ctx, { req, res }) => join(ctx, req, res) },
  claimable: { method: 'GET', path: '/api/claim', auth: 'public', handle: (ctx, { res }) => send(res, 200, { claimable: claimable(ctx) }) },
  claim: {
    method: 'POST',
    path: '/api/claim',
    auth: 'public',
    async handle(ctx, { req, res }) {
      const { cfg, auth } = ctx;
      const guess = await readGuess(ctx, req, res);
      if (!guess) return;
      if (!claimable(ctx)) return send(res, 410, { error: 'This office has already been claimed. Sign in, or register with the password you saved.' });
      if (!auth.checkToken(str(guess.body.token, 256), cfg.claimToken!)) return send(res, 403, { error: 'That claim link is not valid.' });
      const password = cfg.password!;
      cfg.markClaimed();
      auth.recordSuccess(guess.ip);
      console.log('  the office password was claimed — it will not be shown again');
      // Not signed in yet: the office password registers an account (the first one is the admin).
      return send(res, 200, { password, first: !ctx.accounts.any });
    },
  },
  // The link the office printed in its terminal (/login#key=…): whether it still registers an account.
  link: {
    method: 'POST',
    path: '/api/link',
    auth: 'public',
    async handle(ctx, { req, res }) {
      const guess = await readGuess(ctx, req, res);
      if (!guess) return;
      if (!ctx.auth.hasLinkKey(str(guess.body.key, 128))) return send(res, 410, { error: 'That link was already used. Sign in, or register with the office password.' });
      ctx.auth.recordSuccess(guess.ip);
      return send(res, 200, { ok: true, first: !ctx.accounts.any });
    },
  },
  logout: { method: 'POST', path: '/api/logout', auth: 'public', handle: (ctx, { req, res }) => send(res, 200, { ok: true }, { 'set-cookie': ctx.auth.clearCookie(req) }) },
  whoami: { path: '/api/whoami', auth: 'session', handle: (ctx, { res, session }) => send(res, 200, { ok: true, me: ctx.meOf(session.account.id) }) },
} satisfies Record<string, Route>;
