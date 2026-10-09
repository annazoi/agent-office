// Grok: it runs on the person's own ~/.grok and sign-in. The office writes it no hooks (Grok only
// reads them from JSON files, and the office keeps nothing in files), so it's followed by its
// terminal; hooks of the person's own still report on /hooks/grok. Its spend isn't metered by the office.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { normalizeGrokHook, withoutGrokLaunchArgs } from '../agents/grok.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

interface GrokSetup {
  socket: string;
}

export const grok: ProviderAdapter<undefined, GrokSetup> = {
  id: 'grok',
  scrubEnv: [
    'GROK_SESSION_ID', 'GROK_AGENT_ID', 'GROK_HOOK_EVENT', 'GROK_HOOK_NAME', 'GROK_WORKSPACE_ROOT',
    'GROK_PLUGIN_ROOT', 'GROK_PLUGIN_DATA', 'GROK_AUTH', 'GROK_AUTH_PATH',
  ],
  prepare: ({ dataDir }) => ({ socket: path.join(dataDir, 'grok-leader.sock') }),
  launch({ h: { info }, args, prompt, resumeSessionId, setup }) {
    args = withoutGrokLaunchArgs(args);
    args.push('--no-alt-screen', '--trust', '--leader-socket', setup.socket);
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    } else {
      if (!info.sessionId) info.sessionId = randomUUID();
      args.push('--session-id', info.sessionId);
      if (info.model) args.push('--model', info.model);
      if (info.effort) args.push('--effort', info.effort);
    }
    if (prompt) args.push('--', prompt);
    return { args, rotateToken: true };
  },
  titleNoise: /^grok( build)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeGrokHook(event, payload);
      return !!report && reduceLifecycle(h, report);
    },
  },
};
