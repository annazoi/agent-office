import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AgentProvider } from '../../shared/protocol.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import { PtyHost, SCROLLBACK, type Adopted, type Pty } from '../ptys.js';
import { ScrollbackStore, terminalTail } from '../history.js';
import { providerAdapter, titleNoise, type LaunchPlan } from '../providers/index.js';
import { launchAcp } from './acp.js';
import { clockWork } from './clock.js';
import { childEnv } from './env.js';
import { midTurn } from './lifecycle.js';
import { WIN, defaultShell, resolveCommand, shellRun, shq } from './process.js';
import { newTerm, type HeadlessTerminal } from './terminal.js';
import type { HookEnv, RunAs, Worker, WorkerContext } from './types.js';
import type { WorkerWatch } from './watch.js';
import type { WorkerTrees } from './worktree.js';

/** Between a worker's saved scrollback and what it prints after the office restarted. */
const RESTORED_NOTE = '\x1b[2m──── the office restarted · earlier output above ────\x1b[0m\r\n';

/** What starting a worker's process needs of the floor, beyond the workers' shared context. */
export interface RunEnv {
  worktrees: WorkerTrees;
  watch: WorkerWatch;
  /** Runs the workers' terminals outside the office, so they outlive a restart of it (see ptys.ts). */
  /** The terminal host as the manager has it now, so swapping the manager's is seen here too. */
  host: () => PtyHost;
  /** Each worker's terminal on disk, so a restart doesn't wipe it (see history.ts). */
  scrollback: ScrollbackStore;
  hook: HookEnv;
  runAs?: RunAs;
  defaultProvider: AgentProvider;
  agentPath: string | null;
  agentArgs: string[];
  /** What each provider set up on this floor, for its launches (see ProviderAdapter.prepare). */
  setups: Partial<Record<AgentProvider, unknown>>;
  /** Where the office-queue and office-workers commands are, for the workers' PATH (see writeOfficeCommands). */
  officeBin: string | undefined;
}

/** Starting a worker's process (or taking back one the terminal host kept) and following it until it ends. */
export class WorkerRuns {
  constructor(
    private ctx: WorkerContext,
    private env: RunEnv,
  ) {}

