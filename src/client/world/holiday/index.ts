import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALCONY, DESKS, DESK_SIZE, EXIT_STAIRS, FLOOR, PLANTS, STREET_Y, WALL_HEIGHT, WINDOWS } from '../../../shared/building/layout';
import type { Theme } from '../../../shared/protocol';
import { mulberry32 } from '../../../shared/util/rng';
import { batWingGeometry, glowTexture } from '../costumes';
import { plantLeaves } from '../office';
import type { Collider, Office } from '../types';
import { SPOOKY_MOON } from '../sky';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from '../toon';
import { BIG_TREE, DESK_SPOTS, FACE, G, GRAVES, SNOWMEN, pumpkinSpots } from './spots';
import type { Spot } from './spots';
import { halos, pumpkinGeometry, pumpkinTextures, scatter } from './pumpkin';
import { bat, cobweb, gravestone, webTexture } from './halloween';
import type { Bat } from './halloween';
import { PAPERS, christmasTree, present, snowman } from './christmas';

/*
 * The building dressed up for a holiday (the costumes are in world/costumes.ts). Halloween puts
 * jack-o'-lanterns everywhere, on the desks, the sills, the counter, the balcony rail and all down
 * the street, with gravestones on the lawn, cobwebs in the corners and bats circling the building
 * and crossing the moon. Christmas turns the potted plants into little decorated trees with presents
 * under them, puts a present on every desk, a big lit tree out front and snowmen in the snow (the
 * sky makes it snow, see Sky.setTheme). Everything's built once and shown for its holiday. What's
 * down on the street goes further down the higher your floor is, as the street does (Office.setLevel).
 */


export class Holiday {
  readonly group = new THREE.Group();
  theme: Theme | null = null;
  private halloween = new THREE.Group();
  private christmas = new THREE.Group();
  private pumpkin: THREE.MeshToonMaterial;
  private pumpkinGlow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private treeGlow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private bats: Bat[] = [];
  /** Bats far off round the moon, which ride along with you like the moon does. */
  private moonBats = new THREE.Group();
  private lights: THREE.MeshToonMaterial[];
  private colliders: Record<Theme, Collider[]> = { halloween: [], christmas: [] };
  /**
   * Each holiday's things down on the street (and on the landing outside the bottom floor's exit),
   * how far down the street is from the floor you're on, and where their colliders are from the bottom floor.
   */
  private street: Record<Theme, THREE.Group> = { halloween: new THREE.Group(), christmas: new THREE.Group() };
  private drop = 0;
  private base = new Map<Collider, { top: number; bottom: number }>();
  /** The plants' leaves, and the tree each becomes at Christmas. */
  private plants: { leaves: THREE.Object3D[]; tree: THREE.Object3D }[] = [];
  private readonly camPos = new THREE.Vector3();

