// The DJ's synth: schedules each 16th of the set (see song.ts) onto the Web Audio clock.
import { biquad } from '../sound/dsp';
import { buffers, hash, mtof } from '../sound/music';
import { BAR, STEP, djTime, plan, scale, type Track } from './song';

const LOOKAHEAD = 1.1;
/** The set's level after its compressor. */
const LEVEL = 0.9;

export class DjPlayer {
  /** Audio-clock time minus set time. */
  private offset = NaN;
  /** The next 16th to schedule. */
  private next = -1;
  private fade: GainNode;
  private master: DynamicsCompressorNode;
  private drums: BiquadFilterNode;
  private hats: AudioNode;
  /** Ducks the bass and the pads on every kick, so the kick punches through. */
  private duck: GainNode;
  private reeseBus: AudioNode;
  private padBus: AudioNode;
  private arpBus: AudioNode;
  private reverb: AudioNode;
  private stopped = false;
  /** Notes scheduled so far, for quick checks from the console. */
  notes = 0;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    this.fade = ctx.createGain();
    this.fade.gain.setValueAtTime(0, ctx.currentTime);
    this.fade.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 1.2);
    this.fade.connect(out);
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -16;
    this.master.knee.value = 8;
    this.master.ratio.value = 4;
    this.master.attack.value = 0.005;
    this.master.release.value = 0.12;
    this.master.connect(this.fade);

    const room = ctx.createConvolver();
    room.buffer = buffers(ctx).room;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    room.connect(wet).connect(this.master);
    this.reverb = room;

    this.drums = biquad(ctx, 'lowpass', 16000, 0.7);
    this.drums.connect(this.master);
    this.hats = biquad(ctx, 'highpass', 7000, 0.7);
    this.hats.connect(this.drums);

    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    // The reese growls through a little distortion, with the lows left to the sub.
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(2.2);
    drive.oversample = '2x';
    const low = biquad(ctx, 'highpass', 90, 0.7);
    const reeseLevel = ctx.createGain();
    reeseLevel.gain.value = 0.55;
    drive.connect(low).connect(reeseLevel).connect(this.duck);
    this.reeseBus = drive;

    const padTone = biquad(ctx, 'lowpass', 1700, 0.5);
    padTone.connect(this.duck);
    padTone.connect(room);
    this.padBus = padTone;

    // The arpeggio echoes on the dotted 8th.
    const arpTone = biquad(ctx, 'lowpass', 3200, 0.8);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const echoLevel = ctx.createGain();
    echoLevel.gain.value = 0.45;
    arpTone.connect(this.master);
    arpTone.connect(echo);
    echo.connect(feedback).connect(echo);
    echo.connect(echoLevel).connect(this.master);
    this.arpBus = arpTone;
  }

  /** Schedules what's coming up. `at` is how far into the set it is now (see djTime). */
  tick(at: number) {
    const ctx = this.ctx;
    // A suspended context's clock stands still: notes scheduled on it would all come out at once.
    if (this.stopped || ctx.state !== 'running') return;
    const offset = ctx.currentTime - at;
    const drift = Math.abs(offset - this.offset);
    if (!(drift < 0.03)) {
      this.offset = offset;
      // A jump (a suspended context, a computer waking up, the office's clock arriving): pick up from now.
      if (!(drift < 0.5)) this.next = -1;
    }
    if (this.next < 0) this.next = Math.ceil(at / STEP);
    const until = at + LOOKAHEAD;
    for (; this.next * STEP < until; this.next++) {
      const t = this.next * STEP;
      if (t >= at - 0.02) this.play(this.next, Math.max(ctx.currentTime, t + this.offset));
    }
  }

  /** Fades out and lets go of everything. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(0, now + 0.5);
    setTimeout(() => this.fade.disconnect(), 2500);
  }

  /** The air horn, as the DJ (or whoever's at the booth) lets rip: BAAP, bap bap, BAAAAAP. */
  horn(when = this.ctx.currentTime) {
    const ctx = this.ctx;
    const out = biquad(ctx, 'bandpass', 1300, 0.6);
    const g = ctx.createGain();
    g.gain.value = 0.9;
    out.connect(g).connect(this.master);
    g.connect(this.reverb);
    for (const [t, len] of [
      [0, 0.2],
      [0.26, 0.09],
      [0.4, 0.09],
      [0.55, 0.62],
    ]) {
      const env = ctx.createGain();
      const w = when + t;
      env.gain.setValueAtTime(0, w);
      env.gain.linearRampToValueAtTime(0.22, w + 0.015);
      env.gain.setValueAtTime(0.22, w + len - 0.03);
      env.gain.linearRampToValueAtTime(0, w + len);
      env.connect(out);
      for (const [f, det] of [
        [415, 0],
        [415, 14],
        [523, -8],
        [830, 6],
      ]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        // Each blast scoops up into the note.
        o.frequency.setValueAtTime(f * 0.9, w);
        o.frequency.exponentialRampToValueAtTime(f, w + 0.06);
        o.connect(env);
        o.start(w);
        o.stop(w + len + 0.02);
      }
    }
    this.notes++;
  }

  private play(k: number, when: number) {
    const p = plan(k);
    const { track, section, s, chord } = p;
    const { part, bar, second } = section;
    const len = (n: number) => n * STEP;

    // The drums, and how muffled they are: the intro's filter opens bar by bar.
    if (s === 0) {
      const f = part === 'intro' ? 500 * 24 ** (bar / 15) : 16000;
      this.drums.frequency.setTargetAtTime(f, when, 0.2);
    }
    if (p.kick) this.kick(when, p.kick);
    if (p.snare) this.snare(when, p.snare);
    if (p.hat) this.hat(when, p.hat * (0.75 + 0.25 * hash(k, 3)), false);
    if (p.openHat) this.hat(when, 0.7, true);
    if (p.shaker) this.shaker(when, p.shaker);

    const padNotes = [0, 2, 4, 6].map((i) => scale(track.root + 24, chord + i));
    const twoBars = bar % 2 === 0 && s === 0;
    if (part === 'intro' || part === 'breakdown') {
      if (twoBars) this.pad(when, padNotes, len(32), part === 'breakdown' ? 1 : 0.8);
      // The sub comes in halfway through the intro.
      if (part === 'intro' && bar >= 8 && s === 0) this.sub(when, this.subNote(track, chord), len(16));
    } else if (part === 'build') {
      if (twoBars && bar < 6) this.pad(when, padNotes, len(32), 0.6);
      if (s === 0) this.riser(when, bar / section.bars, (bar + 1) / section.bars);
    } else if (part === 'drop') {
      if (bar === 0 && s === 0) {
        this.impact(when);
        if (!second && track.horn) this.horn(when + STEP * 2);
      }
      if (twoBars) this.pad(when, padNotes, len(32), 0.4);
      if (s === 0) this.sub(when, this.subNote(track, chord), len(16));
      const reese = scale(track.root + 12, chord);
      if (track.bass === 'reese') {
        // A long growl across the bar, jumping up an octave for the last few 16ths every other bar.
        if (s === 0) this.reese(when, reese, len(bar % 2 ? 10 : 16), track.wah);
        if (s === 10 && bar % 2) this.reese(when, reese + 12, len(6), track.wah.slice(5));
      } else {
        const hits: [number, number, number][] = [
          [0, 3, 0],
          [3, 2, 0],
          [6, 3, 12],
          [10, 2, 0],
          [12, 3, 7],
        ];
        for (const [at, n, up] of hits) if (at === s) this.reese(when, reese + up, len(n), 'hl');
      }
    }
    // The arpeggio: through the breakdown once it's got going, and over the second drop.
    if ((part === 'breakdown' && bar >= 4) || (part === 'drop' && second)) {
      const i = track.arp[s];
      this.arp(when, scale(track.root + 48, chord + i * 2 - (i > 3 ? 7 : 0)), part === 'drop' ? 0.8 : 1);
    }
  }

  private subNote(track: Track, chord: number): number {
    const n = scale(track.root, chord);
    return n > track.root + 6 ? n - 12 : n;
  }

  // ---- Instruments ------------------------------------------------------------------------------

  private noiseAt(when: number, until: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = buffers(this.ctx).noise;
    n.start(when, Math.random() * 2);
    n.stop(until);
    return n;
  }

  private env(when: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return g;
  }

  private kick(when: number, vel: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(190, when);
    o.frequency.exponentialRampToValueAtTime(55, when + 0.045);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.25);
    o.connect(this.env(when, 0.95 * vel, 0.002, 0.34)).connect(this.drums);
    o.start(when);
    o.stop(when + 0.4);
    // The beater's click.
    this.noiseAt(when, when + 0.02).connect(biquad(ctx, 'highpass', 2500, 0.7)).connect(this.env(when, 0.25 * vel, 0.001, 0.012)).connect(this.drums);
    // Everything else ducks out of its way.
    this.duck.gain.setValueAtTime(0.35, when);
    this.duck.gain.setTargetAtTime(1, when + 0.02, 0.07);
    this.notes++;
  }

  private snare(when: number, vel: number) {
    const ctx = this.ctx;
    const g = this.env(when, 0.55 * vel, 0.002, 0.17);
    this.noiseAt(when, when + 0.22).connect(biquad(ctx, 'highpass', 900, 0.7)).connect(biquad(ctx, 'peaking', 2400, 1)).connect(g);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(230, when);
    o.frequency.exponentialRampToValueAtTime(180, when + 0.06);
    o.connect(this.env(when, 0.4 * vel, 0.002, 0.1)).connect(g);
    o.start(when);
    o.stop(when + 0.14);
    g.connect(this.drums);
    if (vel > 0.5) g.connect(this.reverb);
    this.notes++;
  }

  private hat(when: number, vel: number, open: boolean) {
    this.noiseAt(when, when + (open ? 0.3 : 0.06))
      .connect(this.env(when, (open ? 0.12 : 0.16) * vel, 0.001, open ? 0.24 : 0.035))
      .connect(this.hats);
    this.notes++;
  }

  private shaker(when: number, vel: number) {
    this.noiseAt(when, when + 0.05)
      .connect(biquad(this.ctx, 'bandpass', 9000, 1.2))
      .connect(this.env(when, 0.07 * vel, 0.006, 0.03))
      .connect(this.drums);
  }

  /** A deep sine under everything, for the whole bar. */
  private sub(when: number, midi: number, len: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.42, when + 0.02);
    g.gain.setValueAtTime(0.42, when + len - 0.04);
    g.gain.linearRampToValueAtTime(0, when + len);
    o.connect(g).connect(this.duck);
    o.start(when);
    o.stop(when + len + 0.02);
    this.notes++;
  }

  /** Detuned saws through a resonant filter that opens and closes on the 8ths: the reese bass. */
  private reese(when: number, midi: number, len: number, wah: string) {
    const ctx = this.ctx;
    const lp = biquad(ctx, 'lowpass', 300, 6);
    const eighth = STEP * 2;
    for (let i = 0; i * eighth < len; i++) lp.frequency.setTargetAtTime(wah[i % wah.length] === 'h' ? 1600 : 260, when + i * eighth, eighth * 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.3, when + 0.01);
    g.gain.setValueAtTime(0.3, when + Math.max(0.02, len - 0.03));
    g.gain.linearRampToValueAtTime(0, when + len);
    lp.connect(g).connect(this.reeseBus);
    for (const det of [-17, 0, 17]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(midi);
      o.detune.value = det;
      o.connect(lp);
      o.start(when);
      o.stop(when + len + 0.02);
    }
    this.notes++;
  }

  /** A slow, wide chord: two detuned saws a note. */
  private pad(when: number, notes: number[], len: number, level: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.045 * level, when + 0.5);
    g.gain.setValueAtTime(0.045 * level, when + len);
    g.gain.linearRampToValueAtTime(0, when + len + 0.9);
    g.connect(this.padBus);
    for (const m of notes) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(g);
        o.start(when);
        o.stop(when + len + 1);
      }
    }
    this.notes++;
  }

  private arp(when: number, midi: number, level: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    o.connect(this.env(when, 0.05 * level, 0.003, 0.16)).connect(this.arpBus);
    o.start(when);
    o.stop(when + 0.2);
    this.notes++;
  }

  /** One bar of the build's noise sweep, from `from` to `to` of the way through it. */
  private riser(when: number, from: number, to: number) {
    const ctx = this.ctx;
    const bp = biquad(ctx, 'bandpass', 300, 1.4);
    const f = (p: number) => 300 * 28 ** p;
    bp.frequency.setValueAtTime(f(from), when);
    bp.frequency.exponentialRampToValueAtTime(f(to), when + BAR);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02 + 0.3 * from * from, when);
    g.gain.linearRampToValueAtTime(to >= 1 ? 0 : 0.02 + 0.3 * to * to, when + BAR);
    this.noiseAt(when, when + BAR + 0.01).connect(bp).connect(g).connect(this.master);
    g.connect(this.reverb);
  }

  /** The drop lands: a crash and a boom. */
  private impact(when: number) {
    const ctx = this.ctx;
    const crash = this.env(when, 0.3, 0.004, 2);
    this.noiseAt(when, when + 2.2).connect(biquad(ctx, 'highpass', 4500, 0.6)).connect(crash).connect(this.master);
    crash.connect(this.reverb);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, when);
    o.frequency.exponentialRampToValueAtTime(30, when + 0.9);
    o.connect(this.env(when, 0.7, 0.005, 1.2)).connect(this.master);
    o.start(when);
    o.stop(when + 1.3);
  }
}

/** A soft-clipping curve for the bass's grit. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}
