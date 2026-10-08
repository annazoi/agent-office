// What each account keeps for itself, in the office's database: its profile (name, color, character),
// its settings, and whatever else the browser remembers for it, so it's the same on every computer it
// signs in from. One document per account for what the browser keeps (see client/state/user-storage),
// beside the documents the server keeps per account (its sign-ins).
import { docKey, stateDb, stateDoc, type Doc } from '../db/state.js';
import { ACCOUNT_ID } from './signins/constants.js';

/** The most an account may keep, all of it together, as JSON. */
export const USER_CONFIG_MAX_BYTES = 512 * 1024;
const KEY_RE = /^[\w.:-]{1,80}$/;

/** One of an account's documents, e.g. its sign-ins. */
export function userDoc<T>(dataDir: string, accountId: string, name: string): Doc<T> {
  return stateDoc<T>(dataDir, `users/${accountId}/${name}`);
}

/** Everything the browser keeps for an account, by key (as it would have in localStorage). */
export function userConfig(dataDir: string, accountId: string): Record<string, string> {
  const saved = userDoc<unknown>(dataDir, accountId, 'config').read();
  const out: Record<string, string> = {};
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [k, v] of Object.entries(saved)) if (KEY_RE.test(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Sets (or with `value` null, clears) some of an account's keys at once. Says what's wrong instead
 * when a key isn't one, or it would take the account past USER_CONFIG_MAX_BYTES.
 */
export function setUserConfig(dataDir: string, accountId: string, changes: Record<string, unknown>): string | undefined {
  if (!ACCOUNT_ID.test(accountId)) return 'No such account';
  const next = userConfig(dataDir, accountId);
  for (const [k, v] of Object.entries(changes)) {
    if (!KEY_RE.test(k)) return `Not a setting: ${k.slice(0, 80)}`;
    if (v === null) delete next[k];
    else if (typeof v === 'string') next[k] = v;
    else return `${k} has to be text`;
  }
  if (JSON.stringify(next).length > USER_CONFIG_MAX_BYTES) return 'That is more than an account can keep';
  userDoc(dataDir, accountId, 'config').write(next);
  return undefined;
}

/** An account is gone: everything it kept goes too. */
export function forgetUser(dataDir: string, accountId: string) {
  if (!ACCOUNT_ID.test(accountId)) return;
  for (const key of stateDb().keys(docKey(dataDir, `users/${accountId}/`))) stateDb().delete(key);
}