  constructor(private office: Office) {
    this.halloween.visible = this.christmas.visible = false;
    this.group.add(this.halloween, this.christmas);
    this.halloween.add(this.street.halloween);
    this.christmas.add(this.street.christmas);

    // ---- Halloween ----
    const [skin, glow] = pumpkinTextures();
    const gradientMap = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
    this.pumpkin = new THREE.MeshToonMaterial({ map: skin, emissive: '#ffffff', emissiveMap: glow, emissiveIntensity: 0.5, gradientMap });
    const stem = new THREE.CylinderGeometry(0.09, 0.15, 0.4, 7).rotateZ(0.12).translate(0, 1.6, 0);
    // In the office and out on its balcony, which every floor has; and down on the street, or out
    // past the west wall on the bottom floor's landing.
    const all = pumpkinSpots();
    const down = (s: Spot) => s[1] < 0 || s[0] < FLOOR.minX;
    for (const [spots, into] of [
      [all.filter((s) => !down(s)), this.halloween],
      [all.filter(down), this.street.halloween],
    ] as const) {
      into.add(mesh(scatter(pumpkinGeometry(), spots), this.pumpkin));
      into.add(mesh(scatter(stem, spots), toon('#5b6e2a')));
      // Candlelight spilling out of each face at night.
      const face = new THREE.Vector3();
      const glows = halos(
        spots.map(([x, y, z, r, rotY]) => ({
          p: face.set(x + Math.sin(rotY) * r * 1.35, y + r * 0.8, z + Math.cos(rotY) * r * 1.35).clone(),
          size: r * 5,
          color: '#ffa640',
        })),
      );
      into.add(...glows);
      this.pumpkinGlow.push(...glows);
    }

    const graves = new THREE.Group();
    const rip: THREE.Mesh[] = [];
    for (const [x, z, kind] of GRAVES) {
      const s = gravestone(kind);
      s.position.set(x, G, z);
      s.rotation.y = FACE.east + (kind - 1) * 0.12;
      graves.add(s);
      this.colliders.halloween.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.45, maxZ: z + 0.45, bottom: G, top: G + 1.2 });
      if (kind !== 1) {
        const label = textPlane('R.I.P.', { color: '#2b2d42', size: 56 });
        label.scale.multiplyScalar(kind === 2 ? 0.55 : 0.45);
        label.position.set(x + 0.09, G + (kind === 2 ? 0.28 : 0.5), z);
        label.rotation.y = s.rotation.y;
        rip.push(label);
      }
    }
    this.street.halloween.add(mergeByMaterial(graves), ...rip);

    const web = webTexture();
    for (const [x, z] of [
      [FLOOR.minX, FLOOR.minZ],
      [FLOOR.maxX, FLOOR.minZ],
      [FLOOR.minX, FLOOR.maxZ],
    ]) {
      this.halloween.add(cobweb(x, z, web));
    }

    const batMat = new THREE.MeshBasicMaterial({ color: '#150b1f', side: THREE.DoubleSide });
    const rand = mulberry32(31);
    for (let i = 0; i < 12; i++) {
      const b = bat(batMat, 1.2 + rand() * 0.8);
      this.halloween.add(b.root);
      this.bats.push({ ...b, cx: (rand() - 0.5) * 6, cz: (rand() - 0.5) * 6, r: 23 + rand() * 12, y: 2.5 + rand() * 9, speed: (0.15 + rand() * 0.15) * (i % 3 ? 1 : -1), phase: rand() * 7 });
    }
    // Against the moon: 70 m off in its direction, so they cross it now and then.
    const farMat = new THREE.MeshBasicMaterial({ color: '#0d0612', side: THREE.DoubleSide, fog: false });
    const toMoon = new THREE.Vector3(Math.cos(SPOOKY_MOON.el) * Math.sin(SPOOKY_MOON.az), Math.sin(SPOOKY_MOON.el), -Math.cos(SPOOKY_MOON.el) * Math.cos(SPOOKY_MOON.az)).multiplyScalar(70);
    for (let i = 0; i < 4; i++) {
      const b = bat(farMat, 2.4);
      this.moonBats.add(b.root);
      this.bats.push({ ...b, cx: toMoon.x, cz: toMoon.z, r: 3 + rand() * 4, y: toMoon.y + (rand() - 0.5) * 3, speed: (0.6 + rand() * 0.4) * (i % 2 ? 1 : -1), phase: rand() * 7 });
    }
    this.halloween.add(this.moonBats);

    // ---- Christmas ----
    this.lights = ['#ffe28a', '#ff5a5a', '#6ec3ff', '#7dff8a'].map((c) => {
      const m = toonUnique(c);
      m.emissive.set(c);
      m.emissiveIntensity = 0.6;
      m.userData.outlineParameters = { visible: false };
      return m;
    });
    // The potted plants become little trees standing in their pots, with presents round them: the
    // leaves are hidden and the tree shown instead.
    office.plants.forEach((p, i) => {
      const leaves = plantLeaves(p);
      const tree = new THREE.Group();
      const t = christmasTree(1.25, this.lights);
      t.position.y = 0.45;
      tree.add(t);
      const gifts = new THREE.Group();
      for (const [x, z, w, rot] of [
        [0.45, 0.2, 0.26, 0.3],
        [-0.3, 0.42, 0.2, -0.5],
        [0.12, -0.46, 0.22, 0.9],
      ]) {
        const [paper, ribbon] = PAPERS[(i + Math.round(w * 10)) % PAPERS.length];
        const g = present(w, paper, ribbon);
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        gifts.add(g);
      }
      tree.add(gifts);
      const merged = mergeByMaterial(tree);
      merged.visible = false;
      p.add(merged);
      this.plants.push({ leaves, tree: merged });
    });
    // A present on every desk.
    const deskGifts = new THREE.Group();
    DESK_SPOTS.forEach(([x, y, z, , rotY], i) => {
      const [paper, ribbon] = PAPERS[i % PAPERS.length];
      const g = present(0.17, paper, ribbon);
      g.position.set(x, y, z);
      g.rotation.y = rotY + 0.3;
      deskGifts.add(g);
    });
    this.christmas.add(mergeByMaterial(deskGifts));
    // The big tree out front, lit up, with a heap of presents.
    const out = new THREE.Group();
    const lit: THREE.Vector3[] = [];
    const big = christmasTree(BIG_TREE.height, this.lights, lit, true);
    out.add(big);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + 0.4;
      const w = 0.45 + (i % 3) * 0.15;
      const [paper, ribbon] = PAPERS[i % PAPERS.length];
      const g = present(w, paper, ribbon);
      g.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9);
      g.rotation.y = a;
      out.add(g);
    }
    // Merging keeps only what's inside the group, so it's placed after.
    const tree = mergeByMaterial(out);
    tree.position.set(BIG_TREE.x, G, BIG_TREE.z);
    this.street.christmas.add(tree);
    this.colliders.christmas.push({ minX: BIG_TREE.x - 1.5, maxX: BIG_TREE.x + 1.5, minZ: BIG_TREE.z - 1.5, maxZ: BIG_TREE.z + 1.5, bottom: G, top: G + BIG_TREE.height });
    this.treeGlow = halos(lit.map((p, i) => ({ p: p.clone().add(new THREE.Vector3(BIG_TREE.x, G, BIG_TREE.z)), size: 0.9, color: ['#ffe28a', '#ff5a5a', '#6ec3ff', '#7dff8a'][i % 4] })));
    this.street.christmas.add(...this.treeGlow);
    const men = new THREE.Group();
    for (const [x, z, rotY] of SNOWMEN) {
      const s = snowman();
      s.position.set(x, G, z);
      s.rotation.y = rotY;
      men.add(s);
      this.colliders.christmas.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, bottom: G, top: G + 2.5 });
    }
    this.street.christmas.add(mergeByMaterial(men));
    // Every collider here is down on the street.
    for (const c of [...this.colliders.halloween, ...this.colliders.christmas]) this.base.set(c, { top: c.top, bottom: c.bottom ?? 0 });
  }

  /** Puts up a holiday's decorations (taking down the other's), or none. */
  set(theme: Theme | null) {
    if (theme === this.theme) return;
    const colliders = this.office.colliders;
    if (this.theme) for (const c of this.colliders[this.theme]) colliders.splice(colliders.indexOf(c), 1);
    this.theme = theme;
    if (theme) colliders.push(...this.colliders[theme]);
    this.halloween.visible = theme === 'halloween';
    this.christmas.visible = theme === 'christmas';
    for (const p of this.plants) {
      p.tree.visible = theme === 'christmas';
      for (const l of p.leaves) l.visible = theme !== 'christmas';
    }
  }

  /** `lampsOn` is how far the lamps are on (see Sky), 0 by day and 1 at night: the candles and the tree lights glow brighter. */
  update(t: number, lampsOn: number, camera: THREE.Camera) {
    const drop = STREET_Y - this.office.night.street;
    if (drop !== this.drop) {
      this.drop = drop;
      for (const g of Object.values(this.street)) g.position.y = -drop;
      for (const [c, b] of this.base) {
        c.top = b.top - drop;
        c.bottom = b.bottom - drop;
      }
    }
    if (this.theme === 'halloween') {
      // Candlelight: a slow flicker, and now and then a gutter.
      const flicker = 0.88 + 0.08 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 17.1) + 0.04 * Math.sin(t * 29.7);
      this.pumpkin.emissiveIntensity = (0.45 + 0.9 * lampsOn) * flicker;
      for (const h of this.pumpkinGlow) {
        h.material.opacity = (0.15 + 0.75 * lampsOn) * flicker;
        h.visible = h.material.opacity > 0.01;
      }
      camera.getWorldPosition(this.camPos);
      this.moonBats.position.copy(this.camPos);
      for (const b of this.bats) {
        const a = b.phase + t * b.speed;
        const x = b.cx + Math.cos(a) * b.r;
        const z = b.cz + Math.sin(a) * b.r;
        b.root.position.set(x, b.y + Math.sin(t * 0.9 + b.phase) * 1.2, z);
        // Along the circle, the way it's going, banking into the turn.
        b.root.rotation.set(0, Math.atan2(-Math.sin(a) * Math.sign(b.speed), Math.cos(a) * Math.sign(b.speed)), Math.sign(b.speed) * 0.35);
        const flap = Math.sin(t * 16 + b.phase * 3);
        b.wings.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * (0.15 + flap * 0.65)));
      }
    } else if (this.theme === 'christmas') {
      const base = 0.35 + 0.9 * lampsOn;
      this.lights.forEach((m, i) => (m.emissiveIntensity = base * (0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7))));
      for (const h of this.treeGlow) {
        h.material.opacity = lampsOn * 0.8;
        h.visible = h.material.opacity > 0.01;
      }
    }
  }
}
