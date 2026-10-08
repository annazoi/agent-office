import { BALCONY, DESKS, DESK_SIZE, EXIT_STAIRS, FLOOR, PLANTS, STREET_Y, WINDOWS } from '../../../shared/building/layout';

export const G = STREET_Y;

/** Somewhere to put something: its foot at (x, y, z), `r` its size, turned so its front (+z) faces `rotY`. */
export type Spot = [x: number, y: number, z: number, r: number, rotY: number];

export const FACE = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 } as const;

/** A point `lx` along and `lz` out from a desk's middle, in its own frame (see DeskDef.rotY). */
function onDesk(d: { x: number; z: number; rotY: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return [d.x + lx * c + lz * s, d.z - lx * s + lz * c];
}

/** On every desk, in the back corner its own knick-knack leaves free (see buildDesk), facing whoever sits there. */
export const DESK_SPOTS: Spot[] = DESKS.map((d, i) => {
  const [x, z] = onDesk(d, i % 3 === 1 ? 0.78 : -0.78, -0.28);
  return [x, DESK_SIZE.height, z, 0.12, d.rotY];
});

/** Jack-o'-lanterns: everywhere. */
export function pumpkinSpots(): Spot[] {
  const spots: Spot[] = [...DESK_SPOTS];
  // The kitchen counter, and the lounge's coffee table.
  spots.push([-13, 1.03, 12.2, 0.14, FACE.north], [-16.65, 1.03, 12.25, 0.11, FACE.north], [13, 0.46, 0.25, 0.17, FACE.west]);
  // On the window sills, looking in.
  for (const o of WINDOWS) {
    if (o.y0 > 2) continue;
    if (o.wall === 'south') spots.push([o.u - 0.85, o.y0, FLOOR.maxZ - 0.08, 0.1, FACE.north]);
    if (o.wall === 'west') spots.push([FLOOR.minX + 0.08, o.y0, o.u + 0.85, 0.1, FACE.east]);
  }
  // Beside every potted plant, toward the middle of the room.
  for (const [x, z, s] of PLANTS) {
    const d = Math.hypot(x, z) || 1;
    spots.push([x - (x / d) * 0.55 * s, 0, z - (z / d) * 0.55 * s, 0.2 * s, Math.atan2(-x, -z)]);
  }
  // Under the TV, beside the elevator, out on the balcony and on the landing outside the exit.
  spots.push([17.55, 0, -2.4, 0.22, FACE.west], [17.6, 0, 2.3, 0.17, FACE.west], [10.35, 0, FLOOR.minZ + 0.4, 0.22, FACE.south]);
  for (const x of [-9.3, -5.8, -2.2, 1.4]) spots.push([x, 1.105, BALCONY.maxZ - 0.06, 0.13, FACE.north]);
  // (Only the south-east corner: the south-west one has the balcony's potted plant.)
  spots.push([BALCONY.maxX - 0.4, 0, BALCONY.maxZ - 0.4, 0.2, FACE.north]);
  spots.push([EXIT_STAIRS.minX + 0.3, 0, EXIT_STAIRS.landingZ0 + 0.25, 0.17, FACE.south]);
  // Down the street, at the foot of every lamp (see buildStreet), facing the office.
  for (const x of [-40, -28, -16, -4, 8, 16, 28, 40]) spots.push([x + 0.6, G + 0.04, 21.7, 0.3, FACE.north]);
  for (const x of [-34, -22, -4, 8, 26, 36]) spots.push([x + 0.6, G + 0.04, 32.3, 0.3, FACE.north]);
  // Heaps of them out front, either side of the garage, and at the balcony's posts.
  for (const sx of [-1, 1]) {
    spots.push([sx * 17.2, G, 19.2, 0.55, FACE.north], [sx * 18.3, G, 19.6, 0.38, FACE.north + sx * 0.4], [sx * 16.3, G, 19.9, 0.3, FACE.north - sx * 0.3]);
  }
  spots.push([BALCONY.minX + 0.75, G, BALCONY.maxZ - 0.2, 0.36, FACE.south], [BALCONY.maxX - 0.75, G, BALCONY.maxZ - 0.2, 0.36, FACE.south]);
  // Among the graves.
  spots.push([-22.4, G, -2.2, 0.32, FACE.east], [-22.6, G, 4.6, 0.26, FACE.east], [-24.6, G, 1.3, 0.3, FACE.east]);
  return spots;
}

/** Where the gravestones stand, on the lawn west of the office, facing its windows. */
export const GRAVES: [x: number, z: number, kind: number][] = [
  [-23.2, -3.4, 0],
  [-23.4, -0.4, 1],
  [-23.1, 2.8, 2],
  [-23.3, 6, 0],
  [-25.8, -1.8, 2],
  [-25.9, 1.4, 1],
  [-25.7, 4.5, 0],
];

/** Where the snowmen stand, out front and round the side. */
export const SNOWMEN: [x: number, z: number, rotY: number][] = [
  [-14, 18.6, 0.2],
  [13, 19.2, -0.3],
  [25.5, 6, -Math.PI / 2 + 0.3],
  [-23.5, 2, Math.PI / 2],
];

/** The big tree out front, on the lot by the sidewalk. */
export const BIG_TREE = { x: -24, z: 17, height: 7.5 } as const;
