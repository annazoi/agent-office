// Muse Code: it runs on the person's own ~/.config/muse settings and sign-in. The office writes it no
// hooks (Muse only reads them from its settings.json, and the office keeps nothing in files), so it's
// followed by its terminal; hooks of the person's own still report on /hooks/muse. Its spend isn't
// metered by the office.
import { normalizeMuseHook, withoutMuseLaunchArgs } from '../agents/muse.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

export const muse: ProviderAdapter = {
  id: 'muse',
  scrubEnv: ['MUSE_BIN', 'MUSE_AGENTS_THREAD', 'MUSE_AGENTS_ROLE', 'MUSE_PROJECTS_HOME'],
  launch({ h, args, prompt, resumeSessionId }) {
    const { info } = h;
    args = withoutMuseLaunchArgs(args);
    args.push('--trust-workspace');
    if (resumeSessionId) {
      args.push('resume', resumeSessionId);
      // Muse resume cannot take a prompt on argv: it's pasted into the TUI after SessionStart.
      h.pendingPrompt = prompt;
    } else {
      if (info.model) args.push('--model', info.model);
      if (info.effort) args.push('--reasoning-effort', info.effort);
      if (prompt) args.push('--', prompt);
    }
    return { args, rotateToken: true };
  },
  titleNoise: /^muse( code)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeMuseHook(event, payload);
      return !!report && reduceLifecycle(h, report);
    },
  },
};
