import type { MapState } from '../../shared/protocol.js';
import { OFFICE_MAP, checkCustomMaps, isMapChoice, planOf, type CustomMap, type MapPlan } from '../../shared/building/maps/index.js';
import { docKey, stateDb, stateDoc, type Doc } from '../db/state.js';

/** The most custom maps read, and the biggest one that's read, as JSON. */
export const MAX_MAPS = 24;
export const MAX_MAP_BYTES = 256 * 1024;
/** How often the office looks for maps added or removed by `agent-office maps` (a separate process). */
const POLL_MS = 5000;

interface Saved {
  pick: string;
  by: string;
  at: number;
}

/** Where the maps of your own are kept: a document each, under this key. */
export const customMapsKey = (dataDir: string) => docKey(dataDir, 'maps/');

/** A map's name as `agent-office maps` keeps it: letters, digits, - and _. */
export const MAP_NAME_RE = /^[\w-]{1,40}$/;

/**
 * The building's map (the office, the castle, or one of your own), picked in ⚙️ Settings by anyone
 * and kept in the database. Everyone's on the same one. Maps of your own are in the database too, a
 * document each, added with `agent-office maps add` (see docs/maps.md) and read again whenever
 * someone looks at the list.
 */
export class Maps {
  private saved?: Saved;
  private doc: Doc<unknown>;
  private prefix: string;
  private custom: CustomMap[] = [];
  /** What the maps were when they were last read. */
  private stamp = '';

  constructor(dataDir: string, opts: { watch?: boolean } = {}) {
    this.doc = stateDoc(dataDir, 'map');
    this.prefix = customMapsKey(dataDir);
    this.restore();
    this.reload();
    if (opts.watch) {
      setInterval(() => {
        stateDb()
          .refreshPrefix(this.prefix)
          .catch((err: Error) => console.error(`agent-office: couldn't read the maps from the database: ${err.message}`));
      }, POLL_MS).unref();
    }
  }

  state(): MapState {
    const pick = this.pick();
    // Who picked it, while it's what they picked (not the office, while their map won't load).
    return { pick, custom: this.custom, ...(this.saved?.pick === pick ? { by: this.saved.by, at: this.saved.at } : {}) };
  }

  /** The map everyone's on: the one picked, while it's there to be had. */
  pick(): string {
    const p = this.saved?.pick;
    return p && isMapChoice(p, this.custom) ? p : OFFICE_MAP;
  }

  /** Where everything is on the building's map. */
  plan(): MapPlan {
    return planOf(this.pick(), this.custom);
  }

  /** False when there's no such map (or it won't load). Read the maps first (reload), so a map just added counts. */
  set(pick: string, by: string): boolean {
    if (!isMapChoice(pick, this.custom)) return false;
    this.saved = { pick, by, at: Date.now() };
    this.persist();
    return true;
  }

  /** Reads the custom maps again; true if any of them changed. */
  reload(): boolean {
    const db = stateDb();
    const names = db
      .keys(this.prefix)
      .map((k) => k.slice(this.prefix.length))
      .sort();
    const texts = names.map((name) => JSON.stringify(db.get<unknown>(this.prefix + name) ?? null));
    const stamp = JSON.stringify([names, texts]);
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    const read = names.slice(0, MAX_MAPS).map((file, i) => {
      if (texts[i].length > MAX_MAP_BYTES) return { file, json: undefined, error: `it's over ${MAX_MAP_BYTES / 1024} KB` };
      return { file, json: JSON.parse(texts[i]) as unknown };
    });
    const checked = checkCustomMaps(read.filter((f) => !f.error));
    this.custom = read.map((f) => (f.error ? { file: f.file, error: f.error } : checked.find((c) => c.file === f.file)!));
    for (const file of names.slice(MAX_MAPS)) this.custom.push({ file, error: `only the first ${MAX_MAPS} maps are read` });
    return true;
  }

  private restore() {
    try {
      const s = this.doc.read() as Partial<Saved>;
      if (typeof s.pick === 'string') this.saved = { pick: s.pick, by: typeof s.by === 'string' ? s.by : 'someone', at: typeof s.at === 'number' ? s.at : 0 };
    } catch {
      // never set: the office
    }
  }

  private persist() {
    this.doc.write(this.saved ?? {});
  }
}
