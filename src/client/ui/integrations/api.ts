// The Composio stations' HTTP calls (/api/composio/…, see src/shared/composio-api.ts), as the
// signed-in person, on the floor you're on (so what you do floats over your head there).
import { COMPOSIO_API, type ComposioConnectLink, type ComposioDone, type ComposioStatus } from '../../../shared/composio-api';
import type { ComposioToolkit } from '../../../shared/protocol';
import { store } from '../../state';
import { getJson } from '../github/api';

const url = (p: string, q: Record<string, string | undefined> = {}) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') u.set(k, v);
  const qs = u.toString();
  return `${COMPOSIO_API}/${p}${qs ? `?${qs}` : ''}`;
};

export const get = <T>(p: string, q?: Record<string, string | undefined>) => getJson<T>(url(p, q));

export async function post<T>(p: string, body: unknown): Promise<T> {
  const target = store.floor ? `${url(p)}?floor=${encodeURIComponent(store.floor)}` : url(p);
  const r = await fetch(target, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** An action: what came back, and the line everyone saw over your head. */
export const act = <T>(p: string, body: unknown) => post<ComposioDone<T>>(p, body);

export const status = () => get<ComposioStatus>('status');

/** Starts connecting a toolkit in a new tab; the office hears when it's done. */
export async function connect(toolkit: ComposioToolkit): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { url: link } = await post<ComposioConnectLink>('connect', { toolkit, origin: location.origin });
    if (tab) tab.location.href = link;
    else window.open(link, '_blank');
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export const disconnect = (toolkit: ComposioToolkit) => post<{ ok: true }>('disconnect', { toolkit });
