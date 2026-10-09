/**
 * The gaming room. A shutter in the lounge wall opens onto an arena with a lobby you watch the match
 * from; walking in joins nothing, and whoever stays in the office never hears about it. Joining a
 * match, readying up and starting it are all the office's to decide (see server/floor/arena.ts);
 * this is the page's side of it: the arena to walk about in, the controls while you're fighting,
 * and the windows that show the match.
 */
import { ARENA_SITE } from '../../../shared/games/fps/arena';
import { dirOf, rayWorld } from '../../../shared/games/fps/hit';
import { spreadFor } from '../../../shared/games/fps/weapons';
import { weaponOf } from '../../../shared/games/fps/weapons';
import type { MatchEvent } from '../../../shared/protocol';
import { FPS } from '../../../shared/games/games';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { modalOpen, toast, type Modal } from '../../ui/dom';
import type { RemotePeer } from '../peers';
import { boardArrived } from './board';
import { openBuy } from './buy';
import { Fighter } from './controller';
import { Effects } from './effects';
import { installArenaHud } from './hud';
import { openLobby } from './lobby';

export interface ArenaDeps {
  /** Puts you down somewhere on your feet (see core/place.ts). */
  placeAt(at: { x: number; y: number; z: number; rotY: number }): void;
  /** Everyone else on the floor, as they're drawn (see features/peers). */
  remotes: ReadonlyMap<string, RemotePeer>;
  /** Up off whatever you're sitting on. */
  standUp(): void;
  /** Stops a walk over to someone. */
  stopWalking(): void;
}

