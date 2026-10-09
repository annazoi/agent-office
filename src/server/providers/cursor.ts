// Cursor CLI: the office writes it no hooks (it only reads them from a hooks.json file, and the office
// keeps nothing in files), so it's followed by its terminal; hooks of the person's own in ~/.cursor
// still report on /hooks/cursor. It runs on the machine's own Cursor login. Its spend isn't metered by
// the office, and nothing tells the office about a permission prompt: a worker waiting on one shows
// as working until it's answered.
import { cursorBlocked, normalizeCursorHook, withoutCursorLaunchArgs } from '../agents/cursor.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

export const cursor: ProviderAdapter = {
  id: 'cursor',
  // What Cursor sets in its own shells. CURSOR_API_KEY stays: a worker signs in with it when it's set.
  scrubEnv: ['CURSOR_AGENT', 'CURSOR_CLI', 'CURSOR_INVOKED_AS', 'CURSOR_CONVERSATION_ID', 'CURSOR_REQUEST_ID'],
  launch({ h: { info }, args, prompt, resumeSessionId }) {
    args = withoutCursorLaunchArgs(args);
    // The office made this folder for it. Cursor's own permission prompts stay as they are.
    args.push('--trust');
    // Its chat id is the first one its hooks name. A resumed chat keeps the model it had.
    if (resumeSessionId) args.push(`--resume=${resumeSessionId}`);
    else if (info.model) args.push('--model', info.model);
    if (prompt) args.push('--', prompt);
    return { args, rotateToken: true };
  },
  titleNoise: /^cursor( agent| cli)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeCursorHook(event, payload);
      if (!report) return false;
      // A chat started over inside the terminal fires no sessionStart: its first prompt is the first the office hears of it.
      if (report.event === 'UserPromptSubmit' && h.info.sessionId && h.info.sessionId !== report.sessionId) {
        reduceLifecycle(h, { sessionId: report.sessionId, event: 'SessionStart', source: 'clear' });
      }
      return reduceLifecycle(h, report);
    },
  },
  // A resumed chat fires no sessionStart, so it's idle as soon as it runs; the login screen is read off its terminal.
  screen: { blocked: cursorBlocked },
};
