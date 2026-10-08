// Everything the office keeps between runs lives in its Postgres database: the office's own config,
// accounts and each account's settings, every floor's decor, queue, workers and the rest. Each is a
// document, one row of JSON under a key, read once when the office starts and written back as it
// changes. Reads are synchronous (from memory) so the stores keep their simple shape; writes go out
// in the background, in order, and are flushed before the office exits.
import path from 'node:path';

/** Where the documents really live: Postgres in the office, an in-memory map in the tests. */
export interface Backend {
  /** Every document there is, by key, as JSON text. */
  loadAll(): Promise<Map<string, string>>;
  /** One document, fresh from the database (another process may have changed it). */
  load(key: string): Promise<string | undefined>;
  /** Every document whose key starts with `prefix`, fresh from the database. */
  loadPrefix(prefix: string): Promise<Map<string, string>>;
  write(key: string, json: string): Promise<void>;
  remove(key: string): Promise<void>;
  close(): Promise<void>;
}

/** One saved thing, e.g. a floor's decor or the office's accounts. */
export interface Doc<T> {
  /** What's saved, or undefined when nothing is yet. Always a copy: change it freely. */
  read(): T | undefined;
  /** Replaces it whole, the way a file was written whole. */
  write(value: T): void;
  remove(): void;
  /** Re-reads it from the database, for a document another process (an `agent-office` command) edits. */
  refresh(): Promise<T | undefined>;
}

const RETRY_MS = 2000;

export class StateDb {
  /** Every document, as the JSON text last read or written. */
  private cache: Map<string, string>;
  /** Changes not yet in the database: the newest text for a key, or null to delete it. */
  private pending = new Map<string, string | null>();
  private draining?: Promise<void>;
  private retry?: NodeJS.Timeout;

  private constructor(
    private backend: Backend,
    loaded: Map<string, string>,
  ) {
    this.cache = loaded;
  }

  static async open(backend: Backend): Promise<StateDb> {
    return new StateDb(backend, await backend.loadAll());
  }

  get<T>(key: string): T | undefined {
    const text = this.cache.get(key);
    return text === undefined ? undefined : (JSON.parse(text) as T);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** The keys that start with `prefix`. */
  keys(prefix = ''): string[] {
    return [...this.cache.keys()].filter((k) => k.startsWith(prefix));
  }

  set(key: string, value: unknown) {
    const text = JSON.stringify(value ?? null);
    if (this.cache.get(key) === text && !this.pending.has(key)) return;
    this.cache.set(key, text);
    this.queue(key, text);
  }

  delete(key: string) {
    if (!this.cache.has(key) && !this.pending.has(key)) return;
    this.cache.delete(key);
    this.queue(key, null);
  }

  /** Re-reads a key from the database, unless a change of ours to it is still on its way. */
  async refresh<T>(key: string): Promise<T | undefined> {
    if (!this.pending.has(key)) {
      const text = await this.backend.load(key);
      if (!this.pending.has(key)) {
        if (text === undefined) this.cache.delete(key);
        else this.cache.set(key, text);
      }
    }
    return this.get<T>(key);
  }

  /**
   * Re-reads every key under `prefix` from the database, so documents another process added or
   * removed (`agent-office maps add`) show up; changes of ours still on their way are left alone.
   */
  async refreshPrefix(prefix: string): Promise<void> {
    const rows = await this.backend.loadPrefix(prefix);
    for (const key of this.keys(prefix)) if (!rows.has(key) && !this.pending.has(key)) this.cache.delete(key);
    for (const [key, text] of rows) if (!this.pending.has(key)) this.cache.set(key, text);
  }

  doc<T>(key: string): Doc<T> {
    return {
      read: () => this.get<T>(key),
      write: (value) => this.set(key, value),
      remove: () => this.delete(key),
      refresh: () => this.refresh<T>(key),
    };
  }

  /** Resolves once every change made so far is in the database (or has failed to get there). */
  async flush(): Promise<void> {
    while (this.pending.size || this.draining) {
      if (!this.draining) this.drain();
      await this.draining;
      if (this.pending.size && this.retry) return; // the database is unreachable: don't spin
    }
  }

  async close(): Promise<void> {
    await this.flush();
    clearTimeout(this.retry);
    await this.backend.close();
  }

  private queue(key: string, text: string | null) {
    this.pending.set(key, text);
    if (!this.draining && !this.retry) queueMicrotask(() => this.drain());
  }

  private drain() {
    if (this.draining || !this.pending.size) return;
    this.draining = (async () => {
      while (this.pending.size) {
        const [key, text] = this.pending.entries().next().value!;
        this.pending.delete(key);
        try {
          if (text === null) await this.backend.remove(key);
          else await this.backend.write(key, text);
        } catch (err) {
          // Put it back unless something newer took its place, and try again in a moment.
          if (!this.pending.has(key)) this.pending.set(key, text);
          console.error(`agent-office: couldn't save ${key} to the database: ${(err as Error).message}`);
          clearTimeout(this.retry);
          this.retry = setTimeout(() => {
            this.retry = undefined;
            this.drain();
          }, RETRY_MS);
          this.retry.unref();
          break;
        }
      }
    })().finally(() => {
      this.draining = undefined;
      if (this.pending.size && !this.retry) this.drain();
    });
  }
}

let current: StateDb | undefined;

/** Makes `db` the one the office's stores read and write (once, at start-up; the tests swap in their own). */
export function useStateDb(db: StateDb | undefined) {
  current = db;
}

/** The office's database. Throws before it's open: nothing is ever kept anywhere else. */
export function stateDb(): StateDb {
  if (!current) throw new Error('the office database is not open');
  return current;
}

/**
 * The document for `name` in the office or floor whose data folder is `dataDir`: what used to be the
 * file `<dataDir>/<name>.json`. Keyed by that folder, so each floor's checkout keeps its own.
 */
export function docKey(dataDir: string, name: string): string {
  return `${path.resolve(dataDir).replace(/\\/g, '/')}|${name}`;
}

export function stateDoc<T>(dataDir: string, name: string): Doc<T> {
  return stateDb().doc<T>(docKey(dataDir, name));
}
