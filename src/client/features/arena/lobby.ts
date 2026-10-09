import './lobby.css';
import { FPS, GAMES, teamDef, type Side, type TeamId } from '../../../shared/games/games';
import { onTeam, type MatchSettings, type MatchState, type Player } from '../../../shared/games/match';
import { kd } from '../../../shared/games/stats';
import type { Net } from '../../shared/net';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';
import { settingsForm } from './settings';
import { openBoard } from './board';

// The arena's lobby: who has joined, which side they're on, what the match is set up to be, and the
// controls. Everyone sees the same window; what you can do in it is what the office lets you do, and
// it checks again whatever this window offers.

/** One of the match controls (see the office's Arena.control). */
type Act = Extract<import('../../../shared/protocol').GamesClientMsg, { t: 'game.control' }>['act'];

/** Whether you may set this match up and run it: an administrator, or whoever opened the lobby. */
export const youRun = (match: MatchState): boolean => store.me.admin || match.players.some((p) => p.id === store.you && p.host);

/** You, in the match, if you're in it. */
export const yourSeat = (match: MatchState): Player | undefined => match.players.find((p) => p.id === store.you);

const PHASE_SAYS: Record<MatchState['phase'], string> = {
  idle: 'No match yet',
  lobby: 'Lobby open',
  countdown: 'Starting',
  live: 'Match in progress',
  between: 'Between rounds',
  paused: 'Paused',
  over: 'Match over',
};

/** One person in a side's list. */
function playerRow(p: Player, match: MatchState, net: Net, run: boolean): HTMLElement {
  const you = p.id === store.you;
  const canMove = run && match.phase === 'lobby';
  return h(
    'li',
    { class: `${you ? 'me' : ''} ${match.phase === 'live' && !p.alive ? 'down' : ''}`.trim() },
    h('span.lvl', {}, `L${p.level}`),
    h('span.grow', { style: `color:${p.color}` }, p.name, p.host ? ' 👑' : '', p.admin && !p.host ? ' ★' : ''),
    match.phase === 'lobby' ? h('span.kd', {}, p.ready ? '✅ ready' : '…') : h('span.kd', {}, `${p.kills}/${p.deaths}/${p.assists}`),
    canMove && p.team !== 'a' ? h('button.btn', { type: 'button', title: `Move to ${FPS.teams[0].name}`, onclick: () => net.send({ t: 'game.team', team: 'a', who: p.id }) }, '←') : null,
    canMove && p.team !== 'b' ? h('button.btn', { type: 'button', title: `Move to ${FPS.teams[1].name}`, onclick: () => net.send({ t: 'game.team', team: 'b', who: p.id }) }, '→') : null,
    run && !you ? h('button.btn', { type: 'button', title: 'Remove from the match', onclick: () => net.send({ t: 'game.kick', who: p.id }) }, '✕') : null,
  );
}

/** A side's list, with its name, its score and how many places are left. */
function sideBox(team: TeamId, match: MatchState, net: Net, run: boolean): HTMLElement {
  const def = teamDef(FPS, team);
  const list = onTeam(match.players, team);
  const mine = yourSeat(match);
  const full = list.length >= match.settings.perTeam;
  const canPick = (match.settings.pickTeams || run) && match.phase === 'lobby' && mine && mine.team !== team && !full;
  return h(
    'div.arena-side',
    {},
    h(
      'h4',
      { style: `background:${def.color}` },
      `${def.name}`,
      h('span.grow', {}, ''),
      h('span', {}, `${list.length}/${match.settings.perTeam}`),
      h('span', {}, ` · ${match.score[team]}`),
      canPick ? h('button.btn', { type: 'button', onclick: () => net.send({ t: 'game.team', team }) }, 'Join side') : null,
    ),
    h('ul', {}, ...list.map((p) => playerRow(p, match, net, run))),
  );
}