  launch(w: Worker, prompt: string | undefined, resumeSessionId: string | undefined) {
    const { info } = w;
    // Its folder was deleted meanwhile: it waits, marked lost, for someone to rebuild it or send it home.
    if (this.env.worktrees.checkLost(w)) {
      clockWork(info, 'exited');
      info.status = 'exited';
      this.ctx.emit(w);
      return;
    }
    // The new terminal starts with what the last one showed (on a resume), or with what was saved
    // when the office last stopped, so earlier output is still there to scroll back to and search.
    const restarted = !w.term;
    const before = w.term && w.ser ? terminalTail(w.term, w.ser, SCROLLBACK) : this.env.scrollback.load(info.id);
    const prelude = before ? `${before}\r\n${restarted ? RESTORED_NOTE : ''}` : undefined;
    const term = this.newTerm(w);
    if (prelude) {
      // Writes are parsed in order, so this lands before anything the new process prints.
      term.write(prelude, () => {
        if (w.term === term) w.fresh = term.registerMarker(0);
      });
    }

    const shell = defaultShell();
    const isShell = info.kind === 'shell';
    const adapter = isShell ? undefined : providerAdapter(info.provider);
    const configured = !isShell && info.provider === this.env.defaultProvider;
    const cwd = this.ctx.cwd(info);
    const command = this.ctx.command(info);
    const commandPath = isShell ? undefined : configured ? this.env.agentPath : resolveCommand(command);
    const base = isShell ? (WIN && !process.env.SHELL ? [] : ['-l']) : configured ? [...this.env.agentArgs] : [];
    // Its provider's command line, and anything it sets for this run (see ProviderAdapter.launch).
    const plan: LaunchPlan = adapter ? adapter.launch({ h: this.env.watch.handleOf(w), args: base, prompt, resumeSessionId, station: DESK_BY_ID.get(info.deskId)?.station, cwd, setup: this.env.setups[adapter.id], composio: w.owner ? this.env.runAs?.composioMcp?.(w.owner) : undefined }) : { args: base };
    const { args } = plan;
    if (plan.rotateToken) w.hookToken = randomBytes(16).toString('hex');
    const env = childEnv();
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGENT_OFFICE_WORKER_ID: info.id,
      AGENT_OFFICE_HOOK_URL: this.env.hook.url,
      AGENT_OFFICE_HOOK_TOKEN: w.hookToken,
    });
    Object.assign(env, plan.env);
    // Whichever agent it runs, a worker reaches the office's workers with office-workers, and a board
    // agent the queue with office-queue.
    if (this.env.officeBin) {
      // Windows spells it Path.
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[key] = [this.env.officeBin, env[key]].filter(Boolean).join(path.delimiter);
    }

    // A workspace isn't a repository, but it's inside this floor's checkout: git run in it must not
    // find that checkout (and switch its branch, say) instead of saying it's no repository.
    if (info.repos?.length) env.GIT_CEILING_DIRECTORIES = [path.dirname(cwd), env.GIT_CEILING_DIRECTORIES].filter(Boolean).join(path.delimiter);
    if (w.owner && this.env.runAs) {
      if (adapter?.signIn && !this.env.runAs.claudeReady(w.owner)) {
        this.startFailed(w, `whoever hired ${info.name} (${info.createdBy}) isn't signed in to Claude — they can sign in under ☰ → 🔐 Your sign-ins, then press R here`);
        return;
      }
      this.env.runAs.apply(w.owner, env, [this.ctx.dir, cwd]);
    }
    adapter?.usage?.locate?.(this.env.watch.handleOf(w), cwd, env);

    if (adapter?.transport === 'acp') {
      // No PTY and no argv for prompts or resume: the office owns an ACP connection instead, and
      // renders its updates into this same terminal (see dsh.ts).
      const file = commandPath ?? shell;
      const acpArgs = commandPath ? args : shellRun(['exec', command, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' '));
      launchAcp(this.ctx, w, term, { file, args: acpArgs, cwd, env, resumeSessionId, prompt });
      this.ctx.emit(w);
      this.ctx.persist();
      return;
    }

    // The host keeps its own copy of the screen for the next office: it starts with the same history.
    const where = { cwd, env, cols: info.cols, rows: info.rows, prelude };
    let proc: Pty;
    try {
      plan.finishEnv?.(env);
      if (isShell) {
        proc = this.env.host().spawn({ file: shell, args, ...where });
      } else if (commandPath) {
        proc = this.env.host().spawn({ file: commandPath, args, ...where });
      } else {
        // Not found on PATH: let a login shell find it (nvm, asdf, ~/.local/bin ...).
        const line = ['exec', command, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' ');
        proc = this.env.host().spawn({ file: shell, args: shellRun(line), ...where });
      }
    } catch (err) {
      this.startFailed(w, (err as Error).message);
      return;
    }
    // One that says itself when it's up (see ProviderAdapter.bootHint) starts out 'starting'.
    if (!adapter?.bootHint) {
      clockWork(info, 'idle');
      info.status = 'idle';
    }
    this.follow(w, proc, term, resumeSessionId);
    this.ctx.emit(w);
    this.ctx.persist();
  }

  /** Takes back a terminal the host kept running while the office was down. */
  adopt(w: Worker, adopted: Adopted, saved: NonNullable<Worker['saved']>) {
    const { info } = w;
    // It kept working through the restart: nothing to carry on.
    w.interrupted = false;
    info.cols = adopted.cols;
    info.rows = adopted.rows;
    const term = this.newTerm(w);
    // Scrollback and all, the history from before this run included: only what it prints from here
    // on can say it's stuck on a login.
    term.write(adopted.snapshot, () => {
      if (w.term === term) w.fresh = term.registerMarker(0);
    });
    this.setTitle(w, adopted.title);
    // A hook that came in since the office started already says how it's doing.
    if (info.status === 'offline') {
      clockWork(info, saved.status);
      info.status = saved.status;
      info.acked = saved.acked;
      info.waitingSince = saved.waitingSince;
    }
    const adapter = providerAdapter(info.provider);
    const locate = adapter?.usage?.locate;
    if (locate) locate(this.env.watch.handleOf(w), this.ctx.cwd(info), childEnv());
    this.follow(w, adopted.pty, term, undefined);
    // A turn that ended while the office was down says so with its Stop hook, which retries until
    // the office is back. Claude's progress report, where it gives one, says a turn is still going.
    if (adopted.busy && adapter?.screen?.progress) this.env.watch.onProgress(w, true);
    this.ctx.emit(w);
  }

  /** A fresh screen for a worker's terminal, reading its progress reports (Claude's) and title off it. */
  private newTerm(w: Worker): HeadlessTerminal {
    return newTerm(w, {
      progress: providerAdapter(w.info.provider)?.screen?.progress ? (busy) => this.env.watch.onProgress(w, busy) : undefined,
      title: (title) => this.setTitle(w, title),
    });
  }

  private setTitle(w: Worker, title: string) {
    const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (clean && clean !== w.info.title && !titleNoise(clean)) {
      w.info.title = clean;
      this.ctx.emit(w);
    }
  }

  /** Shows a worker's terminal output as it comes, and deals with the process ending. */
  private follow(w: Worker, proc: Pty, term: HeadlessTerminal, resumeSessionId: string | undefined) {
    const { info } = w;
    const adapter = info.kind === 'agent' ? providerAdapter(info.provider) : undefined;
    w.pty = proc;
    proc.onData((data) => {
      term.write(data);
      w.screenDirty = true;
      w.unsaved = true;
      if (w.viewers.size) this.ctx.events.data(info.id, data, [...w.viewers.keys()]);
    });
    proc.onExit(({ exitCode, error, lost }) => {
      if (w.pty === proc || !w.pty) adapter?.exited?.(this.env.watch.handleOf(w), this.ctx.cwd(info)); // not for a run it has since replaced
      if (w.pty !== proc || this.ctx.workers.get(info.id) !== w) return;
      w.pty = undefined;
      if (error) {
        this.startFailed(w, error);
        return;
      }
      // The terminal host died and took the process with it: nothing the worker did.
      if (lost && !this.ctx.closing) {
        if (midTurn(w)) w.interrupted = true;
        this.ctx.resume(info.id);
        return;
      }
      if (adapter?.usage?.scanOnExit && !this.ctx.closing) this.env.watch.scheduleScan(w);
      // Resuming a conversation Claude no longer has ("No conversation found") exits before Claude
      // ever starts. Start a fresh one rather than leave the worker asleep.
      if (adapter?.freshIfResumeFails && resumeSessionId && info.status === 'starting' && !this.ctx.closing) {
        this.ctx.events.toast(`${info.name}'s last conversation couldn't be resumed — starting a fresh one`, 'warn');
        this.launch(w, undefined, undefined);
        return;
      }
      info.exitCode = exitCode;
      clockWork(info, 'exited');
      info.status = 'exited';
      const hint = info.kind === 'shell' ? ' — press R to restart' : info.sessionId ? ' — press R to resume' : '';
      const msg = `\r\n\x1b[2m[${info.name} exited with code ${exitCode}${hint}]\x1b[0m\r\n`;
      term.write(msg);
      if (w.viewers.size) this.ctx.events.data(info.id, msg, [...w.viewers.keys()]);
      w.screenDirty = true;
      w.unsaved = true;
      this.ctx.emit(w);
      this.ctx.persist();
      void this.ctx.syncBranch(w);
    });
    // SessionStart fires as soon as Claude can take input. Still silent after a while means it is
    // blocked on a human: folder trust dialog, login, first-run onboarding. Flag it so it jumps.
    setTimeout(() => {
      if (info.status !== 'starting' || w.pty !== proc) return;
      if (adapter?.bootHint) {
        w.bootBlocked = true;
        info.activity = adapter.bootHint;
        this.ctx.setStatus(w, 'needs_input');
      } else this.ctx.setStatus(w, 'idle');
    }, 12000);
  }

  private startFailed(w: Worker, message: string) {
    const what = this.ctx.command(w.info);
    const msg = `\r\n\x1b[31mFailed to start ${what}: ${message}\x1b[0m\r\n`;
    clockWork(w.info, 'exited');
    w.info.status = 'exited';
    w.info.exitCode = -1;
    w.term?.write(msg);
    if (w.viewers.size) this.ctx.events.data(w.info.id, msg, [...w.viewers.keys()]);
    w.screenDirty = true;
    w.unsaved = true;
    this.ctx.events.toast(`Could not start ${what}: ${message}`, 'error');
    this.ctx.emit(w);
  }
}
