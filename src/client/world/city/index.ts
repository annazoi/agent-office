import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_T, roofDrop } from '../../../shared/layout';
import { mulberry32 } from '../../../shared/rng';
import type { NightParts } from '../outside';
import { mergeByMaterial, mesh, toon } from '../toon';
import { buildTower } from '../tower';
import type { City, Lot, Car } from './shared';
import { B, PERIOD, STREET_X, STREET_Z, ROAD, WALK, RADIUS, LAID_OUT, PAINTS, GLASS_TOWERS, rise } from './shared';
import { bayTexture, litTexture, groundTexture } from './textures';
import { Walls } from './walls';
import { tree, glowTexture, mergeGeometries } from './props';
export type { City } from './shared';

// The city around the rooftop bar: the building's own floors going down to the street (as the tower
// looks from outside, world/tower.ts), a grid of streets with cars running along them, parks, and
// blocks of buildings out to the haze, most of them lower than the roof so you look out over them,
// with a skyline of towers further off. At night their windows light up, the street lamps come on
// and the cars' lights show. The building is as tall as there are floors, so the street is that far
// down (see setFloors), and the buildings round about are only as tall as leaves the view over them.
//
// Everything is built from a handful of shared materials (a window texture per paint, repeated a
// window at a time), merged into a few meshes, so the whole city is a few dozen draw calls.

