import type { JailState, Prisoner, WorkerInfo } from '../../shared/protocol.js';
import { stateDoc, type Doc } from '../db/state.js';

/** How many prisoners are kept by name: the ones from before them are only a count, bones on the heap. */
export const MAX_PRISONERS = 200;

/**
 * A floor's dungeon (see MapPlan.sendHome): every worker sent home on a map that keeps them, for
 * good, first to last: locked up in the castle's cells, or adrift outside the station's airlock
 * (it's one list, so they're in whichever the building's map has). The map works out how far each has
 * wasted away from when it went; this only remembers who and when. Saved in the database.
 */
export class Jail {
  private prisoners: Prisoner[] = [];
  private bones = 0;
  private doc: Doc<unknown>;

  constructor(
    dataDir: string,
    private now = () => Date.now(),
  ) {
    this.doc = stateDoc(dataDir, 'jail');
    this.load();
  }

  state(): JailState {
    return { prisoners: [...this.prisoners], bones: this.bones };
  }

  /** Locks `w` up, as of now. */
  add(w: Pick<WorkerInfo, 'id' | 'name' | 'color' | 'workedMs'>): JailState {
    this.prisoners = this.prisoners.filter((p) => p.id !== w.id);
    this.prisoners.push({ id: w.id, name: w.name, color: w.color, at: this.now(), ...(w.workedMs ? { workedMs: w.workedMs } : {}) });
    const over = this.prisoners.length - MAX_PRISONERS;
    if (over > 0) {
      this.prisoners.splice(0, over);
      this.bones += over;
    }
    this.save();
    return this.state();
  }

  private load() {
    const s = this.doc.read() as Partial<JailState> | undefined;
    if (s === undefined) return;
    try {
      const ok = (p: unknown): p is Prisoner => {
        const q = p as Prisoner;
        return !!q && typeof q.id === 'string' && typeof q.name === 'string' && typeof q.color === 'string' && typeof q.at === 'number' && Number.isFinite(q.at);
      };
      this.prisoners = (Array.isArray(s.prisoners) ? s.prisoners.filter(ok) : []).slice(-MAX_PRISONERS).map((p) => ({
        id: p.id.slice(0, 64),
        name: p.name.slice(0, 64),
        color: p.color.slice(0, 32),
        at: p.at,
        ...(typeof p.workedMs === 'number' && Number.isFinite(p.workedMs) && p.workedMs > 0 ? { workedMs: p.workedMs } : {}),
      }));
      this.bones = typeof s.bones === 'number' && Number.isInteger(s.bones) && s.bones > 0 ? s.bones : 0;
    } catch {
      // a broken document just means an empty dungeon
    }
  }

  private save() {
    this.doc.write({ prisoners: this.prisoners, bones: this.bones });
  }
}
