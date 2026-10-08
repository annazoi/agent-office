import type { WorkerStatus } from '../../shared/protocol.js';
import { providerAdapter } from '../providers/index.js';
import { addUsage, scanTracker, trackerUsage, zeroUsage, type Ledger } from '../usage/usage.js';
import { clockWork } from './clock.js';
import { WorkerPrs } from './pr.js';
import { WorkerTasks } from './tasks.js';
import { screenText } from './terminal.js';
import type { Worker, WorkerContext, WorkerHandle } from './types.js';

/**
 * What a worker's status and spend are made of: the status it's in and who's told, its usage read
 * off its provider's transcript, the progress and blocked-screen checks, and the narrow handle its
 * provider adapter is given of it. Kept apart from the manager, which owns the workers themselves.
 */
export class WorkerWatch {
  constructor(
    private ctx: WorkerContext,
    private ledger: Ledger,
    private tasks: WorkerTasks,
    private prs: WorkerPrs,
    /** Types a prompt into a worker's session (WorkerManager.prompt). */
    private prompt: (id: string, text: string) => string | undefined,
  ) {}

  /** Hooks fire in bursts (every tool call); one read a moment later covers the whole burst. */
  scheduleScan(w: Worker) {
    if (w.scanTimer) return;
    w.scanTimer = setTimeout(() => {
      w.scanTimer = undefined;
      this.scanUsage(w);
    }, 300);
  }

  /** Picks up what the session logged since last time and books the difference. */
  scanUsage(w: Worker) {
    const usage = w.info.kind === 'agent' ? providerAdapter(w.info.provider)?.usage : undefined;
    if (usage?.scan) {
      if (this.ctx.workers.get(w.info.id) === w) usage.scan(this.handleOf(w));
      return;
    }
    if (!usage?.transcript || !w.tracker.transcript || this.ctx.workers.get(w.info.id) !== w) return;
    try {
      if (!scanTracker(w.tracker)) return;
    } catch {
      return; // an unreadable transcript is retried on the next scan
    }
    const before = w.info.usage ?? zeroUsage();
    const after = trackerUsage(w.tracker);
    w.info.usage = after;
    this.ledger.add(addUsage(after, before, -1));
    this.ctx.emit(w);
    this.ctx.persist();
  }

  onProgress(w: Worker, busy: boolean) {
    const s = w.info.status;
    if (busy && (s === 'idle' || s === 'done' || s === 'starting')) this.setStatus(w, 'working');
    // Progress stays busy while a permission prompt is open, so going idle from needs_input means the
    // turn ended without a Stop hook (the prompt was rejected or Esc'd).
    else if (!busy && (s === 'working' || (s === 'needs_input' && !w.bootBlocked))) this.setStatus(w, 'done');
  }

  setStatus(w: Worker, status: WorkerStatus) {
    if (w.info.status === status) return;
    if (w.info.status === 'needs_input') w.leftNeedsInputAt = Date.now();
    clockWork(w.info, status);
    w.info.status = status;
    // Done, idle or asleep: it's not acting anything out any more.
    if (status !== 'working' && status !== 'needs_input') w.info.action = undefined;
    // Nobody is looking at the terminal right now -> raise the flag (the worker jumps). A worker at the
    // meeting table that ends its part is waiting on the meeting, not on anyone, so it stays quiet.
    if (status === 'done' || status === 'needs_input') {
      w.info.acked = status === 'done' && (w.viewers.size > 0 || !!w.info.meeting);
      w.info.waitingSince = Date.now();
    } else w.info.acked = true;
    this.ctx.emit(w);
    // What a restarted office picks the worker back up as, should its terminal outlive this one.
    if (w.pty?.id || w.dsh) this.ctx.persist();
    // At rest: it may have made a branch of its own this turn, and opened its PR from there.
    if (status === 'done' || status === 'idle') void this.ctx.syncBranch(w);
  }

  /** What a worker's provider adapter is handed of it (see WorkerHandle): made once, kept on the worker. */
  handleOf(w: Worker): WorkerHandle {
    return (w.handle ??= {
      get info() {
        return w.info;
      },
      get state() {
        return w.state;
      },
      get running() {
        return !!w.pty;
      },
      get bootBlocked() {
        return !!w.bootBlocked;
      },
      set bootBlocked(v) {
        w.bootBlocked = v;
      },
      get leftNeedsInputAt() {
        return w.leftNeedsInputAt;
      },
      set leftNeedsInputAt(v) {
        w.leftNeedsInputAt = v;
      },
      get failStreak() {
        return w.failStreak;
      },
      set failStreak(v) {
        w.failStreak = v;
      },
      get tracker() {
        return w.tracker;
      },
      get pendingPrompt() {
        return w.pendingPrompt;
      },
      set pendingPrompt(v) {
        w.pendingPrompt = v;
      },
      setStatus: (status) => this.setStatus(w, status),
      emit: () => this.ctx.emit(w),
      persist: () => this.ctx.persist(),
      notePrompt: (prompt) => this.tasks.notePrompt(w, prompt),
      noteTool: (tool) => this.tasks.noteTool(w, tool),
      notePr: (command, output) => this.prs.noteOwn(w, command, output),
      clearTask: () => this.tasks.clear(w),
      scheduleScan: () => this.scheduleScan(w),
      prompt: (text) => this.prompt(w.info.id, text),
    });
  }

  /**
   * An agent can sit at its prompt without being usable: Claude stuck on a first-run screen, or not
   * signed in on this machine (see ProviderAdapter.screen). Flag that as needing a human, and clear
   * it once the screen moves on.
   */
  checkBlocked(w: Worker) {
    const blockedBy = w.info.kind === 'agent' ? providerAdapter(w.info.provider)?.screen?.blocked : undefined;
    if (!w.term || !blockedBy) return;
    const s = w.info.status;
    if (s !== 'starting' && s !== 'idle' && !(w.bootBlocked && s === 'needs_input')) return;
    // Only this run's output counts: a "Not logged in" in the scrollback from before is old news.
    const text = screenText(w.term, w.term.buffer.active.type === 'normal' ? Math.max(0, w.fresh?.line ?? 0) : 0);
    const blocked = blockedBy(text, s === 'starting' || !!w.bootBlocked);
    if (blocked && s !== 'needs_input') {
      w.bootBlocked = true;
      w.info.activity = blocked;
      this.setStatus(w, 'needs_input');
    } else if (!blocked && w.bootBlocked && s === 'needs_input') {
      w.bootBlocked = false;
      w.info.activity = undefined;
      this.setStatus(w, 'idle');
    }
  }
}
