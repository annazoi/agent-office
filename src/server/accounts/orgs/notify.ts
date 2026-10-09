// Telling people about their organisations, and sending invites out.
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { inviteLink } from './mailer.js';
import type { Invite } from './store.js';

/** Sends `c` their organisations as they are now. */
export function sendOrgs(ctx: Ctx, c: Client) {
  if (!c.accountId || c.out) return;
  const state = ctx.orgs.state(c.accountId, ctx.onlineAccounts(), ctx.mailer.enabled);
  if (state) ctx.sendTo(c, { t: 'orgs', state });
}

/** Everyone in the office gets their organisations again: something about one of them changed. */
export function orgsChanged(ctx: Ctx) {
  ctx.orgs.ensure();
  for (const c of ctx.clients.values()) sendOrgs(ctx, c);
}

/**
 * Emails a just-made (or just re-issued) invite and tells `c` how it went, with its link to copy.
 * `origin` is the sender's page, for the link when the office has no public URL.
 */
export async function deliverInvite(ctx: Ctx, c: Client, made: { invite: Invite; token: string }, origin: string | undefined) {
  const { invite, token } = made;
  const link = inviteLink(token, origin);
  const org = ctx.orgs.get(invite.orgId);
  let error: string | undefined;
  if (!link) error = 'The office has no address to put in the email: set AGENT_OFFICE_PUBLIC_URL';
  else if (org) {
    error = await ctx.mailer.sendInvite({ to: invite.email, org: org.name, inviter: c.peer.name || ctx.accounts.get(c.accountId)?.name || 'Someone', role: invite.role, link, expiresAt: invite.expiresAt });
  }
  ctx.orgs.sent(invite.id, error);
  ctx.sendTo(c, { t: 'orgs.invited', orgId: invite.orgId, email: invite.email, ...(link ? { link } : {}), emailed: !error, ...(error ? { error } : {}) });
  orgsChanged(ctx);
}