export interface LobbyDeps {
  net: Net;
  /** Walks you out of the arena and back into the office. */
  leaveArena(): void;
}

/**
 * Opens the lobby window. It redraws itself whenever the office says the match changed, so the same
 * window is the lobby before a match, the scoreboard during one, and the result after it.
 */
export function openLobby(deps: LobbyDeps): Modal {
  const { net } = deps;
  const title = h('h2', {}, `${FPS.emoji} ${FPS.name}`);
  const body = h('div.body');
  const footer = h('footer');
  const el = h('div.modal.arena-modal', { role: 'dialog', 'aria-label': 'Gaming room' }, h('header', {}, title), body, footer);
  let tab: 'lobby' | 'board' = 'lobby';

  function render() {
    const match = store.game;
    const run = youRun(match);
    const mine = yourSeat(match);
    title.textContent = `${FPS.emoji} ${FPS.name} — ${PHASE_SAYS[match.phase]}`;

    const tabs = h(
      'div.arena-tabs',
      {},
      h('button.btn', { type: 'button', class: tab === 'lobby' ? 'on' : '', onclick: () => ((tab = 'lobby'), render()) }, '🎮 Match'),
      h('button.btn', { type: 'button', class: tab === 'board' ? 'on' : '', onclick: () => ((tab = 'board'), render()) }, '🏆 Leaderboard'),
    );

    if (tab === 'board') {
      body.replaceChildren(tabs, openBoard(net));
      footer.replaceChildren(h('span.grow'), h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Close'));
      return;
    }

    const pieces: (HTMLElement | null)[] = [tabs];
    if (match.phase === 'idle') {
      pieces.push(
        h('p', { style: 'margin:0;font-weight:700' }, store.me.admin ? 'No match is set up here yet. Open a lobby and people can join it.' : 'No match is set up in this arena yet. An administrator opens one.'),
      );
      if (store.me.admin) pieces.push(h('div.arena-controls', {}, ...GAMES.map((g) => h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'game.open', game: g.id }) }, `${g.emoji} Open a ${g.name} lobby`))));
    } else {
      pieces.push(info(match));
      pieces.push(h('div.arena-sides', {}, sideBox('a', match, net, run), sideBox('b', match, net, run)));
      const bench = match.players.filter((p) => p.team === 'none');
      if (bench.length) pieces.push(h('div.arena-bench', {}, '🪑 Watching: ', ...bench.map((p) => h('span', { style: `color:${p.color}` }, `${p.name} `))));
      if (match.result) pieces.push(h('p', { style: 'margin:0;font-weight:800' }, `🏁 ${match.result.winner === 'none' ? 'Drawn' : `${teamDef(FPS, match.result.winner).name} win`} — ${match.result.reason}`));
      if (mine) pieces.push(yourLine(mine));
      if (run) pieces.push(admin(match, net));
    }
    body.replaceChildren(...pieces.filter((p): p is HTMLElement => !!p));
    footer.replaceChildren(...buttons(match, mine, deps, () => modal.close()));
  }

  const modal = openModal(el, { doing: 'in the arena', onClose: () => off() });
  const off = store.on('game', render);
  const offYou = store.on('gameYou', render);
  const closed = modal.close;
  modal.close = () => {
    off();
    offYou();
    closed.call(modal);
  };
  render();
  return modal;
}

/** What the match is set up to be, in a line. */
function info(match: MatchState): HTMLElement {
  const s = match.settings;
  const mode = FPS.modes.find((m) => m.id === s.mode);
  const map = FPS.maps.find((m) => m.id === s.map);
  return h(
    'div.arena-info',
    {},
    h('span', {}, 'Mode ', h('b', {}, mode?.name ?? s.mode)),
    h('span', {}, 'Arena ', h('b', {}, map?.name ?? s.map)),
    h('span', {}, 'Rounds ', h('b', {}, `${s.rounds}`)),
    h('span', {}, 'Round ', h('b', {}, `${s.roundSeconds}s`)),
    h('span', {}, 'Sides ', h('b', {}, `${s.perTeam} a side`)),
    h('span', {}, 'Start at ', h('b', {}, `${s.minPlayers}`)),
    h('span', {}, 'Friendly fire ', h('b', {}, s.friendlyFire ? 'on' : 'off')),
    h('span', {}, 'Teams ', h('b', {}, s.autoTeams ? 'picked by the office' : 'picked by players')),
    h('span', {}, 'Buy menu ', h('b', {}, s.buyMenu ? 'on' : 'off')),
  );
}

