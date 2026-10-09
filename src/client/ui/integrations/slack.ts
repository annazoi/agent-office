// The Slack TV's panel: your channels down the side, the last 20 messages of the one you pick
// (refreshed every 30 s while it's open), and a box to post from.
import type { SlackChannel, SlackMessage } from '../../../shared/integrations/composio-api';
import { h, toast } from '../dom';
import { act, get } from './api';
import { busy, empty, errorRow, every, footerNote, gate, loading, openPanel, row, rows, textarea, type PanelDeps } from './common';

const REFRESH_MS = 30_000;

export function openSlack(deps: PanelDeps) {
  const panel = openPanel('slack', { width: 860, doing: '💬 on Slack' });
  let channels: SlackChannel[] = [];
  let picked: SlackChannel | null = null;
  let messages: SlackMessage[] = [];
  const side = h('div');
  const main = h('div');
  const chat = h('div.cx-chat');

  const load = async () => {
    const blocked = gate('slack', panel, load);
    if (blocked) return panel.body.replaceChildren(blocked);
    panel.body.replaceChildren(loading('your channels'));
    try {
      channels = await get<SlackChannel[]>('slack/channels');
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, load));
    }
    deps.showSlack?.(channels.filter((c) => c.member).map((c) => `#${c.name}`));
    picked ??= channels.find((c) => c.member) ?? channels[0] ?? null;
    panel.body.replaceChildren(h('div.cx-split', {}, side, main));
    paintSide();
    void refresh();
  };

  const paintSide = () =>
    side.replaceChildren(
      rows(
        channels.map((c) => row({ title: `${c.private ? '🔒' : '#'} ${c.name}`, meta: c.members ? `${c.members} members${c.member ? '' : ' · not in it'}` : c.member ? '' : 'not in it', on: c.id === picked?.id, onclick: () => ((picked = c), paintSide(), void refresh()) })),
        'No channels.',
      ),
    );

  const refresh = async () => {
    if (!picked) return main.replaceChildren(empty('Pick a channel.'));
    const ch = picked;
    if (!chat.childElementCount) main.replaceChildren(loading(`#${ch.name}`));
    try {
      messages = await get<SlackMessage[]>('slack/messages', { channel: ch.id });
    } catch (err) {
      return main.replaceChildren(errorRow(err, refresh));
    }
    if (picked !== ch) return;
    chat.replaceChildren(
      ...(messages.length
        ? messages.map((m) => h('div.cx-msg', {}, h('span.cx-who', {}, m.user ?? '?'), h('span.cx-text', {}, m.text), h('span.cx-ts', {}, when(m.ts), m.replies ? ` · ${m.replies} replies` : '')))
        : [empty('Nothing in here yet.')]),
    );
    main.replaceChildren(h('h3', { style: 'margin:0 0 8px' }, `${ch.private ? '🔒' : '#'} ${ch.name}`), chat, sendBox(ch));
    chat.scrollTop = chat.scrollHeight;
  };

  const sendBox = (ch: SlackChannel) => {
    const text = textarea({ placeholder: `Message #${ch.name}`, rows: '2' });
    const send = h('button.btn.primary', { type: 'button' }, 'Send');
    const go = () =>
      busy(send, async () => {
        const body = text.value.trim();
        if (!body) return;
        const { summary } = await act<{ ts: string }>('slack/send', { channel: ch.id, channelName: ch.name, text: body });
        text.value = '';
        toast(summary);
        await refresh();
      });
    send.addEventListener('click', go);
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go();
    });
    return h('div.cx-send', {}, text, send);
  };

  every(panel, REFRESH_MS, () => void refresh());
  footerNote(panel, 'Your own Slack, through Composio. The channel refreshes every 30 seconds while this is open; ⌘/Ctrl+Enter sends.');
  void load();
}

function when(ts: string): string {
  const ms = Number(ts) * 1000;
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
