import * as THREE from 'three';
import { BALCONY, GOLF_HOLE, GOLF_TEE, STREET_Y } from '../../../shared/building/layout';
import type { Collider, Interactable } from '../../world/types';
import { golfBall } from './balls';
import { BUNKERS, FAIRWAY_Z0, FRINGE, STICK } from './course';
import { MAT_H, TEE_BALL, TEE_H } from './shot';
import type { Fixture, StreetSite } from '../../world/office/fixture';
import { bulb, streetLamp, tree, type NightParts } from '../../world/outside';
import { mergeByMaterial, mesh, textPlane, toon } from '../../world/toon';

// Golf off the balcony: the tee out there (a square of turf, a ball on a tee, a bag of clubs), the
// hole across the street it's hit at (a green with a flag on it, a fairway up to it, bunkers), and
// the balls on their way. A shot is only a heading, a loft and how hard it was hit; where it goes
// from there is worked out the same way on every screen (see fly), so everyone on the floor sees the
// same ball land in the same place.

export * from './shot';
export type { Lie } from './course';
export * from './flight';
export * from './balls';

/** A square of green stripes, mown two ways, for the fairway and the tee's mat. */
function mownTexture(light: string, dark: string, stripes: number, border?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? dark : light;
    g.fillRect(0, (i * 128) / stripes, 128, 128 / stripes + 1);
  }
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 6;
    g.strokeRect(5, 5, 118, 118);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function flat(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = mesh(geo.rotateX(-Math.PI / 2), mat, x, y, z, false);
  return m;
}

export interface Tee {
  /** The ball waiting on the tee; hidden from the moment it's hit until the next one's teed up. */
  ball: THREE.Mesh;
}

/**
 * The tee on the balcony: a square of turf, a ball on a tee, a pair of tee markers along its front,
 * and a golf bag leaning on the wall behind it.
 */
export function buildTee(group: THREE.Group, colliders: Collider[], interactables: Interactable[]): Tee {
  const { x, z, size } = GOLF_TEE;
  const it: Interactable = { kind: 'golf', x, z, radius: 1.5 };
  interactables.push(it);
  const mat = new THREE.Mesh(new THREE.BoxGeometry(size, MAT_H, size), [
    toon('#3f8f45'),
    toon('#3f8f45'),
    new THREE.MeshToonMaterial({ map: mownTexture('#7ed957', '#6cc24a', 6, '#fffaf3'), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }),
    toon('#3f8f45'),
    toon('#3f8f45'),
    toon('#3f8f45'),
  ]);
  mat.position.set(x, MAT_H / 2, z);
  mat.receiveShadow = true;
  mat.userData.interact = it;
  group.add(mat);

  const parts = new THREE.Group();
  const { ball: b } = GOLF_TEE;
  parts.add(mesh(new THREE.CylinderGeometry(0.012, 0.006, TEE_H + 0.02, 8), toon('#ffd166'), b.x, MAT_H + (TEE_H + 0.02) / 2 - 0.01, b.z, false));
  // Tee markers: a red ball either side, a little in front of the ball.
  for (const s of [-1, 1]) parts.add(mesh(new THREE.SphereGeometry(0.06, 12, 8), toon('#ef476f'), b.x + s * 0.55, MAT_H + 0.05, z + size / 2 - 0.12));
  // The bag: leaning back on the wall, three clubs sticking out of the top.
  const bag = new THREE.Group();
  bag.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.85, 14), toon('#1d3557'), 0, 0.43, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.1, 14), toon('#ef476f'), 0, 0.62, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 14), toon('#fffaf3'), 0, 0.86, 0));
  for (const [cx, cz, tilt] of [
    [-0.06, 0.04, -0.12],
    [0.05, 0.05, 0.1],
    [0, -0.06, 0.02],
  ]) {
    const club = new THREE.Group();
    club.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), toon('#adb5bd'), 0, 0.25, 0, false));
    club.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), toon('#8d99ae'), 0.03, 0.52, 0));
    club.position.set(cx, 0.8, cz);
    club.rotation.z = tilt;
    bag.add(club);
  }
  bag.rotation.x = -0.14;
  bag.position.set(GOLF_TEE.bag.x, 0, GOLF_TEE.bag.z);
  parts.add(bag);
  colliders.push({ minX: GOLF_TEE.bag.x - 0.2, maxX: GOLF_TEE.bag.x + 0.2, minZ: BALCONY.minZ, maxZ: GOLF_TEE.bag.z + 0.2, top: 1 });
  const merged = mergeByMaterial(parts);
  for (const m of merged.children) m.userData.interact = it;
  group.add(merged);

  const ball = golfBall();
  ball.position.copy(TEE_BALL);
  ball.userData.interact = it;
  group.add(ball);
  return { ball };
}

export interface Green {
  /** The flag, which flaps in the wind. */
  update(t: number): void;
}

/**
 * The hole across the street, in `ground` (with its colliders): a mown fairway from the far sidewalk
 * up to a round green with the cup and the flag in it, bunkers either side, trees behind, a lamp
 * that lights it at night, and a sign.
 */
