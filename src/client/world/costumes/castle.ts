import * as THREE from 'three';
import { mesh, toon, toonUnique } from '../toon';
import { detail } from './shared';
import { onBean, stick } from './workers';

// ---- The castle's workers (see Worker.setOutfit and Worker.setAge) -------------------------------

/** Undyed wool and linen, one per worker (by its name), so a hall full of them isn't in uniform. */
export const SMOCKS = ['#8b6b4a', '#6f7d4f', '#7a5c3e', '#5f6f7a', '#8a7a55', '#6b4f3a', '#7d6a5a', '#556b52'];
/** What cloth and skin turn toward, the longer a worker has toiled. */
export const GRIME = new THREE.Color('#4a3a2a');

/** The smock's outline, bottom up: its radius at each height. */
export const SMOCK: readonly (readonly [r: number, y: number])[] = [
  [0.338, 0.1],
  [0.322, 0.16],
  [0.3, 0.28],
  [0.293, 0.45],
  [0.292, 0.55],
  [0.276, 0.6],
  [0.258, 0.625],
];

/** How far out from the bean something stuck on at height `y` has to go to sit on the smock (see stick). */
export function onSmock(y: number): number {
  let r = SMOCK[0][0];
  for (let i = 1; i < SMOCK.length; i++) {
    const [r0, y0] = SMOCK[i - 1];
    const [r1, y1] = SMOCK[i];
    if (y >= y0 && y <= y1) r = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  const bean = onBean(y, 0).at;
  return r - Math.hypot(bean.x, bean.z) + 0.008;
}

/** A peasant's clothes, over the worker's bean. */
export interface PeasantGarb {
  /** The smock with its rope belt, on the body. */
  body: THREE.Group;
  /** The linen coif on its head (off while a holiday hat's on). */
  cap: THREE.Group;
  /** The smock's cloth, which gets grubby (see Worker.setAge), and the color it started out. */
  cloth: THREE.MeshToonMaterial;
  clean: THREE.Color;
  /** Patches sewn on as it wears through: each shows once the worker's this worn (0–1). */
  patches: { part: THREE.Object3D; at: number }[];
}

/** A rough smock gathered at the neck with a rope belt, and a linen coif: what the castle's workers wear. `seed` picks the cloth. */
export function peasantGarb(seed: number): PeasantGarb {
  const body = new THREE.Group();
  const clean = new THREE.Color(SMOCKS[Math.abs(seed) % SMOCKS.length]);
  const cloth = toonUnique(clean);
  // Round the bean from its bottom up to under its chin, flaring out a little at the hem.
  body.add(mesh(new THREE.LatheGeometry(SMOCK.map(([r, y]) => new THREE.Vector2(r, y)), 28), cloth));
  const hem = mesh(new THREE.TorusGeometry(0.335, 0.016, 5, 28), detail('#3b2f25'), 0, 0.105, 0, false);
  hem.rotation.x = Math.PI / 2;
  body.add(hem);
  const neck = mesh(new THREE.TorusGeometry(0.258, 0.022, 6, 24), detail('#e8dcc2'), 0, 0.622, 0, false);
  neck.rotation.x = Math.PI / 2;
  body.add(neck);
  // A rope for a belt, knotted at the front with the ends hanging down.
  const rope = toon('#c8a86a');
  const belt = mesh(new THREE.TorusGeometry(0.298, 0.022, 6, 28), rope, 0, 0.4, 0, false);
  belt.rotation.x = Math.PI / 2;
  body.add(belt);
  body.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), rope, 0.06, 0.4, 0.29, false));
  for (const [x, rz] of [
    [0.05, 0.12],
    [0.085, -0.1],
  ]) {
    const end = mesh(new THREE.CylinderGeometry(0.013, 0.01, 0.13, 5), rope, x, 0.33, 0.3, false);
    end.rotation.z = rz;
    body.add(end);
  }
  const patches = [
    { y: 0.3, a: 0.7, c: '#a8875c', at: 0.35 },
    { y: 0.5, a: -2.4, c: '#6a7a52', at: 0.55 },
    { y: 0.32, a: -1.1, c: '#9a6b4a', at: 0.7 },
    { y: 0.46, a: 2.5, c: '#7a6a8a', at: 0.85 },
  ].map(({ y, a, c, at }) => {
    const part = stick(mesh(new THREE.BoxGeometry(0.085, 0.08, 0.012), detail(c), 0, 0, 0, false), y, a, onSmock(y) + 0.006);
    part.rotateZ(a * 0.3);
    part.visible = false;
    body.add(part);
    return { part, at };
  });
  // A linen coif over the crown, tied on.
  const cap = new THREE.Group();
  const linen = toon('#e8dcc2');
  const coif = mesh(new THREE.SphereGeometry(0.302, 20, 10, 0, Math.PI * 2, 0, 1.08), linen, 0, 0.7, -0.015);
  cap.add(coif);
  const edge = mesh(new THREE.TorusGeometry(0.265, 0.018, 5, 24), linen, 0, 0.84, -0.015, false);
  edge.rotation.x = Math.PI / 2;
  cap.add(edge);
  cap.rotation.x = -0.12;
  return { body, cap, cloth, clean, patches };
}

