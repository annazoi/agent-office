import { V, THOUGHT_RULE } from './theme.js';

/** A one-line notice from the office itself, rather than from the model. */
export function notice(kind: 'info' | 'warn' | 'bad' | 'quiet', text: string): string {
  const glyph = kind === 'bad' ? '✖' : kind === 'warn' ? '▲' : kind === 'quiet' ? '·' : '◆';
  const paint = kind === 'bad' ? V.bad : kind === 'warn' ? V.warn : kind === 'quiet' ? V.muted : V.brand;
  const body = kind === 'quiet' ? V.muted : paint;
  return `${paint}${glyph}${V.reset} ${body}${escapeText(text)}${V.reset}\r\n`;
}

/**
 * Drop control characters and whole escape sequences from text the harness sent, so it cannot drive
 * the terminal — and so the remains of a sequence (`[2J`) never show up as if the model typed it.
 */
export function escapeText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC … BEL/ST (titles, hyperlinks)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI (colors, cursor, clears)
    .replace(/\x1b[@-Z\\-_]/g, '') // other two-byte escapes
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ''); // whatever is left: BEL, 8-bit C1 (CSI, OSC), bidi overrides
}

/** Text the office writes into a DSH terminal that did not come through the renderer (a prompt, an error). */
export function terminalSafe(text: string): string {
  return escapeText(text);
}

/**
 * A small markdown renderer for the terminal, standing in for the chat's rich text: headings, rules,
 * quotes, bullets, bold, italic, inline code and links. Streaming is line-buffered upstream, so a
 * span is never split across chunks.
 */
export function markdown(text: string, base: string): string {
  const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(text);
  if (heading) return `${V.bold}${V.underline}${escapeText(heading[2])}${V.reset}${base}`;
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) return `${V.faint}${'─'.repeat(24)}${V.reset}${base}`;
  const quote = /^\s{0,3}>\s?(.*)$/.exec(text);
  if (quote) return `${V.muted}${THOUGHT_RULE} ${inline(quote[1], V.muted)}${V.reset}`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(text);
  if (bullet) return `${bullet[1]}${V.faint}•${V.reset}${base} ${inline(bullet[2], base)}`;
  return inline(text, base);
}

/**
 * Inline spans, always falling back to the line's own color after each one.
 *
 * Every span is swapped for a placeholder before the next pattern runs, and the ANSI is substituted
 * at the end: the escapes themselves contain `[`, which the link pattern would otherwise match
 * backwards into, corrupting every span on the line.
 */
function inline(raw: string, base: string): string {
  const painted: string[] = [];
  const hold = (ansi: string): string => {
    painted.push(ansi);
    return `\u0001${painted.length - 1}\u0001`;
  };
  const text = escapeText(raw)
    .replace(/`([^`]+)`/g, (_all, code: string) => hold(`${V.inlineCodeBg}${V.code}${code}${V.reset}${base}`))
    .replace(/\*\*([^*]+)\*\*/g, (_all, bold: string) => hold(`${V.bold}${bold}${V.reset}${base}`))
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, (_all, before: string, italic: string) => before + hold(`${V.italic}${italic}${V.reset}${base}`))
    .replace(/(^|[\s(])_([^_\n]+)_/g, (_all, before: string, italic: string) => before + hold(`${V.italic}${italic}${V.reset}${base}`))
    .replace(/\[([^\][]{1,500})\]\(([^)\s]{1,2000})\)/g, (_all, label: string, url: string) => hold(`${V.underline}${label}${V.reset}${base} ${V.muted}${url}${V.reset}${base}`));
  return text.replace(/\u0001(\d+)\u0001/g, (_all, index: string) => painted[Number(index)] ?? '');
}
