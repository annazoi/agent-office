import * as THREE from 'three';
import { DANCE_FLOOR, DJ_BOOTH, ELEVATOR, ELEVATOR_FRONT, FLOOR, ROOF_BAR, SEATING_BY_ID, STAGE, WALL_HEIGHT, WALL_T } from '../../../shared/layout';
import type { DjFrame } from '../../dnb';
import { buildBarGames, type BarGamesView } from '../bargames/world';
import { Worker } from '../../world/character';
import { Dj } from './dj';
import { B, INK, beamMaterial, deckTexture, fitFont, hue, seatable, unpickable } from './helpers';
import { paintLed } from './led';
import { buildLounge } from './lounge';
import { LASER_RAYS, aimHeads, paintDanceFloor, sweepLasers, type Head } from './show';
import { buildCity, type City } from '../../world/city';
import { buildElevator, type Elevator } from '../../world/elevator';
import type { Collider, Interactable } from '../../world/types';
import { bulb, type NightParts } from '../../world/outside';
import { canvasTexture } from '../../world/texture';
import { mergeByMaterial, mesh, toon } from '../../world/toon';

// The rooftop bar, on top of the building (see shared/rooftop.ts): a deck with a glass railing round
// it and the city all around, the elevator's housing where you arrive, a DJ on a stage under a rig
// of moving lights and lasers with an LED wall behind and a dance floor in front, a bar with a
// bartender under a pergola hung with string lights, a lounge round a fire pit, sun loungers along
// the south edge, and an axe-throwing lane and a dart board in the north-west corner (features/bargames/world.ts).
// Everything that flashes goes by the DJ's set (see djFrame), so it's in time with the music and the
// same for everyone up there.

export interface RoofEnv {
  /** How dark it is, 0 by day to 1 at night: lights show up more. */
  dark: number;
  /** Things may sweep and pulse (off when the system asks for less motion). */
  motion: boolean;
}

export interface Rooftop {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  elevator: Elevator;
  city: City;
  /**
   * The building has `floors` floors under the roof: the street is as far down as that is tall (see
   * City). `wings` is how far each one's back office is built out.
   */
  setFloors(floors: number, wings?: readonly number[]): void;
  /** What looking or clicking can land on: everything but the city far below. */
  pickables: THREE.Object3D[];
  /** Where drinks are poured, for the sound of one. */
  pourAt: { x: number; y: number; z: number };
  /** The axe lane and the dart board, and what's thrown at them. */
  games: BarGamesView;
  /** Someone ordered a drink at the bar, standing (or sitting) at `z` along it: the bartender comes over. */
  serve(z: number): void;
  /**
   * Moves everything to the music. Returns how hard the strobes flash right now (0–1), for the
   * scene's lights: on the snares as a drop lands, never quicker than a couple of times a second.
   */
  update(t: number, dt: number, f: DjFrame, env: RoofEnv): number;
}

// ---- The rooftop --------------------------------------------------------------------------------

