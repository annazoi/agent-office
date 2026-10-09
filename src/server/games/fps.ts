// The first game's rules, on the office's side: what everyone carries into a round, what a shot does,
// what a grenade does, and who has won. Every one of those is worked out here, from the arena and the
// weapon tables in shared/games/fps, and never from anything a browser claims. A page that says it
// fired is only saying where it was aiming.
import { ARENA_BOXES, spawnOf } from '../../shared/games/fps/arena.js';
import { ARMOUR_PRICE, GEAR, GEAR_BY_ID, blastFor, flashFor, isGear, type GearId } from '../../shared/games/fps/gear.js';
import { canSee, dirOf, eyeOf, flyGrenade, rayWorld, shoot, stray, type Target, type Vec3 } from '../../shared/games/fps/hit.js';
import { STARTING_LOADOUT, WEAPONS, WEAPON_BY_ID, damageFor, fireEvery, spreadFor, weaponOf, type Weapon } from '../../shared/games/fps/weapons.js';
import { allowed } from '../../shared/games/match.js';
import type { Side, TeamId } from '../../shared/games/games.js';
import type { GamesClientMsg, YouState } from '../../shared/protocol.js';
import { num } from '../office/input.js';
import type { GameRules, Room, Seat } from './types.js';

/** Seconds at the start of a round when the buy menu is open. */
export const BUY_SECONDS = 18;
/** What everyone starts a match with, what a round is worth, and the most anyone can hold. */
const MONEY_START = 800;
const MONEY_WIN = 3000;
const MONEY_LOSS = 1900;
const MONEY_KILL = 300;
const MONEY_MAX = 14_000;
/** How far anyone can get between two poses, in meters a second, before the office stops believing them. */
const TOP_SPEED = 11;
/** Smoke this thick across the line of a shot stops it. */
const SMOKE_STOPS = 1.2;
/** How long an assist counts for after the hit, in ms. */
const ASSIST_MS = 8000;

/** A grenade on its way, worked out the moment it left the hand. */
interface Pending {
  gear: GearId;
  by: string;
  team: Side;
  at: number;
  where: Vec3;
}

/** A cloud of smoke standing in the arena. */
interface Smoke {
  x: number;
  y: number;
  z: number;
  until: number;
}

const ammoFor = (w: Weapon) => ({ mag: w.mag === Infinity ? 0 : w.mag, spare: w.spare });

export class FpsRules implements GameRules {
  readonly id = 'fps' as const;
  readonly weapons = WEAPONS.map((w) => w.id);
  readonly gear = GEAR.map((g) => g.id);

  private pending: Pending[] = [];
  private smokes: Smoke[] = [];

  // ---- A round, and coming back ---------------------------------------------------------------

  startRound(room: Room, seat: Seat, n: number) {
    const { settings } = room;
    // What they bought last round is still theirs; everything else starts again.
    const kept = settings.buyMenu ? seat.weapons.filter((w) => allowed(settings.weapons, w)) : [];
    seat.weapons = [...new Set([...STARTING_LOADOUT, ...kept])];
    if (!settings.buyMenu) seat.money = 0;
    this.refill(seat);
    seat.gear = new Map(settings.buyMenu ? [...seat.gear].filter(([id]) => allowed(settings.gear, id)) : []);
    this.place(room, seat, n);
    seat.roundKills = 0;
    seat.rounds++;
  }

  respawn(room: Room, seat: Seat, n: number) {
    this.refill(seat);
    this.place(room, seat, n);
  }

  spawnOf(team: TeamId, n: number) {
    const s = spawnOf(team, n);
    return { x: s.x, y: 0, z: s.z, rotY: s.rotY };
  }

