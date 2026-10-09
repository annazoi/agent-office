// The Linear board's panel: your issues in three columns (Mine / In progress / Done), a form for a new
// one, and "Give to a worker", which hands an issue to the office's workers the way the GitHub boards do.
import type { LinearIssue, LinearIssuesResult } from '../../../shared/integrations/composio-api';
import { h, toast } from '../dom';
import { act, get } from './api';
import { busy, errorRow, field, footerNote, gate, input, loading, openPanel, row, rows, textarea, type PanelDeps } from './common';

const PRIORITY = ['—', 'Urgent', 'High', 'Normal', 'Low'];

/** The task a worker gets for a Linear issue, in the shape the GitHub issue prompt takes. */
export function linearPrompt(it: LinearIssue): string {
  const lines = [`Work on Linear issue ${it.identifier || it.id}: ${it.title}`];
  if (it.url) lines.push(it.url);
  if (it.description) lines.push('', it.description);
  lines.push('', 'When you are done, open a pull request and mention the Linear issue in its description.');
  return lines.join('\n');
}

export function openLinear(deps: PanelDeps) {
  const panel = openPanel('linear', { width: 820 });
  let data: LinearIssuesResult | null = null;
  let open: LinearIssue | null = null;
  const inBucket = (b: string) => data?.issues.filter((i) => i.bucket === b) ?? [];

  const load = async () => {
    const blocked = gate('linear', panel, load);
    if (blocked) return panel.body.replaceChildren(blocked);
    panel.body.replaceChildren(loading('your Linear issues'));
    try {
      data = await get<LinearIssuesResult>('linear/issues');
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, load));
    }
    panel.setTabs(
      [
        { id: 'mine', label: '📥 Mine', count: () => inBucket('mine').length },
        { id: 'progress', label: '🚧 In progress', count: () => inBucket('progress').length },
        { id: 'done', label: '✅ Done', count: () => inBucket('done').length },
        { id: 'new', label: '✨ New issue' },
      ],
      paint,
    );
    paint();
  };

  const give = (it: LinearIssue) => {
    const prompt = linearPrompt(it);
    const title = `${it.identifier || 'Linear'} ${it.title}`;
    const hand = deps.assign ? h('button.btn.primary', { type: 'button', onclick: () => deps.assign!(prompt, `Hand ${it.identifier || 'the issue'} to a worker`) }, '🤖 Hand to a worker') : null;
    const queue = h(
      'button.btn',
      {
        type: 'button',
        onclick: () => {
          deps.net.send({ t: 'queue.add', prompt, title });
          toast(`📋 ${it.identifier || it.title} is on the task queue`);
        },
      },
      '📋 Queue it',
    );
    return [hand, queue].filter((x) => !!x) as HTMLElement[];
  };

  const detail = (it: LinearIssue) =>
    h(
      'div.cx-read',
      {},
      h('h3', {}, `${it.identifier} ${it.title}`),
      h('div.cx-meta', {}, [it.state, it.team, it.project, it.assignee && `👤 ${it.assignee}`, it.priority ? `priority ${PRIORITY[it.priority] ?? it.priority}` : null].filter(Boolean).join(' · ')),
      h('div.cx-text', {}, it.description || 'No description.'),
      h('div.cx-actions', {}, ...give(it), it.url ? h('a.btn', { href: it.url, target: '_blank', rel: 'noopener' }, 'Open in Linear ↗') : null, h('button.btn', { type: 'button', onclick: () => ((open = null), paint()) }, 'Back')),
    );

  const list = (items: LinearIssue[]) =>
    rows(
      items.map((it) =>
        row({
          title: `${it.identifier} ${it.title}`,
          meta: [it.state, it.assignee && `👤 ${it.assignee}`, it.team].filter(Boolean).join(' · '),
          dot: it.bucket === 'done' ? 'var(--good)' : it.bucket === 'progress' ? 'var(--warn)' : 'var(--info)',
          onclick: () => ((open = it), paint()),
          actions: [h('button.btn', { type: 'button', onclick: (e: Event) => (e.stopPropagation(), deps.net.send({ t: 'queue.add', prompt: linearPrompt(it), title: `${it.identifier} ${it.title}` }), toast(`📋 ${it.identifier} is on the task queue`)) }, '🤖 Give to a worker')],
        }),
      ),
      'Nothing here.',
    );

  const form = () => {
    const title = input({ placeholder: 'What needs doing?', maxlength: '300' });
    const team = h('select') as HTMLSelectElement;
    for (const t of data?.teams ?? []) team.append(h('option', { value: t.id }, t.name));
    const prio = h('select') as HTMLSelectElement;
    PRIORITY.forEach((p, i) => prio.append(h('option', { value: String(i) }, p)));
    prio.value = '3';
    const desc = textarea({ placeholder: 'Details (Markdown)' });
    const create = h('button.btn.primary', { type: 'button' }, '✨ Create issue');
    create.addEventListener('click', () =>
      busy(create, async () => {
        if (!title.value.trim()) return toast('Give the issue a title', 'warn');
        if (!team.value) return toast('Linear needs a team for the issue', 'warn');
        const { result, summary } = await act<LinearIssue>('linear/issues/create', { title: title.value.trim(), teamId: team.value, description: desc.value.trim() || undefined, priority: Number(prio.value) });
        toast(summary);
        data?.issues.unshift({ ...result, team: team.selectedOptions[0]?.textContent ?? undefined, state: 'Todo' });
        panel.tab = 'mine';
        panel.paintTabs();
        paint();
      }),
    );
    return h('div.cx-form', {}, field('Title', title), h('div.cx-row', {}, field('Team', team), field('Priority', prio)), field('Description', desc), h('div.cx-actions', {}, create));
  };

  function paint() {
    panel.paintTabs();
    if (open) return panel.body.replaceChildren(detail(open));
    if (panel.tab === 'new') return panel.body.replaceChildren(data?.teams.length ? form() : errorRow(new Error('Your Linear has no teams to file an issue in')));
    panel.body.replaceChildren(list(inBucket(panel.tab)));
  }

  footerNote(panel, 'Your own Linear, through Composio. "Give to a worker" puts the issue on the 📋 task queue; "Hand to a worker" lets you pick the desk.');
  void load();
}
