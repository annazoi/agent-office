import type { GhMergeMethod } from '../../../shared/protocol';
import { userStorage } from '../../state/user-storage';

// What the windows remember for you, with your account (see state/user-storage.ts): how you last
// merged, the Files tab's layout, which tab you were on, and the comment you were writing.

export function pref<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(userStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, v: unknown) {
  try {
    userStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked
  }
}

export const MERGE_KEY = 'agent-office.merge';
export const FILES_KEY = 'agent-office.pr-files';
export const TAB_KEY = 'agent-office.pr-tab';
/** Followed by the issue or PR's URL: the comment you were writing there. */
export const DRAFT_KEY = 'agent-office.comment:';

interface MergePref {
  method?: GhMergeMethod;
  deleteBranch?: boolean;
}

export function mergePref(methods: GhMergeMethod[]): { method: GhMergeMethod; deleteBranch: boolean } {
  const p = pref<MergePref>(MERGE_KEY, {});
  return { method: p.method && methods.includes(p.method) ? p.method : methods[0], deleteBranch: p.deleteBranch ?? true };
}