/** A beard and brows, grown out as the worker toils (see Worker.setAge). */
export interface Beard {
  group: THREE.Group;
  hair: THREE.MeshToonMaterial;
  mustache: THREE.Group;
  chin: THREE.Mesh;
  /** What hangs off the chin: its length is its y scale. */
  hang: THREE.Object3D;
  brows: THREE.Group;
  bags: THREE.Group;
}

/** A mustache under the eyes, a beard off the chin that grows down to the floor, and bushy brows. */
export function beard(): Beard {
  const group = new THREE.Group();
  const hair = toonUnique('#5d4030');
  const mustache = new THREE.Group();
  for (const sx of [-1, 1]) {
    const m = mesh(new THREE.CapsuleGeometry(0.03, 0.08, 4, 8), hair, sx * 0.055, 0.6, 0.283, false);
    m.rotation.z = sx * (Math.PI / 2 + 0.45);
    mustache.add(m);
  }
  group.add(mustache);
  const chin = mesh(new THREE.SphereGeometry(0.16, 14, 10), hair, 0, 0.53, 0.235, false);
  chin.scale.set(1.2, 0.75, 0.45);
  group.add(chin);
  // The beard proper: a long, full oval hanging from the chin, lying flat down the front of the smock
  // (its length is its y scale, from the chin down), with a few straggly wisps at its tip.
  const hang = new THREE.Group();
  hang.position.set(0, 0.54, 0.285);
  // A teardrop: full under the chin, tapering to a point at the bottom (a unit long, down from 0).
  // Bottom up, so its faces face out.
  const lock = new THREE.LatheGeometry(
    [
      [0, -1],
      [0.08, -0.96],
      [0.26, -0.8],
      [0.44, -0.52],
      [0.5, -0.24],
      [0.4, -0.06],
      [0, 0.02],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    16,
  );
  const body = mesh(lock, hair, 0, 0, 0, false);
  body.scale.set(0.34, 1, 0.13);
  hang.add(body);
  for (const [x, rz] of [
    [-0.06, 0.35],
    [0, 0],
    [0.06, -0.35],
  ]) {
    const wisp = mesh(new THREE.ConeGeometry(0.035, 0.14, 6).rotateX(Math.PI).translate(0, -0.07, 0), hair, x, -0.97, 0, false);
    wisp.rotation.z = rz;
    wisp.scale.z = 0.6;
    hang.add(wisp);
  }
  hang.rotation.x = 0.06;
  group.add(hang);
  const brows = new THREE.Group();
  for (const sx of [-1, 1]) {
    const b = mesh(new THREE.CapsuleGeometry(0.024, 0.08, 4, 6), hair, sx * 0.115, 0.815, 0.235, false);
    b.rotation.z = Math.PI / 2 + sx * 0.25;
    brows.add(b);
  }
  group.add(brows);
  // Dark bags under its eyes, from too long at the tome.
  const bags = new THREE.Group();
  for (const sx of [-1, 1]) {
    const bag = mesh(new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), detail('#5b3f5e'), sx * 0.11, 0.645, 0.235, false);
    bag.scale.set(1.1, 0.45, 0.5);
    bags.add(bag);
  }
  group.add(bags);
  return { group, hair, mustache, chin, hang, brows, bags };
}

/** The beard's color at `k` worn (0 fresh, 1 worn out): brown, then salt and pepper, then white. */
export function beardColor(k: number, out: THREE.Color): THREE.Color {
  const brown = new THREE.Color('#5d4030');
  const grey = new THREE.Color('#8f8b85');
  const white = new THREE.Color('#ecebe6');
  return k < 0.5 ? out.copy(brown).lerp(grey, k / 0.5) : out.copy(grey).lerp(white, (k - 0.5) / 0.5);
}

/** Smudges of dirt on the worker's bean and smock: each shows once it's this worn (0–1). */
export function grime(): { part: THREE.Object3D; at: number }[] {
  const mud = detail('#4d3a29');
  return [
    [0.68, 0.55, 0.05, 0.15],
    [0.34, -0.4, 0.06, 0.25],
    [0.78, -0.75, 0.045, 0.4],
    [0.3, 1.9, 0.07, 0.5],
    [0.5, 2.6, 0.06, 0.6],
    [0.7, -1.4, 0.05, 0.7],
    [0.36, 0.25, 0.065, 0.8],
    [0.74, 1.2, 0.05, 0.9],
  ].map(([y, a, r, at]) => {
    // On the smock below its neck; on the worker's face above it.
    const part = stick(mesh(new THREE.SphereGeometry(r, 10, 8), mud, 0, 0, 0, false), y, a, y < 0.63 ? onSmock(y) - 0.004 : -0.012);
    part.scale.z = 0.3;
    part.visible = false;
    return { part, at };
  });
}