  /** On their feet at their side's spot, whole again. */
  private place(room: Room, seat: Seat, n: number) {
    const at = this.spawnOf(seat.team === 'b' ? 'b' : 'a', n);
    seat.spawnAt = { ...at, n: (seat.spawnAt?.n ?? 0) + 1 };
    seat.alive = true;
    seat.health = 100;
    seat.respawnAt = 0;
    seat.blindUntil = 0;
    seat.hurtBy.clear();
    seat.weapon = seat.weapons.includes('rifle') ? 'rifle' : seat.weapons[seat.weapons.length - 1] ?? 'sidearm';
    seat.nextShot = 0;
    seat.reloadingUntil = 0;
    seat.pose = { ...seat.pose, x: at.x, y: at.y, z: at.z, yaw: at.rotY, pitch: 0, crouch: false, moving: false, weapon: seat.weapon };
    seat.poseAt = room.now();
    room.changed(seat);
  }

  /** Every gun they carry loaded up again. */
  private refill(seat: Seat) {
    seat.ammo = new Map(seat.weapons.map((id) => [id, ammoFor(weaponOf(id))]));
    seat.armour = false;
  }

  /** What each side takes from a round, once it's over. */
  moneyForRound(room: Room, winner: Side) {
    for (const s of room.seats()) {
      const won = s.team !== 'none' && s.team === winner;
      s.money = Math.min(MONEY_MAX, s.money + (won ? MONEY_WIN : MONEY_LOSS));
    }
  }

  // ---- Who won --------------------------------------------------------------------------------

  decide(room: Room, timeUp: boolean) {
    const mode = room.settings.mode;
    const a = room.seats().filter((s) => s.team === 'a');
    const b = room.seats().filter((s) => s.team === 'b');
    if (!a.length || !b.length) {
      // A side emptied out: the round, and the match, goes to whoever is left.
      if (!a.length && !b.length) return { winner: 'none' as Side, reason: 'Everyone left' };
      return { winner: (a.length ? 'a' : 'b') as Side, reason: 'The other side left' };
    }
    if (mode === 'elim') {
      const aliveA = a.some((s) => s.alive);
      const aliveB = b.some((s) => s.alive);
      if (!aliveA && !aliveB) return { winner: 'none' as Side, reason: 'Both sides down' };
      if (!aliveA) return { winner: 'b' as Side, reason: 'Raiders eliminated' };
      if (!aliveB) return { winner: 'a' as Side, reason: 'Wardens eliminated' };
      if (timeUp) {
        const left = a.filter((s) => s.alive).length - b.filter((s) => s.alive).length;
        if (left === 0) return { winner: 'none' as Side, reason: 'Time: even' };
        return { winner: (left > 0 ? 'a' : 'b') as Side, reason: 'Time: last standing' };
      }
      return undefined;
    }
    if (!timeUp) return undefined;
    const kills = (side: Seat[]) => side.reduce((n, s) => n + s.roundKills, 0);
    const d = kills(a) - kills(b);
    if (d === 0) return { winner: 'none' as Side, reason: 'Time: even' };
    return { winner: (d > 0 ? 'a' : 'b') as Side, reason: 'Time: most eliminations' };
  }

  // ---- What a browser asks for ------------------------------------------------------------------

  handle(room: Room, seat: Seat, msg: GamesClientMsg): boolean {
    switch (msg.t) {
      case 'game.pose':
        this.pose(room, seat, msg);
        return true;
      case 'game.fire':
        this.fire(room, seat, num(msg.yaw), num(msg.pitch));
        return true;
      case 'game.reload':
        this.reload(room, seat);
        return true;
      case 'game.weapon':
        this.switchTo(room, seat, msg.weapon);
        return true;
      case 'game.throw':
        this.throwGear(room, seat, msg.gear, num(msg.yaw), num(msg.pitch));
        return true;
      case 'game.buy':
        this.buy(room, seat, msg);
        return true;
      default:
        return false;
    }
  }

