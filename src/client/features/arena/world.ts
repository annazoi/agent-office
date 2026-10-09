import * as THREE from 'three';
import { FLOOR, WALL_T } from '../../../shared/building/layout';
import { ARENA_SITE, ARRIVE, ARENA_BOXES, EXIT_DOOR, LOBBY, LOBBY_BOARD, PITCH, SPAWNS, WALL_H, type Box } from '../../../shared/games/fps/arena';
import { FPS } from '../../../shared/games/games';
import { mesh, mergeByMaterial, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The gaming room: a shutter in the office's north wall, and the arena itself, built far enough out
// past the city that nothing of the office is in it. You walk through the shutter into the arena's
// lobby, watch the match through the glass, and join it from there if you want to.
//
// The boxes are the ones in shared/games/fps/arena.ts, which is also what the office shoots its rays
// through: what you bump into here and what stops a bullet there are the same numbers.

/**
 * Where the shutter stands: the stretch of the lounge's east wall between the Services board (which
 * ends at z -5.2) and the TV (which starts at -3.2), across from the arcade corner. It faces into the
 * room (-x), so you walk up to it from the lounge.
 */
export const DOOR = { x: FLOOR.maxX - 0.06, z: -4.2, width: 1.6, height: 2.4 } as const;

export interface ArenaWorld {
  group: THREE.Group;
  /** Where the office's shutter puts you down in the arena's lobby. */
  arriveAt: { x: number; y: number; z: number; rotY: number };
  /** Where the arena's way out puts you back in the office. */
  backAt: { x: number; y: number; z: number; rotY: number };
  /** Whether (x, z) is anywhere in the gaming room (the lobby or the arena). */
  inside(x: number, z: number): boolean;
  /** The room the camera keeps to while you're in there. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The lights over the pitch, turned up while a round is live. */
  setLive(live: boolean): void;
}

declare module '../../world/types' {
  interface InteractKinds {
    /** The shutter in the office that opens onto the gaming room. */
    arena: true;
    /** The way back out, inside the arena's lobby. */
    arenaExit: true;
    /** The board in the lobby that opens the match. */
    arenaBoard: true;
  }
  interface OfficeHandles {
    arena: ArenaWorld;
  }
}

const CONCRETE = '#6f7378';
const DARK = '#3b3f45';
const CRATE = '#b5793a';
const LINE = '#f4c95d';

/**
 * The arena is sealed and lit by its own strip lights, so its surfaces carry their own light: the
 * office's sun and lamps never reach out here, and a match at midnight has to play like one at noon.
 */
const lit = (color: string, amount = 0.62) => toon(color, { emissive: new THREE.Color(color).multiplyScalar(amount) });

/** A box of the arena, in the site's own frame, as something to look at. */
function boxMesh(b: Box, mats: Record<string, THREE.Material>): THREE.Mesh {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const h = Math.max(0.02, b.top - b.y);
  const m = mesh(new THREE.BoxGeometry(w, h, d), mats[b.look ?? 'wall'] ?? mats.wall, (b.minX + b.maxX) / 2, b.y + h / 2, (b.minZ + b.maxZ) / 2);
  return m;
}

/** A box turned into something you bump into, moved out to the site. */
function boxCollider(b: Box): Collider {
  return { minX: b.minX + ARENA_SITE.x, maxX: b.maxX + ARENA_SITE.x, minZ: b.minZ + ARENA_SITE.z, maxZ: b.maxZ + ARENA_SITE.z, top: b.top, bottom: b.y || undefined };
}

/** The steel shutter in the office's north wall, with the game's name lit over it. */
function shutter(): THREE.Group {
  const g = new THREE.Group();
  const steel = toon('#8d939b');
  const frame = toon('#454a52');
  g.add(mesh(new THREE.BoxGeometry(DOOR.width + 0.4, DOOR.height + 0.3, 0.16), frame, 0, (DOOR.height + 0.3) / 2, 0));
  // The slatted shutter itself, a little proud of the frame.
  for (let i = 0; i < 9; i++) {
    const h = DOOR.height / 9;
    g.add(mesh(new THREE.BoxGeometry(DOOR.width, h * 0.86, 0.1), steel, 0, h * (i + 0.5), 0.1));
  }
  const sign = textPlane(`${FPS.emoji} ${FPS.name.toUpperCase()} ARENA`, { color: '#0d0f12', bg: LINE, size: 48 });
  sign.position.set(0, DOOR.height + 0.46, 0.14);
  g.add(sign);
  const lamp = mesh(new THREE.BoxGeometry(DOOR.width * 0.8, 0.07, 0.07), toon('#ffdf6b', { emissive: '#ffb703' }), 0, DOOR.height + 0.2, 0.2);
  g.add(lamp);
  return g;
}

/** A pad on the floor in a side's colors, where its players come in. */
function spawnPad(color: string): THREE.Mesh {
  const pad = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.04, 20), toon(color, { emissive: color, transparent: true, opacity: 0.75 }), 0, 0.02, 0, false);
  return pad;
}

