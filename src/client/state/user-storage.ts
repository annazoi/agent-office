// What you keep for yourself — your profile, your settings, the floor you were on, your best lap —
// kept under your account in the office's database (see server/accounts/user-config.ts), so it's
// the same on every computer you sign in from. It's read once as the page loads (this module waits
// for it, and so does every module that imports it), and each change is saved a moment after.
// The same shape as localStorage, which is where it all used to live.

const SAVE_DELAY_MS = 400;

let items: Record<string, string> = {};
/** Only in a page of the office (the tests load these modules in Node, with nothing to fetch from). */
const inPage = typeof location !== 'undefined' && typeof addEventListener === 'function';
try {
  if (!inPage) throw new Error('not in a page');
  const res = await fetch('/api/me/config', { cache: 'no-store' });
  if (res.ok) items = ((await res.json()) as { config?: Record<string, string> }).config ?? {};
} catch {
  // Office unreachable (the page says so on its own), or not a page: start from nothing.
}

/** Changes not yet saved: the new text, or null for one taken out. */
const pending = new Map<string, string | null>();
let timer: ReturnType<typeof setTimeout> | undefined;

function save(keepalive = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.size || !inPage) return;
  const body = JSON.stringify(Object.fromEntries(pending));
  pending.clear();
  void fetch('/api/me/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive }).catch(() => {});
}

function changed(key: string, value: string | null) {
  pending.set(key, value);
  timer ??= setTimeout(save, SAVE_DELAY_MS);
}

// Leaving (closing the tab, reloading): what's waiting goes now, in a request that outlives the page.
if (inPage) addEventListener('pagehide', () => save(true));

export const userStorage = {
  getItem(key: string): string | null {
    return Object.hasOwn(items, key) ? items[key] : null;
  },
  setItem(key: string, value: string) {
    const text = String(value);
    if (items[key] === text) return;
    items[key] = text;
    changed(key, text);
  },
  removeItem(key: string) {
    if (!Object.hasOwn(items, key)) return;
    delete items[key];
    changed(key, null);
  },
};
