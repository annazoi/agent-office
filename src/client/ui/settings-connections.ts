// ⚙️ Settings' Connections pane: your own Linear, Notion, Slack, Google Calendar and Gmail, each to
// connect or disconnect (only you see yours), and for admins the office's Composio API key and which
// toolkits the office shows (see server/integrations/composio.ts).
import { COMPOSIO_TOOLKITS, COMPOSIO_TOOLKIT_META, type ComposioToolkit } from '../../shared/protocol';
import type { Net } from '../shared/net';
import { store } from '../state';
import { h, timeAgo, toast } from './dom';
import { connect, disconnect } from './integrations/api';

type Frame = (title: string, body: Node[]) => HTMLElement;

/** The pane's settings, made by `frame`, and how to paint them afresh when anything changes. */
export function connectionsSettings(net: Net, frame: Frame): { sections: HTMLElement[]; paint: () => void } {
  // Yours: one row per toolkit the office shows.
  const list = h('ul.svc-list');
  const mineNote = h('p.setting-note');
  const mine = frame('Your connections', [list, mineNote]);

  // The office's: the key (admins only; never shown back), and the toolkits.
  const keyInput = h('input', { type: 'password', placeholder: 'ak_…', 'aria-label': 'Composio API key', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const keySave = h('button.btn.primary', { type: 'button' }, 'Save');
  const keyRemove = h('button.btn.danger', { type: 'button' }, 'Remove');
  const keyNote = h('p.setting-note');
  const keyBad = h('p.setting-note.bad');
  const toolkitRow = h('div.seg', { role: 'group', 'aria-label': 'Toolkits' });
  const toolkitNote = h('p.setting-note');
  const office = frame('Composio (the office)', [h('div.webhook', {}, keyInput, keySave, keyRemove), keyNote, keyBad, toolkitRow, toolkitNote]);

  keySave.addEventListener('click', () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) return keyInput.focus();
    net.send({ t: 'composio.key', apiKey });
    keyInput.value = '';
    toast('Checking the key with Composio…');
  });
  keyRemove.addEventListener('click', () => net.send({ t: 'composio.key', apiKey: '' }));

  const paint = () => {
    const { office: o, mine: m } = store.composio;
    const admin = store.me.admin;
    const account = store.me.account;

    list.replaceChildren(
      ...(o.toolkits.length ? o.toolkits : COMPOSIO_TOOLKITS).map((t) => {
        const meta = COMPOSIO_TOOLKIT_META[t];
        const state = m.toolkits[t];
        const shown = o.toolkits.includes(t);
        const can = o.configured && o.available && shown && !!account && !m.blocked;
        const btn = h('button.btn', { type: 'button', class: state === 'connected' ? 'danger' : 'primary', disabled: !can || undefined }, state === 'connected' ? 'Disconnect' : state === 'pending' ? 'Finish connecting' : 'Connect');
        btn.addEventListener('click', async () => {
          btn.setAttribute('disabled', '');
          try {
            if (state === 'connected') {
              await disconnect(t);
              toast(`Disconnected ${meta.label}`);
            } else {
              await connect(t);
              toast(`Finish connecting ${meta.label} in the tab that opened`);
            }
            net.send({ t: 'composio.get' });
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally {
            btn.removeAttribute('disabled');
          }
        });
        return h(
          'li',
          {},
          h('span.dot', { style: `background:${state === 'connected' ? 'var(--good)' : state === 'pending' ? 'var(--warn)' : '#adb5bd'}` }),
          h('div.svc-main', {}, h('div.svc-title', {}, `${meta.icon} ${meta.label}`), h('div.svc-meta', {}, !shown ? 'switched off in this office' : state === 'connected' ? (t === 'github' ? 'connected · the elevator lists and clones your repositories through it' : `connected · the ${meta.station}`) : state === 'pending' ? 'connecting…' : t === 'github' ? 'not connected · connect it to add projects from the elevator' : 'not connected')),
          btn,
        );
      }),
    );
    mineNote.textContent = !o.configured
      ? 'The office has no Composio API key yet; an admin sets one below.'
      : (m.blocked ?? 'Each connection is yours alone: the stations in the office and the workers you hire use it; nobody else sees it. Disconnecting removes it from Composio too.');

    office.classList.toggle('hidden', !admin);
    keyInput.placeholder = o.configured ? '•••••••••• (set)' : 'ak_…';
    keySave.textContent = o.configured ? 'Replace' : 'Save';
    keyRemove.classList.toggle('hidden', !o.configured);
    keyNote.textContent = o.configured
      ? `Set ${o.by ? `by ${o.by} ` : ''}${o.at ? timeAgo(o.at) : ''}. The key stays on the office machine (.agent-office/composio.json); nobody can read it back from here.`
      : 'A Composio project API key from app.composio.dev lets the office show the stations and give the workers these tools. Everyone then connects their own accounts.';
    keyBad.textContent = o.error ?? '';
    keyBad.classList.toggle('hidden', !o.error);
    toolkitRow.replaceChildren(
      ...COMPOSIO_TOOLKITS.map((t) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'checkbox',
            'aria-checked': String(o.toolkits.includes(t)),
            class: o.toolkits.includes(t) ? 'on' : '',
            disabled: !o.configured || undefined,
            onclick: () => {
              const next: ComposioToolkit[] = o.toolkits.includes(t) ? o.toolkits.filter((x) => x !== t) : [...o.toolkits, t];
              net.send({ t: 'composio.toolkits', toolkits: next });
            },
          },
          `${COMPOSIO_TOOLKIT_META[t].icon} ${COMPOSIO_TOOLKIT_META[t].label}`,
        ),
      ),
    );
    toolkitNote.textContent = 'Which stations the office shows, and which tools its workers get. Off is off for everyone; a toolkit switched back on keeps its connections.';
  };
  return { sections: [mine, office], paint };
}