/** The arena, built once, far out past the city. */
function buildArena(): { group: THREE.Group; setLive(live: boolean): void; board: THREE.Object3D; out: THREE.Object3D } {
  const group = new THREE.Group();
  group.position.set(ARENA_SITE.x, ARENA_SITE.y, ARENA_SITE.z);
  const mats: Record<string, THREE.Material> = {
    wall: lit(CONCRETE, 0.66),
    crate: lit(CRATE, 0.66),
    pillar: lit(DARK, 0.7),
    glass: toon('#9fd8ff', { emissive: '#2c4257', transparent: true, opacity: 0.22 }),
    floor: lit('#55595e', 0.6),
  };

  // The ground, under the pitch and the lobby both, and a dark ceiling over each.
  const slab = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, y: number, mat: THREE.Material) =>
    mesh(new THREE.BoxGeometry(a.maxX - a.minX + 1.2, 0.2, a.maxZ - a.minZ + 1.2), mat, (a.minX + a.maxX) / 2, y, (a.minZ + a.maxZ) / 2, false);
  const concrete = lit('#4b4f55', 0.62);
  group.add(slab(PITCH, -0.1, concrete), slab(LOBBY, -0.1, concrete));
  group.add(slab(PITCH, WALL_H + 0.1, lit('#2a2d31', 0.5)), slab(LOBBY, WALL_H + 0.1, lit('#2a2d31', 0.5)));

  // Everything solid, merged down to one draw per material.
  const solids = new THREE.Group();
  for (const b of ARENA_BOXES) solids.add(boxMesh(b, mats));
  group.add(mergeByMaterial(solids));

  // A line down the middle, and a pad at each side's spots.
  group.add(mesh(new THREE.BoxGeometry(0.12, 0.02, PITCH.maxZ - PITCH.minZ), toon(LINE, { emissive: LINE }), 0, 0.01, 0, false));
  for (const team of FPS.teams) {
    for (const s of SPAWNS[team.id]) {
      const pad = spawnPad(team.color);
      pad.position.set(s.x, 0.02, s.z);
      group.add(pad);
    }
  }

  // The strip lights over the pitch: low while nothing is on, up while a round is live.
  const tube = toon('#ffffff', { emissive: '#bcd4ff' });
  const strips: THREE.Mesh[] = [];
  for (const x of [-15, -5, 5, 15]) {
    const strip = mesh(new THREE.BoxGeometry(0.4, 0.12, PITCH.maxZ - PITCH.minZ - 4), tube, x, WALL_H - 0.3, 0, false);
    strips.push(strip);
    group.add(strip);
  }

  // The lobby: a board on the back wall, and the way out beside it.
  const board = mesh(new THREE.BoxGeometry(LOBBY_BOARD.width, LOBBY_BOARD.height, 0.1), lit('#1b1f26', 0.8), LOBBY_BOARD.x, LOBBY_BOARD.y, LOBBY_BOARD.z - 0.3);
  group.add(board);
  const title = textPlane(`${FPS.emoji} ${FPS.name}`, { color: LINE, size: 72 });
  title.position.set(LOBBY_BOARD.x, LOBBY_BOARD.y + 0.5, LOBBY_BOARD.z - 0.24);
  title.rotation.y = Math.PI;
  group.add(title);
  const blurb = textPlane('Press E at the board for the lobby', { color: '#d7dce4', size: 40 });
  blurb.position.set(LOBBY_BOARD.x, LOBBY_BOARD.y - 0.35, LOBBY_BOARD.z - 0.24);
  blurb.rotation.y = Math.PI;
  group.add(blurb);
  const out = mesh(new THREE.BoxGeometry(EXIT_DOOR.width, EXIT_DOOR.height, 0.12), lit('#2f7d55', 0.6), EXIT_DOOR.x, EXIT_DOOR.height / 2, EXIT_DOOR.z - 0.34);
  group.add(out);
  const outSign = textPlane('← Back to the office', { color: '#eafff3', size: 40 });
  outSign.position.set(EXIT_DOOR.x, EXIT_DOOR.height + 0.3, EXIT_DOOR.z - 0.3);
  outSign.rotation.y = Math.PI;
  group.add(outSign);

  const setLive = (live: boolean) => {
    for (const s of strips) (s.material as THREE.MeshToonMaterial).emissive.set(live ? '#eaf2ff' : '#52607a');
  };
  setLive(false);
  return { group, setLive, board, out };
}

