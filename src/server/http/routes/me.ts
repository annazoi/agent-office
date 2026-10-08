// What the signed-in account keeps for itself (its profile and settings, see accounts/user-config.ts):
// the browser reads it all once as the office loads, and saves what changes as it changes.
import { USER_CONFIG_MAX_BYTES, setUserConfig, userConfig } from '../../accounts/user-config.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

export const meRoutes = {
  config: {
    method: 'GET',
    path: '/api/me/config',
    auth: 'session',
    handle: (ctx, { res, session }) => send(res, 200, { config: userConfig(ctx.cfg.dataDir, session.account.id) }),
  },
  saveConfig: {
    method: 'POST',
    path: '/api/me/config',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      // Only the office's own pages save to it, never another site's with a visitor's cookie.
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (Number(req.headers['content-length']) > USER_CONFIG_MAX_BYTES) return send(res, 413, { error: 'That is more than an account can keep' });
      let changes: unknown;
      try {
        changes = JSON.parse(await readBody(req, USER_CONFIG_MAX_BYTES + 4096));
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return send(res, 400, { error: 'Bad request' });
      const err = setUserConfig(ctx.cfg.dataDir, session.account.id, changes as Record<string, unknown>);
      return err ? send(res, 400, { error: err }) : send(res, 200, { ok: true });
    },
  },
} satisfies Record<string, Route>;