  /** Where they say they are. Anyone who covers more ground than a person can is left where they were. */
  private pose(room: Room, seat: Seat, msg: Extract<GamesClientMsg, { t: 'game.pose' }>) {
    const now = room.now();
    const was = seat.pose;
    const next = { x: num(msg.x), y: num(msg.y), z: num(msg.z) };
    const dt = Math.max(0.03, (now - seat.poseAt) / 1000);
    const far = Math.hypot(next.x - was.x, next.z - was.z);
    if (seat.alive && far > TOP_SPEED * dt + 1.2) {
      // Too far, too fast: keep where they were, and put them back there.
      seat.warps++;
      if (seat.warps % 10 === 1) room.changed(seat);
      return;
    }
    seat.poseAt = now;
    seat.pose = {
      id: seat.id,
      x: next.x,
      y: next.y,
      z: next.z,
      yaw: num(msg.yaw),
      pitch: Math.max(-1.55, Math.min(1.55, num(msg.pitch))),
      crouch: !!msg.crouch,
      moving: !!msg.moving,
      weapon: seat.weapon,
    };
  }

  private fire(room: Room, seat: Seat, yaw: number, pitch: number) {
    const now = room.now();
    if (!seat.alive || now < seat.nextShot) return;
    const w = weaponOf(seat.weapon);
    const ammo = seat.ammo.get(w.id);
    if (w.mag !== Infinity && (!ammo || ammo.mag <= 0)) {
      this.reload(room, seat);
      return;
    }
    if (now < seat.reloadingUntil) return;
    seat.nextShot = now + fireEvery(w);
    if (ammo && w.mag !== Infinity) ammo.mag--;
    const from = eyeOf(seat.pose);
    const speed = seat.pose.moving ? (seat.pose.crouch ? 2.2 : 5) : 0;
    const spread = spreadFor(w, speed, seat.pose.crouch, false);
    const targets = this.targetsFor(room, seat);
    let anyHit = false;
    let far: Vec3 = from;
    for (let pellet = 0; pellet < w.pellets; pellet++) {
      const dir = stray(yaw, pitch, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread);
      const reach = w.kind === 'melee' ? w.range : 200;
      const found = shoot(from, dir, targets, reach, ARENA_BOXES);
      const wall = rayWorld(from, dir, reach, ARENA_BOXES);
      const t = found ? found.hit.t : Math.min(wall, reach);
      far = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
      if (!found || this.smoked(from, far)) continue;
      anyHit = true;
      const hurt = room.seat(found.who.id);
      if (!hurt) continue;
      const damage = damageFor(w, found.hit.part, found.hit.t, hurt.armour);
      this.hurt(room, hurt, seat, damage, found.hit.part, w.id);
      room.toSeat(seat, { e: 'hitmark', who: hurt.id, part: found.hit.part, killed: !hurt.alive });
    }
    room.shot(seat, from, far, anyHit);
    room.changed(seat);
  }

  private reload(room: Room, seat: Seat) {
    const now = room.now();
    const w = weaponOf(seat.weapon);
    const ammo = seat.ammo.get(w.id);
    if (!seat.alive || !ammo || w.mag === Infinity || ammo.mag >= w.mag || ammo.spare <= 0 || now < seat.reloadingUntil) return;
    seat.reloadingUntil = now + w.reload * 1000;
    seat.nextShot = seat.reloadingUntil;
    setTimeout(() => {
      if (seat.reloadingUntil > room.now()) return;
      const take = Math.min(w.mag - ammo.mag, ammo.spare);
      ammo.mag += take;
      ammo.spare -= take;
      room.changed(seat);
    }, w.reload * 1000 + 20).unref?.();
    room.changed(seat);
  }

  private switchTo(room: Room, seat: Seat, id: unknown) {
    if (typeof id !== 'string' || !seat.weapons.includes(id) || seat.weapon === id) return;
    seat.weapon = id;
    seat.pose = { ...seat.pose, weapon: id };
    seat.reloadingUntil = 0;
    seat.nextShot = Math.max(seat.nextShot, room.now() + 250);
    room.changed(seat);
  }

  private throwGear(room: Room, seat: Seat, id: unknown, yaw: number, pitch: number) {
    const now = room.now();
    if (!seat.alive || !isGear(id) || now < seat.nextThrow) return;
    const left = seat.gear.get(id) ?? 0;
    const g = GEAR_BY_ID.get(id)!;
    if (left <= 0) return;
    seat.gear.set(id, left - 1);
    seat.nextThrow = now + g.cooldown * 1000;
    const from = eyeOf(seat.pose);
    const dir = dirOf(yaw, Math.max(-1.4, Math.min(1.4, pitch)) + 0.05);
    const where = flyGrenade(from, dir, g.speed, g.fuse);
    this.pending.push({ gear: id, by: seat.id, team: seat.team, at: now + g.fuse * 1000, where });
    room.toFloor({ e: 'throw', id: seat.id, gear: id, x: from.x, y: from.y, z: from.z, dx: dir.x, dy: dir.y, dz: dir.z });
    room.changed(seat);
  }

