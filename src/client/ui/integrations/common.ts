// What the five station panels share: the window frame with its tabs, the "connect first" gate, a
// row list, and loading and error states, all from the office's own pieces (dom.ts, github/pieces.ts).
import './integrations.css';
import { COMPOSIO_TOOLKIT_META, type ComposioStationToolkit } from '../../../shared/protocol';
import type { Net } from '../../shared/net';
import { store } from '../../state';
import { h, openModal, toast, type Modal } from '../dom';
import { spinnerRow } from '../github/pieces';
import { connect } from './api';

/** What a panel can do beyond its own toolkit: hand work to the office's workers. */
export interface PanelDeps {
  net: Net;
  /** Start a worker on a prompt (shown for editing first); absent on the 2D view. */
  assign?(prompt: string, title: string): void;
  /** The 3D stations' screens, to show what the panel fetched; absent on the 2D view. */
  showSlack?(lines: string[]): void;
  showCalendar?(lines: string[]): void;
}

export interface Tab {
  id: string;
  label: string;
  count?: () => number | undefined;
}

export interface Panel {
  modal: Modal;
  body: HTMLElement;
  footer: HTMLElement;
  /** Which tab is up; `onTab` is called when it changes. */
  tab: string;
  setTabs(tabs: Tab[], onTab: (id: string) => void): void;
  paintTabs(): void;
  /** Runs `fn` on close (a timer to clear, a subscription to drop). */
  onClose(fn: () => void): void;
}

/** A station's window: a header with the toolkit's name and tabs, a body, a footer. */
export function openPanel(toolkit: ComposioStationToolkit, opts: { width?: number; doing?: string } = {}): Panel {
  const meta = COMPOSIO_TOOLKIT_META[toolkit];
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const nav = h('nav.gh-tabs.cx-tabs', { role: 'tablist' });
  const body = h('div.body.cx-body');
  const footer = h('footer', {}, h('span.grow'));
  const el = h('div.modal.cx-panel', { role: 'dialog', 'aria-label': meta.station, style: `width:min(${opts.width ?? 760}px,100%)` }, h('header', {}, h('h2', {}, `${meta.icon} ${meta.station}`), close), nav, body, footer);
  const closers: (() => void)[] = [];
  const modal = openModal(el, { doing: opts.doing ?? `${meta.icon} at the ${meta.station}`, onClose: () => closers.forEach((f) => f()) });
  close.addEventListener('click', () => modal.close());
  let tabs: Tab[] = [];
  let onTab = (_id: string) => {};
  const panel: Panel = {
    modal,
    body,
    footer,
    tab: '',
    setTabs(ts, fn) {
      tabs = ts;
      onTab = fn;
      if (!tabs.some((t) => t.id === panel.tab)) panel.tab = tabs[0]?.id ?? '';
      nav.replaceChildren(
        ...tabs.map((t) =>
          h(
            'button.gh-tab',
            {
              type: 'button',
              role: 'tab',
              onclick: () => {
                panel.tab = t.id;
                panel.paintTabs();
                onTab(t.id);
              },
            },
            t.label,
            h('span.gh-count.cx-count'),
          ),
        ),
      );
      nav.classList.toggle('hidden', !tabs.length);
      panel.paintTabs();
    },
    paintTabs() {
      [...nav.children].forEach((b, i) => {
        const t = tabs[i];
        b.classList.toggle('on', t.id === panel.tab);
        b.setAttribute('aria-selected', String(t.id === panel.tab));
        const n = t.count?.();
        const count = b.querySelector('.cx-count')!;
        count.textContent = n ? String(n) : '';
        count.classList.toggle('hidden', !n);
      });
    },
    onClose(fn) {
      closers.push(fn);
    },
  };
  nav.classList.add('hidden');
  return panel;
}

/** A line of the footer, replacing what was there. */
export function footerNote(panel: Panel, ...children: (Node | string)[]) {
  panel.footer.replaceChildren(h('span.grow', {}, ...children));
}

export const loading = (what: string) => spinnerRow(`Loading ${what}…`);

