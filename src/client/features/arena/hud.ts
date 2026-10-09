import './hud.css';
import { FPS, teamDef, type Side } from '../../../shared/games/games';
import { GEAR_BY_ID } from '../../../shared/games/fps/gear';
import { weaponOf } from '../../../shared/games/fps/weapons';
import type { FeedLine, MatchState } from '../../../shared/games/match';
import type { YouState } from '../../../shared/protocol';
import { $, h } from '../../ui/dom';

// What's on the screen while you're in a match: the round and its clock, the sides' scores, your
// health and your gun, the kill feed, the crosshair, and what a scope or a flashbang does to the view.

const SIDE_COLOR: Record<string, string> = { a: FPS.teams[0].color, b: FPS.teams[1].color };

/** mm:ss of what's left on a clock. */
function clock(until: number, now: number): string {
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

const PHASE_WORDS: Record<MatchState['phase'], string> = {
  idle: '',
  lobby: 'Lobby',
  countdown: 'Starting',
  live: 'Round',
  between: 'Next round',
  paused: 'Paused',
  over: 'Match over',
};

/** One line of the kill feed, in the two sides' colors. */
function feedLine(line: FeedLine): HTMLElement {
  const what = GEAR_BY_ID.get(line.with as never)?.emoji ?? weaponOf(line.with).emoji;
  return h(
    'div',
    {},
    h('b', { style: `color:${SIDE_COLOR[line.byTeam] ?? '#cfd6df'}` }, line.own ? '' : line.by),
    ` ${line.own ? '☠️' : what}${line.headshot ? ' 🎯' : ''} `,
    h('b', { style: `color:${SIDE_COLOR[line.whoTeam] ?? '#cfd6df'}` }, line.who),
  );
}

export function installArenaHud() {
  const scoreA = h('span.ah-score', { style: `background:${FPS.teams[0].color}` }, '0');
  const scoreB = h('span.ah-score', { style: `background:${FPS.teams[1].color}` }, '0');
  const clockEl = h('span.ah-clock', {}, '0:00');
  const phaseEl = h('span.ah-phase', {}, '');
  const health = h('span.ah-big', {}, '100');
  const armour = h('span.ah-sub', {}, '');
  const ammo = h('span.ah-big', {}, '—');
  const gun = h('span.ah-sub', {}, '');
  const money = h('span.ah-sub', {}, '');
  const feed = h('div.ah-feed');
  const middle = h('div.ah-middle');
  const healthBox = h('div.ah-health', {}, h('span.ah-sub', {}, '❤'), health, armour);
  const root = h(
    'div',
    { id: 'arena-hud' },
    h('div.ah-top', {}, scoreA, phaseEl, clockEl, scoreB),
    healthBox,
    h('div.ah-ammo', {}, ammo, gun, money),
    feed,
    middle,
    h('div', { id: 'arena-hurt' }),
    h('div', { id: 'arena-flash' }),
    h('div', { id: 'arena-scope' }, h('span.v')),
  );
  const cross = h('div', { id: 'arena-cross' }, h('span.d'), h('span.n'), h('span.s'), h('span.e'), h('span.w'));
  $('hud').append(root, cross);
  const hurtEl = root.querySelector('#arena-hurt') as HTMLElement;
  const flashEl = root.querySelector('#arena-flash') as HTMLElement;
  const scopeEl = root.querySelector('#arena-scope') as HTMLElement;
  const arms = { n: cross.querySelector('.n') as HTMLElement, s: cross.querySelector('.s') as HTMLElement, e: cross.querySelector('.e') as HTMLElement, w: cross.querySelector('.w') as HTMLElement };

  let shownFeed = '';
  let hitUntil = 0;

  /** The HUD is up while you're in a match that's running. */
  function show(on: boolean) {
    root.classList.toggle('on', on);
  }

  /** Draws the whole thing from the match and your own state. */
  function sync(match: MatchState, you: YouState, opts: { now: number; spread: number; scoped: boolean; crosshair: boolean }) {
    scoreA.textContent = String(match.score.a);
    scoreB.textContent = String(match.score.b);
    phaseEl.textContent = match.phase === 'live' ? `${PHASE_WORDS.live} ${match.round}/${match.settings.rounds}` : PHASE_WORDS[match.phase];
    clockEl.textContent = match.until ? clock(match.until, opts.now) : '—';
    health.textContent = String(Math.max(0, Math.round(you.health)));
    healthBox.classList.toggle('ah-hurt', you.alive && you.health <= 35);
    armour.textContent = you.armour ? '🛡' : '';
    const w = weaponOf(you.weapon);
    const a = you.ammo[w.id];
    ammo.textContent = w.mag === Infinity ? '∞' : a ? `${a.mag}` : '—';
    gun.textContent = `${w.emoji} ${w.name}${a && w.mag !== Infinity ? ` · ${a.spare}` : ''}`;
    money.textContent = match.settings.buyMenu ? `· $${you.money}` : '';

    const key = match.feed.map((f) => `${f.at}`).join();
    if (key !== shownFeed) {
      shownFeed = key;
      feed.replaceChildren(...match.feed.slice(-6).map(feedLine));
    }

    // The crosshair opens with how wide the gun is shooting right now.
    const gap = Math.round(5 + opts.spread * 900);
    arms.n.style.top = `${-gap - 7}px`;
    arms.s.style.top = `${gap}px`;
    arms.w.style.left = `${-gap - 7}px`;
    arms.e.style.left = `${gap}px`;
    cross.classList.toggle('on', opts.crosshair && !opts.scoped);
    cross.classList.toggle('hit', opts.now < hitUntil);
    scopeEl.classList.toggle('on', opts.scoped);

    middle.replaceChildren(...banner(match, you, opts.now));
  }

  /** What's said across the middle of the screen: waiting to come back, the round's result, the match's. */
  function banner(match: MatchState, you: YouState, now: number): HTMLElement[] {
    if (match.phase === 'countdown') return [h('div.big', {}, clock(match.until, now)), h('div.small', {}, 'Match starting')];
    if (match.phase === 'between') return [h('div.big', {}, 'Round over'), h('div.small', {}, `Next round in ${clock(match.until, now)}`)];
    if (match.phase === 'paused') return [h('div.big', {}, 'Paused'), h('div.small', {}, 'The host stopped the clock')];
    if (match.phase === 'over' && match.result) {
      const side = match.result.winner;
      const name = side === 'none' ? 'Nobody' : teamDef(FPS, side).name;
      return [h('div.big', {}, `${name} ${side === 'none' ? 'won it' : 'win'}`), h('div.small', {}, match.result.reason)];
    }
    if (you.in && !you.alive && match.phase === 'live') {
      const waiting = you.respawnAt ? `Back in ${Math.max(0, Math.ceil((you.respawnAt - now) / 1000))}s` : 'Watching the round out';
      return [h('div.big', {}, 'Eliminated'), h('div.small', {}, waiting)];
    }
    return [];
  }

  /** You were hit: the edges of the screen redden for a moment. */
  function hurt() {
    hurtEl.style.opacity = '1';
    setTimeout(() => (hurtEl.style.opacity = '0'), 90);
  }

  /** You hit someone: the crosshair flicks red. */
  function hitmark(now: number) {
    hitUntil = now + 140;
  }

  /** A flashbang: white, then back, over `seconds`. */
  function blind(seconds: number) {
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '1';
    requestAnimationFrame(() => {
      flashEl.style.transition = `opacity ${Math.max(0.2, seconds).toFixed(2)}s`;
      flashEl.style.opacity = '0';
    });
  }

  /** What the side `s` is called, for anything else that needs it. */
  const sideName = (s: Side) => (s === 'none' ? 'nobody' : teamDef(FPS, s).name);

  return { show, sync, hurt, hitmark, blind, sideName };
}
