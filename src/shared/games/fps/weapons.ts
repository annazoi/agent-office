// The guns, as numbers both sides go by: the page draws the shot and the recoil from these, and the
// office works out the damage from the same ones, so nothing a browser says about its own gun is
// taken on trust. A new gun is a row here and nothing else.

/** What a gun is: the categories the buy menu groups them under. */
export const WEAPON_KINDS = ['melee', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'heavy'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

/** How a gun is aimed when you hold the right button: nothing, down the irons, a dot, or a scope. */
export type SightKind = 'none' | 'iron' | 'dot' | 'scope';

export interface Weapon {
  id: string;
  name: string;
  kind: WeaponKind;
  emoji: string;
  /** Damage to the body at point blank, before the hit's part of the body and the range are counted. */
  damage: number;
  /** Shots a minute. */
  rpm: number;
  /** Pellets a shot (a shotgun's spread); one for everything else. */
  pellets: number;
  mag: number;
  /** Rounds you carry besides the magazine. */
  spare: number;
  reload: number;
  /** How far the sights climb per shot (radians), and how wide the shot can stray standing still. */
  recoil: number;
  spread: number;
  /** How much wider it strays at a run, and crouching (a multiplier on `spread`). */
  moveSpread: number;
  crouchSpread: number;
  /** Full damage out to `range` meters, tailing off to half at twice that. */
  range: number;
  sight: SightKind;
  /** What the sight does to the field of view, as a fraction of the usual one. */
  zoom: readonly number[];
  /** How fast you walk holding it, against the office's usual pace. */
  weight: number;
  /** What it costs at the start of a round, when the match has a buy menu. */
  price: number;
  /** Hold the trigger down for more than one shot. */
  auto: boolean;
  /** Headshots do this much more. */
  headshot: number;
}

const W = (w: Weapon) => w;

export const WEAPONS: readonly Weapon[] = [
  W({ id: 'knife', name: 'Knife', kind: 'melee', emoji: '🔪', damage: 55, rpm: 110, pellets: 1, mag: Infinity, spare: 0, reload: 0, recoil: 0, spread: 0, moveSpread: 1, crouchSpread: 1, range: 2, sight: 'none', zoom: [], weight: 1.08, price: 0, auto: false, headshot: 2 }),
  W({ id: 'sidearm', name: 'P-9 Sidearm', kind: 'pistol', emoji: '🔫', damage: 26, rpm: 400, pellets: 1, mag: 15, spare: 60, reload: 1.5, recoil: 0.014, spread: 0.006, moveSpread: 3, crouchSpread: 0.6, range: 22, sight: 'iron', zoom: [0.8], weight: 1.04, price: 0, auto: false, headshot: 3.4 }),
  W({ id: 'magnum', name: 'Magnum', kind: 'pistol', emoji: '🔫', damage: 48, rpm: 220, pellets: 1, mag: 7, spare: 28, reload: 2, recoil: 0.034, spread: 0.008, moveSpread: 3.4, crouchSpread: 0.55, range: 26, sight: 'iron', zoom: [0.8], weight: 1.02, price: 700, auto: false, headshot: 3.2 }),
  W({ id: 'smg', name: 'Vector SMG', kind: 'smg', emoji: '🔫', damage: 22, rpm: 850, pellets: 1, mag: 30, spare: 90, reload: 2.1, recoil: 0.011, spread: 0.011, moveSpread: 1.7, crouchSpread: 0.7, range: 18, sight: 'dot', zoom: [0.72], weight: 1.0, price: 1200, auto: true, headshot: 2.6 }),
  W({ id: 'rifle', name: 'AR-15 Rifle', kind: 'rifle', emoji: '🔫', damage: 33, rpm: 620, pellets: 1, mag: 30, spare: 90, reload: 2.4, recoil: 0.018, spread: 0.008, moveSpread: 3.2, crouchSpread: 0.5, range: 34, sight: 'dot', zoom: [0.7], weight: 0.94, price: 2700, auto: true, headshot: 3.2 }),
  W({ id: 'bullpup', name: 'Bullpup', kind: 'rifle', emoji: '🔫', damage: 29, rpm: 700, pellets: 1, mag: 25, spare: 75, reload: 2.2, recoil: 0.015, spread: 0.009, moveSpread: 2.8, crouchSpread: 0.55, range: 30, sight: 'iron', zoom: [0.78], weight: 0.96, price: 2100, auto: true, headshot: 3 }),
  W({ id: 'shotgun', name: 'Breacher', kind: 'shotgun', emoji: '🔫', damage: 13, rpm: 90, pellets: 9, mag: 7, spare: 28, reload: 3.1, recoil: 0.07, spread: 0.055, moveSpread: 1.4, crouchSpread: 0.8, range: 9, sight: 'none', zoom: [], weight: 0.92, price: 1800, auto: false, headshot: 2 }),
  W({ id: 'sniper', name: 'Longshot', kind: 'sniper', emoji: '🎯', damage: 110, rpm: 45, pellets: 1, mag: 5, spare: 20, reload: 3.4, recoil: 0.09, spread: 0.03, moveSpread: 8, crouchSpread: 0.12, range: 60, sight: 'scope', zoom: [0.28, 0.12], weight: 0.84, price: 4200, auto: false, headshot: 2.2 }),
  W({ id: 'lmg', name: 'Mule LMG', kind: 'heavy', emoji: '🔫', damage: 30, rpm: 720, pellets: 1, mag: 80, spare: 160, reload: 5.2, recoil: 0.021, spread: 0.016, moveSpread: 3, crouchSpread: 0.45, range: 30, sight: 'iron', zoom: [0.76], weight: 0.78, price: 4600, auto: true, headshot: 2.6 }),
];

export const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

export function isWeapon(v: unknown): v is string {
  return typeof v === 'string' && WEAPON_BY_ID.has(v);
}

/** The gun `id`, or the sidearm when it's nothing the office knows. */
export function weaponOf(id: string | undefined): Weapon {
  return (id && WEAPON_BY_ID.get(id)) || WEAPON_BY_ID.get('sidearm')!;
}

/** What everyone starts a round with, whatever the match lets them buy. */
export const STARTING_LOADOUT = ['knife', 'sidearm'] as const;

/** The shortest a shot can follow the one before it, in ms. */
export const fireEvery = (w: Weapon): number => 60_000 / w.rpm;

/** Where a shot landed on someone (see damageFor). */
export type HitPart = 'head' | 'body' | 'legs';

/**
 * What a hit takes off: the gun's damage for the part of the body it hit, tailing off past its range
 * (full damage to `range`, half at twice that, and a tenth beyond), and halved by armour on the body.
 */
export function damageFor(w: Weapon, part: HitPart, distance: number, armour: boolean): number {
  const falloff = distance <= w.range ? 1 : Math.max(0.1, 1 - (distance - w.range) / (2 * w.range));
  const part_ = part === 'head' ? w.headshot : part === 'legs' ? 0.75 : 1;
  const armoured = armour && part !== 'legs' ? 0.55 : 1;
  return Math.max(1, Math.round(w.damage * part_ * falloff * armoured));
}

/** How wide a shot strays for someone moving at `speed` m/s, crouched or not, with the sights up or not. */
export function spreadFor(w: Weapon, speed: number, crouching: boolean, aiming: boolean): number {
  const moving = 1 + (w.moveSpread - 1) * Math.min(1, speed / 5);
  return w.spread * moving * (crouching ? w.crouchSpread : 1) * (aiming && w.sight !== 'none' ? 0.35 : 1);
}
