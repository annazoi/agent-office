import { FPS } from '../../../shared/games/games';
import { GEAR } from '../../../shared/games/fps/gear';
import { WEAPONS } from '../../../shared/games/fps/weapons';
import type { MatchSettings, MatchState } from '../../../shared/games/match';
import { h } from '../../ui/dom';

// The administrator's form: everything a match can be set up to be. Nothing here decides anything —
// each change goes to the office as a whole settings object, which checks every field again
// (checkSettings in shared/games/match.ts) before any of it counts.

type Apply = (patch: Partial<MatchSettings>) => void;

/** A labelled number box. */
function number(label: string, value: number, min: number, max: number, onChange: (n: number) => void): HTMLElement {
  return h(
    'label',
    {},
    h('span', {}, label),
    h('input', {
      type: 'number',
      value: String(value),
      min: String(min),
      max: String(max),
      onchange: (e: Event) => {
        const n = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(n)) onChange(n);
      },
    }),
  );
}

/** A labelled tick box. */
function toggle(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
  return h('label', {}, h('span', {}, label), h('input', { type: 'checkbox', ...(on ? { checked: true } : {}), onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }));
}

/** A labelled drop-down. */
function choose(label: string, value: string, options: readonly { id: string; name: string }[], onChange: (v: string) => void): HTMLElement {
  const select = h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...options.map((o) => h('option', { value: o.id, ...(o.id === value ? { selected: true } : {}) }, o.name)));
  return h('label', {}, h('span', {}, label), select);
}

/** What a match may be played with: an empty list is everything the game has. */
function allowList(label: string, all: readonly { id: string; name: string; emoji: string }[], chosen: readonly string[], onChange: (ids: string[]) => void): HTMLElement {
  const on = (id: string) => chosen.length === 0 || chosen.includes(id);
  return h(
    'div',
    {},
    h('div', { style: 'font-size:13px;font-weight:800;margin-bottom:4px' }, label, chosen.length ? '' : ' (all)'),
    h(
      'div.arena-controls',
      {},
      ...all.map((w) =>
        h(
          'button.btn',
          {
            type: 'button',
            class: on(w.id) ? 'on' : '',
            style: on(w.id) ? '' : 'opacity:.45',
            onclick: () => {
              const now = chosen.length ? [...chosen] : all.map((x) => x.id);
              const i = now.indexOf(w.id);
              if (i >= 0) now.splice(i, 1);
              else now.push(w.id);
              // Everything ticked is the same as no list at all.
              onChange(now.length === all.length ? [] : now);
            },
          },
          `${w.emoji} ${w.name}`,
        ),
      ),
    ),
  );
}

/** The whole settings form for `match`; every change sends the lot back to the office. */
export function settingsForm(match: MatchState, apply: Apply): HTMLElement {
  const s = match.settings;
  const locked = match.phase !== 'lobby' && match.phase !== 'idle' && match.phase !== 'over';
  const grid = h(
    'div.arena-grid',
    {},
    choose('Game mode', s.mode, FPS.modes, (mode) => apply({ mode })),
    choose('Arena', s.map, FPS.maps, (map) => apply({ map })),
    number('Players a side', s.perTeam, 1, 5, (perTeam) => apply({ perTeam, maxPlayers: Math.max(s.maxPlayers, perTeam * 2) })),
    number('Most players', s.maxPlayers, 2, 10, (maxPlayers) => apply({ maxPlayers })),
    number('Start at', s.minPlayers, 2, 10, (minPlayers) => apply({ minPlayers })),
    number('Rounds', s.rounds, 1, 30, (rounds) => apply({ rounds })),
    number('Round seconds', s.roundSeconds, 20, 600, (roundSeconds) => apply({ roundSeconds })),
    number('Count-in seconds', s.countdown, 3, 60, (countdown) => apply({ countdown })),
    number('Between rounds', s.betweenRounds, 3, 60, (betweenRounds) => apply({ betweenRounds })),
    number('Respawn seconds', s.respawnSeconds, 1, 30, (respawnSeconds) => apply({ respawnSeconds })),
    toggle('Friendly fire', s.friendlyFire, (friendlyFire) => apply({ friendlyFire })),
    toggle('Office picks sides', s.autoTeams, (autoTeams) => apply({ autoTeams })),
    toggle('Players pick sides', s.pickTeams, (pickTeams) => apply({ pickTeams })),
    toggle('Start by itself', s.autoStart, (autoStart) => apply({ autoStart })),
    toggle('Buy menu', s.buyMenu, (buyMenu) => apply({ buyMenu })),
  );
  if (locked) for (const input of grid.querySelectorAll('input, select')) (input as HTMLInputElement).disabled = true;
  return h(
    'div',
    {},
    grid,
    allowList('Weapons', WEAPONS, s.weapons, (weapons) => apply({ weapons })),
    allowList('Equipment', GEAR, s.gear, (gear) => apply({ gear })),
    locked ? h('p', { style: 'margin:4px 0 0;font-size:12px;font-weight:700;color:var(--muted)' }, 'The settings are fixed while a match is running. Reset it to change them.') : null,
  );
}