/** How you're doing in this match. */
function yourLine(p: Player): HTMLElement {
  return h('div.arena-info', {}, h('span', {}, 'You: ', h('b', {}, `level ${p.level} · ${p.kills} kills · ${p.deaths} deaths · ${p.assists} assists · K/D ${kd(p).toFixed(2)} · ${sideName(p.team)}`)));
}

/** The administrator's half: the settings and the controls. */
function admin(match: MatchState, net: Net): HTMLElement {
  const apply = (patch: Partial<MatchSettings>) => net.send({ t: 'game.config', settings: { ...match.settings, ...patch } });
  const act = (a: Act) => net.send({ t: 'game.control', act: a });
  const live = match.phase === 'live' || match.phase === 'countdown' || match.phase === 'between';
  return h(
    'div.arena-admin',
    {},
    h('h4', {}, '🛠️ Match settings'),
    settingsForm(match, apply),
    h(
      'div.arena-controls',
      {},
      match.phase === 'lobby' ? h('button.btn.primary', { type: 'button', onclick: () => act('start') }, '▶️ Start the match') : null,
      live ? h('button.btn', { type: 'button', onclick: () => act(match.phase === 'paused' ? 'resume' : 'pause') }, '⏸️ Pause') : null,
      match.phase === 'paused' ? h('button.btn', { type: 'button', onclick: () => act('resume') }, '▶️ Resume') : null,
      live || match.phase === 'paused' ? h('button.btn', { type: 'button', onclick: () => act('stop') }, '⏹️ End the match') : null,
      h('button.btn', { type: 'button', onclick: () => act('reset') }, '↺ Reset'),
      h('button.btn', { type: 'button', onclick: () => act('shuffle') }, '🔀 Shuffle sides'),
      h('button.btn', { type: 'button', onclick: () => act('balance') }, '⚖️ Even the sides'),
      h('button.btn', { type: 'button', onclick: () => act('lock') }, '🔒 Close the lobby'),
      h('button.btn', { type: 'button', onclick: () => act('unlock') }, '🔓 Open it'),
      h('button.btn', { type: 'button', onclick: () => act('close') }, '🧹 Shut the gaming room'),
    ),
  );
}

/** The window's own buttons: joining, readying up, and leaving. */
function buttons(match: MatchState, mine: Player | undefined, deps: LobbyDeps, close: () => void): HTMLElement[] {
  const { net } = deps;
  const out: HTMLElement[] = [h('span.grow')];
  if (match.phase !== 'idle' && !mine) out.push(h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'game.join' }) }, '🎮 Join the game'));
  if (mine && match.phase === 'lobby') out.push(h('button.btn', { type: 'button', onclick: () => net.send({ t: 'game.ready', ready: !mine.ready }) }, mine.ready ? '✅ Ready' : '☐ Ready up'));
  if (mine) out.push(h('button.btn', { type: 'button', onclick: () => net.send({ t: 'game.leave' }) }, '🚪 Leave the game'));
  out.push(h('button.btn', { type: 'button', onclick: () => (close(), deps.leaveArena()) }, '🏢 Back to the office'));
  out.push(h('button.btn', { type: 'button', onclick: close }, 'Close'));
  return out;
}

/** The side someone is on, in words. */
export const sideName = (s: Side): string => (s === 'none' ? 'watching' : teamDef(FPS, s).name);
