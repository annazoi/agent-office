
export const GROK_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'StopFailure',
  'StopCancelled',
] as const;

export type GrokHookEventName = (typeof GROK_HOOK_EVENTS)[number];

/** The bounded event shape forwarded to the worker bridge. */
export interface GrokHookEvent {
  sessionId: string;
  event: GrokHookEventName;
  source?: string;
  prompt?: string;
  tool?: string;
  toolUseId?: string;
  notificationType?: string;
  reason?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
const EVENT_SET = new Set<string>(GROK_HOOK_EVENTS);

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
 * Validate and compact a Grok hook payload. Child-session events (a subagent's own turn) are
 * ignored so they cannot overwrite the desk's root status. Message bodies and tool inputs are
 * discarded.
 */
export function normalizeGrokHook(event: string, payload: unknown): GrokHookEvent | undefined {
  if (!EVENT_SET.has(event) || !isRecord(payload)) return undefined;
  if (hasText(field(payload, 'subagentType', 'subagent_type', 'agent_id', 'agent_type'))) return undefined;

  const sessionId = bounded(field(payload, 'sessionId', 'session_id'), MAX_ID);
  if (!sessionId) return undefined;
  const result: GrokHookEvent = { sessionId, event: event as GrokHookEventName };

  const source = event === 'SessionStart' ? bounded(field(payload, 'source'), MAX_ID) : undefined;
  if (source) result.source = source;
  if (event === 'UserPromptSubmit') {
    const prompt = bounded(field(payload, 'prompt'), MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (event === 'PreToolUse' || event === 'PostToolUse') {
    const tool = bounded(field(payload, 'toolName', 'tool_name'), MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(field(payload, 'toolUseId', 'tool_use_id'), MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  } else if (event === 'Notification') {
    const notificationType = bounded(field(payload, 'notificationType', 'notification_type'), MAX_ID);
    if (notificationType) result.notificationType = notificationType;
  } else if (event === 'Stop' || event === 'StopFailure' || event === 'StopCancelled') {
    const reason = bounded(field(payload, 'reason'), MAX_ID);
    if (reason) result.reason = reason;
  }
  return result;
}

export function validateGrokHook(event: string, payload: unknown): boolean {
  return !!normalizeGrokHook(event, payload);
}

/** Drop launch flags the office always sets itself, plus model/effort/session flags it may replace. */
export function withoutGrokLaunchArgs(args: string[]): string[] {
  const skipValue = new Set([
    '--model', '-m', '--effort', '--reasoning-effort', '--session-id', '-s',
    '--resume', '-r', '--leader-socket',
  ]);
  const skipFlag = new Set(['--no-alt-screen', '--trust', '--continue', '-c', '--fullscreen', '--minimal']);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (skipFlag.has(arg)) continue;
    if (skipValue.has(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--model=') || arg.startsWith('--effort=') || arg.startsWith('--reasoning-effort=')
      || arg.startsWith('--session-id=') || arg.startsWith('--resume=') || arg.startsWith('--leader-socket=')
      || (arg.startsWith('-m') && arg.length > 2 && arg !== '-minimal')) continue;
    clean.push(arg);
  }
  return clean;
}