export function buildGreen(ground: THREE.Group, colliders: Collider[], night: NightParts): Green {
  const G = STREET_Y;
  const { x: px, z: pz } = GOLF_HOLE;
  const [fx0, fx1] = GOLF_HOLE.fairway;
  const fairLen = pz - FAIRWAY_Z0;
  const fairTex = mownTexture('#8fd16f', '#7fc463', 2);
  fairTex.wrapT = THREE.RepeatWrapping;
  fairTex.repeat.set(1, fairLen / 4);
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const fairway = flat(new THREE.PlaneGeometry(fx1 - fx0, fairLen), new THREE.MeshToonMaterial({ map: fairTex, gradientMap: gradient }), (fx0 + fx1) / 2, G + 0.004, FAIRWAY_Z0 + fairLen / 2);
  fairway.receiveShadow = true;
  ground.add(fairway);

  const parts = new THREE.Group();
  parts.add(flat(new THREE.CircleGeometry(GOLF_HOLE.green + FRINGE, 48), toon('#6cc24a'), px, G + 0.008, pz));
  parts.add(flat(new THREE.CircleGeometry(GOLF_HOLE.green, 48), toon('#9be07a'), px, G + 0.012, pz));
  for (const [bx, bz, r] of BUNKERS) {
    parts.add(flat(new THREE.CircleGeometry(r + 0.12, 32), toon('#d9c48a'), bx, G + 0.016, bz));
    parts.add(flat(new THREE.CircleGeometry(r, 32), toon('#f3e3b3'), bx, G + 0.02, bz));
  }
  // The cup (bigger than a real one, like the ball) with a white rim.
  parts.add(flat(new THREE.CircleGeometry(0.17, 20), toon('#fffaf3'), px, G + 0.016, pz));
  parts.add(flat(new THREE.CircleGeometry(0.13, 20), toon('#1d1d1d'), px, G + 0.02, pz));
  parts.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, STICK, 8), toon('#fffaf3'), px, G + STICK / 2, pz));
  parts.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#ffd166'), px, G + STICK + 0.03, pz));
  // Trees round the back of the green.
  for (const [tx, tz, s] of [
    [px - 9, pz + 7, 1.2],
    [px + 8.5, pz + 8, 1.05],
    [px - 1, pz + 12, 1.3],
    [px + 11, pz - 3, 0.95],
  ]) {
    const t = tree(s);
    t.position.set(tx, G, tz);
    parts.add(t);
    colliders.push({ minX: tx - 0.3 * s, maxX: tx + 0.3 * s, minZ: tz - 0.3 * s, maxZ: tz + 0.3 * s, bottom: G, top: G + 2.2 * s });
  }
  // A street lamp behind the green, reaching out over it, so the hole's there to aim at after dark.
  streetLamp(parts, night, bulb(night, '#fff3d6'), colliders, px + 1.5, pz + 6.8, -1);
  // A sign where the fairway starts, facing the office: which hole it is.
  const sx = fx1 + 1.8;
  const sz = FAIRWAY_Z0 + 0.6;
  for (const dx of [-1.1, 1.1]) {
    parts.add(mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), toon('#8a5a3b'), sx + dx, G + 0.75, sz));
    colliders.push({ minX: sx + dx - 0.08, maxX: sx + dx + 0.08, minZ: sz - 0.08, maxZ: sz + 0.08, bottom: G, top: G + 1.5 });
  }
  ground.add(mergeByMaterial(parts));
  const sign = textPlane('⛳ Hole 1 · Par 1', { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
  sign.position.set(sx, G + 1.5, sz - 0.07);
  sign.rotation.y = Math.PI;
  ground.add(sign);
  colliders.push({ minX: px - 0.05, maxX: px + 0.05, minZ: pz - 0.05, maxZ: pz + 0.05, bottom: G, top: G + STICK });

  // The flag: a red pennant off the top of the stick, rippling.
  const flagGeo = new THREE.PlaneGeometry(1.2, 0.75, 8, 1);
  flagGeo.translate(0.6, 0, 0);
  const rest = Float32Array.from(flagGeo.getAttribute('position').array);
  const flag = mesh(flagGeo, new THREE.MeshToonMaterial({ color: '#ef476f', side: THREE.DoubleSide, gradientMap: gradient }), px + 0.03, G + STICK - 0.42, pz, false);
  ground.add(flag);
  return {
    update(t: number) {
      const pos = flagGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = rest[i * 3];
        // Pinned at the stick, flapping more toward its tail, and swinging round a little in the wind.
        pos.setZ(i, Math.sin(t * 5 - u * 4) * 0.12 * u);
        pos.setY(i, rest[i * 3 + 1] - u * u * 0.06);
      }
      pos.needsUpdate = true;
      flagGeo.computeVertexNormals();
      flag.rotation.y = -0.5 + Math.sin(t * 0.7) * 0.25;
    },
  };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The golf tee on the balcony, and the hole across the street it's hit at. */
    tee: Tee;
    green: Green;
  }
}

/** The golf tee, out on the balcony. */
export const tee: Fixture<'tee'> = (site) => ({ handle: { tee: buildTee(site.group, site.colliders, site.interactables) } });

/** The green across the street, with the hole the tee's shots are hit at. */
export const green: Fixture<'green', StreetSite> = (site) => {
  const built = buildGreen(site.ground, site.groundColliders, site.get('night'));
  return { handle: { green: built }, update: (t) => built.update(t) };
};

