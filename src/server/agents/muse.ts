
export const MUSE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'Stop',
  'StopFailure',
] as const;

export type MuseHookEventName = (typeof MUSE_HOOK_EVENTS)[number];

/** The bounded event shape forwarded to the worker bridge. */
export interface MuseHookEvent {
  sessionId: string;
  event: MuseHookEventName;
  source?: string;
  prompt?: string;
  tool?: string;
  toolUseId?: string;
  notificationType?: string;
  reason?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
const EVENT_SET = new Set<string>(MUSE_HOOK_EVENTS);

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

function field(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

/**
 * Validate and compact a Muse hook payload. Child-session events are ignored so they cannot
 * overwrite the desk's root status. Transcript paths and assistant message bodies are discarded.
 */
export function normalizeMuseHook(event: string, payload: unknown): MuseHookEvent | undefined {
  if (!isRecord(payload)) return undefined;
  const name = EVENT_SET.has(event) ? event : bounded(field(payload, 'hook_event_name', 'hookEventName'), MAX_ID);
  if (!name || !EVENT_SET.has(name)) return undefined;
  if (hasText(field(payload, 'subagentType', 'subagent_type', 'agent_id', 'agent_type', 'parent_session_id', 'parent_session'))) return undefined;

  const sessionId = bounded(field(payload, 'sessionId', 'session_id'), MAX_ID);
  if (!sessionId) return undefined;
  const result: MuseHookEvent = { sessionId, event: name as MuseHookEventName };

  const source = name === 'SessionStart' ? bounded(field(payload, 'source'), MAX_ID) : undefined;
  if (source) result.source = source;
  if (name === 'UserPromptSubmit') {
    const prompt = bounded(field(payload, 'prompt'), MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (name === 'PreToolUse' || name === 'PostToolUse' || name === 'PostToolUseFailure' || name === 'PermissionRequest') {
    const tool = bounded(field(payload, 'toolName', 'tool_name', 'tool'), MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(field(payload, 'toolUseId', 'tool_use_id'), MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  } else if (name === 'Notification') {
    const notificationType = bounded(field(payload, 'notificationType', 'notification_type'), MAX_ID);
    if (notificationType) result.notificationType = notificationType;
  } else if (name === 'Stop' || name === 'StopFailure') {
    const reason = bounded(field(payload, 'reason'), MAX_ID);
    if (reason) result.reason = reason;
  }
  return result;
}

export function validateMuseHook(event: string, payload: unknown): boolean {
  return !!normalizeMuseHook(event, payload);
}

/** Drop launch flags the office always sets itself, plus model/effort/session flags it may replace. */
export function withoutMuseLaunchArgs(args: string[]): string[] {
  const skipValue = new Set([
    '--model', '--reasoning-effort', '--provider', '--workspace', '--worktree',
    '--worktree-base', '--worktree-existing', '--approval-mode', '--permission-profile',
    '--sandbox-network',
  ]);
  const skipFlag = new Set([
    '--trust-workspace', '--yolo', '--disable-approval', '--disable-sandbox',
    '--disable-write', '--disable-shell', '--last', '-w',
  ]);
  const skipCommand = new Set(['resume', 'exec', 'serve']);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (skipFlag.has(arg) || skipCommand.has(arg)) {
      if (skipCommand.has(arg) && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (skipValue.has(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--model=') || arg.startsWith('--reasoning-effort=') || arg.startsWith('--provider=')
      || arg.startsWith('--workspace=') || arg.startsWith('--worktree=') || arg.startsWith('--approval-mode=')) continue;
    clean.push(arg);
  }
  return clean;
}

