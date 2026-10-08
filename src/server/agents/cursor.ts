// Cursor CLI (cursor-agent): what its hooks report, should any be set up for it, and its command line.
// The office writes no hooks for it (they'd be a hooks.json in each worker's folder): everything the
// office keeps is in its database, so a Cursor worker is followed by its terminal alone.

/** Cursor's hook events the office listens to, and the lifecycle event each one is (see workers/lifecycle.ts). */
export const CURSOR_HOOK_EVENTS = {
  sessionStart: 'SessionStart',
  beforeSubmitPrompt: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  stop: 'Stop',
} as const;

export type CursorHookName = keyof typeof CURSOR_HOOK_EVENTS;

/** The bounded event shape forwarded to the worker bridge. */
export interface CursorHookEvent {
  sessionId: string;
  event: (typeof CURSOR_HOOK_EVENTS)[CursorHookName];
  prompt?: string;
  tool?: string;
  toolUseId?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
/** A chat id goes back on the command line (`--resume=<id>`), so it's never taken as anything but an id. */
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** What marks a payload as a subagent's or a cloud agent's rather than the desk's own session. */
const CHILD_FIELDS = ['subagent_id', 'subagent_type', 'parent_conversation_id', 'agent_id', 'agent_type'];

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate and compact a Cursor hook payload. A subagent's events are ignored so they cannot
 * overwrite the desk's root status. Tool inputs and outputs, the assistant's messages and the
 * transcript path are discarded.
 */
export function normalizeCursorHook(event: string, payload: unknown): CursorHookEvent | undefined {
  if (!Object.hasOwn(CURSOR_HOOK_EVENTS, event) || !isRecord(payload)) return undefined;
  if (CHILD_FIELDS.some((key) => hasText(payload[key])) || payload.is_background_agent === true) return undefined;
  const sessionId = payload.conversation_id ?? payload.session_id;
  if (typeof sessionId !== 'string' || !CHAT_ID.test(sessionId)) return undefined;
  const name = event as CursorHookName;
  const result: CursorHookEvent = { sessionId, event: CURSOR_HOOK_EVENTS[name] };
  if (name === 'beforeSubmitPrompt') {
    const prompt = bounded(payload.prompt, MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (name === 'preToolUse' || name === 'postToolUse' || name === 'postToolUseFailure') {
    const tool = bounded(payload.tool_name, MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(payload.tool_use_id, MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  }
  return result;
}

/**
 * Drop launch flags the office sets itself, the ones that would take a worker out of its terminal or
 * its folder, and the ones that skip Cursor's permission prompts (the office never passes those).
 */
export function withoutCursorLaunchArgs(args: string[]): string[] {
  const skipValue = new Set(['--model', '--workspace', '--worktree-base', '--output-format', '--new-session-id']);
  // These take a value only when one follows.
  const skipOptional = new Set(['--resume', '--worktree', '-w']);
  const skipFlag = new Set([
    '--force', '-f', '--yolo', '--trust', '--continue', '--print', '-p', '--list-models',
    '--stream-partial-output', '--skip-worktree-setup',
  ]);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (skipFlag.has(arg)) continue;
    if (skipValue.has(arg) || skipOptional.has(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if ([...skipValue, ...skipOptional].some((flag) => flag.startsWith('--') && arg.startsWith(`${flag}=`))) continue;
    clean.push(arg);
  }
  return clean;
}

/** What a Cursor worker's desk says when its screen shows it can't be used yet. */
export function cursorBlocked(text: string): string | undefined {
  return /Press any key to log in/i.test(text) ? "Cursor isn't signed in on this machine — open the terminal and log in" : undefined;
}

