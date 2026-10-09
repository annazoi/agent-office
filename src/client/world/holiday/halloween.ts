import * as THREE from 'three';
import { WALL_HEIGHT } from '../../../shared/building/layout';
import { batWingGeometry } from '../costumes';
import { mesh, toon } from '../toon';

// ---- Gravestones, cobwebs, bats -----------------------------------------------------------------

/** A gravestone (a rounded slab, a cross, or a squat marker) with a mound of earth in front, facing +z. */
export function gravestone(kind: number): THREE.Group {
  const g = new THREE.Group();
  const stone = toon('#9a9ca8');
  if (kind === 1) {
    g.add(mesh(new THREE.BoxGeometry(0.16, 1.2, 0.14), stone, 0, 0.6, 0));
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.16, 0.14), stone, 0, 0.85, 0));
  } else {
    const w = kind === 2 ? 0.8 : 0.62;
    const h = kind === 2 ? 0.45 : 0.72;
    g.add(mesh(new THREE.BoxGeometry(w, h, 0.16), stone, 0, h / 2, 0));
    g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.16, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), stone, 0, h, 0));
  }
  const mound = mesh(new THREE.SphereGeometry(0.55, 14, 8), toon('#5b4636'), 0, -0.02, 0.75);
  mound.scale.set(0.8, 0.22, 1.35);
  g.add(mound);
  g.rotation.z = (kind - 1) * 0.07;
  return g;
}

/** A spider's web, hub near the top, in a canvas: white threads on nothing. */
export function webTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const hub = [128, 70] as const;
  const ends: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = -0.1 + (i / 10) * (Math.PI + 0.2);
    ends.push([hub[0] + Math.cos(a) * 260, hub[1] + Math.sin(a) * 260]);
  }
  g.strokeStyle = 'rgba(245, 245, 255, 0.9)';
  g.lineWidth = 2;
  for (const [x, y] of ends) {
    g.beginPath();
    g.moveTo(hub[0], hub[1]);
    g.lineTo(x, y);
    g.stroke();
  }
  g.lineWidth = 1.5;
  for (let r = 18; r < 240; r *= 1.32) {
    g.beginPath();
    ends.forEach(([x, y], i) => {
      const k = r / 260;
      const px = hub[0] + (x - hub[0]) * k;
      const py = hub[1] + (y - hub[1]) * k;
      if (i === 0) g.moveTo(px, py);
      // Sagging a little between the threads.
      else {
        const [x0, y0] = ends[i - 1];
        const mx = hub[0] + ((x + x0) / 2 - hub[0]) * k * 0.9;
        const my = hub[1] + ((y + y0) / 2 - hub[1]) * k * 0.9;
        g.quadraticCurveTo(mx, my, px, py);
      }
    });
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A web strung across a top corner of the room, where the walls meet the ceiling at (x, z). */
export function cobweb(x: number, z: number, map: THREE.Texture): THREE.Mesh {
  const sx = Math.sign(x);
  const sz = Math.sign(z);
  const H = WALL_HEIGHT - 0.02;
  const S = 2.2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x - sx * S, H, z, x, H, z - sz * S, x, H - S * 1.1, z], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
}

export interface Bat {
  root: THREE.Group;
  wings: THREE.Object3D[];
  /** Round (cx, cz) at radius r, `speed` radians a second (the sign is which way), at height y. */
  cx: number;
  cz: number;
  r: number;
  y: number;
  speed: number;
  phase: number;
}

/** A bat: a black silhouette with flapping wings, flying toward +z. */
export function bat(mat: THREE.Material, scale: number): { root: THREE.Group; wings: THREE.Object3D[] } {
  const root = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.12, 10, 8), mat, 0, 0, 0, false);
  body.scale.set(0.8, 0.75, 1.3);
  root.add(body);
  root.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat, 0, 0.03, 0.16, false));
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.03, 0.08, 6), mat, sx * 0.04, 0.1, 0.16, false);
    ear.rotation.z = -sx * 0.3;
    root.add(ear);
  }
  const geo = batWingGeometry(0.6);
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.06, 0.02, 0.04);
    const w = mesh(geo, mat, 0, 0, 0, false);
    w.scale.x = sx;
    pivot.add(w);
    root.add(pivot);
    wings.push(pivot);
  }
  root.scale.setScalar(scale);
  return { root, wings };
}

