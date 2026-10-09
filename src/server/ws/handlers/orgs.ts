// Organisations: making and switching between them, their members and roles, and email invites.
// What each role may do is decided by the store (see accounts/orgs/roles.ts).
import type { OrgsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { asRole } from '../../accounts/orgs/roles.js';
import { deliverInvite, orgsChanged, sendOrgs } from '../../accounts/orgs/notify.js';
import type { HandlerMap } from './types.js';

const INVITE_EVERY_MS = 1000;

/** Warns `c` when something was refused, else lets everyone see what changed. */
const done = (ctx: Ctx, c: Client, err: string | undefined) => (err ? ctx.warn(c, err) : orgsChanged(ctx));
const id = (v: unknown) => str(v, 32);
const origin = (v: unknown) => str(v, 256) || undefined;

export const orgsHandlers = {
  'orgs.get'(ctx, c) {
    sendOrgs(ctx, c);
  },
  'orgs.create'(ctx, c, msg) {
    if (!c.accountId) return;
    const r = ctx.orgs.create(c.accountId, str(msg.name, 128));
    done(ctx, c, typeof r === 'string' ? r : undefined);
  },
  'orgs.switch'(ctx, c, msg) {
    if (!c.accountId) return;
    const err = ctx.orgs.switchTo(c.accountId, id(msg.orgId));
    if (err) return ctx.warn(c, err);
    sendOrgs(ctx, c);
  },
  'orgs.rename'(ctx, c, msg) {
    if (!c.accountId) return;
    done(ctx, c, ctx.orgs.rename(c.accountId, id(msg.orgId), str(msg.name, 128)));
  },
  'orgs.delete'(ctx, c, msg) {
    if (!c.accountId) return;
    done(ctx, c, ctx.orgs.remove(c.accountId, id(msg.orgId)));
  },
  'orgs.leave'(ctx, c, msg) {
    if (!c.accountId) return;
    done(ctx, c, ctx.orgs.leave(c.accountId, id(msg.orgId)));
  },
  'orgs.invite'(ctx, c, msg) {
    if (!c.accountId) return;
    const orgId = id(msg.orgId);
    if (!throttle(c, 'orgs.invite', INVITE_EVERY_MS)) return ctx.sendTo(c, { t: 'orgs.invited', orgId, error: 'One moment between invites' });
    const role = asRole(msg.role) ?? 'member';
    const r = ctx.orgs.invite(c.accountId, orgId, str(msg.email, 320), role);
    if (typeof r === 'string') return ctx.sendTo(c, { t: 'orgs.invited', orgId, error: r });
    void deliverInvite(ctx, c, r, origin(msg.origin));
  },
  'orgs.resend'(ctx, c, msg) {
    if (!c.accountId) return;
    const orgId = id(msg.orgId);
    const r = ctx.orgs.reissue(c.accountId, orgId, id(msg.inviteId));
    if (typeof r === 'string') return ctx.sendTo(c, { t: 'orgs.invited', orgId, error: r });
    void deliverInvite(ctx, c, r, origin(msg.origin));
  },
  'orgs.revoke'(ctx, c, msg) {
    if (!c.accountId) return;
    done(ctx, c, ctx.orgs.revokeInvite(c.accountId, id(msg.orgId), id(msg.inviteId)));
  },
  'orgs.role'(ctx, c, msg) {
    if (!c.accountId) return;
    const role = asRole(msg.role);
    if (!role) return;
    done(ctx, c, ctx.orgs.setRole(c.accountId, id(msg.orgId), id(msg.accountId), role));
  },
  'orgs.remove'(ctx, c, msg) {
    if (!c.accountId) return;
    done(ctx, c, ctx.orgs.removeMember(c.accountId, id(msg.orgId), id(msg.accountId)));
  },
} satisfies HandlerMap<OrgsClientMsg>;
