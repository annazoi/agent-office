import { WB_MAX_BYTES, WB_MAX_ELEMENTS, WB_MAX_ELEMENT_BYTES, WB_MAX_FILES_BYTES, byIndex, checkElement, checkFile, newer, type WbElement, type WbFile } from '../../shared/toys/whiteboard.js';
import { docKey, stateDb, stateDoc, type Doc } from '../db/state.js';

/** How long after the last stroke the drawing is saved. */
const SAVE_DELAY_MS = 2000;
/** Deleted elements are kept this long, so the deletion reaches anyone who still has them. */
const TOMBSTONE_MS = 7 * 24 * 3600_000;

/** What `apply` made of a batch of changes. */
export interface Applied {
  /** The changes that went in, to pass on to everyone else. */
  accepted: WbElement[];
  /** Why some didn't, when the board is full. */
  error?: string;
}

/**
 * A floor's whiteboard: the Excalidraw elements everyone drew, merged by version the way
 * Excalidraw's live collaboration merges them, and the pictures on it. Kept in the database: the
 * elements in one document, and a document per picture.
 */
export class Whiteboard {
  private elements = new Map<string, WbElement>();
  /** Each element's size as JSON, to keep the board under WB_MAX_BYTES. */
  private sizes = new Map<string, number>();
  private bytes = 0;
  /** Pictures saved, by id, with their size. */
  private files = new Map<string, number>();
  private fileBytes = 0;
  private doc: Doc<unknown>;
  /** The start of every picture's key. */
  private filesPrefix: string;
  private saveTimer?: NodeJS.Timeout;

  constructor(dataDir: string) {
    this.doc = stateDoc(dataDir, 'whiteboard');
    this.filesPrefix = docKey(dataDir, 'whiteboard/files/');
    this.load();
  }

  /** Every element, deleted ones too, bottom of the stack first. */
  scene(): WbElement[] {
    return [...this.elements.values()].sort(byIndex);
  }

  /** Whether anything is drawn on it. */
  get empty(): boolean {
    for (const e of this.elements.values()) if (!e.isDeleted) return false;
    return true;
  }

  /** Takes in someone's changes: each element that's newer than the board's copy replaces it. */
  apply(raw: unknown): Applied {
    const accepted: WbElement[] = [];
    let error: string | undefined;
    for (const item of Array.isArray(raw) ? raw : []) {
      const el = checkElement(item);
      if (!el) continue;
      const had = this.elements.get(el.id);
      if (!newer(el, had)) continue;
      const size = JSON.stringify(el).length;
      if (size > WB_MAX_ELEMENT_BYTES) {
        error = 'That drawing is too big for the whiteboard. Try it in smaller pieces.';
        continue;
      }
      if (!had && this.elements.size >= WB_MAX_ELEMENTS) this.forgetDeleted(1);
      if (this.bytes - (this.sizes.get(el.id) ?? 0) + size > WB_MAX_BYTES) this.forgetDeleted(Infinity);
      if ((!had && this.elements.size >= WB_MAX_ELEMENTS) || this.bytes - (this.sizes.get(el.id) ?? 0) + size > WB_MAX_BYTES) {
        error = 'The whiteboard is full. Clear some of it to draw more.';
        continue;
      }
      this.put(el, size);
      accepted.push(el);
    }
    if (accepted.length) this.saveSoon();
    return { accepted, error };
  }

  /** A picture on the board. */
  file(id: string): WbFile | undefined {
    if (!this.files.has(id)) return undefined;
    const f = checkFile(stateDb().get<unknown>(this.filesPrefix + id));
    return typeof f === 'string' ? undefined : f;
  }

  /** Keeps a picture someone put on the board. A picture with the same id is already there: it's the same picture. */
  addFile(raw: unknown): string | undefined {
    const f = checkFile(raw);
    if (typeof f === 'string') return f;
    if (this.files.has(f.id)) return undefined;
    const json = JSON.stringify(f);
    if (this.fileBytes + json.length > WB_MAX_FILES_BYTES) this.forgetUnusedFiles();
    if (this.fileBytes + json.length > WB_MAX_FILES_BYTES) return 'The whiteboard has too many pictures on it. Delete some first.';
    stateDb().set(this.filesPrefix + f.id, f);
    this.files.set(f.id, json.length);
    this.fileBytes += json.length;
    return undefined;
  }

  /** Saves the drawing now, if it has changed since. */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }

  private put(el: WbElement, size: number) {
    this.bytes += size - (this.sizes.get(el.id) ?? 0);
    this.elements.set(el.id, el);
    this.sizes.set(el.id, size);
  }

  private drop(id: string) {
    this.bytes -= this.sizes.get(id) ?? 0;
    this.elements.delete(id);
    this.sizes.delete(id);
  }

  /** Makes room by forgetting up to `n` deleted elements, the longest-deleted first. */
  private forgetDeleted(n: number) {
    const gone = [...this.elements.values()].filter((e) => e.isDeleted).sort((a, b) => (a.updated ?? 0) - (b.updated ?? 0));
    for (const e of gone.slice(0, n)) this.drop(e.id);
  }

  /** Pictures that no element shows any more, deleted elements included (an undo can bring those back). */
  private forgetUnusedFiles() {
    const used = new Set<string>();
    for (const e of this.elements.values()) if (e.fileId) used.add(e.fileId);
    for (const [id, size] of this.files) {
      if (used.has(id)) continue;
      stateDb().delete(this.filesPrefix + id);
      this.files.delete(id);
      this.fileBytes -= size;
    }
  }

  private saveSoon() {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, SAVE_DELAY_MS);
  }

  private save() {
    this.doc.write(this.scene());
  }

  private load() {
    const saved = this.doc.read();
    const now = Date.now();
    for (const item of Array.isArray(saved) ? saved : []) {
      const el = checkElement(item);
      if (!el || (el.isDeleted && now - (el.updated ?? 0) > TOMBSTONE_MS)) continue;
      this.put(el, JSON.stringify(el).length);
    }
    for (const key of stateDb().keys(this.filesPrefix)) {
      const size = JSON.stringify(stateDb().get<unknown>(key) ?? null).length;
      this.files.set(key.slice(this.filesPrefix.length), size);
      this.fileBytes += size;
    }
    this.forgetUnusedFiles();
  }
}
