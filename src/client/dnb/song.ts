/**
 * The DJ on the rooftop: an endless drum and bass set, synthesized with Web Audio like the jukebox's
 * tunes (sound/music.ts). The set is a run of tracks of 96 bars each: an intro, a build, the drop, a
 * breakdown, another build and a second drop. Each track has its own key, chords, groove and
 * bassline, picked from its number.
 *
 * Every note follows from the office's clock (see djTime), so everyone on the roof hears the same bar
 * at the same moment, and the lights on the rig flash on the same kicks and snares (see djFrame),
 * even for someone who has the music turned off.
 */
import { mulberry32 } from '../../shared/util/rng';

export const DJ_BPM = 172;
/** A 16th, a beat and a bar, in seconds. */
export const STEP = 60 / DJ_BPM / 4;
const BEAT = STEP * 4;
export const BAR = STEP * 16;
const TRACK_BARS = 96;
/** The set started here, on the office's clock; it keeps the numbers small. */
const EPOCH = Date.UTC(2026, 0, 1);

/** How far into the set it is (seconds) at `officeMs` on the office's clock. */
export function djTime(officeMs: number): number {
  return (officeMs - EPOCH) / 1000;
}

export type Part = 'intro' | 'build' | 'drop' | 'breakdown';

interface Section {
  part: Part;
  /** The bar within this part, and how many it has. */
  bar: number;
  bars: number;
  /** Past the first drop: the breakdown, the second build and the second drop. */
  second: boolean;
}

const SECTIONS: [Part, number][] = [
  ['intro', 16],
  ['build', 8],
  ['drop', 32],
  ['breakdown', 16],
  ['build', 8],
  ['drop', 16],
];

function sectionOf(barInTrack: number): Section {
  let start = 0;
  let second = false;
  for (const [part, bars] of SECTIONS) {
    if (barInTrack < start + bars) return { part, bar: barInTrack - start, bars, second };
    if (part === 'drop') second = true;
    start += bars;
  }
  return { part: 'drop', bar: 0, bars: 16, second: true };
}

/** A bar of 16ths each: x hits, o hits softly (a ghost note). */
interface Groove {
  kick: string;
  snare: string;
}

const GROOVES: Groove[] = [
  { kick: 'x.........x.....', snare: '....x..o....x..o' },
  { kick: 'x.........x..x..', snare: '....x.......x.o.' },
  { kick: 'x......x..x.....', snare: '.o..x..o....x...' },
  { kick: 'x.x.......x.....', snare: '....x....o..x..o' },
  { kick: 'x.........xx....', snare: '....x..o....x...' },
];

/** Chords as degrees of the minor scale, one every two bars. */
const PROGRESSIONS = [
  [0, 5, 2, 6],
  [0, 6, 5, 6],
  [0, 3, 5, 4],
  [5, 3, 0, 6],
  [0, 5, 3, 4],
];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export interface Track {
  /** The lowest bass note (MIDI, around F1). */
  root: number;
  prog: number[];
  groove: Groove;
  /** Long notes that growl (a reese), or short rolling ones. */
  bass: 'reese' | 'roller';
  /** How the bass's filter moves through each bar, an 8th at a time: h opens it, l closes it. */
  wah: string;
  /** Which chord note the arpeggio plays on each 16th. */
  arp: number[];
  /** An air horn when the first drop lands. */
  horn: boolean;
  /** The lights' color for this track, 0–1 round the color wheel. */
  hue: number;
}

let cached: { n: number; track: Track } | null = null;

function trackAt(n: number): Track {
  if (cached?.n === n) return cached.track;
  const r = mulberry32(n * 7919 + 13);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const track: Track = {
    root: pick([28, 29, 30, 31, 33]),
    prog: pick(PROGRESSIONS),
    groove: pick(GROOVES),
    bass: r() < 0.6 ? 'reese' : 'roller',
    wah: Array.from({ length: 8 }, (_, i) => (i === 0 || r() < 0.45 ? 'h' : 'l')).join(''),
    arp: pick([
      [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3],
      [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 2, 4, 3, 5],
      [0, 0, 2, 0, 3, 0, 2, 4, 0, 0, 2, 0, 3, 2, 4, 3],
    ]),
    horn: r() < 0.65,
    hue: r(),
  };
  cached = { n, track };
  return track;
}

/** A note of the track's minor scale: `degree` steps up from `root` (MIDI). */
export function scale(root: number, degree: number): number {
  const d = ((degree % 7) + 7) % 7;
  return root + MINOR[d] + 12 * Math.floor(degree / 7);
}

/** What happens on one 16th of the set. */
interface Plan {
  track: Track;
  section: Section;
  /** 0–15 within the bar. */
  s: number;
  /** The chord's degree. */
  chord: number;
  /** How hard each drum hits, 0 for not at all. */
  kick: number;
  snare: number;
  hat: number;
  openHat: boolean;
  shaker: number;
}

