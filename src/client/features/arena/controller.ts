import * as THREE from 'three';
import { ARENA_SITE } from '../../../shared/games/fps/arena';
import { GEAR, GEAR_BY_ID, type GearId } from '../../../shared/games/fps/gear';
import { dirOf, type Vec3 } from '../../../shared/games/fps/hit';
import { fireEvery, weaponOf, type Weapon } from '../../../shared/games/fps/weapons';
import type { Ctx, StopWhy } from '../../core/context';
import type { Activity } from '../../core/registry';
import { store } from '../../state';
import { modalOpen } from '../../ui/dom';
import { ViewModel } from './viewmodel';

// Being in a match: the controls while you are. The office's own walking, looking and jumping stay
// exactly as they are — this adds the gun, the crouch, the sights and the recoil on top, and takes
// the keys and the mouse while a round is live. Leaving the match hands all of it straight back.

/** How often where you are goes to the office while you're in a match, in ms. */
const POSE_EVERY = 66;
/** How far the camera drops when you crouch, and how fast it gets there. */
const CROUCH_DROP = 0.52;
const CROUCH_SPEED = 7;
/** How quickly the sights climb back down after a shot. */
const RECOIL_RECOVER = 3.4;

export interface FighterDeps {
  /** A shot of your own, for the sound and the tracer. */
  fired(w: Weapon, from: Vec3, yaw: number, pitch: number): void;
  /** You threw something. */
  threw(gear: GearId, from: Vec3, dir: Vec3): void;
  /** Opens the buy menu. */
  buy(): void;
  /** Opens the lobby window (the scoreboard while a match is on). */
  lobby(): void;
}

/**
 * You, in a match. It's an activity (see ctx.activities), so anything else you start stops it, and
 * `stop` is the one way out: the office's controls are back the moment it isn't active.
 */
export class Fighter implements Activity<StopWhy, KeyboardEvent, HTMLElement> {
  readonly id = 'fighter';
  /** Your own hands are off: the gun is drawn instead. */
  readonly hidesHands = true;
  readonly model = new ViewModel();

  /** In a match and on your feet in a live round. */
  private fighting = false;
  private crouch = false;
  private crouchAt = 0;
  private aiming = false;
  private zoom = 0;
  private firing = false;
  private nextShot = 0;
  /** What's left of the kick from the last shot, in radians. */
  private recoil = 0;
  private sentAt = 0;
  /** Which piece of gear G throws. */
  private gear: GearId = 'smoke';
  /** When the reload this page asked for should be done, so the gun drops out of sight while it is. */
  private reloadUntil = 0;

  constructor(
    private ctx: Ctx,
    private deps: FighterDeps,
  ) {
    ctx.camera.add(this.model.group);
  }

  active(): boolean {
    return this.fighting;
  }

  /** You're in a match and a round is live: the match's controls are yours. */
  begin() {
    if (this.fighting) return;
    this.fighting = true;
    this.crouch = false;
    this.aiming = false;
    this.firing = false;
    this.recoil = 0;
    this.ctx.player.setView('first');
    this.model.hold(store.gameYou.weapon || 'sidearm');
    this.ctx.hint.invalidate();
  }

  stop(why: StopWhy) {
    // Going to another floor, or the office putting you somewhere, takes you out; nothing else does.
    if (why === 'walk' || why === 'errand') return;
    this.end();
  }

  /** Out of the fight: the office's own controls, and no gun. */
  end() {
    if (!this.fighting) return;
    this.fighting = false;
    this.firing = false;
    this.aiming = false;
    this.crouch = false;
    this.model.update(0, { walking: false, walkPhase: 0, reloading: false, hidden: true });
    this.ctx.hint.invalidate();
  }

  /** Whether the gun is up at the sights right now. */
  get aimed(): boolean {
    return this.fighting && this.aiming;
  }

  /** How much the sights narrow the view: 1 from the hip. */
  fovScale(): number {
    const w = weaponOf(store.gameYou.weapon);
    if (!this.fighting || !this.aiming || !w.zoom.length) return 1;
    return w.zoom[Math.min(this.zoom, w.zoom.length - 1)];
  }

  /** Whether a scope has the screen to itself (the sniper's). */
  get scoped(): boolean {
    return this.fighting && this.aiming && weaponOf(store.gameYou.weapon).sight === 'scope';
  }

