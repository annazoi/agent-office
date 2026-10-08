// Your own Claude and GitHub sign-ins (see signins.ts).
import type { SignInKind, SignInsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

/** The account `c` is signed in with. */
const accountOf = (_ctx: Ctx, c: Client): string | undefined => c.accountId;
const whichOf = (msg: SignInsClientMsg): SignInKind => ('which' in msg && msg.which === 'github' ? 'github' : 'claude');

export const signinsHandlers = {
  'signins.get'(ctx, c) {
    const id = accountOf(ctx, c);
    if (!id) return;
    ctx.sendTo(c, { t: 'signins', state: ctx.signins.state(id) });
    void ctx.signins.look(id, true);
  },
  'signins.start'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    ctx.warn(c, ctx.signins.start(id, whichOf(msg)));
  },
  'signins.code'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    ctx.warn(c, ctx.signins.code(id, str(msg.code, 4096)));
  },
  'signins.cancel'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    ctx.signins.cancel(id, whichOf(msg));
  },
  'signins.token'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    void ctx.signins.token(id, whichOf(msg), str(msg.token, 4096)).then((err) => ctx.warn(c, err));
  },
  'signins.office'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    ctx.warn(c, ctx.signins.useOffice(id, whichOf(msg)));
  },
  'signins.signout'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    void ctx.signins.signOut(id, whichOf(msg));
  },
} satisfies HandlerMap<SignInsClientMsg>;
