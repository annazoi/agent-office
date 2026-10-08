import * as THREE from 'three';
import { AXE_LANE } from '../../../shared/toys/bargames';
import { FLOOR, ROOF_TABLES, SEATING_BY_ID, FIRE_PIT } from '../../../shared/building/layout';
import type { Collider, Interactable } from '../../world/types';
import { bulb, type NightParts } from '../../world/outside';
import { mesh, roundedBox, toon } from '../../world/toon';
import { INK, boxCollider, seatable } from './helpers';

/** What a part of the rooftop adds its pieces to. */
export interface RoofParts {
  group: THREE.Group;
  /** The parts that never move, merged into a few meshes by the rooftop once everything's in. */
  statics: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
}

export interface Lounge {
  /** The fire pit's flames, which flicker. */
  flames: THREE.Mesh[];
  fireLight: THREE.PointLight;
  /** The air conditioning's fans, which turn. */
  fans: THREE.Group[];
}

/**
 * The lounge: sofas round a fire pit, sun loungers along the south edge, tall tables to stand at
 * with a candle each, planters along the edges, and the air conditioning behind a screen.
 */
export function buildLounge(night: NightParts, { group, statics, colliders, interactables }: RoofParts): Lounge {
  const cushion = toon('#2a9d8f');
  const frame = toon('#f4f1ea');
  const sofa = (id: string, len: number) => {
    const s = SEATING_BY_ID.get(id)!;
    const g = new THREE.Group();
    g.add(mesh(roundedBox(len, 0.3, 0.9, 0.08), frame, 0, 0.15, 0));
    g.add(mesh(roundedBox(len - 0.1, 0.16, 0.8, 0.08), cushion, 0, 0.38, 0.03));
    g.add(mesh(roundedBox(len, 0.5, 0.2, 0.08), cushion, 0, 0.6, -0.36));
    for (const sx of [-1, 1]) g.add(mesh(roundedBox(0.16, 0.5, 0.9, 0.06), frame, sx * (len / 2 - 0.08), 0.35, 0));
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.rotY;
    seatable(g, id, 1.6, interactables);
    group.add(g);
    colliders.push(boxCollider(s.x, s.z, len, 0.9, s.rotY, 0.5));
  };
  sofa('roof-sofa-1', 3.4);
  sofa('roof-sofa-2', 2.2);
  sofa('roof-sofa-3', 2.2);
  statics.add(mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.01, 40), toon('#f2cc8f'), FIRE_PIT.x, 0.006, FIRE_PIT.z + 0.3, false));
  statics.add(mesh(new THREE.CylinderGeometry(FIRE_PIT.r, FIRE_PIT.r + 0.05, 0.42, 20), toon('#8d99ae'), FIRE_PIT.x, 0.21, FIRE_PIT.z));
  statics.add(mesh(new THREE.CylinderGeometry(FIRE_PIT.r - 0.12, FIRE_PIT.r - 0.12, 0.02, 20), toon('#3d405b'), FIRE_PIT.x, 0.43, FIRE_PIT.z, false));
  colliders.push({ minX: FIRE_PIT.x - FIRE_PIT.r, maxX: FIRE_PIT.x + FIRE_PIT.r, minZ: FIRE_PIT.z - FIRE_PIT.r, maxZ: FIRE_PIT.z + FIRE_PIT.r, top: 0.42 });
  const flames: THREE.Mesh[] = [];
  const flameMats = ['#ff9f1c', '#ffbf69', '#ff5d2b'].map((c) => {
    const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 });
    m.toneMapped = false;
    return m;
  });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.32;
    const flame = mesh(new THREE.ConeGeometry(0.16, 0.6, 8).translate(0, 0.3, 0), flameMats[i % 3], FIRE_PIT.x + Math.cos(a) * r, 0.42, FIRE_PIT.z + Math.sin(a) * r, false);
    flames.push(flame);
    group.add(flame);
  }
  const fireLight = new THREE.PointLight('#ff8a3d', 0, 8, 1.3);
  fireLight.position.set(FIRE_PIT.x, 1.1, FIRE_PIT.z);
  group.add(fireLight);

  // Sun loungers along the south edge, a parasol between each pair, facing out over the street.
  for (let i = 1; i <= 3; i++) {
    const s = SEATING_BY_ID.get(`roof-lounger-${i}`)!;
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.28, 1.9), frame, 0, 0.14, 0.15));
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.08, 1.3), toon('#f4a261'), 0, 0.32, 0.45));
    const backrest = mesh(new THREE.BoxGeometry(0.66, 0.08, 0.8), toon('#f4a261'), 0, 0.55, -0.5);
    backrest.rotation.x = 0.75;
    g.add(backrest);
    g.position.set(s.x, 0, s.z);
    seatable(g, s.id, 1.1, interactables);
    group.add(g);
    colliders.push({ minX: s.x - 0.36, maxX: s.x + 0.36, minZ: s.z - 0.8, maxZ: s.z + 1.1, top: 0.36 });
  }
  for (const x of [-0.8, 2]) {
    const z = FLOOR.maxZ - 1.1;
    statics.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), frame, x, 1.3, z, false));
    statics.add(mesh(new THREE.ConeGeometry(1.5, 0.5, 12, 1, true), toon('#ef476f'), x, 2.6, z, true));
    statics.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 12), frame, x, 0.225, z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), frame, x, 0.47, z, false));
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, top: 0.49 });
  }

  // Tall tables to stand at between the elevator and the bar, with a candle each.
  const candle = bulb(night, '#ffbf69', 0.5);
  for (const { x, z } of ROOF_TABLES) {
    statics.add(mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.04, 16), toon(INK), x, 0.02, z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.05, 8), toon(INK), x, 0.55, z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), toon('#f4f1ea'), x, 1.08, z));
    statics.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), candle, x, 1.16, z, false));
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, top: 1.1 });
  }

  // Planters along the edges, and the air conditioning behind a screen in the north-east corner.
  const planter = toon('#6d6875');
  const leaf = toon('#5fb760');
  const leafDark = toon('#3f8f45');
  const planterRow = (x0: number, x1: number, z0: number, z1: number) => {
    statics.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0), planter, (x0 + x1) / 2, 0.3, (z0 + z1) / 2));
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let a = 0.4; a < len - 0.2; a += 0.7) {
      const px = alongX ? x0 + a : (x0 + x1) / 2;
      const pz = alongX ? (z0 + z1) / 2 : z0 + a;
      statics.add(mesh(new THREE.SphereGeometry(0.38 + ((a * 13) % 3) * 0.06, 10, 8), a % 1.4 < 0.7 ? leaf : leafDark, px, 0.8, pz, false));
    }
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: 0.6 });
  };
  // Down the west edge from the axe lane's booth, which has the corner.
  planterRow(FLOOR.minX, FLOOR.minX + 0.7, FLOOR.minZ + AXE_LANE.depth + 0.3, 3.2);
  planterRow(FLOOR.minX + 0.4, -6.2, FLOOR.maxZ - 0.7, FLOOR.maxZ);
  planterRow(5.2, FLOOR.maxX - 0.4, FLOOR.maxZ - 0.7, FLOOR.maxZ);
  const screenX = 10.9;
  const screenZ = -8.2;
  const slat = toon('#8d99ae');
  for (let z = FLOOR.minZ; z < screenZ; z += 0.3) statics.add(mesh(new THREE.BoxGeometry(0.06, 2.2, 0.14), slat, screenX, 1.1, z, false));
  for (let x = screenX; x < FLOOR.maxX; x += 0.3) statics.add(mesh(new THREE.BoxGeometry(0.14, 2.2, 0.06), slat, x, 1.1, screenZ, false));
  colliders.push({ minX: screenX - 0.1, maxX: screenX + 0.1, minZ: FLOOR.minZ, maxZ: screenZ, top: 99 });
  colliders.push({ minX: screenX, maxX: FLOOR.maxX, minZ: screenZ - 0.1, maxZ: screenZ + 0.1, top: 99 });
  const fans: THREE.Group[] = [];
  for (const [x, z] of [
    [13.2, -11],
    [16.2, -11],
  ]) {
    statics.add(mesh(new THREE.BoxGeometry(2.2, 1.3, 2.4), toon('#dfe3e8'), x, 0.65, z));
    statics.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20), toon('#565a75'), x, 1.31, z, false));
    const fan = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const blade = mesh(new THREE.BoxGeometry(1.2, 0.02, 0.22), toon('#2b2d42'), 0, 0, 0, false);
      blade.rotation.y = (b / 3) * Math.PI;
      fan.add(blade);
    }
    fan.position.set(x, 1.36, z);
    group.add(fan);
    fans.push(fan);
  }
  return { flames, fireLight, fans };
}
