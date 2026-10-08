import type { Usage, WorkerAction } from '../../shared/protocol.js';
import { MAX_LINE, MAX_TOOL_OUTPUT_LINES, isRec, num, oneLine, str, type Rec } from './util.js';
import { THOUGHT_RULE, TOOL_ELBOW, V } from './theme.js';
import { escapeText, markdown } from './text.js';
import { contentText, toolError, toolKindAction, toolLine, toolRow, type ToolRow } from './tools.js';

/**
 * ACP's `usage_update` is context occupancy plus, possibly, a cumulative cost — not the
 * input/output/cache split the office's Usage type wants. Context tokens are reported as `input`
 * with an authoritative `totalTokens`, and cost is only shown when the agent supplies it
 * (docs/dsh-acp-integration.md, usage option 1).
 */
export function dshUsage(update: unknown): Usage | undefined {
  if (!isRec(update)) return undefined;
  const used = num(update.used);
  const size = num(update.size);
  if (used === undefined || size === undefined) return undefined;
  const cost = isRec(update.cost) ? num(update.cost.amount) : undefined;
  return {
    input: Math.max(0, Math.round(used)),
    output: 0,
    reasoning: 0,
    cacheWrite: 0,
    cacheRead: 0,
    cost: cost !== undefined ? Math.max(0, cost) : 0,
    costKnown: cost !== undefined,
    calls: 0,
    callsKnown: false,
    totalTokens: Math.max(0, Math.round(used)),
    contextSize: Math.max(0, Math.round(size)),
  };
}

export interface RenderedUpdate {
  /** ANSI text for the worker's terminal (empty when the update is not worth a line). */
  text: string;
  /** What the worker should act out now. */
  action?: WorkerAction;
  /** A tool call that failed, for the hands-on-heads pose. */
  failed?: boolean;
  /** Context usage, when the update carried any. */
  usage?: Usage;
}

/**
 * Renders committed ACP updates into terminal lines, in the harness's own visual language.
 *
 * Text is buffered by line rather than written as it streams: a line is emitted only once it is
 * complete, so markdown is formatted whole, a span never splits across chunks, and every line ends
 * CRLF (a bare LF drifting the cursor is what made the first version's output staircase). Reasoning
 * is the harness's "Think" block, each tool call is one row with the harness's own title and
 * summary, a finished tool call is left collapsed the way the chat leaves it, and an approval reads
 * like its approval card. Anything the office does not understand is skipped, never fatal.
 */
export class DshRenderer {
  private mode: 'text' | 'thought' | undefined;
  private buffer = '';
  private fence = false;
  /** Tool calls by id, so an update that carries only the id still knows what the tool was. */
  private tools = new Map<string, ToolRow>();
  private toolCalls = 0;

  /** What tool call `id` said it would act on, for the approval card. */
  toolDetail(id: string | undefined): string | undefined {
    return id ? this.tools.get(id)?.detail : undefined;
  }

  /**
   * Closes the turn: flush what is left, close an open code fence, and report the turn the way the
   * chat's process row does ("Worked · 3 tool calls").
   */
  endTurn(outcome: 'Worked' | 'Stopped' | 'Failed' = 'Worked'): string {
    const out: string[] = [];
    this.flush(out, true);
    this.closeFence(out);
    this.mode = undefined;
    const calls = this.toolCalls;
    this.toolCalls = 0;
    const paint = outcome === 'Failed' ? V.bad : outcome === 'Stopped' ? V.warn : V.muted;
    const count = calls ? ` · ${calls} tool call${calls === 1 ? '' : 's'}` : '';
    out.push(`${paint}  ${outcome}${count}${V.reset}\r\n`);
    return out.join('');
  }

  render(update: unknown): RenderedUpdate {
    const out: string[] = [];
    if (!isRec(update)) return { text: '' };
    const kind = str(update.sessionUpdate);

    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const text = isRec(update.content) ? str(update.content.text) : undefined;
      if (!text) return { text: '' };
      this.write(out, kind === 'agent_thought_chunk' ? 'thought' : 'text', text);
      return { text: out.join('') };
    }

    if (kind === 'tool_call') {
      this.closeFence(out);
      this.flush(out, true);
      const id = str(update.toolCallId);
      const row = toolRow(update);
      if (id) this.tools.set(id, row);
      this.toolCalls++;
      out.push(toolLine(row));
      return { text: out.join(''), action: toolKindAction(update.kind, update.name, update.title, update.rawInput) };
    }

