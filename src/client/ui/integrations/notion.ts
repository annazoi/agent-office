// The Notion bookshelf's panel: search, the pages edited last, a page to read, and a new page.
import type { NotionPage, NotionPageContent } from '../../../shared/composio-api';
import { h, toast } from '../dom';
import { markdown } from '../markdown';
import { act, get } from './api';
import { busy, errorRow, field, fmtWhen, footerNote, gate, input, loading, openPanel, row, rows, textarea, type PanelDeps } from './common';

export function openNotion(_deps: PanelDeps) {
  const panel = openPanel('notion', { width: 820, doing: '📓 reading Notion' });
  let recent: NotionPage[] = [];
  let found: NotionPage[] | null = null;
  let open: NotionPageContent | null = null;

  const load = async () => {
    const blocked = gate('notion', panel, load);
    if (blocked) return panel.body.replaceChildren(blocked);
    panel.body.replaceChildren(loading('your Notion pages'));
    try {
      recent = await get<NotionPage[]>('notion/search');
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, load));
    }
    panel.setTabs(
      [
        { id: 'recent', label: '🕘 Recent', count: () => recent.length },
        { id: 'search', label: '🔍 Search', count: () => found?.length },
        { id: 'new', label: '✨ New page' },
      ],
      paint,
    );
    paint();
  };

  const read = async (p: NotionPage) => {
    panel.body.replaceChildren(loading(p.title));
    try {
      open = await get<NotionPageContent>('notion/page', { id: p.id });
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, () => read(p)));
    }
    paint();
  };

  const pages = (items: NotionPage[], none: string) =>
    rows(
      items.map((p) => row({ title: `${p.icon ?? (p.kind === 'database' ? '🗄️' : '📄')} ${p.title}`, meta: [p.kind === 'database' ? 'database' : 'page', p.editedAt && `edited ${fmtWhen(p.editedAt)}`].filter(Boolean).join(' · '), onclick: () => void read(p) })),
      none,
    );

  const search = () => {
    const q = input({ placeholder: 'Search your pages…' });
    const go = h('button.btn.primary', { type: 'button' }, 'Search');
    const results = h('div');
    const run = () =>
      busy(go, async () => {
        results.replaceChildren(loading('results'));
        found = await get<NotionPage[]>('notion/search', { q: q.value.trim() });
        panel.paintTabs();
        results.replaceChildren(pages(found, 'No pages match.'));
      });
    go.addEventListener('click', run);
    q.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    if (found) results.replaceChildren(pages(found, 'No pages match.'));
    setTimeout(() => q.focus(), 0);
    return h('div', {}, h('div.cx-search', {}, q, go), results);
  };

  const form = () => {
    const parent = input({ placeholder: 'Parent page or database: its id, or its exact title', maxlength: '200' });
    const title = input({ placeholder: 'Page title', maxlength: '300' });
    const body = textarea({ placeholder: 'Contents (Markdown)', rows: '10' });
    const create = h('button.btn.primary', { type: 'button' }, '✨ Create page');
    create.addEventListener('click', () =>
      busy(create, async () => {
        if (!parent.value.trim() || !title.value.trim()) return toast('A new page needs a parent and a title', 'warn');
        const { result, summary } = await act<NotionPage>('notion/pages/create', { parentId: parent.value.trim(), title: title.value.trim(), markdown: body.value });
        toast(summary);
        recent.unshift(result);
        panel.tab = 'recent';
        paint();
      }),
    );
    return h('div.cx-form', {}, field('Where', parent), field('Title', title), field('Contents', body), h('div.cx-actions', {}, create));
  };

  function paint() {
    panel.paintTabs();
    if (open) {
      const p = open;
      return panel.body.replaceChildren(
        h(
          'div.cx-read',
          {},
          h('h3', {}, `${p.icon ?? '📄'} ${p.title}`),
          h('div.cx-meta', {}, [p.editedAt && `edited ${fmtWhen(p.editedAt)}`, p.truncated && 'long page, cut short'].filter(Boolean).join(' · ')),
          markdown(p.markdown || '_Nothing on this page yet._'),
          h('div.cx-actions', {}, p.url ? h('a.btn', { href: p.url, target: '_blank', rel: 'noopener' }, 'Open in Notion ↗') : null, h('button.btn', { type: 'button', onclick: () => ((open = null), paint()) }, 'Back')),
        ),
      );
    }
    if (panel.tab === 'search') return panel.body.replaceChildren(search());
    if (panel.tab === 'new') return panel.body.replaceChildren(form());
    panel.body.replaceChildren(pages(recent, "Composio can't see any pages yet. Share some with its integration in Notion."));
  }

  footerNote(panel, 'Your own Notion, through Composio: only the pages you shared with it.');
  void load();
}
