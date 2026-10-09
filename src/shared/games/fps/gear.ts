// What you throw: smoke, a flashbang, a frag. Each is a row here and a handful of numbers; the office
// flies every throw itself and tells everyone where it burst, so nobody's page decides who was blinded.

export const GEAR_IDS = ['smoke', 'flash', 'frag'] as const;
export type GearId = (typeof GEAR_IDS)[number];

export interface Gear {
  id: GearId;
  name: string;
  emoji: string;
  blurb: string;
  /** How many of it you carry into a round. */
  carried: number;
  price: number;
  /** Seconds from the throw to the burst. */
  fuse: number;
  /** How far its effect reaches, in meters. */
  radius: number;
  /** How long the effect lasts once it bursts. */
  duration: number;
  /** A frag's damage at the middle of the burst; nothing for the others. */
  damage: number;
  /** How hard it's thrown, in m/s. */
  speed: number;
  /** How quickly you can throw another, in seconds. */
  cooldown: number;
  /** Whether a wall between you and the burst saves you from it. */
  needsSight: boolean;
}

export const GEAR: readonly Gear[] = [
  { id: 'smoke', name: 'Smoke', emoji: '💨', blurb: 'A cloud nobody sees through, for twenty seconds.', carried: 1, price: 300, fuse: 1.6, radius: 4.6, duration: 20, damage: 0, speed: 17, cooldown: 1.2, needsSight: false },
  { id: 'flash', name: 'Flashbang', emoji: '✨', blurb: 'Blinds whoever is looking at it, for as long as they were.', carried: 2, price: 250, fuse: 1.5, radius: 11, duration: 3.4, damage: 0, speed: 19, cooldown: 1.2, needsSight: true },
  { id: 'frag', name: 'Frag', emoji: '💥', blurb: 'Hurts anyone near it, through nothing.', carried: 1, price: 400, fuse: 2.4, radius: 6, duration: 0.4, damage: 92, speed: 17, cooldown: 1.2, needsSight: true },
];

export const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

export function isGear(v: unknown): v is GearId {
  return typeof v === 'string' && GEAR_BY_ID.has(v as GearId);
}

/** How much a frag at `distance` takes off, nothing past its radius. */
export function blastFor(g: Gear, distance: number): number {
  if (!g.damage || distance >= g.radius) return 0;
  return Math.max(1, Math.round(g.damage * (1 - distance / g.radius) ** 1.4));
}

/**
 * How long a flash blinds someone `distance` away who was looking `angle` radians off it: full in the
 * face up close, nothing at all with their back turned or out of range.
 */
export function flashFor(g: Gear, distance: number, angle: number): number {
  if (distance >= g.radius || angle > Math.PI * 0.7) return 0;
  const near = 1 - distance / g.radius;
  const facing = Math.max(0, 1 - angle / (Math.PI * 0.7));
  return g.duration * near * facing ** 0.7;
}

/** Armour, the one thing in the buy menu that isn't thrown or fired. */
export const ARMOUR_PRICE = 650;
