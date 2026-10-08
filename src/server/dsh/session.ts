import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Usage, WorkerAction, WorkerStatus } from '../../shared/protocol.js';
import { CONTROL_TIMEOUT_MS, MAX_FRAME, MAX_LINE, MAX_TEXT, MAX_TYPED, bounded, isRec, oneLine, reason, str, type Rec } from './util.js';
import { V } from './theme.js';
import { escapeText, notice } from './text.js';
import { allowOption, permissionChoice, permissionOptions, rejectOption, renderPermission, type DshPermissionOption } from './permission.js';
import { DshRenderer } from './renderer.js';
import { dshEffort, resolveConfigValue, type DshLaunch } from './config.js';

export interface DshEvents {
  /** ANSI text for the worker's terminal. */
  output(text: string): void;
  status(status: WorkerStatus): void;
  action(action: WorkerAction | undefined): void;
  usage(usage: Usage): void;
  /** The session id the agent handed back, for the worker's card and for resume. */
  session(sessionId: string): void;
  /** A prompt someone typed into the terminal, for the worker's task card. */
  prompted(text: string): void;
  /** The child process ended. `quiet` marks a close the office asked for. */
  exit(code: number | null, error: string | undefined, quiet: boolean): void;
}

/**
 * One DSH worker's ACP connection. Serializes prompts (ACP allows one per session), answers
 * permission requests from the person at the terminal, and renders every update into the worker's
 * headless terminal through `events.output`.
 */
export class DshSession {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private nextId = 100;
  private sessionId?: string;
  private buffer = '';
  private line = '';
  private permission?: { id: unknown; options: DshPermissionOption[] };
  private configOptions: Rec[] = [];
  private renderer = new DshRenderer();
  private prompting = false;
  private finished = false;
  private closing = false;
  private started = false;

  constructor(
    private launch: DshLaunch,
    private events: DshEvents,
  ) {}

  get id(): string | undefined {
    return this.sessionId;
  }

  get running(): boolean {
    return this.started && !this.finished;
  }