export function buildCity(night: NightParts): City {
  const group = new THREE.Group();
  /** Everything down on the street, which is as far below the roof as the building is tall. */
  const street = new THREE.Group();
  group.add(street);
  // The same numbers every time, so everyone sees the same city.
  const r = mulberry32(20260927);

  // The ground: every block and street, repeated out to the haze.
  const size = PERIOD * 24;
  const groundGeo = new THREE.PlaneGeometry(size, size);
  groundGeo.rotateX(-Math.PI / 2);
  const uv = groundGeo.getAttribute('uv') as THREE.BufferAttribute;
  const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
  // Line the texture up with the streets: a road down its middle falls on x = STREET_X, z = STREET_Z.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (gp.getX(i) - STREET_X) / PERIOD + 0.5, (gp.getZ(i) - STREET_Z) / PERIOD + 0.5);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ map: groundTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  ground.receiveShadow = false;
  street.add(ground);

  // The blocks: parks now and then, and lots with a building on each, laid out once. How tall the
  // buildings stand depends on the roof (see raise, below).
  const lots: Lot[] = [];
  const parks = new THREE.Group();
  const blockAt = (i: number, j: number) => ({ x: STREET_X - PERIOD / 2 + i * PERIOD, z: STREET_Z - PERIOD / 2 + j * PERIOD });
  const inner = PERIOD - ROAD - WALK * 2;
  const n = Math.ceil(RADIUS / PERIOD) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const { x: bx, z: bz } = blockAt(i, j);
      const dist = Math.hypot(bx, bz);
      if (dist > RADIUS) continue;
      // The block the office stands on: a plaza round it.
      if (i === 0 && j === 0) continue;
      // Now and then a park, with trees.
      if (r() < 0.1 && dist > 60) {
        const park = mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#8fcf7a'), bx, 0.03, bz, false);
        parks.add(park);
        for (let k = 0; k < 7; k++) {
          const t = tree(r);
          t.position.set(bx + (r() - 0.5) * (inner - 6), 0, bz + (r() - 0.5) * (inner - 6));
          parks.add(t);
        }
        continue;
      }
      // The block split into lots: one big one, two halves or four quarters.
      const split = r();
      const plots: [number, number, number, number][] = [];
      const gap = 2;
      if (split < 0.25) plots.push([bx, bz, inner, inner]);
      else if (split < 0.6) {
        const w = (inner - gap) / 2;
        const alongX = r() < 0.5;
        for (const s of [-1, 1]) plots.push(alongX ? [bx + (s * (w + gap)) / 2, bz, w, inner] : [bx, bz + (s * (w + gap)) / 2, inner, w]);
      } else {
        const w = (inner - gap) / 2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) plots.push([bx + (sx * (w + gap)) / 2, bz + (sz * (w + gap)) / 2, w, w]);
      }
      // Lower than the roof round about, so you see out over them; taller further out, and tallest
      // downtown, off to the north-east, where the skyline is.
      const downtown = Math.max(0, 1 - Math.hypot(bx - 210, bz + 220) / 150);
      for (const [lx, lz, lw, ld] of plots) {
        const back = 1 + r() * 3;
        const w = lw - back * 2;
        const d = ld - back * 2;
        if (w < 6 || d < 6) continue;
        let h: number;
        if (dist < 100) h = 9 + r() * 24 + (r() < 0.1 ? 8 : 0);
        else if (dist < 190) h = r() < 0.1 ? 50 + r() * 40 : 12 + r() * 28;
        else h = r() < 0.2 ? 65 + r() * 95 : 20 + r() * 30;
        h *= 1 + downtown * 1.3;
        const glassy = h > 70 && r() < 0.6;
        const paint = glassy ? GLASS_TOWERS[Math.floor(r() * GLASS_TOWERS.length)] : Math.floor(r() * 7);
        const lot: Lot = { x: lx, z: lz, w, d, h, paint, ou: Math.floor(r() * 16), ov: Math.floor(r() * 16), ring: dist < 100 ? 0 : dist < 190 ? 1 : 2 };
        let tall = h;
        let tw = w;
        let td = d;
        // Tall ones step back once on the way up.
        if (h > 55 && r() < 0.6) {
          tw = w * (0.55 + r() * 0.25);
          td = d * (0.55 + r() * 0.25);
          lot.step = { w: tw, d: td, up: 12 + r() * h * 0.5 };
          tall += lot.step.up;
        }
        // On the roof: a water tower, a box of air conditioning, or a mast with a red light.
        const what = r();
        if (tall > 90) lot.top = { kind: 'mast' };
        else if (what < 0.3) lot.top = { kind: 'tank', x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        else if (what < 0.65) {
          const pw = 3 + r() * 3;
          const pd = 2 + r() * 2;
          lot.top = { kind: 'plant', w: pw, d: pd, x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        }
        lots.push(lot);
      }
    }
  }

  // The office's own building, a floor per project, from the street up to the roof, and the open
  // garage at the bottom: walled at the back and on the west side, columns along the other two.
  const building = buildTower([], night);
  group.add(building.group);
  const garage = new THREE.Group();
  const garageH = -STREET_Y - SLAB;
  const concrete = toon('#d3d6dd');
  garage.add(mesh(new THREE.BoxGeometry(B.maxX - B.minX, garageH, WALL_T), concrete, (B.minX + B.maxX) / 2, garageH / 2, B.minZ + WALL_T / 2, false));
  garage.add(mesh(new THREE.BoxGeometry(WALL_T, garageH, B.maxZ - B.minZ), concrete, B.minX + WALL_T / 2, garageH / 2, (B.minZ + B.maxZ) / 2, false));
  const column = new THREE.BoxGeometry(0.5, garageH, 0.5);
  for (const x of [B.maxX - 0.25, -9.6, 0, 9.6]) garage.add(mesh(column, toon('#e6e8ee'), x, garageH / 2, B.maxZ - 0.25, false));
  for (const z of [-6.5, 6.5, B.minZ + 0.25]) garage.add(mesh(column, toon('#e6e8ee'), B.maxX - 0.25, garageH / 2, z, false));
  garage.add(mesh(new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ).rotateX(-Math.PI / 2), toon('#9a9ea8'), (B.minX + B.maxX) / 2, 0.03, (B.minZ + B.maxZ) / 2, false));
  street.add(mergeByMaterial(garage));
  // Its plaza, with a few trees in front.
  parks.add(mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#cfc8b8'), blockAt(0, 0).x, 0.02, blockAt(0, 0).z, false));
  for (const [x, z] of [
    [-16, 18],
    [-6, 18],
    [6, 18],
    [16, 18],
    [-20, -18],
    // Clear of the back office, when a floor's built out into one (see WING).
    [21, -20],
  ]) {
    const t = tree(r);
    t.position.set(x, 0, z);
    parks.add(t);
  }
  street.add(mergeByMaterial(parks));

  // The buildings' walls (a material for each paint), their roofs, and what's on them.
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const paintMats = new Map<number, THREE.MeshToonMaterial>();
  const paintOf = (i: number) => {
    let m = paintMats.get(i);
    if (!m) {
      const p = PAINTS[i];
      const lit = litTexture(p, i + 1);
      lit.repeat.set(1 / 16, 1 / 16);
      m = new THREE.MeshToonMaterial({ map: bayTexture(p), emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: gradient });
      night.windows.push(m);
      paintMats.set(i, m);
    }
    return m;
  };
  const roofs = toon('#a19d97');
  const mastGeo = new THREE.CylinderGeometry(0.2, 0.35, 12, 6);
  const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5);
  const tankGeo = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12);
  const capGeo = new THREE.ConeGeometry(1.8, 1.3, 12);
  const unitGeo = new THREE.BoxGeometry(1, 1.6, 1);
  const glow = glowTexture();
  const beaconMat = new THREE.PointsMaterial({ size: 5, map: glow, color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beaconPoints = new THREE.Points(new THREE.BufferGeometry(), beaconMat);
  street.add(beaconPoints);
  let raised: THREE.Object3D[] = [];

  /** Puts up the buildings, each as tall as `rise` says with the street `drop` below the roof. */
  const raise = (drop: number) => {
    for (const o of raised) {
      o.removeFromParent();
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
      });
    }
    raised = [];
    const walls = new Map<number, Walls>();
    const tops = new Walls();
    const extras = new THREE.Group();
    const beacons: number[] = [];
    for (const lot of lots) {
      const k = rise(lot.ring, drop);
      let bucket = walls.get(lot.paint);
      if (!bucket) walls.set(lot.paint, (bucket = new Walls()));
      let topY = lot.h * k;
      bucket.box(lot.x, lot.z, lot.w, lot.d, 0, topY, lot.ou, lot.ov);
      let tw = lot.w;
      let td = lot.d;
      if (lot.step) {
        tops.top(lot.x, lot.z, lot.w, lot.d, topY);
        tw = lot.step.w;
        td = lot.step.d;
        bucket.box(lot.x, lot.z, tw, td, topY, topY + lot.step.up * k, lot.ou + 5, lot.ov + 3);
        topY += lot.step.up * k;
      }
      tops.top(lot.x, lot.z, tw, td, topY);
      const top = lot.top;
      if (top?.kind === 'mast') {
        extras.add(mesh(mastGeo, toon('#8d99ae'), lot.x, topY + 6, lot.z, false));
        beacons.push(lot.x, topY + 12.3, lot.z);
      } else if (top?.kind === 'tank') {
        const wt = new THREE.Group();
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          wt.add(mesh(legGeo, toon('#5b3a29'), sx * 1.1, 1.2, sz * 1.1, false));
        wt.add(mesh(tankGeo, toon('#9c6b4a'), 0, 4, 0, false));
        wt.add(mesh(capGeo, toon('#6b4a35'), 0, 6.25, 0, false));
        wt.position.set(top.x, topY, top.z);
        extras.add(wt);
      } else if (top?.kind === 'plant') {
        const unit = mesh(unitGeo, toon('#c9ccd4'), top.x, topY + 0.8, top.z, false);
        unit.scale.set(top.w, 1, top.d);
        extras.add(unit);
      }
    }
    for (const [paint, w] of walls) raised.push(new THREE.Mesh(w.geometry(), paintOf(paint)));
    raised.push(new THREE.Mesh(tops.geometry(), roofs), mergeByMaterial(extras));
    street.add(...raised);
    beaconPoints.geometry.dispose();
    beaconPoints.geometry = new THREE.BufferGeometry();
    beaconPoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  };

  // Street lamps down both sides of every street, and red lights blinking on the masts.
  const lampPos: number[] = [];
  for (let k = -n; k <= n; k++) {
    for (let a = -RADIUS; a <= RADIUS; a += 28) {
      for (const s of [-1, 1]) {
        const off = s * (ROAD / 2 + 0.6);
        const sx = STREET_X + k * PERIOD;
        const sz = STREET_Z + k * PERIOD;
        if (Math.hypot(sx, a) < RADIUS) lampPos.push(sx + off, 5, a);
        if (Math.hypot(a, sz) < RADIUS) lampPos.push(a, 5, sz + off);
      }
    }
  }
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 4, map: glow, color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamps.visible = false;
  street.add(lamps);

  // Cars, up and down the streets round the office's block.
  const cars: Car[] = [];
  const lanes: [boolean, number][] = [
    [true, STREET_Z],
    [true, STREET_Z - PERIOD],
    [false, STREET_X],
    [false, STREET_X - PERIOD],
    [true, STREET_Z + PERIOD],
    [false, STREET_X + PERIOD],
  ];
  for (const [alongX, line] of lanes) {
    for (let k = 0; k < 7; k++) {
      const dir = k % 2 ? 1 : -1;
      cars.push({ alongX, lane: line + dir * (ROAD / 4) * (alongX ? 1 : -1), dir, at: -RADIUS + r() * RADIUS * 2, speed: 9 + r() * 6 });
    }
  }
  const body = new THREE.BoxGeometry(4.2, 1.05, 1.9).translate(0, 0.9, 0);
  const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.7).translate(-0.3, 1.75, 0);
  const carGeo = mergeGeometries([body, cabin]);
  const carMesh = new THREE.InstancedMesh(carGeo, toon('#ffffff'), cars.length);
  const paints = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#3d405b', '#e07a5f', '#8ecae6'];
  cars.forEach((_, i) => carMesh.setColorAt(i, new THREE.Color(paints[Math.floor(r() * paints.length)])));
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff6d0' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2d2d' });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.3, 1.6).translate(2.12, 0.95, 0), headMat, cars.length);
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.25, 1.6).translate(-2.12, 0.95, 0), tailMat, cars.length);
  for (const m of [carMesh, heads, tails]) {
    m.frustumCulled = false;
    street.add(m);
  }
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const moveCars = (dt: number) => {
    cars.forEach((c, i) => {
      c.at += c.dir * c.speed * dt;
      if (c.at > RADIUS) c.at -= RADIUS * 2;
      if (c.at < -RADIUS) c.at += RADIUS * 2;
      if (c.alongX) at.set(c.at, 0, c.lane);
      else at.set(c.lane, 0, c.at);
      // The car's nose is +x: turned to face the way it's going.
      const yaw = c.alongX ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      q.setFromAxisAngle(up, yaw);
      place.compose(at, q, one);
      carMesh.setMatrixAt(i, place);
      heads.setMatrixAt(i, place);
      tails.setMatrixAt(i, place);
    });
    for (const m of [carMesh, heads, tails]) m.instanceMatrix.needsUpdate = true;
  };
  moveCars(0);

  // Clouds, drifting past at about the height of the towers.
  const cloud = night.clouds;
  const sky = new THREE.Group();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r();
    const dist = 220 + r() * 120;
    const c = new THREE.Group();
    for (const [dx, dy, rad] of [
      [0, 0, 9],
      [10, -2, 7],
      [-10, -2, 6.5],
      [4, 4, 6],
    ]) {
      const puff = mesh(new THREE.SphereGeometry(rad, 12, 9), cloud, dx, dy, 0, false);
      puff.scale.y = 0.7;
      c.add(puff);
    }
    c.position.set(Math.cos(a) * dist, 40 + r() * 50, Math.sin(a) * dist);
    c.lookAt(0, c.position.y, 0);
    sky.add(c);
  }
  group.add(mergeByMaterial(sky));

  let floorsNow = 0;
  let wingsNow = '';
  let riseNow = -1;
  return {
    group,
    setFloors(floors, wings = []) {
      floors = Math.max(1, floors);
      if (floors === floorsNow && wings.join() === wingsNow) return;
      floorsNow = floors;
      wingsNow = wings.join();
      const drop = roofDrop(floors);
      street.position.y = -drop;
      building.set(floors, floors, wings);
      // The buildings only change height up to six floors (see rise).
      const k = Math.min(1, drop / LAID_OUT);
      if (k !== riseNow) {
        riseNow = k;
        raise(drop);
      }
    },
    update(t, dt, dark) {
      moveCars(dt);
      lamps.visible = dark > 0.02;
      lamps.material.opacity = dark;
      headMat.color.setScalar(0.75 + 0.25 * dark);
      // The masts' lights blink, a second on and a second off, brighter at night.
      beaconMat.opacity = (Math.sin(t * Math.PI) > 0 ? 1 : 0.08) * (0.35 + 0.65 * dark);
    },
  };
}
