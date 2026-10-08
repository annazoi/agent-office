import { commandAction, toolAction } from '../../../shared/actions.js';
import type { WorkerAction } from '../../../shared/protocol.js';
import { bounded, isRec, oneLine, str, type Rec } from './util.js';
import { V } from './theme.js';
import { escapeText } from './text.js';

/** What a tool call will act on, most specific first: the approval card shows this, not the model's description of it. */
export const DETAIL_KEYS = ['command', 'path', 'file_path', 'query', 'pattern', 'url', 'description'];

/**
 * The ACP `ToolKind` → office action mapping (docs/dsh-acp-integration.md). Kinds are semantic, so
 * they are trusted ahead of the tool's name; a call with no usable kind falls back to the same
 * name-based mapper the other providers use.
 */
export function toolKindAction(kind: unknown, name: unknown, title: unknown, rawInput: unknown): WorkerAction | undefined {
  const k = str(kind);
  if (k === 'read') return 'read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'edit';
  if (k === 'fetch') return 'web';
  if (k === 'execute') {
    const command = isRec(rawInput) ? str(rawInput.command) : undefined;
    return command ? commandAction(command) : undefined;
  }
  if (k === 'search') {
    // A code search reads; a web search browses. The title is where the difference shows.
    const haystack = `${str(title) ?? ''} ${str(name) ?? ''}`.toLowerCase();
    return /web|fetch|http|url|brows/.test(haystack) ? 'web' : 'read';
  }
  if (!k) return toolAction(name ?? title, rawInput);
  return undefined; // think, switch_mode, other: plain typing
}

/** One tool call as the chat draws it: a leading icon, a title, and a one-line summary. */
export interface ToolRow {
  icon: string;
  title: string;
  summary?: string;
  /** What it acts on (the command, the path), for an approval that names only the call's id. */
  detail?: string;
}

/**
 * The harness's own tool rows: it picks a title and which argument to summarize by the tool's wire
 * name (its client has no per-ToolKind icon table), so this mirrors that table as closely as a
 * terminal can. The icons are glyphs standing in for the SVGs the chat draws.
 */
const TOOL_ROWS: { name: RegExp; icon: string; title: string; keys: string[] }[] = [
  { name: /^(pwsh|bash)$/, icon: '❯', title: 'Bash', keys: ['description', 'command'] },
  { name: /^run_code$/, icon: '{ }', title: 'Code', keys: ['description'] },
  { name: /^read_image$/, icon: '▤', title: 'Read image', keys: ['path', 'file_path'] },
  { name: /^read$/, icon: '▤', title: 'Read', keys: ['path', 'file_path', 'url'] },
  { name: /^web_fetch$/, icon: '⇅', title: 'Fetch', keys: ['url'] },
  { name: /^web_search$/, icon: '⌕', title: 'Search', keys: ['query', 'url'] },
  { name: /^grep$/, icon: '⌕', title: 'Grep', keys: ['pattern', 'path'] },
  { name: /^glob$/, icon: '⌕', title: 'Glob', keys: ['pattern', 'path'] },
  { name: /^write$/, icon: '✎', title: 'Write', keys: ['path', 'file_path'] },
  { name: /^edit$/, icon: '✎', title: 'Edit', keys: ['path', 'file_path'] },
];

/** The fallback for a tool this office does not know, from its semantic kind. */
function kindRow(kind: unknown): { icon: string; title: string; keys: string[] } {
  const k = str(kind);
  if (k === 'read') return { icon: '▤', title: 'Read', keys: ['path', 'file_path'] };
  if (k === 'edit' || k === 'delete' || k === 'move') return { icon: '✎', title: 'Edit', keys: ['path', 'file_path'] };
  if (k === 'execute') return { icon: '❯', title: 'Bash', keys: ['description', 'command'] };
  if (k === 'search') return { icon: '⌕', title: 'Search', keys: ['query', 'pattern'] };
  if (k === 'fetch') return { icon: '⇅', title: 'Fetch', keys: ['url'] };
  return { icon: '✦', title: 'Tool call', keys: [] };
}

/** The first of the harness's summary keys the tool actually sent, else its first short string. */
export function toolSummary(input: Rec, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(input[key]);
    if (value) return value;
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim() && value.length <= 160) return value;
  }
  return undefined;
}

/** The row for a tool call, keeping what was already shown when an update carries only its id. */
export function toolRow(update: Rec, remembered?: ToolRow): ToolRow {
  const wireName = (str(update.name) ?? str(update.title) ?? '').toLowerCase();
  const known = TOOL_ROWS.find((row) => row.name.test(wireName));
  const kind = str(update.kind);
  // A tool this office knows by name, else by what the call is doing, else what the row already said.
  const described = known ?? (wireName || kind ? kindRow(kind) : undefined);
  const base = described ?? remembered ?? kindRow(undefined);
  const input = isRec(update.rawInput) ? update.rawInput : undefined;
  let summary = input ? toolSummary(input, described?.keys ?? []) : undefined;
  if (!summary) summary = remembered?.summary;
  // An unknown tool's row leads with the tool's own name, the way the chat's generic row does.
  const raw = str(update.title) ?? str(update.name);
  if (!described && raw) summary = summary && summary !== raw ? `${oneLine(raw, 60)} · ${summary}` : oneLine(raw, 60);
  const detail = (input ? toolSummary(input, DETAIL_KEYS) : undefined) ?? remembered?.detail;
  return { icon: base.icon, title: base.title, summary: summary ? oneLine(summary, 160) : undefined, detail: detail ? bounded(detail) : undefined };
}

/** A tool row: icon, title, then the harness's dot separator before the summary. */
export function toolLine(row: ToolRow): string {
  const summary = row.summary ? ` ${V.faint}·${V.reset} ${V.muted}${escapeText(row.summary)}${V.reset}` : '';
  return `  ${V.faint}${row.icon}${V.reset} ${V.secondary}${escapeText(row.title)}${V.reset}${summary}\r\n`;
}

/** Why a tool failed, from its raw output or its content blocks. */
export function toolError(update: Rec): string | undefined {
  const raw = update.rawOutput;
  if (isRec(raw)) {
    const message = str(raw.message) ?? str(raw.error);
    if (message) return oneLine(message, 200);
  }
  if (typeof raw === 'string' && raw.trim()) return oneLine(raw, 200);
  const text = contentText(update);
  return text ? oneLine(text, 200) : undefined;
}

/** The text of a tool update's content blocks, in order. */
export function contentText(update: Rec): string | undefined {
  const items = Array.isArray(update.content) ? update.content : [];
  const parts: string[] = [];
  for (const item of items) {
    if (!isRec(item)) continue;
    const direct = str(item.text);
    if (direct) {
      parts.push(direct);
      continue;
    }
    if (isRec(item.content)) {
      const nested = str(item.content.text);
      if (nested) parts.push(nested);
    }
  }
  return parts.length ? parts.join('\n') : undefined;
}
