// Shared bounds and small readers for values off the ACP wire (see ../dsh.ts).

/** Bounds on everything read off the wire, so a chatty or hostile agent can't grow a terminal. */
export const MAX_TEXT = 4000;
export const MAX_LINE = 2000;
export const MAX_FRAME = 4_000_000;
/** A line typed into a DSH terminal, before Enter: about what a prompt box takes. */
export const MAX_TYPED = 20_000;
/** A permission request never needs more choices than a person can read. */
export const MAX_OPTIONS = 20;
export const CONTROL_TIMEOUT_MS = 30_000;
/** Tool output shown per update: enough to be useful, not enough to bury the turn. */
export const MAX_TOOL_OUTPUT_LINES = 8;

export type Rec = Record<string, unknown>;

export function isRec(value: unknown): value is Rec {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function bounded(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function oneLine(text: string, max = MAX_LINE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
