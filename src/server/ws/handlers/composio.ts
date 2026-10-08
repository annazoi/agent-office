// The Composio stations over the socket: the office's state, each person's own connections, and the
// admins' toolkit picks (the key is the server's own, from its environment). The stations' actions themselves go over HTTP (http/composio.ts).
import type { ComposioClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const composioHandlers = {
  'composio.get'(ctx, c) {
    ctx.sendTo(c, { t: 'composio', state: ctx.composio.state() });
    void ctx.composio.connections(c.accountId).then((connections) => ctx.sendTo(c, { t: 'composio.connections', connections }));
  },
  'composio.toolkits'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can pick the toolkits');
    ctx.warn(c, ctx.composio.setToolkits(msg.toolkits));
  },
} satisfies HandlerMap<ComposioClientMsg>;
