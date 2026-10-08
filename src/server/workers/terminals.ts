import type { TerminalHit } from '../../shared/protocol.js';
import { searchTerminal } from '../floor/history.js';
import { offlineBanner } from './terminal.js';
import type { Worker, WorkerContext } from './types.js';
import { clamp, truncate } from './util.js';

/** How often a steady typist's "last typed" time is refreshed for everyone. */
const TYPED_REFRESH_MS = 15_000;

/**
 * The people at a worker's terminal: who is watching it, what they type, search across the
 * terminals, and fitting a terminal to the window it's shown in.
 */
export class WorkerTerminals {
  constructor(private ctx: WorkerContext) {}

  attach(id: string, clientId: string, name: string): { data: string; cols: number; rows: number } | undefined {
    const w = this.ctx.workers.get(id);
    if (!w) return undefined;
    w.viewers.set(clientId, name);
    let changed = this.syncViewers(w);
    if (!w.info.acked && w.info.status !== 'needs_input') {
      w.info.acked = true;
      changed = true;
    }
    if (changed) this.ctx.emit(w);
    const data = w.snapshot ? w.snapshot() : offlineBanner(w.info);
    return { data, cols: w.info.cols, rows: w.info.rows };
  }

  /** Lines of every worker's terminal holding `needle` (a searchKey), newest first, at most `perWorker` each. */
  search(needle: string, perWorker: number): { hits: TerminalHit[]; more: boolean } {
    const hits: TerminalHit[] = [];
    let more = false;
    for (const w of this.ctx.workers.values()) {
      if (!w.term) continue;
      const found = searchTerminal(w.term, needle, perWorker);
      more ||= found.more;
      for (const hit of found.hits) hits.push({ workerId: w.info.id, ...hit });
    }
    return { hits, more };
  }

  detach(id: string, clientId: string) {
    const w = this.ctx.workers.get(id);
    if (!w) return;
    if (w.viewers.delete(clientId) && this.syncViewers(w)) this.ctx.emit(w);
  }

  detachAll(clientId: string) {
    for (const w of this.ctx.workers.values()) {
      if (w.viewers.delete(clientId) && this.syncViewers(w)) this.ctx.emit(w);
    }
  }

  /** Keystrokes from `by`'s browser. */
  write(id: string, data: string, by: string) {
    const w = this.ctx.workers.get(id);
    if (!w) return;
    if (w.dsh) {
      // ACP has no terminal: the session buffers these into a line and submits it on Enter.
      w.dsh.writeInput(data);
      let changed = this.typed(w, by);
      if (w.info.status === 'needs_input' && w.info.acked === false) {
        w.info.acked = true;
        changed = true;
      }
      if (changed) this.ctx.emit(w);
      return;
    }
    if (!w.pty) return;
    w.pty.write(data);
    let changed = this.typed(w, by);
    if (w.info.status === 'needs_input' && w.info.acked === false) {
      w.info.acked = true;
      changed = true;
    }
    if (changed) this.ctx.emit(w);
  }

  /**
   * Remembers who typed into the terminal last. Says whether that's news: another person, or the
   * same one after a pause (not every keystroke, or a typist would flood everyone with updates).
   */
  private typed(w: Worker, by: string): boolean {
    const now = Date.now();
    const last = w.info.lastInput;
    if (last?.by === by && now - last.at < TYPED_REFRESH_MS) return false;
    w.info.lastInput = { by, at: now };
    return true;
  }

  /** Types a prompt into the agent's input box and submits it; `by` is the person who sent it, if any. */
  prompt(id: string, text: string, by?: string): string | undefined {
    const w = this.ctx.workers.get(id);
    if (!w) return 'No such worker';
    if (w.dsh) {
      const clean = text.replace(/\r\n?/g, '\n').trim();
      if (!clean) return 'Empty prompt';
      w.dsh.prompt(clean);
      w.info.activity = truncate(clean, 80);
      this.ctx.notePrompt(w, clean);
      if (by) w.info.lastInput = { by, at: Date.now() };
      this.ctx.emit(w);
      return undefined;
    }
    if (!w.pty) return 'Worker is not running';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty prompt';
    // Bracketed paste keeps multi-line prompts in one message, then Enter submits.
    w.pty.write(`\x1b[200~${clean}\x1b[201~`);
    setTimeout(() => w.pty?.write('\r'), 120);
    w.info.activity = truncate(clean, 80);
    this.ctx.notePrompt(w, clean);
    if (by) w.info.lastInput = { by, at: Date.now() };
    this.ctx.emit(w);
    return undefined;
  }

  resize(id: string, cols: number, rows: number) {
    const w = this.ctx.workers.get(id);
    // A DSH worker has no PTY to resize, but its terminal still fits the window it's shown in.
    if (!(w?.pty || w?.dsh) || !w.term) return;
    cols = clamp(Math.floor(cols), 20, 400);
    rows = clamp(Math.floor(rows), 5, 200);
    if (cols === w.info.cols && rows === w.info.rows) return;
    w.info.cols = cols;
    w.info.rows = rows;
    try {
      w.pty?.resize(cols, rows);
      w.term.resize(cols, rows);
    } catch {
      // pty may have exited between checks
    }
    w.screenDirty = true;
    w.lastLines = [];
    this.ctx.emit(w);
  }

  private syncViewers(w: Worker): boolean {
    const names = [...new Set(w.viewers.values())];
    const ids = [...w.viewers.keys()];
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
    if (same(names, w.info.viewers) && same(ids, w.info.viewerIds)) return false;
    w.info.viewers = names;
    w.info.viewerIds = ids;
    return true;
  }
}
