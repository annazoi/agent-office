// The loopback-only server for the workers' own calls: their agents' hook events, and the office's
// queue and workers for the board agents and the office-workers command.
import http from 'node:http';
import type { Ctx } from '../office/context.js';
import { readBody, send } from '../http/util.js';
import { officeQueue } from './office-queue.js';
import { officeWorkers } from './office-workers.js';
import { providerHook } from '../providers/index.js';
import type { AgentProvider } from '../../shared/agents/providers.js';
import { stateDoc } from '../db/state.js';

/** Starts the hook server, and says which port it listens on. */
export async function startHookServer(ctx: Ctx): Promise<{ hookServer: http.Server; hookPort: number }> {
  const hookServer = http.createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return send(res, 400, {});
    }
    if (url.pathname === '/office/queue') return officeQueue(ctx, req, res, url);
    if (url.pathname === '/office/workers' || url.pathname.startsWith('/office/workers/')) return officeWorkers(ctx, req, res, url);
    // Each provider with hooks has its route, /hooks/<provider> (see providers/).
    const route = url.pathname.startsWith('/hooks/') ? url.pathname.slice('/hooks/'.length) : '';
    const hook = providerHook(route);
    if (req.method !== 'POST' || !hook) return send(res, 404, { ok: false });
    let payload: unknown = {};
    try {
      const body = await readBody(req);
      payload = body ? JSON.parse(body) : {};
    } catch {
      if (hook.strictJson) return send(res, 400, { ok: false });
      // permissive: a bad payload still counts as the event
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const workerId = url.searchParams.get('worker') ?? '';
    const workers = ctx.workerFloor(workerId)?.workers;
    if (!workers) return send(res, 401, {});
    const event = url.searchParams.get('event') ?? '';
    const ok = workers.handleProviderHook(route as AgentProvider, workerId, token, event, payload);
    send(res, ok ? 200 : 401, {});
  });
  // Workers' terminals outlive a restart of the office (see ptys.ts) with this address in their
  // environment, so listen where the last office did when that port is free.
  const portDoc = stateDoc<number>(ctx.cfg.dataDir, 'hook-port');
  const listenHooks = (port: number) =>
    new Promise<void>((resolve, reject) => {
      hookServer.once('error', reject);
      hookServer.listen(port, '127.0.0.1', () => {
        hookServer.off('error', reject);
        resolve();
      });
    });
  const lastHookPort = Number(portDoc.read()) || 0;
  await listenHooks(lastHookPort).catch(() => listenHooks(0));
  const hookPort = (hookServer.address() as { port: number }).port;
  portDoc.write(hookPort);
  return { hookServer, hookPort };
}