export function plan(k: number): Plan {
  const bar = Math.floor(k / 16);
  const s = ((k % 16) + 16) % 16;
  const n = Math.floor(bar / TRACK_BARS);
  const b = bar - n * TRACK_BARS;
  const track = trackAt(n);
  const section = sectionOf(b);
  const chord = track.prog[Math.floor(b / 2) % track.prog.length];
  const hit = (p: string) => (p[s] === 'x' ? 1 : p[s] === 'o' ? 0.35 : 0);
  const out: Plan = { track, section, s, chord, kick: 0, snare: 0, hat: 0, openHat: false, shaker: 0 };
  const g = track.groove;
  const { part, bar: sb } = section;
  if (part === 'intro') {
    // Hats alone at first, then the whole break, muffled (the drum filter opens up as it goes).
    out.hat = s % 2 === 0 ? (s % 4 === 2 ? 0.8 : 0.5) : 0;
    if (sb >= 4) {
      out.kick = hit(g.kick);
      out.snare = hit(g.snare);
    }
  } else if (part === 'build') {
    // Four to the floor under a snare roll that gets quicker every couple of bars, then a beat of nothing.
    const last = sb === section.bars - 1 && s >= 12;
    if (!last) {
      if (sb < 6 && s % 4 === 0) out.kick = 0.8;
      const every = sb < 3 ? 4 : sb < 5 ? 2 : 1;
      if (s % every === 0) out.snare = 0.35 + 0.65 * ((sb * 16 + s) / (section.bars * 16));
      out.hat = s % 2 === 0 ? 0.4 : 0;
    }
  } else if (part === 'drop') {
    const fill = sb % 8 === 7;
    out.kick = fill && s >= 10 ? 0 : hit(g.kick);
    out.snare = fill && s >= 12 ? 0.55 + (s - 12) * 0.15 : hit(g.snare);
    out.hat = s % 2 === 0 ? (s % 4 === 2 ? 1 : 0.6) : 0;
    out.openHat = s === 14 && sb % 2 === 1;
    out.shaker = s % 2 === 1 ? 0.7 : 0.4;
  } else {
    // The breakdown: pads and the arpeggio alone, then a half-time beat creeping back in.
    if (sb >= 8) {
      out.kick = s === 0 ? 0.8 : 0;
      out.snare = s === 8 ? 0.8 : 0;
      out.hat = s % 4 === 2 ? 0.6 : 0;
    }
  }
  return out;
}

/** What the lights go by: where the set is, and what just hit. */
export interface DjFrame {
  /** Beats since the set began. */
  beats: number;
  /** 1 on each beat, falling to 0 before the next. */
  beat: number;
  /** 1 as a kick or a snare lands, falling off fast. */
  kick: number;
  snare: number;
  /** How hard it's going: low in a breakdown, 1 in a drop. */
  energy: number;
  part: Part;
  /** 0 → 1 through a build. */
  rise: number;
  /** Seconds since the drop landed (Infinity outside a drop). */
  sinceDrop: number;
  /** Which track of the set, and its color (0–1 round the wheel). */
  track: number;
  hue: number;
}

/** Where the set is at `at` (see djTime), and what just hit. */
export function djFrame(at: number): DjFrame {
  const k = Math.floor(at / STEP);
  const p = plan(k);
  const { part, bar, bars, second } = p.section;
  const beats = at / BEAT;
  const beat = (1 - (beats - Math.floor(beats))) ** 3;
  let kick = 0;
  let snare = 0;
  // The last kick and snare within a beat, fading from when they hit.
  for (let j = 0; j < 4 && !(kick && snare); j++) {
    const q = j ? plan(k - j) : p;
    const since = at - (k - j) * STEP;
    if (!kick && q.kick >= 0.5) kick = Math.exp(-since * 9);
    if (!snare && q.snare >= 0.5) snare = Math.exp(-since * 11);
  }
  const through = (bar + (k % 16) / 16) / bars;
  const energy = part === 'drop' ? 1 : part === 'build' ? 0.45 + 0.5 * through : part === 'intro' ? 0.3 + 0.2 * through : bar >= 8 ? 0.35 : 0.18;
  const n = Math.floor(Math.floor(k / 16) / TRACK_BARS);
  return {
    beats,
    beat,
    kick,
    snare,
    energy: second && part === 'drop' ? 1 : energy,
    part,
    rise: part === 'build' ? through : 0,
    sinceDrop: part === 'drop' ? (bar * 16 + (k % 16)) * STEP + (at - k * STEP) : Infinity,
    track: n,
    hue: p.track.hue,
  };
}
