import { JUKEBOX_TUNES, STREAM, checkStreamUrl, trackTitle, tuneById, type JukeboxState } from '../../shared/toys/jukebox.js';
import { stateDoc, type Doc } from '../db/state.js';

interface Saved {
  on: boolean;
  track: string;
  url?: string;
  by?: string;
  /** When the track started, on this machine's clock. */
  startedAt: number;
}

/**
 * The lounge jukebox on one floor, in the database. It only says what's on and
 * since when; every browser plays it for itself, from the same point.
 */
export class Jukebox {
  private s: Saved = { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now() };
  private doc: Doc<unknown>;

  constructor(dataDir: string) {
    this.doc = stateDoc(dataDir, 'jukebox');
    this.load();
  }

  state(): JukeboxState {
    const { on, track, url, by, startedAt } = this.s;
    return { on, track, ...(url && track === STREAM ? { url } : {}), ...(by ? { by } : {}), startedAt, elapsed: Math.max(0, Date.now() - startedAt) };
  }

  /** What's on, for toasts: “Rainy Window”, or where a stream comes from. */
  title(): string {
    return trackTitle(this.s);
  }

  /** Puts on a tune, a stream, or (with neither) whatever it had. Says whether anything changed, or why it can't. */
  play(input: { track?: unknown; url?: unknown }, by: string): { changed: boolean } | { error: string } {
    if (input.url !== undefined && input.url !== '') {
      const u = checkStreamUrl(input.url);
      if ('error' in u) return u;
      this.set({ on: true, track: STREAM, url: u.url, by });
    } else if (input.track !== undefined) {
      if (typeof input.track !== 'string' || !tuneById(input.track)) return { error: "The jukebox doesn't have that one" };
      this.set({ on: true, track: input.track, by });
    } else {
      if (this.s.on) return { changed: false };
      this.set({ ...this.s, on: true, by });
    }
    return { changed: true };
  }

  /** On to the next tune; from a stream, back to the first one. */
  skip(by: string) {
    const i = JUKEBOX_TUNES.findIndex((t) => t.id === this.s.track);
    this.set({ on: true, track: JUKEBOX_TUNES[(i + 1) % JUKEBOX_TUNES.length].id, by });
  }

  stop(by: string): boolean {
    if (!this.s.on) return false;
    this.s = { ...this.s, on: false, by };
    this.save();
    return true;
  }

  private set(s: Omit<Saved, 'startedAt'>) {
    this.s = { ...s, startedAt: Date.now() };
    this.save();
  }

  private load() {
    const s = this.doc.read() as Partial<Saved> | undefined;
    if (s === undefined) return;
    try {
      const url = s.track === STREAM ? checkStreamUrl(s.url) : undefined;
      if (s.track === STREAM ? !url || 'error' in url : typeof s.track !== 'string' || !tuneById(s.track)) return;
      this.s = {
        on: s.on === true,
        track: s.track!,
        ...(url && 'url' in url ? { url: url.url } : {}),
        ...(typeof s.by === 'string' ? { by: s.by.slice(0, 24) } : {}),
        startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
      };
    } catch {
      // a broken document just means a quiet lounge
    }
  }

  private save() {
    this.doc.write(this.s);
  }
}
