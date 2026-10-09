import { FPS } from '../../../shared/games/games';
import { BOARDS, BOARD_NAMES, SPANS, SPAN_NAMES, type BoardKey, type BoardRow, type Span } from '../../../shared/games/stats';
import type { Net } from '../../shared/net';
import { h } from '../../ui/dom';

// The leaderboard: the office works every row of it out itself (see server/games/stats.ts), so there
// is nothing here a page could tilt in its own favour. It asks for a board and draws what comes back.

/** The rows the office last sent, by board and span, so switching tabs doesn't blank the table. */
const cache = new Map<string, BoardRow[]>();
/** Whoever is listening for a board right now (the open window). */
let listening: ((key: BoardKey, span: Span, rows: BoardRow[]) => void) | undefined;

/** Takes the office's answer to a `game.board` ask. */
export function boardArrived(key: BoardKey, span: Span, rows: BoardRow[]) {
  cache.set(`${key}:${span}`, rows);
  listening?.(key, span, rows);
}

const cell = (v: string | number) => h('td', {}, String(v));

function table(rows: BoardRow[]): HTMLElement {
  if (!rows.length) return h('p', { style: 'font-weight:700' }, 'Nobody has finished a match yet. Play one and you will be the first.');
  return h(
    'table.arena-board',
    {},
    h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', {}, 'Lvl'), h('th', {}, 'XP'), h('th', {}, 'W'), h('th', {}, 'Win %'), h('th', {}, 'K'), h('th', {}, 'D'), h('th', {}, 'K/D'), h('th', {}, 'HS'))),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          { class: r.you ? 'you' : '' },
          cell(r.rank),
          h('td', {}, h('span.dot', { style: `background:${r.color}` }), r.name || 'someone'),
          cell(r.level),
          cell(r.xp.toLocaleString()),
          cell(r.wins),
          cell(r.matches ? `${Math.round(r.winRate * 100)}%` : '—'),
          cell(r.kills),
          cell(r.deaths),
          cell(r.kd ? r.kd.toFixed(2) : '—'),
          cell(r.headshots),
        ),
      ),
    ),
  );
}

/**
 * The leaderboard pane, for the lobby window's 🏆 tab. It asks the office for the board it's showing
 * and redraws when the answer comes.
 */
export function openBoard(net: Net): HTMLElement {
  let key: BoardKey = 'xp';
  let span: Span = 'all';
  const body = h('div');
  const pane = h('div');

  const ask = () => net.send({ t: 'game.board', game: FPS.id, key, span });

  function render() {
    const tabs = h(
      'div.arena-tabs',
      {},
      ...BOARDS.map((k) => h('button.btn', { type: 'button', class: k === key ? 'on' : '', onclick: () => ((key = k), ask(), render()) }, BOARD_NAMES[k])),
    );
    const spans = h(
      'div.arena-tabs',
      {},
      ...SPANS.map((sp) => h('button.btn', { type: 'button', class: sp === span ? 'on' : '', onclick: () => ((span = sp), ask(), render()) }, SPAN_NAMES[sp])),
    );
    body.replaceChildren(table(cache.get(`${key}:${span}`) ?? []));
    pane.replaceChildren(tabs, spans, body);
  }

  listening = (k, sp) => {
    if (k === key && sp === span) render();
  };
  render();
  ask();
  return pane;
}
