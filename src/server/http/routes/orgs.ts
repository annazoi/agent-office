// An organisation invite's link, /invite#<token>: what it's for, and accepting it. Whoever opens it
// may already be signed in, may sign in with the account they have, or, when an office admin sent
// it, make an account there and then. The token is a secret, so every try counts like a password guess.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { orgsChanged } from '../../accounts/orgs/notify.js';
import type { Invite } from '../../accounts/orgs/store.js';
import { clientIp, isSecure, readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

const GONE = 'This invite has expired, was revoked or was used already. Ask whoever sent it for a new one.';

/** Whether opening `invite` may make a new account: only an office admin's invites let people in who have none. */
const mayRegister = (ctx: Ctx, invite: Invite) => ctx.accounts.get(invite.createdBy)?.role === 'admin';

async function orgInvite(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  const { auth, accounts, orgs } = ctx;
  const ip = clientIp(req, ctx.cfg.trustProxy);
  if (!auth.allowAttempt(ip)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(req, 4096));
    if (!body || typeof body !== 'object') throw new Error();
  } catch {
    return send(res, 400, { error: 'Bad request' });
  }
  const token = str(body.token, 128);
  const invite = orgs.findInvite(token);
  const org = invite && orgs.get(invite.orgId);
  if (!invite || !org) return send(res, 410, { error: GONE });
  // Not counted as a success until it's accepted: a good token mustn't reset the count for password guesses.
  const session = auth.fromRequest(req);

  if (body.peek === true) {
    return send(res, 200, {
      org: org.name,
      role: invite.role,
      email: invite.email,
      by: accounts.get(invite.createdBy)?.name ?? 'Someone',
      signedInAs: session?.account.name,
      already: !!(session && orgs.membership(org.id, session.account.id)),
      canRegister: mayRegister(ctx, invite),
    });
  }

  let accountId: string;
  let headers: Record<string, string> = {};
  const signIn = (id: string) => ({ 'set-cookie': auth.cookie(req, auth.issue(id), isSecure(req, ctx.cfg)) });
  if (body.action === 'accept') {
    if (!session) return send(res, 401, { error: 'Sign in first' });
    // Only the office's own page accepts for whoever is signed in, never another site with their cookie.
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    accountId = session.account.id;
  } else if (body.action === 'login') {
    const a = await accounts.check(str(body.name, 64).trim(), str(body.password, 512));
    if (!a) return send(res, 401, { error: 'Wrong name or password' });
    accountId = a.id;
    headers = signIn(a.id);
  } else if (body.action === 'register') {
    if (!mayRegister(ctx, invite)) return send(res, 403, { error: 'Sign in with your account to accept this invite: ask an office admin if you have none.' });
    const a = await accounts.register(str(body.name, 64), str(body.password, 1024));
    if (typeof a === 'string') return send(res, 400, { error: a });
    console.log(`  ${a.name} registered with an invite to ${org.name}`);
    accountId = a.id;
    headers = signIn(a.id);
  } else return send(res, 400, { error: 'Bad request' });

  // Signing in or hashing a password took a moment: the invite may have been used meanwhile.
  const joined = orgs.accept(token, accountId);
  if (typeof joined === 'string') return send(res, 410, { error: joined }, headers);
  auth.recordSuccess(ip);
  console.log(`  ${accounts.get(accountId)?.name} joined ${joined.name}`);
  ctx.accountsChanged();
  orgsChanged(ctx);
  return send(res, 200, { ok: true, org: joined.name }, headers);
}

export const orgRoutes = {
  invite: { method: 'POST', path: '/api/org-invite', auth: 'public', handle: (ctx, { req, res }) => orgInvite(ctx, req, res) },
} satisfies Record<string, Route>;