export function buildRooftop(night: NightParts, floors: number): Rooftop {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const statics = new THREE.Group();
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const cx = (B.minX + B.maxX) / 2;
  const cz = (B.minZ + B.maxZ) / 2;

  const city = buildCity(night);
  city.setFloors(floors);
  group.add(city.group);

  // The deck, and the slab it's laid on (the top of the building).
  const deckMat = new THREE.MeshToonMaterial({ map: deckTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  deckMat.userData.outlineParameters = { visible: false };
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), deckMat);
  deck.position.set(cx, 0.002, cz);
  deck.receiveShadow = true;
  group.add(deck);
  statics.add(mesh(new THREE.BoxGeometry(w, 0.3, d), toon('#c9c4bb'), cx, -0.15, cz, false));
  colliders.push({ minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, bottom: -0.3, top: 0 });

  // Round the edge: a concrete curb with glass panels on it and a steel rail on top. Nobody goes over it.
  const curb = toon('#d8d3ca');
  const steel = toon('#aeb6bf');
  const glassMat = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const edges: [number, number, number, number][] = [
    [B.minX, B.maxX, B.minZ, FLOOR.minZ],
    [B.minX, B.maxX, FLOOR.maxZ, B.maxZ],
    [B.minX, FLOOR.minX, B.minZ, B.maxZ],
    [FLOOR.maxX, B.maxX, B.minZ, B.maxZ],
  ];
  for (const [x0, x1, z0, z1] of edges) {
    const ex = (x0 + x1) / 2;
    const ez = (z0 + z1) / 2;
    const alongX = x1 - x0 > z1 - z0;
    statics.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.45, z1 - z0), curb, ex, 0.225, ez));
    const len = alongX ? x1 - x0 : z1 - z0;
    const pane = mesh(new THREE.PlaneGeometry(len, 0.72), glassMat, ex, 0.81, ez, false);
    if (!alongX) pane.rotation.y = Math.PI / 2;
    group.add(pane);
    const rail = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), steel, ex, 1.19, ez, false);
    rail.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    statics.add(rail);
    for (let a = 0; a <= len + 0.01; a += 2.4) {
      const px = alongX ? x0 + a : ex;
      const pz = alongX ? ez : z0 + a;
      statics.add(mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), steel, px, 0.8, pz, false));
    }
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: 99 });
  }

  // The elevator, in its housing: a back wall and a roof over the shaft (as tall as a floor), with a light on top.
  const elevator = buildElevator();
  elevator.setSign('🍸 Rooftop bar');
  group.add(elevator.group);
  colliders.push(...elevator.colliders);
  interactables.push(elevator.interactable);
  const hw = ELEVATOR.width / 2;
  const housing = toon('#b8c1cc');
  statics.add(mesh(new THREE.BoxGeometry(ELEVATOR.width, WALL_HEIGHT + 0.3, WALL_T), housing, ELEVATOR.x, (WALL_HEIGHT + 0.3) / 2, FLOOR.minZ - WALL_T / 2));
  statics.add(mesh(new THREE.BoxGeometry(ELEVATOR.width + 0.3, 0.3, ELEVATOR_FRONT - B.minZ + 0.2), toon('#8d99ae'), ELEVATOR.x, WALL_HEIGHT + 0.15, (B.minZ + ELEVATOR_FRONT) / 2 + 0.05));
  const beacon = bulb(night, '#ff5d5d', 0.6);
  statics.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), beacon, ELEVATOR.x, WALL_HEIGHT + 0.4, (B.minZ + ELEVATOR_FRONT) / 2, false));
  colliders.push({ minX: ELEVATOR.x - hw, maxX: ELEVATOR.x + hw, minZ: B.minZ, maxZ: FLOOR.minZ, top: 99 });

  // ---- The stage ----------------------------------------------------------------------------------
  const stageMat = toon('#2b2d42');
  const sw = STAGE.maxX - STAGE.minX;
  const sd = STAGE.maxZ - STAGE.minZ;
  const scx = (STAGE.minX + STAGE.maxX) / 2;
  const scz = (STAGE.minZ + STAGE.maxZ) / 2;
  statics.add(mesh(new THREE.BoxGeometry(sw, STAGE.height, sd), stageMat, scx, STAGE.height / 2, scz));
  colliders.push({ minX: STAGE.minX, maxX: STAGE.maxX, minZ: STAGE.minZ, maxZ: STAGE.maxZ, top: STAGE.height });
  // A step up at its east end.
  statics.add(mesh(new THREE.BoxGeometry(0.7, STAGE.height / 2, 1.8), stageMat, STAGE.maxX + 0.35, STAGE.height / 4, -10.7));
  colliders.push({ minX: STAGE.maxX, maxX: STAGE.maxX + 0.7, minZ: -11.6, maxZ: -9.8, top: STAGE.height / 2 });
  // An LED strip along its front edge.
  const stripMat = new THREE.MeshBasicMaterial({ color: '#ff4fd8' });
  stripMat.toneMapped = false;
  group.add(mesh(new THREE.BoxGeometry(sw, 0.06, 0.02), stripMat, scx, STAGE.height - 0.08, STAGE.maxZ + 0.011, false));

  // The DJ's table: decks and a mixer on it, and the DJ's name across the front. The DJ stands on a
  // riser behind it, so the dance floor sees more than the top of their cap.
  const table = new THREE.Group();
  const tableY = STAGE.height;
  const TH = 0.8;
  const tz = DJ_BOOTH.z + 0.75;
  const riser = 0.25;
  table.add(mesh(new THREE.BoxGeometry(3.4, TH, 0.7), toon('#1d1d1d'), DJ_BOOTH.x, tableY + TH / 2, tz));
  statics.add(mesh(new THREE.BoxGeometry(1.8, riser, 0.9), toon('#3d405b'), DJ_BOOTH.x, tableY + riser / 2, DJ_BOOTH.z - 0.05));
  const nameplate = canvasTexture(512, 128, (g) => {
    g.fillStyle = '#111018';
    g.fillRect(0, 0, 512, 128);
    fitFont(g, 'DJ MERGE CONFLICT', 64, 470);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff4fd8';
    g.shadowBlur = 18;
    g.fillStyle = '#ffe3fb';
    g.fillText('DJ MERGE CONFLICT', 256, 66);
  });
  const plateMat = new THREE.MeshBasicMaterial({ map: nameplate });
  plateMat.toneMapped = false;
  table.add(mesh(new THREE.PlaneGeometry(3.2, 0.8), plateMat, DJ_BOOTH.x, tableY + TH / 2, tz + 0.352, false));
  const jog = new THREE.MeshBasicMaterial({ color: '#4cc9f0' });
  jog.toneMapped = false;
  for (const s of [-1, 1]) {
    table.add(mesh(new THREE.BoxGeometry(0.62, 0.07, 0.5), toon('#3d405b'), DJ_BOOTH.x + s * 0.95, tableY + TH + 0.035, tz, false));
    table.add(mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 24), jog, DJ_BOOTH.x + s * 0.95, tableY + TH + 0.08, tz - 0.03, false));
  }
  table.add(mesh(new THREE.BoxGeometry(0.5, 0.09, 0.45), toon('#565a75'), DJ_BOOTH.x, tableY + TH + 0.045, tz, false));
  for (let i = 0; i < 4; i++) table.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8), toon('#ffd166'), DJ_BOOTH.x - 0.18 + i * 0.12, tableY + TH + 0.1, tz - 0.1, false));
  group.add(table);
  colliders.push({ minX: DJ_BOOTH.x - 1.7, maxX: DJ_BOOTH.x + 1.7, minZ: tz - 0.35, maxZ: tz + 0.35, top: 99 });
  const djIt: Interactable = { kind: 'dj', x: DJ_BOOTH.x, z: STAGE.maxZ + 0.4, radius: 2.4 };
  interactables.push(djIt);
  table.userData.interact = djIt;

  const dj = new Dj();
  dj.root.position.set(DJ_BOOTH.x, STAGE.height + riser, DJ_BOOTH.z);
  dj.root.userData.interact = djIt;
  group.add(dj.root);

  // Speaker stacks at either front corner of the stage; their cones thump with the kick.
  const cones: THREE.Mesh[] = [];
  const box = toon('#1d1d1d');
  const coneMat = toon('#3d405b');
  for (const sx of [STAGE.minX + 1.1, STAGE.maxX - 1.1]) {
    const z = STAGE.maxZ - 0.55;
    statics.add(mesh(new THREE.BoxGeometry(1.2, 1.0, 0.9), box, sx, STAGE.height + 0.5, z));
    statics.add(mesh(new THREE.BoxGeometry(0.95, 1.35, 0.8), box, sx, STAGE.height + 1.675, z));
    for (const [y, r] of [
      [STAGE.height + 0.5, 0.36],
      [STAGE.height + 1.35, 0.26],
      [STAGE.height + 2.0, 0.16],
    ]) {
      const cone = mesh(new THREE.CylinderGeometry(r, r * 0.6, 0.06, 20), coneMat, sx, y, z + (y > STAGE.height + 1 ? 0.41 : 0.46), false);
      cone.rotation.x = Math.PI / 2;
      group.add(cone);
      cones.push(cone);
    }
    colliders.push({ minX: sx - 0.6, maxX: sx + 0.6, minZ: z - 0.45, maxZ: z + 0.45, top: 99 });
  }

  // The LED wall behind the DJ.
  const led = canvasTexture(512, 256);
  const ledMat = new THREE.MeshBasicMaterial({ map: led });
  ledMat.toneMapped = false;
  const ledW = 8;
  const ledH = 4;
  group.add(mesh(new THREE.PlaneGeometry(ledW, ledH), ledMat, scx, STAGE.height + 0.35 + ledH / 2, STAGE.minZ + 0.2, false));
  statics.add(mesh(new THREE.BoxGeometry(ledW + 0.3, ledH + 0.3, 0.25), toon('#1d1d1d'), scx, STAGE.height + 0.35 + ledH / 2, STAGE.minZ + 0.06));
  colliders.push({ minX: scx - ledW / 2, maxX: scx + ledW / 2, minZ: STAGE.minZ, maxZ: STAGE.minZ + 0.35, top: 99 });
  const ledCtx = (led.image as HTMLCanvasElement).getContext('2d')!;
  let ledAt = -1;

  // The rig: a truss tower either side of the stage and a beam across, with moving heads hanging off it.
  const truss = toon('#c9d1d9');
  const rigZ = STAGE.maxZ - 0.15;
  const rigTop = 5.6;
  for (const x of [STAGE.minX + 0.2, STAGE.maxX - 0.2]) {
    for (const [dx, dz] of [
      [-0.15, -0.15],
      [0.15, -0.15],
      [-0.15, 0.15],
      [0.15, 0.15],
    ])
      statics.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, rigTop - STAGE.height, 6), truss, x + dx, (rigTop + STAGE.height) / 2, rigZ + dz, false));
    for (let y = STAGE.height + 0.4; y < rigTop; y += 0.6) statics.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.34), truss, x, y, rigZ, false));
  }
  for (const dy of [0, 0.3]) {
    for (const dz of [-0.15, 0.15]) {
      const bar = mesh(new THREE.CylinderGeometry(0.035, 0.035, sw - 0.4, 6), truss, scx, rigTop - dy, rigZ + dz, false);
      bar.rotation.z = Math.PI / 2;
      statics.add(bar);
    }
  }
  const heads: Head[] = [];
  const beamLen = 18;
  const beamGeo = new THREE.CylinderGeometry(0.09, 1.7, beamLen, 20, 1, true).translate(0, -beamLen / 2, 0);
  for (let i = 0; i < 5; i++) {
    const pan = new THREE.Group();
    pan.position.set(STAGE.minX + 1.4 + i * ((sw - 2.8) / 4), rigTop - 0.45, rigZ);
    const yoke = mesh(new THREE.BoxGeometry(0.34, 0.06, 0.12), toon('#1d1d1d'), 0, 0.18, 0, false);
    pan.add(yoke);
    const tilt = new THREE.Group();
    tilt.add(mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.36, 12).translate(0, -0.05, 0), toon('#1d1d1d'), 0, 0, 0, false));
    const lens = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    lens.toneMapped = false;
    tilt.add(mesh(new THREE.CircleGeometry(0.11, 16).rotateX(Math.PI / 2), lens, 0, -0.232, 0, false));
    const beam = unpickable(new THREE.Mesh(beamGeo, beamMaterial()));
    beam.position.y = -0.24;
    beam.frustumCulled = false;
    tilt.add(beam);
    pan.add(tilt);
    group.add(pan);
    heads.push({ pan, tilt, beam, lens, i });
  }

  // Lasers from the front corners of the stage, fanning out over the dance floor into the sky.
  const lasers = [STAGE.minX + 2.2, STAGE.maxX - 2.2].map((x, k) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LASER_RAYS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ color: k ? '#ff2bd6' : '#39ff14', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = unpickable(new THREE.LineSegments(geo, mat));
    lines.frustumCulled = false;
    group.add(lines);
    statics.add(mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), toon('#1d1d1d'), x, STAGE.height + 0.09, STAGE.maxZ - 0.25, false));
    return { lines, mat, from: new THREE.Vector3(x, STAGE.height + 0.2, STAGE.maxZ - 0.25), k };
  });

  // ---- The dance floor ----------------------------------------------------------------------------
  const cols = Math.round(DANCE_FLOOR.maxX - DANCE_FLOOR.minX);
  const rows = Math.round(DANCE_FLOOR.maxZ - DANCE_FLOOR.minZ);
  const tileMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  tileMat.toneMapped = false;
  const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), tileMat, cols * rows);
  const tileAt = new THREE.Matrix4();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tileAt.makeTranslation(DANCE_FLOOR.minX + c + 0.5, 0.012, DANCE_FLOOR.minZ + r + 0.5);
      tiles.setMatrixAt(r * cols + c, tileAt);
      tiles.setColorAt(r * cols + c, new THREE.Color('#222'));
    }
  }
  tiles.receiveShadow = false;
  group.add(tiles);
  const underFloor = mesh(
    new THREE.PlaneGeometry(cols, rows).rotateX(-Math.PI / 2),
    toon('#15141c'),
    (DANCE_FLOOR.minX + DANCE_FLOOR.maxX) / 2,
    0.008,
    (DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2,
    false,
  );
  group.add(underFloor);

  // Colored washes over the dance floor.
  const washes = [-1, 1].map((s) => {
    const l = new THREE.PointLight('#ff4fd8', 0, 15, 1.2);
    l.position.set((DANCE_FLOOR.minX + DANCE_FLOOR.maxX) / 2 + s * 2.6, 3.6, (DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2);
    group.add(l);
    return l;
  });

  // ---- The bar ------------------------------------------------------------------------------------
  const bar = new THREE.Group();
  const bx = ROOF_BAR.x;
  const blen = ROOF_BAR.maxZ - ROOF_BAR.minZ;
  const bz = (ROOF_BAR.minZ + ROOF_BAR.maxZ) / 2;
  const front = bx - ROOF_BAR.depth / 2;
  bar.add(mesh(new THREE.BoxGeometry(ROOF_BAR.depth, ROOF_BAR.height - 0.06, blen), toon('#6b3f2a'), bx, (ROOF_BAR.height - 0.06) / 2, bz));
  // Slats up the front of it.
  for (let z = ROOF_BAR.minZ + 0.25; z < ROOF_BAR.maxZ; z += 0.5) bar.add(mesh(new THREE.BoxGeometry(0.03, ROOF_BAR.height - 0.3, 0.08), toon('#8a5a3b'), front - 0.012, ROOF_BAR.height / 2, z, false));
  bar.add(mesh(new THREE.BoxGeometry(ROOF_BAR.depth + 0.2, 0.06, blen + 0.2), toon('#f4f1ea'), bx - 0.05, ROOF_BAR.height - 0.03, bz));
  const footRail = mesh(new THREE.CylinderGeometry(0.03, 0.03, blen, 8), toon('#e9b949'), front - 0.2, 0.22, bz, false);
  footRail.rotation.x = Math.PI / 2;
  bar.add(footRail);
  // A glow along its foot that shifts color with the music.
  const barGlow = new THREE.MeshBasicMaterial({ color: '#4cc9f0' });
  barGlow.toneMapped = false;
  group.add(mesh(new THREE.BoxGeometry(0.02, 0.05, blen), barGlow, front - 0.02, 0.06, bz, false));
  // Beer taps, and a few glasses waiting on the counter.
  for (const z of [-0.6, 0, 0.6]) {
    bar.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), toon('#e9b949'), bx + 0.12, ROOF_BAR.height + 0.2, z, false));
    bar.add(mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), toon(['#ef476f', '#06d6a0', '#ffd166'][Math.round(z / 0.6) + 1]), bx + 0.05, ROOF_BAR.height + 0.46, z, false));
  }
  group.add(bar);
  colliders.push({ minX: front, maxX: bx + ROOF_BAR.depth / 2, minZ: ROOF_BAR.minZ, maxZ: ROOF_BAR.maxZ, top: ROOF_BAR.height });
  const barIts = [-3.6, -0.6, 2.4].map((z): Interactable => ({ kind: 'bar', x: front - 0.7, z, radius: 1.7 }));
  interactables.push(...barIts);
  bar.userData.interact = barIts[1];

  // The back bar: shelves of bottles against a warm glow, along the east edge.
  const back = FLOOR.maxX - 0.35;
  const shelf = toon('#4a2c1d');
  bar.add(mesh(new THREE.BoxGeometry(0.6, 1.0, blen - 0.6), shelf, back, 0.5, bz));
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb55a' });
  const glowPanel = mesh(new THREE.PlaneGeometry(blen - 1, 1.5).rotateY(-Math.PI / 2), glowMat, FLOOR.maxX - 0.08, 1.85, bz, false);
  group.add(glowPanel);
  const bottles = new THREE.Group();
  const bottleColors = ['#2a9d8f', '#e9c46a', '#8ecae6', '#6a994e', '#bc4749', '#f4a261', '#dda15e'];
  let k = 0;
  for (const y of [1.15, 1.65, 2.15]) {
    bar.add(mesh(new THREE.BoxGeometry(0.4, 0.04, blen - 1), shelf, FLOOR.maxX - 0.24, y - 0.02, bz, false));
    for (let z = ROOF_BAR.minZ + 0.8; z < ROOF_BAR.maxZ - 0.6; z += 0.24) {
      const h = 0.26 + ((k * 7) % 5) * 0.03;
      const c = bottleColors[k++ % bottleColors.length];
      bottles.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, h, 8), toon(c), FLOOR.maxX - 0.25, y + h / 2, z, false));
      bottles.add(mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.08, 6), toon(c), FLOOR.maxX - 0.25, y + h + 0.04, z, false));
    }
  }
  group.add(mergeByMaterial(bottles));
  colliders.push({ minX: back - 0.3, maxX: FLOOR.maxX, minZ: ROOF_BAR.minZ + 0.3, maxZ: ROOF_BAR.maxZ - 0.3, top: 99 });

  // A pergola over it, hung with string lights, and a neon sign facing the dance floor.
  const wood = toon('#8a5a3b');
  const p0 = { x: front - 0.9, z: ROOF_BAR.minZ - 0.8 };
  const p1 = { x: FLOOR.maxX - 0.1, z: ROOF_BAR.maxZ + 0.8 };
  const roofY = 3.3;
  for (const x of [p0.x, p1.x]) {
    for (const z of [p0.z, p1.z]) {
      statics.add(mesh(new THREE.BoxGeometry(0.16, roofY, 0.16), wood, x, roofY / 2, z));
      colliders.push({ minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1, top: 99 });
    }
    statics.add(mesh(new THREE.BoxGeometry(0.16, 0.22, p1.z - p0.z + 0.3), wood, x, roofY, (p0.z + p1.z) / 2));
  }
  for (let z = p0.z; z <= p1.z + 0.01; z += 0.55) statics.add(mesh(new THREE.BoxGeometry(p1.x - p0.x + 0.4, 0.08, 0.1), wood, (p0.x + p1.x) / 2, roofY + 0.15, z));
  const neon = canvasTexture(768, 192, (g) => {
    g.clearRect(0, 0, 768, 192);
    g.font = '900 104px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [blur, color] of [
      [36, '#ff4fd8'],
      [14, '#ff4fd8'],
      [0, '#ffe3fb'],
    ] as const) {
      g.shadowColor = '#ff4fd8';
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText('🍸 SKY BAR', 384, 100);
    }
  });
  const neonMat = new THREE.MeshBasicMaterial({ map: neon, transparent: true, depthWrite: false });
  neonMat.toneMapped = false;
  const sign = mesh(new THREE.PlaneGeometry(3.6, 0.9).rotateY(-Math.PI / 2), neonMat, p0.x - 0.1, roofY - 0.4, bz, false);
  group.add(sign);

  // The bartender, behind the bar, facing the counter.
  const bartender = new Worker('Bartender', '#e76f51');
  bartender.setStatus('idle', false);
  bartender.setTask({ name: '🍸 Bartender', summary: "What'll it be? E at the bar" });
  const tendX = bx + ROOF_BAR.depth / 2 + 0.7;
  bartender.root.position.set(tendX, 0, bz);
  bartender.root.rotation.y = -Math.PI / 2;
  group.add(bartender.root);
  let tendZ = bz;
  let wander = 0;

  // Bar stools along the counter.
  for (let i = 1; i <= 6; i++) {
    const s = SEATING_BY_ID.get(`roof-stool-${i}`)!;
    const stool = new THREE.Group();
    stool.add(mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.03, 16), steel, 0, 0.015, 0, false));
    stool.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.66, 8), steel, 0, 0.36, 0, false));
    stool.add(mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 16).rotateX(Math.PI / 2), steel, 0, 0.32, 0, false));
    stool.add(mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.1, 16), toon('#c1121f'), 0, 0.72, 0));
    stool.position.set(s.x, 0, s.z);
    seatable(stool, s.id, 0.75, interactables);
    group.add(stool);
  }

  // String lights: over the pergola, and criss-crossing the dance floor from the rig to poles along the south side of it.
  const bulbColors = ['#ffd166', '#ff8fa3', '#8ecae6', '#caffbf'];
  const bulbMats = bulbColors.map((c) => bulb(night, c, 0.45));
  const glowAt: number[] = [];
  const glowColor: number[] = [];
  const wire = toon(INK);
  const festoon = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= sag * 2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    statics.add(mesh(new THREE.TubeGeometry(curve, 20, 0.012, 4), wire, 0, 0, 0, false));
    const n = Math.max(2, Math.round(curve.getLength() / 0.6));
    for (let i = 1; i < n; i++) {
      const p = curve.getPoint(i / n);
      const j = i % bulbMats.length;
      statics.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), bulbMats[j], p.x, p.y - 0.06, p.z, false));
      glowAt.push(p.x, p.y - 0.06, p.z);
      const c = new THREE.Color(bulbColors[j]);
      glowColor.push(c.r, c.g, c.b);
    }
  };
  for (let z = p0.z + 0.6; z < p1.z; z += 2.9) festoon(new THREE.Vector3(p0.x, roofY - 0.1, z), new THREE.Vector3(p1.x, roofY - 0.1, z + 1.4), 0.25);
  // (Two poles, one either side, so nothing stands between the dance floor and the DJ.)
  const poles = [DANCE_FLOOR.minX - 0.6, DANCE_FLOOR.maxX + 0.6].map((x) => new THREE.Vector3(x, 3.4, DANCE_FLOOR.maxZ + 0.6));
  for (const p of poles) {
    statics.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8), toon(INK), p.x, 1.7, p.z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.1, 12), toon(INK), p.x, 0.05, p.z, false));
    colliders.push({ minX: p.x - 0.12, maxX: p.x + 0.12, minZ: p.z - 0.12, maxZ: p.z + 0.12, top: 99 });
  }
  const rigCorners = [new THREE.Vector3(STAGE.minX + 0.2, rigTop - 0.6, rigZ), new THREE.Vector3(STAGE.maxX - 0.2, rigTop - 0.6, rigZ)];
  festoon(rigCorners[0], poles[1], 0.35);
  festoon(rigCorners[1], poles[0], 0.35);
  festoon(rigCorners[0], poles[0], 0.3);
  festoon(rigCorners[1], poles[1], 0.3);
  festoon(poles[0], poles[1], 0.4);
  festoon(poles[1], new THREE.Vector3(p0.x, roofY - 0.1, p0.z), 0.35);
  // Their glow at night.
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowAt, 3));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowColor, 3));
  const halo = canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  const glows = unpickable(new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 0.55, map: halo, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
  group.add(glows);

  const barLight = new THREE.PointLight('#ffc98a', 0, 11, 1.2);
  barLight.position.set(bx + 1.2, 2.8, bz);
  group.add(barLight);

  const lounge = buildLounge(night, { group, statics, colliders, interactables });
  const { flames, fireLight, fans } = lounge;


  group.add(mergeByMaterial(statics));

  // The games corner: the axe lane and the dart board.
  const games = buildBarGames(night);
  group.add(games.group);
  colliders.push(...games.colliders);
  interactables.push(...games.interactables);

  // ---- Moving it all to the music ---------------------------------------------------------------
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();
  /** `calm`: the slow washes whatever the set is doing, for anyone who'd rather nothing flashed. */
  const drawLed = (f: DjFrame, t: number, calm: boolean) => paintLed(ledCtx, led, f, t, calm);

  return {
    group,
    colliders,
    interactables,
    elevator,
    city,
    setFloors: (n, wings) => city.setFloors(n, wings),
    pickables: group.children.filter((c) => c !== city.group),
    pourAt: { x: bx + 0.2, y: ROOF_BAR.height + 0.2, z: bz },
    games,
    serve(z: number) {
      tendZ = THREE.MathUtils.clamp(z, ROOF_BAR.minZ + 0.6, ROOF_BAR.maxZ - 0.6);
      wander = 6;
      bartender.cheer(1.2);
    },
    update(t, dt, f, env) {
      const { dark, motion } = env;
      const m = motion ? 1 : 0;
      const e = f.energy;
      const drop = f.part === 'drop';
      // How much the lights stand out: faint in the sun, blazing at night.
      const show = 0.3 + 0.7 * dark;
      city.update(t, dt, dark);
      elevator.update(dt);
      games.update(dt, dark);
      dj.update(t, f, motion);

      // The bartender drifts along the bar between customers, and comes over when someone orders.
      wander -= dt;
      if (wander <= 0) {
        wander = 5 + Math.random() * 6;
        tendZ = ROOF_BAR.minZ + 1 + Math.random() * (ROOF_BAR.maxZ - ROOF_BAR.minZ - 2);
      }
      const bp = bartender.root.position;
      bp.z += THREE.MathUtils.clamp(tendZ - bp.z, -dt * 1.6, dt * 1.6);
      bartender.update(dt, t);

      // Speaker cones thump.
      for (const c of cones) c.scale.setScalar(1 + 0.12 * f.kick * m);
      for (const fan of fans) fan.rotation.y += dt * 9;

      // Moving heads, lasers and the dance floor go by the set.
      aimHeads(heads, f, t, motion, show, tmp);
      sweepLasers(lasers, f, t, dark, motion);
      paintDanceFloor(tiles, cols, rows, f, t, motion, tmp);

      // Washes, the stage's strip, the glow under the bar, the fire and the bulbs' halos.
      washes.forEach((w, i) => {
        w.color.copy(hue(tmp, f.hue + i * 0.33 + (drop ? Math.floor(f.beats / 2) * 0.17 : t * 0.02), 0.5));
        w.intensity = (1.2 + 5 * e * (drop ? f.beat : 0.4)) * show;
      });
      stripMat.color.copy(hue(tmp, f.hue + 0.5, 0.45 + 0.2 * f.beat));
      barGlow.color.copy(hue(tmp2, f.hue + 0.15 + t * 0.01, 0.5));
      glowMat.color.set('#ffb55a').multiplyScalar(0.75 + 0.35 * dark);
      barLight.intensity = 0.6 + 2.6 * dark;
      const flicker = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 7.3 + 1);
      for (let i = 0; i < flames.length; i++) {
        const fl = flames[i];
        fl.scale.set(1, (0.75 + 0.35 * Math.abs(Math.sin(t * (5 + i) + i * 1.7))) * flicker, 1);
      }
      fireLight.intensity = (1.2 + 1.6 * dark) * flicker;
      glows.material.opacity = dark * 0.85;
      glows.visible = dark > 0.02;
      neonMat.opacity = 0.9 + 0.1 * Math.sin(t * 3);
      jog.color.copy(hue(tmp, f.hue + 0.6, 0.55));
      // The LED wall redraws twenty times a second.
      if (t - ledAt > 0.05) {
        ledAt = t;
        drawLed(f, t, !motion);
      }
      // Strobes: on each snare as the drop lands and through the build's last bar, a couple a second at most.
      if (!motion) return 0;
      if (drop && f.sinceDrop < 6) return f.snare;
      if (f.part === 'build' && f.rise > 7 / 8) return f.beat;
      return 0;
    },
  };
}
