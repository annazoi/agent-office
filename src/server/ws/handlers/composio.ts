// The Composio stations over the socket: the office's state, each person's own connections, and the
// admins' key and toolkit picks. The stations' actions themselves go over HTTP (http/composio.ts).
import type { ComposioClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

export const composioHandlers = {
  'composio.get'(ctx, c) {
    ctx.sendTo(c, { t: 'composio', state: ctx.composio.state() });
    void ctx.composio.connections(c.accountId).then((connections) => ctx.sendTo(c, { t: 'composio.connections', connections }));
  },
  'composio.key'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can set the Composio API key');
    const who = c.peer.name;
    const key = str(msg.apiKey, 1024).trim();
    void ctx.composio.setKey(key, who).then((err) => {
      ctx.warn(c, err);
      if (!err) ctx.toastAll(key ? `🔌 ${who} connected the office to Composio` : `${who} removed the office's Composio key`);
    });
  },
  'composio.toolkits'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can pick the toolkits');
    ctx.warn(c, ctx.composio.setToolkits(msg.toolkits));
  },
} satisfies HandlerMap<ComposioClientMsg>;
