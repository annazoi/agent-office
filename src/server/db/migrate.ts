// Seeds the database from an office's JSON files, from before everything was kept in Postgres: its
// config, accounts and everyone's sign-ins, floors, chat, settings, and each floor's workers, queue,
// decor and the rest. Once, the first time something looks for an office there and the database has
// nothing of it yet (see officeRanIn); a document the database already has is never written over,
// and the files themselves are left as they were.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { docKey, stateDb } from './state.js';

/** The documents that were a file of the same name, plus .json: each store's (see their stateDoc). */
const DOCS = [
  // The office's own
  'config', 'accounts', 'floors', 'cloning', 'projects-folder', 'local-floor', 'arcade', 'usage', 'map', 'theme', 'prompts',
  'webhook', 'machine', 'composio', 'leave-on-merge', 'sky-place', 'sky-clock', 'pty-host',
  // Each floor's
  'workers', 'queue', 'decor', 'dog', 'floorplan', 'jail', 'jukebox', 'meetings',
];
const CHAT_KEEP = 1000;

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // missing or broken: nothing to bring over
  }
};
const listDir = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Whether `dir` has an office of JSON files the database doesn't have yet. */
export function hasLegacyOffice(dir: string): boolean {
  const dataDir = path.join(dir, '.agent-office');
  return existsSync(path.join(dataDir, 'config.json')) && !stateDb().has(docKey(dataDir, 'config'));
}

/**
 * Brings the office in `dir` (and every floor it lists) over from its JSON files, unless the database
 * already has it. Returns how many documents it wrote, or 0 when there was nothing to bring.
 */
export function migrateLegacyOffice(dir: string): number {
  if (!hasLegacyOffice(dir)) return 0;
  const dataDir = path.join(dir, '.agent-office');
  let n = migrateDataDir(dataDir);
  const floors = readJson(path.join(dataDir, 'floors.json'));
  for (const f of Array.isArray(floors) ? floors : []) {
    const floorDir = f && typeof f.dir === 'string' && path.isAbsolute(f.dir) ? path.join(f.dir, '.agent-office') : '';
    if (floorDir && path.resolve(floorDir) !== path.resolve(dataDir)) n += migrateDataDir(floorDir);
  }
  console.log(`agent-office: brought ${n} things over from the JSON files in ${dataDir} into the database (the files are left as they were)`);
  return n;
}

/** Everything one .agent-office folder kept in files, as documents under it. */
function migrateDataDir(dataDir: string): number {
  const db = stateDb();
  let n = 0;
  const put = (name: string, value: unknown) => {
    const key = docKey(dataDir, name);
    if (value === undefined || db.has(key)) return;
    db.set(key, value);
    n++;
  };
  for (const name of DOCS) put(name, readJson(path.join(dataDir, `${name}.json`)));
  // The chat was a line of JSON per message; the last few might be torn.
  try {
    const lines = readFileSync(path.join(dataDir, 'chat.jsonl'), 'utf8').split('\n').filter(Boolean);
    const chat = lines.flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return [];
      }
    });
    if (chat.length) put('chat', chat.slice(-CHAT_KEEP));
  } catch {
    // no chat
  }
  try {
    const port = Number(readFileSync(path.join(dataDir, 'hook-port'), 'utf8').trim());
    if (port > 0) put('hook-port', port);
  } catch {
    // never started
  }
  const cert = path.join(dataDir, 'tls-cert.pem');
  const key = path.join(dataDir, 'tls-key.pem');
  if (existsSync(cert) && existsSync(key)) put('tls', { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') });
  // Each account's choice of sign-ins, beside the logins themselves.
  for (const id of listDir(path.join(dataDir, 'homes'))) put(`users/${id}/signins`, readJson(path.join(dataDir, 'homes', id, 'signins.json')));
  for (const id of listDir(path.join(dataDir, 'scrollback'))) {
    if (!id.endsWith('.ansi')) continue;
    try {
      put(`scrollback/${id.slice(0, -'.ansi'.length)}`, readFileSync(path.join(dataDir, 'scrollback', id), 'utf8'));
    } catch {
      // unreadable: the worker starts without its old lines
    }
  }
  put('whiteboard', readJson(path.join(dataDir, 'whiteboard', 'elements.json')));
  for (const f of listDir(path.join(dataDir, 'whiteboard', 'files'))) {
    if (f.endsWith('.json')) put(`whiteboard/files/${f.slice(0, -'.json'.length)}`, readJson(path.join(dataDir, 'whiteboard', 'files', f)));
  }
  for (const f of listDir(path.join(dataDir, 'maps'))) {
    if (/^[\w-]{1,40}\.json$/.test(f)) put(`maps/${f.slice(0, -'.json'.length)}`, readJson(path.join(dataDir, 'maps', f)));
  }
  return n;
}