  private buy(room: Room, seat: Seat, msg: Extract<GamesClientMsg, { t: 'game.buy' }>) {
    const { settings } = room;
    if (!settings.buyMenu) return room.warn(seat, 'This match has no buy menu: everyone comes in with the same kit.');
    if (!seat.alive) return;
    if (msg.armour) {
      if (seat.armour) return;
      if (seat.money < ARMOUR_PRICE) return room.warn(seat, 'Not enough for armour.');
      seat.money -= ARMOUR_PRICE;
      seat.armour = true;
      return room.changed(seat);
    }
    if (typeof msg.gear === 'string') {
      const g = GEAR_BY_ID.get(msg.gear as GearId);
      if (!g || !allowed(settings.gear, g.id)) return room.warn(seat, "That isn't on this match's list.");
      const have = seat.gear.get(g.id) ?? 0;
      if (have >= g.carried) return room.warn(seat, `You can only carry ${g.carried} of those.`);
      if (seat.money < g.price) return room.warn(seat, `Not enough for a ${g.name.toLowerCase()}.`);
      seat.money -= g.price;
      seat.gear.set(g.id, have + 1);
      return room.changed(seat);
    }
    const w = typeof msg.weapon === 'string' ? WEAPON_BY_ID.get(msg.weapon) : undefined;
    if (!w || !allowed(settings.weapons, w.id)) return room.warn(seat, "That isn't on this match's list.");
    if (seat.weapons.includes(w.id)) return room.warn(seat, 'You already have one.');
    if (seat.money < w.price) return room.warn(seat, `Not enough for a ${w.name}.`);
    seat.money -= w.price;
    // One of each kind besides the knife and the sidearm: a new rifle replaces the old one.
    seat.weapons = seat.weapons.filter((id) => (STARTING_LOADOUT as readonly string[]).includes(id) || weaponOf(id).kind !== w.kind);
    seat.weapons.push(w.id);
    seat.ammo.set(w.id, ammoFor(w));
    this.switchTo(room, seat, w.id);
    room.changed(seat);
  }

  // ---- Damage ------------------------------------------------------------------------------------

  /** Takes `damage` off `who`, and counts the elimination when it finishes them. */
  private hurt(room: Room, who: Seat, by: Seat | undefined, damage: number, part: 'head' | 'body' | 'legs', withWhat: string) {
    if (!who.alive) return;
    const friendly = !!by && by !== who && by.team === who.team;
    if (friendly && !room.settings.friendlyFire) return;
    who.health = Math.max(0, who.health - damage);
    if (by && by !== who) who.hurtBy.set(by.id, room.now());
    room.toSeat(who, { e: 'hurt', by: by?.id ?? '', damage, part, health: who.health });
    if (who.health > 0) return room.changed(who);
    room.eliminated(who, by, withWhat, part === 'head');
  }

  // ---- Grenades, and the clock ------------------------------------------------------------------