  /** Spawns the child and runs the ACP handshake. Everything after is driven by updates. */
  start(): void {
    if (this.started) return;
    this.started = true;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.launch.file, this.launch.args, {
        cwd: this.launch.cwd,
        env: this.launch.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.events.status('exited');
      this.events.exit(-1, reason(err), false);
      this.finished = true;
      return;
    }
    this.child = child;
    this.events.status('starting');

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_TEXT);
    });
    child.on('error', (err) => this.finish(-1, err.message));
    child.on('exit', (code) => this.finish(code, stderr.trim() || undefined));

    void this.handshake();
  }

  /** Keystrokes from a browser: echoed, buffered to a line, submitted on Enter (see the doc). */
  writeInput(data: string): void {
    if (this.finished || !this.started) return;
    if (data === '\x1b') {
      this.cancelTurn();
      return;
    }
    // Arrow/function keys arrive as escape sequences: swallow them rather than typing them in.
    const cleaned = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1bO[@-~]/g, '');
    // A browser sends each key on its own, so Enter is a lone "\r". Several characters at once are a
    // paste, and a blank line in a paste must not press the approval's Enter (allow once); a choice
    // typed out ("1", an option's name) still has to match one of those listed.
    const burst = [...cleaned].length > 1;
    let echo = '';
    const flushEcho = () => {
      if (echo) this.events.output(echo);
      echo = '';
    };
    for (const ch of cleaned) {
      if (ch === '\r' || ch === '\n') {
        if (burst && this.permission && !this.line.trim()) continue;
        flushEcho();
        this.submitLine();
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line) {
          this.line = [...this.line].slice(0, -1).join('');
          echo += '\b \b';
        }
      } else if (ch === '\x03') {
        flushEcho();
        this.cancelTurn();
      } else if (ch < ' ' || /[\x80-\x9f\u202a-\u202e\u2066-\u2069]/.test(ch)) continue;
      else if (this.line.length < MAX_TYPED) {
        this.line += ch;
        echo += ch;
      }
    }
    flushEcho();
  }

  /** A prompt from the office (the prompt box, the queue, a board agent): echoed, then submitted. */
  prompt(text: string): void {
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return;
    if (this.prompting) {
      this.events.output(notice('warn', 'one prompt at a time — this turn is still running'));
      return;
    }
    this.events.output(`${V.brand}${V.bold}>${V.reset} ${V.text}${escapeText(bounded(clean, MAX_LINE)).replace(/\n/g, '\r\n  ')}${V.reset}\r\n`);
    this.sendPrompt(clean);
  }

  /**
   * Escape / Ctrl+C. On an open approval this is the harness's Reject, which the tool records and
   * the turn carries on around; a tool that offers no reject choice is cancelled outright. With no
   * question open, it cancels the turn in flight.
   */
  cancelTurn(): void {
    if (this.finished) return;
    if (this.permission) {
      const reject = rejectOption(this.permission.options);
      this.answerPermission(reject?.optionId, !reject);
      if (!reject) this.notify('session/cancel', { sessionId: this.sessionId });
      return;
    }
    if (this.prompting) {
      this.events.output(`\r\n${notice('quiet', 'cancelled')}`);
      this.notify('session/cancel', { sessionId: this.sessionId });
      return;
    }
    this.line = '';
    this.events.output('\r\n');
  }

  /** Sends home: close the session quietly, then end the child. */
  close(): void {
    if (this.closing || this.finished) return;
    this.closing = true;
    if (this.sessionId) {
      // session/close is a request, but the office does not wait on it: the child goes either way.
      this.send({ jsonrpc: '2.0', id: ++this.nextId, method: 'session/close', params: { sessionId: this.sessionId } });
    }
    const child = this.child;
    setTimeout(() => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // already gone
      }
    }, 500).unref?.();
  }

  // --- the handshake, and everything the agent sends back -------------------

  private async handshake(): Promise<void> {
    try {
      await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: 'agent-office', version: '0.1.0' },
      });
    } catch (err) {
      this.fail(`DeepSeek Harness did not answer initialize: ${reason(err)}`);
      return;
    }

    // Only this worker's own session is carried on. Every desk without a worktree shares the checkout,
    // so "the newest session in this directory" may be another worker's, even one still running.
    let ready = false;
    if (this.launch.resumeSessionId) ready = await this.tryResume(this.launch.resumeSessionId);
    if (!ready && !(await this.newSession())) return;

    await this.applyChoices();
    if (this.launch.firstPrompt) this.prompt(this.launch.firstPrompt);
    else this.events.status('idle');
  }

  private async newSession(): Promise<boolean> {
    try {
      const result = await this.request('session/new', { cwd: this.launch.cwd, mcpServers: [] });
      const id = isRec(result) ? str(result.sessionId) : undefined;
      if (!id) throw new Error('session/new returned no session id');
      this.adopt(id, isRec(result) ? result.configOptions : undefined);
      this.events.output(notice('info', 'DeepSeek Harness ready'));
      return true;
    } catch (err) {
      this.fail(`DeepSeek Harness could not start a session: ${reason(err)}`);
      return false;
    }
  }

  private async tryResume(id: string): Promise<boolean> {
    try {
      const result = await this.request('session/resume', { sessionId: id, cwd: this.launch.cwd, mcpServers: [] });
      this.adopt(id, isRec(result) ? result.configOptions : undefined);
      this.events.output(notice('info', `resumed session ${id}`));
      return true;
    } catch (err) {
      this.events.output(notice('quiet', `could not resume session ${id}: ${oneLine(reason(err), 200)}`));
      return false;
    }
  }

  private adopt(id: string, configOptions: unknown): void {
    this.sessionId = id;
    this.configOptions = Array.isArray(configOptions) ? configOptions.filter(isRec) : [];
    this.events.session(id);
  }

  /** Model and reasoning effort chosen for this worker, if the live catalog offers them. */
  private async applyChoices(): Promise<void> {
    if (this.launch.model) await this.setConfig('model', this.launch.model);
    if (this.launch.effort) await this.setConfig('reasoning_effort', dshEffort(this.launch.effort));
  }

  private async setConfig(configId: string, wanted: string): Promise<void> {
    const option = this.configOptions.find((entry) => str(entry.id) === configId);
    if (!option) {
      this.events.output(notice('quiet', `the harness advertises no ${configId}; keeping the profile default`));
      return;
    }
    const value = resolveConfigValue(wanted, option);
    try {
      const result = await this.request('session/set_config_option', { sessionId: this.sessionId, configId, value });
      const options = isRec(result) ? result.configOptions : undefined;
      if (Array.isArray(options)) this.configOptions = options.filter(isRec);
      this.events.output(notice('quiet', `${configId} → ${oneLine(value, 160)}`));
    } catch (err) {
      // A stale saved model must not fail the launch: the profile default stays in force.
      this.events.output(notice('warn', `${configId} "${oneLine(wanted, 120)}" was not accepted (${oneLine(reason(err), 160)}); keeping the profile default`));
    }
  }

  private sendPrompt(clean: string): void {
    if (!this.sessionId) {
      this.events.output(notice('bad', 'no session to prompt yet'));
      return;
    }
    this.prompting = true;
    this.events.status('working');
    this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: clean }] }, 0)
      .then((result) => {
        this.prompting = false;
        const stop = isRec(result) ? str(result.stopReason) : undefined;
        this.events.output(this.renderer.endTurn(stop === 'cancelled' ? 'Stopped' : 'Worked'));
        this.events.action(undefined);
        // "Worked" and "Stopped" are the harness's own words for those two endings.
        if (stop && stop !== 'end_turn' && stop !== 'cancelled') this.events.output(notice('quiet', oneLine(stop, 80)));
        this.events.status('done');
      })
      .catch((err) => {
        this.prompting = false;
        this.events.output(this.renderer.endTurn('Failed'));
        this.events.output(notice('bad', `prompt failed: ${oneLine(reason(err), 300)}`));
        this.events.action(undefined);
        this.events.status('done');
      });
  }

  private submitLine(): void {
    const text = this.line;
    this.line = '';
    this.events.output('\r\n');
    if (this.permission) {
      // Enter on an empty line is the harness's Allow once; a number picks a listed choice.
      if (!text.trim()) {
        const once = allowOption(this.permission.options);
        if (once) this.answerPermission(once.optionId);
        else this.events.output(notice('warn', 'no allow-once choice here: type a listed number, or Esc'));
        return;
      }
      const pick = permissionChoice(text, this.permission.options);
      if (pick) {
        this.answerPermission(pick.optionId);
        return;
      }
      this.events.output(notice('warn', 'Enter allows once, Esc rejects, or type a listed number'));
      return;
    }
    if (text.trim()) {
      const clean = text.trim();
      // The office can see prompts it sends itself; this one came from the terminal, so it is told.
      this.events.prompted(clean);
      this.sendPrompt(clean);
    }
  }

  private answerPermission(optionId: string | undefined, cancelled = false): void {
    const permission = this.permission;
    if (!permission) return;
    this.permission = undefined;
    const outcome = cancelled || !optionId ? { outcome: 'cancelled' } : { outcome: 'selected', optionId };
    this.send({ jsonrpc: '2.0', id: permission.id, result: { outcome } });
    const label = cancelled || !optionId ? 'permission cancelled' : `permission answered: ${oneLine(optionId, 80)}`;
    this.events.output(notice('quiet', label));
    // Answering a prompt's question puts the turn back to work; answering autonomous work leaves the
    // session ready for the next prompt.
    this.events.status(this.prompting ? 'working' : 'idle');
  }

  private onPermission(id: unknown, params: unknown): void {
    const options = permissionOptions(params);
    this.permission = { id, options };
    const toolCall = isRec(params) && isRec(params.toolCall) ? params.toolCall : undefined;
    this.events.output(renderPermission(params, options, this.renderer.toolDetail(toolCall ? str(toolCall.toolCallId) : undefined)));
    this.events.status('needs_input');
  }

  private onUpdate(params: unknown): void {
    const update = isRec(params) ? params.update : undefined;
    const rendered = this.renderer.render(update);
    if (rendered.text) this.events.output(rendered.text);
    if (rendered.usage) this.events.usage(rendered.usage);
    if (rendered.action !== undefined) this.events.action(rendered.action);
  }

  // --- framing --------------------------------------------------------------

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const frame = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!frame) continue;
      let message: unknown;
      try {
        message = JSON.parse(frame);
      } catch {
        this.events.output(notice('quiet', 'unreadable ACP frame'));
        continue;
      }
      try {
        this.dispatch(message);
      } catch (err) {
        this.events.output(notice('quiet', `ACP frame skipped: ${oneLine(reason(err), 200)}`));
      }
    }
    // A frame that never ends is not a frame: drop it rather than grow without bound.
    if (this.buffer.length > MAX_FRAME) {
      this.buffer = '';
      this.events.output(notice('quiet', 'oversized ACP frame dropped'));
    }
  }

  private dispatch(message: unknown): void {
    if (!isRec(message)) return;
    const method = str(message.method);
    const id = message.id;
    if (method && id !== undefined && id !== null) {
      if (method === 'session/request_permission') this.onPermission(id, message.params);
      else this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported: ${method}` } });
      return;
    }
    if (method) {
      if (method === 'session/update') this.onUpdate(message.params);
      return;
    }
    const waiter = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (!waiter) return;
    this.pending.delete(id as number);
    if (message.error) waiter.reject(new Error(this.errorText(message.error)));
    else waiter.resolve(message.result);
  }

  private errorText(error: unknown): string {
    if (isRec(error)) return str(error.message) ?? 'unknown error';
    return 'unknown error';
  }

  private request(method: string, params: unknown, timeoutMs = CONTROL_TIMEOUT_MS): Promise<unknown> {
    if (!this.child || this.finished) return Promise.reject(new Error('the DeepSeek Harness process is not running'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
        }, timeoutMs).unref?.();
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: unknown): void {
    const child = this.child;
    if (!child || this.finished || !child.stdin.writable) return;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // The exit handler reports a broken pipe.
    }
  }

  private fail(message: string): void {
    this.events.output(notice('bad', message));
    this.finish(-1, message);
  }

  private finish(code: number | null, error?: string): void {
    if (this.finished) return;
    this.finished = true;
    const quiet = this.closing;
    for (const waiter of this.pending.values()) waiter.reject(new Error('the DeepSeek Harness process ended'));
    this.pending.clear();
    this.child = undefined;
    this.events.exit(code, error, quiet);
  }
}