  // ---- The mouse ---------------------------------------------------------------------------------

  mouse(button: number, down: boolean) {
    if (!this.fighting || modalOpen()) return;
    if (button === 0) this.firing = down;
    if (button === 2) {
      this.aiming = down;
      if (!down) this.zoom = 0;
      else if (this.scoped) this.ctx.sound.arenaScope();
    }
  }

  /** A scoped weapon steps through its zooms on the wheel. */
  wheel(up: boolean) {
    const w = weaponOf(store.gameYou.weapon);
    if (!this.fighting || !this.aiming || w.zoom.length < 2) return this.nextWeapon(up ? 1 : -1);
    this.zoom = Math.max(0, Math.min(w.zoom.length - 1, this.zoom + (up ? 1 : -1)));
  }

  // ---- Keys ---------------------------------------------------------------------------------------

  key(e: KeyboardEvent): boolean {
    if (!this.fighting || e.ctrlKey || e.metaKey || e.altKey) return false;
    const you = store.gameYou;
    switch (e.code) {
      case 'KeyR':
        this.reload();
        return true;
      case 'KeyB':
        this.deps.buy();
        return true;
      case 'Tab':
        e.preventDefault();
        this.deps.lobby();
        return true;
      case 'KeyG':
        this.throwGear();
        return true;
      case 'KeyF':
        this.cycleGear();
        return true;
      case 'KeyQ':
        this.nextWeapon(1);
        return true;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5': {
        const n = Number(e.code.slice(5)) - 1;
        const id = you.weapons[n];
        if (id) this.take(id);
        return true;
      }
      default:
        return false;
    }
  }

  private reload() {
    const w = weaponOf(store.gameYou.weapon);
    const ammo = store.gameYou.ammo[w.id];
    if (w.mag === Infinity || !ammo || ammo.mag >= w.mag || ammo.spare <= 0) return;
    this.ctx.net.send({ t: 'game.reload' });
    this.reloadUntil = performance.now() + w.reload * 1000;
    this.nextShot = this.reloadUntil;
    this.ctx.sound.arenaReload(this.at());
  }

  private take(id: string) {
    if (id === store.gameYou.weapon) return;
    this.ctx.net.send({ t: 'game.weapon', weapon: id });
    this.model.hold(id);
    this.aiming = false;
    this.zoom = 0;
    this.reloadUntil = 0;
    this.nextShot = performance.now() + 250;
  }

  private nextWeapon(step: number) {
    const list = store.gameYou.weapons;
    if (list.length < 2) return;
    const i = list.indexOf(store.gameYou.weapon);
    this.take(list[(((i + step) % list.length) + list.length) % list.length]);
  }

  private cycleGear() {
    const have = GEAR.filter((g) => (store.gameYou.gear[g.id] ?? 0) > 0);
    if (!have.length) return;
    const i = have.findIndex((g) => g.id === this.gear);
    this.gear = have[(i + 1) % have.length].id;
    this.ctx.hint.invalidate();
  }

  private throwGear() {
    const left = store.gameYou.gear[this.gear] ?? 0;
    if (left <= 0) return this.cycleGear();
    const { player } = this.ctx;
    const yaw = player.camYaw + Math.PI;
    const pitch = player.lookPitch;
    this.ctx.net.send({ t: 'game.throw', gear: this.gear, yaw, pitch });
    const from = this.eye();
    this.deps.threw(this.gear, from, dirOf(yaw, Math.max(-1.4, Math.min(1.4, pitch)) + 0.05));
    this.ctx.sound.arenaThrow({ x: player.pos.x, y: player.pos.y + 1.4, z: player.pos.z });
  }

  /** Where you're looking from, in the arena's own frame (which is what the office works in). */
  private eye(): Vec3 {
    const { player } = this.ctx;
    return { x: player.pos.x - ARENA_SITE.x, y: player.pos.y + (this.crouch ? 0.92 - CROUCH_DROP * 0.5 : 0.92) + 0.48, z: player.pos.z - ARENA_SITE.z };
  }

  // ---- Each frame ------------------------------------------------------------------------------------

  /** Runs in the `play` phase, before your character and the camera are put where they go. */
  tick(dt: number, now: number) {
    const { player } = this.ctx;
    if (!this.fighting) {
      this.model.update(dt, { walking: false, walkPhase: 0, reloading: false, hidden: true });
      return;
    }
    // Crouching: held, and only on the ground.
    this.crouch = player.holding('ControlLeft', 'KeyC') && player.grounded;
    this.crouchAt += ((this.crouch ? 1 : 0) - this.crouchAt) * Math.min(1, dt * CROUCH_SPEED);
    this.model.setAim(this.aiming, dt);
    // The sights come back down after a shot.
    if (this.recoil > 0) {
      const back = Math.min(this.recoil, dt * RECOIL_RECOVER * (this.recoil + 0.2));
      player.lookPitch -= back;
      this.recoil -= back;
    }
    const w = weaponOf(store.gameYou.weapon);
    if (this.firing && now >= this.nextShot && !modalOpen()) {
      if (this.shoot(w, now) && !w.auto) this.firing = false;
    }
    const reloading = now < this.reloadUntil;
    this.model.update(dt, { walking: player.moving && player.grounded, walkPhase: player.walkPhase, reloading, hidden: this.scoped });
    this.sendPose(now);
  }

  /** Lowers the camera while you're crouched. Runs as a view effect, after the camera is placed. */
  view() {
    if (!this.fighting || this.crouchAt < 0.001) return;
    this.ctx.camera.position.y -= CROUCH_DROP * this.crouchAt;
  }

  private shoot(w: Weapon, now: number): boolean {
    const you = store.gameYou;
    const left = you.ammo[w.id];
    if (w.mag !== Infinity && left && left.mag <= 0) {
      this.reload();
      return false;
    }
    const { player } = this.ctx;
    const yaw = player.camYaw + Math.PI;
    const pitch = player.lookPitch;
    this.nextShot = now + fireEvery(w);
    this.ctx.net.send({ t: 'game.fire', yaw, pitch });
    // Shown and heard here and now; what it actually hit comes back from the office.
    if (left && w.mag !== Infinity) left.mag = Math.max(0, left.mag - 1);
    this.model.fired(w);
    this.recoil += w.recoil;
    player.lookPitch = Math.min(1.5, player.lookPitch + w.recoil);
    this.ctx.shake(Math.min(0.25, w.recoil * 3));
    this.deps.fired(w, this.eye(), yaw, pitch);
    return true;
  }

  private sendPose(now: number) {
    if (now - this.sentAt < POSE_EVERY) return;
    this.sentAt = now;
    const { player } = this.ctx;
    this.ctx.net.send({
      t: 'game.pose',
      x: player.pos.x - ARENA_SITE.x,
      y: player.pos.y - ARENA_SITE.y,
      z: player.pos.z - ARENA_SITE.z,
      yaw: player.camYaw + Math.PI,
      pitch: player.lookPitch,
      crouch: this.crouch,
      moving: player.moving,
    });
  }

  /** What the hint bar says while you're fighting. */
  hint(el: HTMLElement) {
    const you = store.gameYou;
    const w = weaponOf(you.weapon);
    const ammo = you.ammo[w.id];
    const g = GEAR_BY_ID.get(this.gear);
    const k = `${w.id}:${ammo?.mag ?? -1}:${this.gear}:${you.gear[this.gear] ?? 0}`;
    this.ctx.hint.draw(el, k, () => [`${w.emoji} ${w.name}`, ammo && w.mag !== Infinity ? ` ${ammo.mag}/${ammo.spare}` : '', ' · R reload · B buy', g ? ` · G ${g.emoji} ${g.name} (${you.gear[this.gear] ?? 0})` : '', ' · Tab scores']);
  }

  /** The office said where you are: put yourself there (a spawn, or a correction). */
  placeAt(at: { x: number; y: number; z: number; rotY: number }) {
    const { player } = this.ctx;
    player.pos.set(at.x + ARENA_SITE.x, at.y + ARENA_SITE.y, at.z + ARENA_SITE.z);
    player.vy = 0;
    player.facing = at.rotY;
    player.camYaw = at.rotY - Math.PI;
    player.lookPitch = 0;
    this.recoil = 0;
  }

  /** The gun in your hands changed under you (the office's word on it). */
  holding(id: string) {
    if (id) this.model.hold(id);
  }

  /** Where your eyes are in the world, for sounds. */
  at(): THREE.Vector3 {
    const { player } = this.ctx;
    return new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z);
  }
}
