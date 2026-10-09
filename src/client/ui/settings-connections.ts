// ⚙️ Settings' Connections pane: your own Linear, Notion, Slack, Google Calendar and Gmail, each to
// connect or disconnect (only you see yours), and for admins which toolkits the office shows (the
// Composio API key is the server's, from its environment) (see server/integrations/composio.ts).
import { COMPOSIO_TOOLKITS, COMPOSIO_TOOLKIT_META, type ComposioToolkit } from '../../shared/protocol';
import type { Net } from '../shared/net';
import { store } from '../state';
import { h, toast } from './dom';
import { connect, disconnect } from './integrations/api';

type Frame = (title: string, body: Node[]) => HTMLElement;

/** The pane's settings, made by `frame`, and how to paint them afresh when anything changes. */
export function connectionsSettings(net: Net, frame: Frame): { sections: HTMLElement[]; paint: () => void } {
  // Yours: one row per toolkit the office shows.
  const list = h('ul.svc-list');
  const mineNote = h('p.setting-note');
  const mine = frame('Your connections', [list, mineNote]);

  // The office's (admins): whether the server has its key, and the toolkits.
  const keyNote = h('p.setting-note');
  const keyBad = h('p.setting-note.bad');
  const toolkitRow = h('div.seg', { role: 'group', 'aria-label': 'Toolkits' });
  const toolkitNote = h('p.setting-note');
  const office = frame('Composio (the office)', [keyNote, keyBad, toolkitRow, toolkitNote]);

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
    keyNote.textContent = o.configured
      ? "The server has its Composio API key (COMPOSIO_API_KEY in its environment). It's never stored, and nobody can read it from here."
      : "No Composio API key yet. Set COMPOSIO_API_KEY (a project key from app.composio.dev) in the server's environment or its .env file, and restart the office: then everyone can connect their own GitHub, Linear, Slack and the rest.";
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