export function errorRow(err: unknown, retry?: () => void): HTMLElement {
  const msg = (err as Error)?.message ?? String(err);
  return h('div.gh-error', {}, `Couldn't reach ${msg.includes('Composio') ? 'it' : 'Composio'}: ${msg}`, retry ? h('button.btn', { type: 'button', onclick: retry }, 'Try again') : null);
}

export const empty = (text: string) => h('p.empty.cx-empty', {}, text);

/** `fn` once `ms` has passed, and again every `ms` while the panel is open (the Slack TV's 30 s refresh). */
export function every(panel: Panel, ms: number, fn: () => void) {
  const timer = setInterval(fn, ms);
  panel.onClose(() => clearInterval(timer));
}

/**
 * Whether you can use this toolkit here, and if not, what the panel shows instead: a Connect button
 * when it's just you who hasn't connected yet, or why nobody can (no key, switched off, no account).
 */
export function gate(toolkit: ComposioStationToolkit, panel: Panel, retry: () => void): HTMLElement | null {
  const { office, mine } = store.composio;
  const meta = COMPOSIO_TOOLKIT_META[toolkit];
  const note = (text: string, ...more: Node[]) => h('div.cx-gate', {}, h('p', {}, text), ...more);
  if (!office.configured) return note(`The office isn't connected to Composio yet. Whoever runs the server sets COMPOSIO_API_KEY in its environment (or its .env) and restarts it.`);
  if (!office.available) return note(office.error ?? 'Composio needs Node 22.22 or newer on the office machine.');
  if (!office.toolkits.includes(toolkit)) return note(`${meta.label} is switched off in this office (⚙️ Settings → Connections).`);
  if (mine.blocked) return note(mine.blocked);
  const state = mine.toolkits[toolkit];
  if (state === 'connected') return null;
  const btn = h(
    'button.btn.primary',
    {
      type: 'button',
      onclick: async () => {
        btn.setAttribute('disabled', '');
        try {
          await connect(toolkit);
          toast(`Finish connecting ${meta.label} in the tab that opened, then come back`);
          panel.onClose(store.on('composio', () => store.composio.mine.toolkits[toolkit] === 'connected' && retry()));
        } catch (err) {
          toast((err as Error).message, 'error');
          btn.removeAttribute('disabled');
        }
      },
    },
    `${meta.icon} Connect ${meta.label}`,
  );
  return note(state === 'pending' ? `You started connecting ${meta.label}; finish it in the tab that opened, or start again.` : `Connect your own ${meta.label} account to use this station. Only you see what's in it.`, btn);
}

/** The ready-made rows of the office (`.svc-list`), for a list the panels scroll. */
export function rows(items: HTMLElement[], none: string): HTMLElement {
  return items.length ? h('ul.svc-list', {}, ...items) : empty(none);
}

export function row(opts: { title: string; meta?: string; dot?: string; on?: boolean; onclick?: () => void; actions?: HTMLElement[] }): HTMLElement {
  return h(
    'li',
    { class: opts.on ? 'on' : '', tabindex: '0', onclick: opts.onclick, onkeydown: ((e: KeyboardEvent) => e.key === 'Enter' && opts.onclick?.()) as EventListener },
    opts.dot ? h('span.dot', { style: `background:${opts.dot}` }) : null,
    h('div.svc-main', {}, h('div.svc-title', {}, opts.title), opts.meta ? h('div.svc-meta', {}, opts.meta) : null),
    ...(opts.actions ?? []),
  );
}

/** A labelled field of a form. */
export function field(label: string, input: HTMLElement): HTMLElement {
  return h('label.cx-field', {}, h('span', {}, label), input);
}

export const input = (attrs: Record<string, string>) => h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', ...attrs }) as HTMLInputElement;
export const textarea = (attrs: Record<string, string>) => h('textarea', { rows: '5', ...attrs }) as HTMLTextAreaElement;

/** Runs an action from a button: disables it meanwhile, toasts what went wrong. */
export async function busy(btn: HTMLElement, fn: () => Promise<unknown>) {
  btn.setAttribute('disabled', '');
  try {
    await fn();
  } catch (err) {
    toast((err as Error).message, 'error');
  } finally {
    btn.removeAttribute('disabled');
  }
}

export function fmtWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
