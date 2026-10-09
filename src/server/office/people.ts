import type { Accounts } from '../accounts/accounts.js';
import type { Me } from '../../shared/protocol.js';
import type { Ctx, People } from './context.js';
import type { Client } from './client.js';
import { orgsChanged } from '../accounts/orgs/notify.js';

/** WebSocket close code for a session that stopped counting: its account was revoked. */
const SIGNED_OUT = 4001;

/** Who the people in the office are signed in as, and telling them when that changes. */
export function people(ctx: Ctx): People {
  /** Who a connection is: its account's current name and role (an account that's gone is nobody, and no admin). */
  const meOf = (accountId: string | undefined): Me => {
    const a = ctx.accounts.get(accountId);
    return a ? { account: { name: a.name, role: a.role }, admin: a.role === 'admin' } : { account: { name: '', role: 'member' }, admin: false };
  };
  /** Still signed in: the account wasn't revoked. */
  const stillIn = (c: Client) => !!ctx.accounts.get(c.accountId);
  const signOut = (c: Client) => {
    c.out = true;
    c.ws.close(SIGNED_OUT, 'Signed out');
  };
  const onlineAccounts = () => new Set([...ctx.clients.values()].map((c) => c.accountId).filter((id): id is string => !!id));
  /** Tells each admin what the accounts are now, and everyone whether they're (still) an admin. */
  const accountsChanged = () => {
    let state: ReturnType<Accounts['state']> | undefined;
    for (const c of ctx.clients.values()) {
      if (c.out) continue;
      if (!stillIn(c)) {
        signOut(c);
        continue;
      }
      const me = meOf(c.accountId);
      if (me.admin !== c.admin) {
        c.admin = me.admin;
        ctx.sendTo(c, { t: 'me', me });
      }
      if (me.admin) ctx.sendTo(c, { t: 'accounts', state: (state ??= ctx.accounts.state(onlineAccounts())) });
    }
    // Someone new is in an organisation of their own, and someone revoked is out of theirs.
    orgsChanged(ctx);
  };
  return { meOf, stillIn, signOut, onlineAccounts, accountsChanged };
}
