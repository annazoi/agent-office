// The office's database for the tests: the same StateDb the office runs on, over a Map instead of
// Postgres. Loaded before every test file (see the test script in package.json), so the stores the
// tests make read and write it as they would the real one. Keys start with each test's own temp
// folder, so tests don't see each other's documents.
import { StateDb, useStateDb, type Backend } from '../../src/server/db/state.ts';

/** A backend that keeps every document in memory; `rows` is there to look at, or to fill in first. */
export function memoryBackend(rows = new Map<string, string>()): Backend & { rows: Map<string, string> } {
  return {
    rows,
    loadAll: async () => new Map(rows),
    load: async (key) => rows.get(key),
    loadPrefix: async (prefix) => new Map([...rows].filter(([k]) => k.startsWith(prefix))),
    write: async (key, json) => void rows.set(key, json),
    remove: async (key) => void rows.delete(key),
    close: async () => {},
  };
}

/** A fresh in-memory database, made the office's. */
export async function freshDb(rows?: Map<string, string>): Promise<StateDb> {
  const db = await StateDb.open(memoryBackend(rows));
  useStateDb(db);
  return db;
}

await freshDb();