/** The gaming room: the shutter in the office, and the arena it opens onto. */
export const arena: Fixture<'arena'> = (site) => {
  const group = new THREE.Group();
  const door = shutter();
  door.position.set(DOOR.x, 0, DOOR.z);
  door.rotation.y = -Math.PI / 2;
  group.add(door);
  site.wall('east', DOOR.z, DOOR.height / 2, DOOR.width + 0.4, DOOR.height + 0.3);

  const built = buildArena();
  group.add(built.group);

  const colliders: Collider[] = [
    // The floor of the whole place, so you stand on it rather than falling to the street.
    { minX: PITCH.minX + ARENA_SITE.x - 1, maxX: PITCH.maxX + ARENA_SITE.x + 1, minZ: PITCH.minZ + ARENA_SITE.z - 1, maxZ: LOBBY.maxZ + ARENA_SITE.z + 1, top: 0 },
    ...ARENA_BOXES.map(boxCollider),
  ];

  const [shutterUse, exitUse, boardUse]: Interactable[] = [
    { kind: 'arena', x: DOOR.x - 1.2, z: DOOR.z, radius: 2.6 },
    { kind: 'arenaExit', x: EXIT_DOOR.x + ARENA_SITE.x, z: EXIT_DOOR.z + ARENA_SITE.z - 0.5, radius: 1.2 },
    { kind: 'arenaBoard', x: LOBBY_BOARD.x + ARENA_SITE.x, z: LOBBY_BOARD.z + ARENA_SITE.z - 0.5, radius: 1.6 },
  ];
  // What the crosshair lands on has to carry the thing it uses (see aimedAt in input/pointer.ts).
  door.userData.interact = shutterUse;
  built.out.userData.interact = exitUse;
  built.board.userData.interact = boardUse;
  const interactables: Interactable[] = [shutterUse, exitUse, boardUse];

  const bounds = { minX: PITCH.minX + ARENA_SITE.x, maxX: PITCH.maxX + ARENA_SITE.x, minZ: PITCH.minZ + ARENA_SITE.z, maxZ: LOBBY.maxZ + ARENA_SITE.z };
  const handle: ArenaWorld = {
    group: built.group,
    arriveAt: { x: ARRIVE.x + ARENA_SITE.x, y: 0, z: ARRIVE.z + ARENA_SITE.z, rotY: ARRIVE.rotY },
    backAt: { x: DOOR.x - 1.6, y: 0, z: DOOR.z, rotY: -Math.PI / 2 },
    inside: (x, z) => x > bounds.minX - 2 && x < bounds.maxX + 2 && z > bounds.minZ - 2 && z < bounds.maxZ + 2,
    bounds,
    setLive: built.setLive,
  };

  return { handle: { arena: handle }, group, colliders, interactables };
};

/** The office's own wall, for anything that needs to know the shutter isn't a hole in it. */
export const DOOR_WALL_T = WALL_T;
