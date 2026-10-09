// The arena the first game is played in, as plain boxes: the browser builds it and bumps into it, and
// the office shoots rays through it to see what a shot hit. Both go by exactly these numbers, so a
// shot the page drew and the one the office counted are the same shot.
//
// It stands well clear of the city (ARENA_SITE), sealed, with a lobby room at one end behind glass:
// you walk in through the lounge door, and whoever isn't playing watches the match from there.

import type { TeamId } from '../games.js';

/** Where the arena is built, in the office floor's own frame: far out past everything else. */
export const ARENA_SITE = { x: 700, y: 0, z: 0 } as const;

/** A box of the arena: a wall, a crate, a pillar. `y` is its underside, `top` what you stand on. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  top: number;
  /** What it's made of, for the browser to paint it (see world.ts). */
  look?: 'wall' | 'crate' | 'pillar' | 'glass' | 'floor';
}

/** The arena floor, in the site's own frame. */
export const PITCH = { minX: -22, maxX: 22, minZ: -16, maxZ: 16 } as const;
/**
 * The lobby you arrive in, behind the glass at the pitch's south end: nobody is shot at in here, and
 * whoever isn't playing watches the match through it. It shares that wall with the pitch.
 */
export const LOBBY = { minX: -10, maxX: 10, minZ: PITCH.maxZ, maxZ: 28 } as const;
/** How high the arena's walls are, and the lobby's. */
export const WALL_H = 7;
const T = 0.6;

/** The door back to the office, in the lobby's far wall. */
export const EXIT_DOOR = { x: 0, z: LOBBY.maxZ, width: 1.8, height: 2.4 } as const;
/** Where you arrive in the lobby, facing the arena. */
export const ARRIVE = { x: 0, z: LOBBY.maxZ - 2.2, rotY: Math.PI } as const;
/** The board on the lobby wall that shows the match (see lobby board in world.ts). */
export const LOBBY_BOARD = { x: -7.4, z: LOBBY.maxZ - 0.35, y: 2.1, width: 4.4, height: 2.2 } as const;

/** A wall from (x0, z0) to (x1, z1), `T` thick, floor to `top`. */
function wall(x0: number, z0: number, x1: number, z1: number, top = WALL_H, look: Box['look'] = 'wall'): Box {
  return { minX: Math.min(x0, x1) - T / 2, maxX: Math.max(x0, x1) + T / 2, minZ: Math.min(z0, z1) - T / 2, maxZ: Math.max(z0, z1) + T / 2, y: 0, top, look };
}

/** A crate `w` by `d` at (x, z), `h` high, standing on `y`. */
function crate(x: number, z: number, w: number, d: number, h: number, y = 0, look: Box['look'] = 'crate'): Box {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y, top: y + h, look };
}

/** The same box mirrored across x, for an arena that plays the same from either end. */
const mirrored = (b: Box): Box => ({ ...b, minX: -b.maxX, maxX: -b.minX });

/** The cover in one half of the arena (the -x half): crates, pillars and a long centre block. */
const HALF: readonly Box[] = [
  // Clear of the spawn spots, which look straight down the arena.
  crate(-15.4, -12.1, 2.6, 1.6, 1.3),
  crate(-15.4, -6.6, 2.2, 2.2, 2.4),
  crate(-13.4, 2.8, 3.2, 2.2, 1.3),
  crate(-13.4, 2.8, 1.4, 1.4, 2.2),
  crate(-9, -12.2, 4.4, 2.2, 2.6),
  crate(-8.2, 8.6, 2.6, 4.6, 1.4),
  crate(-6, -3.4, 1.1, 1.1, 3.4, 0, 'pillar'),
  crate(-6, 3.4, 1.1, 1.1, 3.4, 0, 'pillar'),
  crate(-4.4, 12.6, 3.6, 2.2, 1.3),
  // Two stretches of wall across the half, with a gap down the middle to push through.
  wall(-11.6, -7.4, -11.6, -2.4, 3),
  wall(-11.6, 2.4, -11.6, 7.4, 3),
];

/** Everything solid in the arena, both halves and the shell round them. */
export const ARENA_BOXES: readonly Box[] = [
  // The shell: four walls round the pitch, head height and more. The south one is in three pieces,
  // with the lobby's glass down the middle of it: it stops a bullet like the rest, and you see through it.
  wall(PITCH.minX, PITCH.minZ, PITCH.maxX, PITCH.minZ),
  wall(PITCH.minX, PITCH.maxZ, LOBBY.minX, PITCH.maxZ),
  wall(LOBBY.maxX, PITCH.maxZ, PITCH.maxX, PITCH.maxZ),
  wall(LOBBY.minX, PITCH.maxZ, LOBBY.maxX, PITCH.maxZ, WALL_H, 'glass'),
  wall(PITCH.minX, PITCH.minZ, PITCH.minX, PITCH.maxZ),
  wall(PITCH.maxX, PITCH.minZ, PITCH.maxX, PITCH.maxZ),
  // The middle block, which both halves fight round.
  crate(0, 0, 5.2, 5.2, 2.8),
  crate(0, -8.4, 2.2, 2.2, 1.4),
  crate(0, 8.4, 2.2, 2.2, 1.4),
  ...HALF,
  ...HALF.map(mirrored),
  // The lobby behind it: its own three walls (the glass above is its fourth).
  wall(LOBBY.minX, LOBBY.maxZ, LOBBY.maxX, LOBBY.maxZ),
  wall(LOBBY.minX, LOBBY.minZ, LOBBY.minX, LOBBY.maxZ),
  wall(LOBBY.maxX, LOBBY.minZ, LOBBY.maxX, LOBBY.maxZ),
];

/** Where each team comes in, one spot a player, spread down their end. */
const spawnsFor = (x: number, rotY: number) => [-9, -4.5, 0, 4.5, 9].map((z) => ({ x, z, rotY }));
export const SPAWNS: Record<TeamId, readonly { x: number; z: number; rotY: number }[]> = {
  a: spawnsFor(-19, Math.PI / 2),
  b: spawnsFor(19, -Math.PI / 2),
};

/** Where player `n` of `team` comes in; they wrap round when a team is bigger than the arena's spots. */
export function spawnOf(team: TeamId, n: number) {
  const list = SPAWNS[team];
  return list[((n % list.length) + list.length) % list.length];
}

/** Whether (x, z) is inside the arena proper, where the shooting happens. */
export function inPitch(x: number, z: number): boolean {
  return x > PITCH.minX && x < PITCH.maxX && z > PITCH.minZ && z < PITCH.maxZ;
}

/** Whether (x, z) is in the lobby, where nobody is shot at. */
export function inLobby(x: number, z: number): boolean {
  return x > LOBBY.minX && x < LOBBY.maxX && z > LOBBY.minZ && z < LOBBY.maxZ;
}
