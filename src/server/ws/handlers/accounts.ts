// Inviting, listing and revoking people. Admin accounts only.
import type { AccountsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

/** Whether `c` may manage accounts; if not, they're told so. */
const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can manage accounts');
  return false;
};

export const accountsHandlers = {
  'accounts.get'(ctx, c) {
    if (!admin(ctx, c)) return;
    ctx.sendTo(c, { t: 'accounts', state: ctx.accounts.state(ctx.onlineAccounts()) });
  },
  'accounts.invite'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const r = ctx.accounts.invite(who, msg.role === 'admin' ? 'admin' : 'member', typeof msg.name === 'string' ? msg.name : undefined);
    if (typeof r === 'string') return ctx.sendTo(c, { t: 'accounts.invited', error: r });
    ctx.sendTo(c, { t: 'accounts.invited', invite: r });
    ctx.accountsChanged();
  },
  'accounts.cancel'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    if (ctx.accounts.cancel(str(msg.inviteId, 32))) ctx.accountsChanged();
  },
  'accounts.revoke'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const id = str(msg.accountId, 32);
    if (id === c.accountId) return ctx.warn(c, "You can't revoke your own account");
    const a = ctx.accounts.revoke(id);
    if (!a) return;
    console.log(`  ${who} revoked ${a.name}'s account`);
    ctx.toastAll(`${who} revoked ${a.name}'s account`);
    ctx.accountsChanged(); // signs them out everywhere
    ctx.signins.forget(a.id); // and their Claude and GitHub sign-ins go with the account
    ctx.accountLimits.get(a.id)?.reader.close();
    ctx.accountLimits.delete(a.id);
  },
  'accounts.role'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const id = str(msg.accountId, 32);
    if (id === c.accountId) return ctx.warn(c, "You can't change your own role");
    const a = ctx.accounts.setRole(id, msg.role === 'admin' ? 'admin' : 'member');
    if (!a) return;
    ctx.toastAll(a.role === 'admin' ? `${who} made ${a.name} an admin` : `${a.name} is no longer an admin`);
    ctx.accountsChanged();
    // Only admins may use the office's own sign-ins: a demoted one is back on their own.
    void ctx.signins.look(a.id, true);
  },
  'accounts.registration'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    if (!!msg.on === ctx.accounts.state(new Set()).openRegistration) return;
    ctx.accounts.setOpenRegistration(!!msg.on);
    console.log(`  ${who} switched registering with the office password ${msg.on ? 'on' : 'off'}`);
    ctx.toastAll(msg.on ? `${who} let people register with the office password again` : `🔑 ${who} closed registration — new people need an invite now`);
    ctx.accountsChanged();
  },
} satisfies HandlerMap<AccountsClientMsg>;