    if (kind === 'tool_call_update') {
      const id = str(update.toolCallId);
      const remembered = id ? this.tools.get(id) : undefined;
      const row = toolRow(update, remembered);
      if (id) this.tools.set(id, row);
      const status = str(update.status);
      if (status === 'failed') {
        this.closeFence(out);
        this.flush(out, true);
        const why = toolError(update);
        out.push(`  ${V.faint}${TOOL_ELBOW}${V.reset} ${V.bad}${escapeText(row.title)} failed${V.reset}${why ? ` ${V.faint}·${V.reset} ${V.muted}${escapeText(why)}${V.reset}` : ''}\r\n`);
        out.push(...this.toolOutput(update));
        return { text: out.join(''), action: 'failing', failed: true };
      }
      // completed: the harness leaves a finished tool call collapsed, with no check mark, so there
      // is nothing to add to the row this tool already printed.
      const action = toolKindAction(update.kind, update.name, update.title, update.rawInput);
      return action ? { text: '', action } : { text: '' };
    }

    if (kind === 'usage_update') return { text: '', usage: dshUsage(update) };

    if (kind === 'config_option_update') {
      this.closeFence(out);
      this.flush(out, true);
      for (const option of Array.isArray(update.configOptions) ? update.configOptions : []) {
        if (!isRec(option)) continue;
        const id = str(option.id);
        const value = str(option.currentValue) ?? (typeof option.currentValue === 'boolean' ? String(option.currentValue) : undefined);
        if (id && value) out.push(`  ${V.muted}${escapeText(id)} ${V.faint}→${V.reset} ${V.muted}${escapeText(oneLine(value, 120))}${V.reset}\r\n`);
      }
      return { text: out.join('') };
    }

    // plan, current_mode, available_commands and anything newer: not part of this surface.
    return { text: '' };
  }

  /** Buffers streamed text for `mode`, flushing whole lines as they complete. */
  private write(out: string[], mode: 'text' | 'thought', text: string): void {
    if (this.mode !== mode) {
      const wasThinking = this.mode === 'thought';
      this.closeFence(out);
      this.flush(out, true);
      this.mode = mode;
      // The chat introduces reasoning with a "Think" row; give the block the same heading, and let
      // the answer start clear of it.
      if (mode === 'thought') out.push(`${V.secondary}  ✻ Think${V.reset}\r\n`);
      else if (wasThinking) out.push('\r\n');
    }
    this.buffer += text;
    this.flush(out, false);
  }

  private flush(out: string[], final: boolean): void {
    // Model text is untrusted: keep newlines and tabs, and strip whole escape sequences (colors,
    // cursor moves, window titles) before anything else looks at the text, so no trace of one can
    // show up as if the model had typed it.
    this.buffer = escapeText(this.buffer.replace(/\r\n?/g, '\n'));
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      out.push(this.line(line));
    }
    // A single line that never ends still has to show something before it is finished.
    if (this.buffer.length > 4000) {
      out.push(this.line(this.buffer));
      this.buffer = '';
    }
    if (final && this.buffer) {
      out.push(this.line(this.buffer));
      this.buffer = '';
    }
  }

  /** One complete line, styled for what it is: fenced code, reasoning, or the answer. */
  private line(raw: string): string {
    const text = raw.replace(/\t/g, '  ').replace(/\s+$/, '');
    const probe = text.trim();
    if (probe.startsWith('```')) {
      const opening = !this.fence;
      this.fence = opening;
      if (opening) {
        const language = oneLine(probe.slice(3), 40);
        return `  ${V.faintBg}┌─${language ? ` ${V.code}${V.blockCodeBg}${escapeText(language)}` : ''}${V.reset}\r\n`;
      }
      return `  ${V.faintBg}└─${V.reset}\r\n`;
    }
    if (this.fence) return `  ${V.blockCodeBg}${V.code}${escapeText(text)}${V.reset}\r\n`;
    if (this.mode === 'thought') return `${V.muted}  ${THOUGHT_RULE} ${markdown(text, V.muted)}${V.reset}\r\n`;
    return `${markdown(text, V.text)}${V.reset}\r\n`;
  }

  private closeFence(out: string[]): void {
    if (!this.fence) return;
    this.fence = false;
    out.push(`  ${V.faintBg}└─${V.reset}\r\n`);
  }

  /** A failing tool's own output, tail-first, so it says why without burying the turn. */
  private toolOutput(update: Rec): string[] {
    const text = contentText(update);
    if (!text) return [];
    const lines = text.split('\n').map((line) => line.replace(/\s+$/, ''));
    while (lines.length && !lines.at(-1)?.trim()) lines.pop();
    const shown = lines.slice(-MAX_TOOL_OUTPUT_LINES);
    const omitted = lines.length - shown.length;
    const out = shown.map((line) => `      ${V.muted}${escapeText(oneLine(line, MAX_LINE))}${V.reset}\r\n`);
    if (omitted > 0) out.unshift(`      ${V.faint}… ${omitted} more line${omitted === 1 ? '' : 's'}${V.reset}\r\n`);
    return out;
  }
}
