// The mailroom's panel: what's unread in your inbox, a message to read, and a reply (or a fresh email).
import type { MailMessage, MailSummary } from '../../../shared/integrations/composio-api';
import { h, toast } from '../dom';
import { act, get } from './api';
import { busy, errorRow, field, fmtWhen, footerNote, gate, input, loading, openPanel, row, rows, textarea, type PanelDeps } from './common';

/** Just the address out of "Name <who@where>", for the reply's To. */
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

export function openGmail(_deps: PanelDeps) {
  const panel = openPanel('gmail', { width: 820, doing: '✉️ in the mailroom' });
  let unread: MailSummary[] = [];
  let open: MailMessage | null = null;

  const load = async () => {
    const blocked = gate('gmail', panel, load);
    if (blocked) return panel.body.replaceChildren(blocked);
    panel.body.replaceChildren(loading('your inbox'));
    try {
      unread = await get<MailSummary[]>('gmail/unread');
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, load));
    }
    panel.setTabs(
      [
        { id: 'unread', label: '📥 Unread', count: () => unread.length },
        { id: 'new', label: '✍️ New email' },
      ],
      paint,
    );
    paint();
  };

  const read = async (m: MailSummary) => {
    panel.body.replaceChildren(loading(m.subject));
    try {
      open = await get<MailMessage>('gmail/message', { id: m.id });
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, () => read(m)));
    }
    paint();
  };

  const replyBox = (m: MailMessage) => {
    const body = textarea({ placeholder: `Reply to ${addressOf(m.from)}…`, rows: '4' });
    const send = h('button.btn.primary', { type: 'button' }, '↩️ Reply');
    const draft = h('button.btn', { type: 'button' }, 'Save as draft');
    send.addEventListener('click', () =>
      busy(send, async () => {
        if (!body.value.trim()) return toast('Write something first', 'warn');
        const { summary } = await act('gmail/reply', { threadId: m.threadId, to: addressOf(m.from), body: body.value });
        toast(summary);
        body.value = '';
      }),
    );
    draft.addEventListener('click', () =>
      busy(draft, async () => {
        if (!body.value.trim()) return toast('Write something first', 'warn');
        const { summary } = await act('gmail/draft', { threadId: m.threadId, to: addressOf(m.from), body: body.value });
        toast(summary);
      }),
    );
    return h('div.cx-form', {}, body, h('div.cx-actions', {}, draft, send));
  };

  const compose = () => {
    const to = input({ placeholder: 'who@where.com', type: 'email' });
    const subject = input({ placeholder: 'Subject', maxlength: '500' });
    const body = textarea({ placeholder: 'Your message', rows: '8' });
    const send = h('button.btn.primary', { type: 'button' }, '✉️ Send');
    const draft = h('button.btn', { type: 'button' }, 'Save as draft');
    const go = (path: 'gmail/send' | 'gmail/draft', btn: HTMLElement) =>
      busy(btn, async () => {
        if (!to.value.trim() || !body.value.trim()) return toast('An email needs someone to go to and something to say', 'warn');
        const { summary } = await act(path, { to: to.value.trim(), subject: subject.value.trim(), body: body.value });
        toast(summary);
        if (path === 'gmail/send') {
          to.value = subject.value = body.value = '';
          panel.tab = 'unread';
          paint();
        }
      });
    send.addEventListener('click', () => go('gmail/send', send));
    draft.addEventListener('click', () => go('gmail/draft', draft));
    return h('div.cx-form', {}, field('To', to), field('Subject', subject), field('Message', body), h('div.cx-actions', {}, draft, send));
  };

  function paint() {
    panel.paintTabs();
    if (open) {
      const m = open;
      return panel.body.replaceChildren(
        h(
          'div.cx-read',
          {},
          h('h3', {}, m.subject),
          h('div.cx-meta', {}, `From ${m.from}${m.to ? ` · to ${m.to}` : ''}${m.at ? ` · ${fmtWhen(m.at)}` : ''}`),
          h('div.cx-text', {}, m.text || m.preview || ''),
          h('div.cx-actions', {}, h('button.btn', { type: 'button', onclick: () => ((open = null), paint()) }, 'Back to inbox')),
        ),
        replyBox(m),
      );
    }
    if (panel.tab === 'new') return panel.body.replaceChildren(compose());
    panel.body.replaceChildren(
      rows(
        unread.map((m) => row({ title: m.subject, meta: `${m.from}${m.at ? ` · ${fmtWhen(m.at)}` : ''}${m.preview ? ` — ${m.preview}` : ''}`, dot: 'var(--info)', onclick: () => void read(m) })),
        'Nothing unread. 🎉',
      ),
    );
  }

  footerNote(panel, 'Your own Gmail, through Composio. Nothing is sent without you pressing the button.');
  void load();
}