  tick(room: Room) {
    const now = room.now();
    this.smokes = this.smokes.filter((s) => s.until > now);
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.at <= now);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) this.burst(room, p);
  }

  private burst(room: Room, p: Pending) {
    const g = GEAR_BY_ID.get(p.gear)!;
    const now = room.now();
    room.toFloor({ e: 'burst', gear: p.gear, x: p.where.x, y: p.where.y, z: p.where.z });
    if (p.gear === 'smoke') {
      this.smokes.push({ x: p.where.x, y: p.where.y, z: p.where.z, until: now + g.duration * 1000 });
      return;
    }
    const by = room.seat(p.by);
    for (const s of room.seats()) {
      if (!s.alive) continue;
      const eye = eyeOf(s.pose);
      const d = Math.hypot(eye.x - p.where.x, eye.y - p.where.y, eye.z - p.where.z);
      if (d >= g.radius) continue;
      if (g.needsSight && !canSee(p.where, eye, ARENA_BOXES)) continue;
      if (p.gear === 'flash') {
        // How square on they were looking at it decides how long it takes them.
        const look = dirOf(s.pose.yaw, s.pose.pitch);
        const to = { x: p.where.x - eye.x, y: p.where.y - eye.y, z: p.where.z - eye.z };
        const len = Math.max(1e-6, Math.hypot(to.x, to.y, to.z));
        const cos = (look.x * to.x + look.y * to.y + look.z * to.z) / len;
        const blind = flashFor(g, d, Math.acos(Math.max(-1, Math.min(1, cos))));
        if (blind < 0.25) continue;
        s.blindUntil = Math.max(s.blindUntil, now + blind * 1000);
        room.toSeat(s, { e: 'blind', until: s.blindUntil });
        continue;
      }
      const damage = blastFor(g, d);
      if (damage > 0) this.hurt(room, s, by && by.id === s.id ? undefined : by, damage, 'body', g.id);
    }
  }

  clear() {
    this.pending = [];
    this.smokes = [];
  }

  /** Whether enough smoke stands between two points to stop a shot. */
  private smoked(from: Vec3, to: Vec3): boolean {
    if (!this.smokes.length) return false;
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = Math.max(1e-6, Math.hypot(d.x, d.y, d.z));
    let through = 0;
    for (const s of this.smokes) {
      const g = GEAR_BY_ID.get('smoke')!;
      const o = { x: from.x - s.x, y: from.y - s.y, z: from.z - s.z };
      const b = (o.x * d.x + o.y * d.y + o.z * d.z) / len;
      const c = o.x * o.x + o.y * o.y + o.z * o.z - g.radius * g.radius;
      const disc = b * b - c;
      if (disc <= 0) continue;
      const root = Math.sqrt(disc);
      const t0 = Math.max(0, -b - root);
      const t1 = Math.min(len, -b + root);
      if (t1 > t0) through += t1 - t0;
    }
    return through >= SMOKE_STOPS;
  }

  /** Who `seat` can hit: everyone else alive, their own side only when the match allows it. */
  private targetsFor(room: Room, seat: Seat): Target[] {
    const ff = room.settings.friendlyFire;
    return room
      .seats()
      .filter((s) => s.alive && s.id !== seat.id && (ff || s.team !== seat.team))
      .map((s) => ({ id: s.id, x: s.pose.x, y: s.pose.y, z: s.pose.z, crouching: s.pose.crouch }));
  }

  /** Who helped bring `who` down in the last few seconds, besides whoever finished them. */
  assists(room: Room, who: Seat, by: Seat | undefined): Seat[] {
    const now = room.now();
    return [...who.hurtBy]
      .filter(([id, at]) => id !== by?.id && now - at <= ASSIST_MS)
      .map(([id]) => room.seat(id))
      .filter((s): s is Seat => !!s && s.team !== who.team);
  }

  /** What a kill pays. */
  killMoney(): number {
    return MONEY_KILL;
  }

  /** What someone starts a match with. */
  startMoney(): number {
    return MONEY_START;
  }

  you(seat: Seat, inMatch: boolean): YouState {
    return {
      in: inMatch,
      team: seat.team,
      alive: seat.alive,
      health: seat.health,
      armour: seat.armour,
      weapons: [...seat.weapons],
      weapon: seat.weapon,
      ammo: Object.fromEntries([...seat.ammo].map(([id, a]) => [id, { ...a }])),
      gear: Object.fromEntries(seat.gear),
      money: seat.money,
      respawnAt: seat.respawnAt,
      ...(seat.spawnAt ? { spawn: seat.spawnAt } : {}),
      ...(seat.blindUntil ? { blindUntil: seat.blindUntil } : {}),
    };
  }

  publish(seat: Seat) {
    return { alive: seat.alive, health: seat.health };
  }
}
