import type { AudioCore } from '../../sound/core';
import { biquad, envelope, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';
import type { Weapon } from '../../../shared/games/fps/weapons';

// What a fight sounds like, synthesized like everything else in the office: a crack and a tail of
// noise for a shot (heavier and slower the bigger the gun), a clack for a magazine, the whump of a
// grenade, the ring of a flashbang, and a tick for the round clock.

/** A gun going off at `at`, as far away as that is from your ears. */
export function gunshot(a: AudioCore, w: Weapon, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`gun-${w.id}`);
  const out = a.panner(at, 6, 0.9);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.004;
  // How big it sounds: a pistol is short and bright, a sniper long and low.
  const heft = Math.min(1, w.damage / 110);
  const len = 0.12 + heft * 0.34;
  const crack = a.noise(a.buf.white);
  const tone = biquad(ctx, 'bandpass', 1400 - heft * 700, 0.8);
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [0.004, 0.55 + heft * 0.35],
    [len * 0.35, 0.12],
    [len, 0],
  ]);
  crack.connect(tone).connect(g).connect(out);
  crack.start(t0);
  crack.stop(t0 + len + 0.05);
  // The thump underneath it.
  a.blip(out, t0, 90 - heft * 30, 0.5, 0.1 + heft * 0.14, 0.26 + heft * 0.3, 'triangle');
}

/** A magazine out and another one in. */
export function reload(a: AudioCore, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('gun-reload');
  const out = a.panner(at, 2, 1.2);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.01;
  a.clink(out, t0, rand(900, 1100), 0.1);
  a.clink(out, t0 + 0.22, rand(500, 650), 0.14);
  a.clink(out, t0 + 0.46, rand(1300, 1600), 0.08);
}

/** The gun coming up to the sights. */
export function scope(a: AudioCore) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('gun-scope');
  a.blip(a.ambience, ctx.currentTime + 0.005, 1800, 0.6, 0.06, 0.05, 'square');
}

/** Something thrown, and then what it does when it goes off. */
export function throwGear(a: AudioCore, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('gear-throw');
  const out = a.panner(at, 2, 1.2);
  out.connect(a.ambience);
  a.blip(out, ctx.currentTime + 0.01, 420, 0.4, 0.09, 0.1, 'triangle');
}

export function burst(a: AudioCore, kind: 'smoke' | 'flash' | 'frag', at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`gear-${kind}`);
  const out = a.panner(at, 8, 0.8);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  if (kind === 'smoke') {
    // A long hiss of escaping gas.
    const n = a.noise(a.buf.white);
    const tone = biquad(ctx, 'highpass', 2200, 0.7);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.08, 0.18],
      [1.6, 0.1],
      [3.2, 0],
    ]);
    n.connect(tone).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + 3.4);
    return;
  }
  if (kind === 'flash') {
    a.blip(out, t0, 2600, 0.9, 0.5, 0.26, 'sine');
    a.blip(out, t0, 180, 0.3, 0.16, 0.3, 'triangle');
    return;
  }
  const n = a.noise(a.buf.white);
  const tone = biquad(ctx, 'lowpass', 900, 0.9);
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [0.01, 0.8],
    [0.25, 0.2],
    [0.7, 0],
  ]);
  n.connect(tone).connect(g).connect(out);
  n.start(t0);
  n.stop(t0 + 0.8);
  a.blip(out, t0, 60, 0.4, 0.3, 0.5, 'triangle');
}

/** A hit landing on somebody: a short wet smack, and a brighter ping for a headshot. */
export function hitMark(a: AudioCore, headshot: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('gun-hit');
  a.blip(a.ambience, ctx.currentTime + 0.004, headshot ? 1500 : 760, 0.6, 0.07, 0.11, 'square');
}

/** The round turning over: a rising pair for a win, a falling one for a loss. */
export function roundChime(a: AudioCore, won: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('arena-round');
  const t0 = ctx.currentTime + 0.01;
  const notes = won ? [523, 784] : [392, 262];
  notes.forEach((f, i) => a.blip(a.ambience, t0 + i * 0.14, f, 0.7, 0.3, 0.09, 'triangle'));
}
