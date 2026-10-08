import { MAX_OPTIONS, MAX_TEXT, isRec, oneLine, str } from './util.js';
import { BOLD, V } from './theme.js';
import { escapeText } from './text.js';
import { DETAIL_KEYS, toolSummary } from './tools.js';

// ---------------------------------------------------------------------------
// The wire, as far as this office needs it
// ---------------------------------------------------------------------------

export interface DshPermissionOption {
  optionId: string;
  name: string;
  kind: string;
  /** One-shot choices are the only ones ACP offers; kept for the rendered prompt. */
  once: boolean;
}

/** The choices a permission request offers, defensively read off the wire. */
export function permissionOptions(params: unknown): DshPermissionOption[] {
  const raw = isRec(params) && Array.isArray(params.options) ? params.options : [];
  const options: DshPermissionOption[] = [];
  for (const entry of raw) {
    if (options.length >= MAX_OPTIONS) break;
    if (!isRec(entry)) continue;
    const optionId = str(entry.optionId);
    if (!optionId) continue;
    const kind = str(entry.kind) ?? 'other';
    options.push({ optionId, name: oneLine(str(entry.name) ?? optionId, 120), kind, once: kind.includes('once') });
  }
  return options;
}

/** What a typed line means while a permission prompt is open: an option, or nothing. */
export function permissionChoice(line: string, options: DshPermissionOption[]): DshPermissionOption | undefined {
  const text = line.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return options[Number(text) - 1];
  return options.find((o) => o.optionId === text) ?? options.find((o) => o.name.toLowerCase() === text.toLowerCase());
}

/**
 * The prompted lines for an outstanding permission request. `remembered` is what the tool call's own
 * row said it would do (see DshRenderer.toolDetail), for a request that carries only the call's id.
 */
export function renderPermission(params: unknown, options: DshPermissionOption[], remembered?: string): string {
  const toolCall = isRec(params) && isRec(params.toolCall) ? params.toolCall : {};
  // The approval card names the tool the way the harness does, and shows what it will run under it,
  // in full: what is being approved must never be cut off or left to the model's own description.
  const label = str(toolCall.title) ?? str(toolCall.name);
  const detail = (isRec(toolCall.rawInput) ? toolSummary(toolCall.rawInput, DETAIL_KEYS) : undefined) ?? remembered;
  const what = label ? oneLine(label, 120) : undefined;
  const lines = [
    `\r\n${V.warn}${BOLD}  ▲ Waiting for approval${V.reset} ${V.secondary}${what ? `Tool ${escapeText(what)} requests privileged execution` : 'A tool call requests privileged execution'}${V.reset}\r\n`,
  ];
  if (detail && detail !== label) lines.push(`    ${V.code}${escapeText(oneLine(detail, MAX_TEXT))}${V.reset}\r\n`);
  const width = options.reduce((max, option) => Math.max(max, option.name.length), 0);
  options.forEach((option, index) => {
    // The card paints reject in the error color and allow in the warning's own; so does this.
    const paint = /reject|cancel|deny/.test(option.kind) ? V.bad : V.warnEdge;
    lines.push(`  ${paint}${BOLD}${index + 1}${V.reset}${V.faint})${V.reset} ${V.secondary}${escapeText(option.name.padEnd(width))}${V.reset}  ${V.faint}${escapeText(option.kind)}${V.reset}\r\n`);
  });
  const hint = allowOption(options) ? 'Enter allows once, Esc rejects, or type a number for another choice.' : 'Type a number to choose, or Esc to reject.';
  lines.push(`  ${V.muted}${hint}${V.reset}\r\n`);
  return lines.join('');
}

/**
 * The choice the harness's Enter key means: allow once, and only that. A request with no one-shot
 * allow (only "always", say) needs a number typed, so a stray Enter never grants more than one call.
 */
export function allowOption(options: DshPermissionOption[]): DshPermissionOption | undefined {
  return options.find((option) => option.once && /allow|approve|accept/.test(option.kind));
}

/** The choice its Escape key means: reject, if the tool offers one. */
export function rejectOption(options: DshPermissionOption[]): DshPermissionOption | undefined {
  return options.find((option) => /reject|cancel|deny/.test(option.kind));
}