export function installArena(ctx: Ctx, deps: ArenaDeps) {
  const { office, player } = ctx;
  const effects = new Effects();
  ctx.scene.add(effects.group);
  const hud = installArenaHud();
  let lobbyWindow: Modal | null = null;
  let buyWindow: Modal | null = null;

  const fighter = new Fighter(ctx, {
    fired: (w, from, yaw, pitch) => {
      // Drawn and heard where it happened; what it hit comes back from the office.
      const dir = dirOf(yaw, pitch);
      const far = rayWorld(from, dir, 200);
      effects.shot(from, { x: from.x + dir.x * far, y: from.y + dir.y * far, z: from.z + dir.z * far }, false);
      ctx.sound.arenaShot(w, { x: player.pos.x, y: player.pos.y + 1.4, z: player.pos.z });
    },
    threw: (gear, from, dir) => effects.thrown(gear, from, dir),
    buy: () => openBuyWindow(),
    lobby: () => showLobby(),
  });
  ctx.activities.add(fighter);
  ctx.view.add({ update: () => fighter.view(), fov: (fov) => fov * fighter.fovScale() });

  /** Whether you're anywhere in the gaming room. */
  const inArena = () => office.arena.inside(player.pos.x, player.pos.z);

  // ---- Walking in and out ---------------------------------------------------------------------

  /** The office's room, put back when you come out of the arena. */
  let officeRoom = player.room;

  function goIn() {
    if (ctx.trip()) return;
    officeRoom = player.room;
    deps.standUp();
    deps.stopWalking();
    ctx.activities.stopAll('start');
    deps.placeAt(office.arena.arriveAt);
    player.room = { ...office.arena.bounds, wall: 0.6, enclosed: true };
    ctx.sound.arenaScope();
    if (store.game.phase === 'idle' && !store.me.admin) toast('🎯 Nobody has opened a match in here yet — an administrator can', 'info');
    else showLobby();
  }

  function goOut() {
    fighter.end();
    if (store.gameYou.in) ctx.net.send({ t: 'game.leave' });
    effects.clear();
    player.room = officeRoom;
    deps.placeAt(office.arena.backAt);
  }

  ctx.interactions.define('arena', {
    reach: 3.2,
    hint: () => {
      const match = store.game;
      const n = match.players.length;
      const says = match.phase === 'idle' ? 'no match yet' : match.phase === 'lobby' ? `lobby open · ${n} in` : `${match.phase === 'live' ? `round ${match.round}` : match.phase} · ${n} playing`;
      return { k: `arena:${match.phase}:${n}`, parts: [hintTitle(`${FPS.emoji} ${FPS.name} arena`), aside(says), key('E', 'Go in')] };
    },
    use: onE(() => goIn()),
  });

  ctx.interactions.define('arenaExit', {
    reach: 3.2,
    hint: () => ({ k: 'arena-exit', parts: [hintTitle('🏢 Back to the office'), key('E', 'Leave the arena')] }),
    use: onE(() => goOut()),
  });

  ctx.interactions.define('arenaBoard', {
    reach: 3.4,
    hint: () => {
      const match = store.game;
      return { k: `board:${match.phase}:${match.players.length}`, parts: [hintTitle('📋 Match board'), aside(match.phase === 'idle' ? 'no match yet' : `${match.players.length} in the lobby`), key('E', 'Open it')] };
    },
    use: onE(() => showLobby()),
  });

  // ---- The windows -------------------------------------------------------------------------------

  /** Opens a window and forgets it again once it closes (by its ✕, Esc or a button). */
  function keep(m: Modal, forget: () => void): Modal {
    const was = m.close;
    m.close = () => {
      forget();
      was.call(m);
    };
    return m;
  }

  function showLobby() {
    if (lobbyWindow) return lobbyWindow.close();
    lobbyWindow = keep(openLobby({ net: ctx.net, leaveArena: () => goOut() }), () => (lobbyWindow = null));
  }

  function openBuyWindow() {
    if (!buyWindow) buyWindow = keep(openBuy(ctx.net), () => (buyWindow = null));
  }

  // Tab shows the match from anywhere in the gaming room; the fighter takes it while a round is live.
  ctx.keys.bind({
    code: 'Tab',
    when: () => inArena() && !modalOpen(),
    preventDefault: true,
    repeat: false,
    run: () => void showLobby(),
  });

  // ---- The mouse while you're fighting --------------------------------------------------------------

  const onMouse = (e: MouseEvent, down: boolean) => {
    if (!fighter.active() || modalOpen()) return;
    if (e.button === 2) e.preventDefault();
    fighter.mouse(e.button, down);
  };
  ctx.canvas.addEventListener('mousedown', (e) => onMouse(e, true));
  window.addEventListener('mouseup', (e) => onMouse(e, false));
  ctx.canvas.addEventListener('contextmenu', (e) => fighter.active() && e.preventDefault());
  ctx.canvas.addEventListener('wheel', (e) => {
    if (!fighter.active()) return;
    e.preventDefault();
    fighter.wheel(e.deltaY < 0);
  });
  // A window opening lets go of the trigger, so it isn't still held when it closes.
  ctx.windowOpened.add(() => fighter.mouse(0, false));

  // ---- What the office says ------------------------------------------------------------------------

  ctx.messages.on('game', () => syncFighting());
  ctx.messages.on('game.you', () => {
    syncFighting();
    fighter.holding(store.gameYou.weapon);
  });

  ctx.messages.on('game.poses', (m) => {
    // The office's own word on where everyone is: what it shot its rays through, so what you see is
    // what it hit. It stands in for the slower `move` everyone sends while a round is live.
    for (const p of m.poses) {
      const r = deps.remotes.get(p.id);
      if (!r) continue;
      r.target.set(p.x + ARENA_SITE.x, p.y + ARENA_SITE.y, p.z + ARENA_SITE.z);
      r.rotY = p.yaw;
      r.moving = p.moving;
    }
  });

  ctx.messages.on('game.shot', (m) => {
    if (m.id === store.you) return;
    effects.shot({ x: m.x, y: m.y, z: m.z }, { x: m.tx, y: m.ty, z: m.tz }, m.hit);
    const w = weaponOf(m.weapon);
    ctx.sound.arenaShot(w, { x: m.x + ARENA_SITE.x, y: m.y, z: m.z + ARENA_SITE.z });
  });

  ctx.messages.on('game.event', (m) => onEvent(m.event));
  ctx.messages.on('game.board', (m) => boardArrived(m.key, m.span, m.rows));

  function onEvent(event: MatchEvent) {
    const you = store.gameYou;
    switch (event.e) {
      case 'hurt':
        hud.hurt();
        ctx.shake(Math.min(0.5, event.damage / 90));
        break;
      case 'hitmark':
        hud.hitmark(performance.now());
        ctx.sound.arenaHit(event.part === 'head');
        break;
      case 'throw':
        if (event.id !== store.you) effects.thrown(event.gear, { x: event.x, y: event.y, z: event.z }, { x: event.dx, y: event.dy, z: event.dz });
        break;
      case 'burst':
        effects.burst(event.gear, { x: event.x, y: event.y, z: event.z });
        ctx.sound.arenaBurst(event.gear, { x: event.x + ARENA_SITE.x, y: event.y, z: event.z + ARENA_SITE.z });
        break;
      case 'blind':
        hud.blind(Math.max(0.2, (event.until - Date.now()) / 1000));
        break;
      case 'round':
        effects.clear();
        office.arena.setLive(true);
        break;
      case 'roundOver':
        office.arena.setLive(false);
        if (you.in && you.team !== 'none') ctx.sound.arenaRound(event.winner === you.team);
        break;
      case 'matchOver':
        office.arena.setLive(false);
        fighter.end();
        if (event.xp) toast(`🏁 Match over — you earned ${event.xp.toLocaleString()} XP`, 'info');
        break;
      case 'say':
        if (inArena()) toast(`${FPS.emoji} ${event.text}`, 'info');
        break;
    }
  }

  /** The fighter is on exactly while you're alive in a live round, and off the moment you aren't. */
  function syncFighting() {
    const you = store.gameYou;
    const live = store.game.phase === 'live';
    if (you.in && you.alive && live && inArena()) fighter.begin();
    else fighter.end();
  }

  // ---- Each frame -------------------------------------------------------------------------------------

  ctx.ticks.add('play', ({ dt, now }) => {
    fighter.tick(dt, now);
    effects.update(dt);
  });

  ctx.ticks.add('others', () => {
    // Anybody down is out of sight until the round brings them back.
    const match = store.game;
    const down = new Set(match.players.filter((p) => !p.alive).map((p) => p.id));
    const playing = match.phase === 'live';
    for (const [id, r] of deps.remotes) {
      const inMatch = match.players.some((p) => p.id === id);
      if (!inMatch) continue;
      r.person.root.visible = !playing || !down.has(id);
    }
  });

  ctx.ticks.add('hud', ({ now }) => {
    const you = store.gameYou;
    const show = inArena() && store.game.phase !== 'idle';
    hud.show(show);
    if (!show) return;
    const w = weaponOf(you.weapon);
    const speed = player.moving ? (player.running ? 7.5 : 4.6) : 0;
    hud.sync(store.game, you, {
      now,
      spread: spreadFor(w, speed, false, fighter.aimed),
      scoped: fighter.scoped,
      crosshair: fighter.active(),
    });
  });

  // Leaving the floor, or the office putting you somewhere else, takes you out of the gaming room.
  store.on('floor', () => {
    if (!inArena()) return;
    fighter.end();
    effects.clear();
    player.room = officeRoom;
  });

  return {
    fighter,
    inArena,
    /** Opens the gaming room's window from anywhere (the ☰ menu). */
    showLobby,
    /** Walks you into the arena and out again, for the palette and the tests. */
    goIn,
    goOut,
  };
}
