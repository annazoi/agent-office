// DeepSeek Harness's terminal theme: ANSI escapes and the harness's own design tokens.

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
export const BOLD = `${ESC}1m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;

/** 24-bit foreground, for the harness's own semantic colors on the office's dark terminal. */
function fg(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `${ESC}38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

/** 24-bit background, for the harness's code blocks. */
function bg(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `${ESC}48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

/**
 * DeepSeek Harness's own design tokens, read off its theme (`body[data-ds-dark-theme]`, the mode
 * the office's dark terminal matches) and carried into ANSI here. Every color in this file comes
 * from this table, so the transcript and the harness's web chat agree.
 */
export const V = {
  /** `label-primary`: assistant prose. */
  text: fg('#F9FAFB'),
  /** `label-secondary`: a tool's title. */
  secondary: fg('#CFD3D6'),
  /** `label-tertiary`: reasoning, tool summaries, captions. */
  muted: fg('#ADB2B8'),
  /** `label-caption`: the dot between a tool's title and its summary. */
  faint: fg('#81858C'),
  /** `link` (dark): the harness's blue, for notices and the person's own line. */
  brand: fg('#7AAAFF'),
  /** `state-success-primary`. */
  ok: fg('#22C55E'),
  /** `state-warn-primary`, with `-secondary` for the approval edge. */
  warn: fg('#F59E0B'),
  warnEdge: fg('#F7AD31'),
  /** `state-error-primary` (dark). */
  bad: fg('#F25A5A'),
  /** Code: the harness renders it in the body color on a subtle block of its own. */
  code: fg('#E1E5EE'),
  inlineCodeBg: bg('#292929'),
  blockCodeBg: bg('#1B1B1C'),
  /** `label-dimmed`, for a fenced block's gutter. */
  faintBg: fg('#81858C'),
  reset: RESET,
  bold: BOLD,
  italic: ITALIC,
  underline: UNDERLINE,
  dim: DIM,
} as const;

/** The left rule that marks a block as reasoning rather than the answer. */
export const THOUGHT_RULE = '│';
/** The marker a tool call's outcome hangs from. */
export const TOOL_ELBOW = '└';
