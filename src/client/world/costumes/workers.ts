import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { detail, Z } from './shared';

// ---- The workers --------------------------------------------------------------------------------

/** The worker's bean-shaped body (see Worker): a capsule standing at y 0.4..0.7, 0.28 round. */
export const BEAN = { y: 0.55, half: 0.15, r: 0.28 } as const;

/** A point on the bean at height `y`, `a` round from the front (+z; +x is positive), `out` off its surface, and which way is out there. */
export function onBean(y: number, a: number, out = 0): { at: THREE.Vector3; normal: THREE.Vector3 } {
  const c = THREE.MathUtils.clamp(y, BEAN.y - BEAN.half, BEAN.y + BEAN.half);
  const dy = y - c;
  const rr = Math.sqrt(Math.max(0, BEAN.r * BEAN.r - dy * dy));
  const normal = new THREE.Vector3(Math.sin(a) * rr, dy, Math.cos(a) * rr).normalize();
  return { at: new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr).addScaledVector(normal, out), normal };
}

/** Lays `m` on the bean at (y, a), its +z pointing out of the surface. */
export function stick<T extends THREE.Object3D>(m: T, y: number, a: number, out = 0): T {
  const { at, normal } = onBean(y, a, out);
  m.position.copy(at);
  m.quaternion.setFromUnitVectors(Z, normal);
  return m;
}

/** A stitched-up line over the bean from (y0, a0) to (y1, a1): thread, with cross stitches every so often. */
export function stitches(g: THREE.Group, from: [number, number], to: [number, number], crossings: number, wobble = 0) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push(onBean(THREE.MathUtils.lerp(from[0], to[0], k) + Math.sin(k * 9) * wobble, THREE.MathUtils.lerp(from[1], to[1], k), 0.004).at);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const thread = detail('#3b2a2a');
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.009, 5), thread, 0, 0, 0, false));
  const stitch = new THREE.BoxGeometry(0.075, 0.014, 0.014);
  for (let i = 0; i < crossings; i++) {
    const k = (i + 0.5) / crossings;
    const at = curve.getPointAt(k);
    const along = curve.getTangentAt(k);
    const normal = at.clone().setY(at.y - THREE.MathUtils.clamp(at.y, BEAN.y - BEAN.half, BEAN.y + BEAN.half)).normalize();
    const across = new THREE.Vector3().crossVectors(normal, along).normalize();
    const up = new THREE.Vector3().crossVectors(normal, across).normalize();
    const s = mesh(stitch, thread, at.x, at.y, at.z, false);
    s.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, normal));
    s.rotateZ(i % 2 ? 0.25 : -0.25);
    g.add(s);
  }
}

/** A zombie's bits, over the worker's own body: a stitched grin and scar, a drooping eyelid, bandages, rot. */
export function zombieWorker(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // A grim stitched mouth across the front, and a scar over the top of the head.
  stitches(g, [0.5, -0.42], [0.5, 0.42], 6, 0.012);
  stitches(g, [0.93, -0.9], [0.82, -0.1], 4);
  // The right eye (the one on +x) half shut under a drooping lid.
  const lid = mesh(new THREE.SphereGeometry(0.098, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0.11, 0.7, 0.235, false);
  lid.scale.set(1.04, 1, 0.64);
  lid.rotation.x = 0.55;
  lid.rotation.z = -0.25;
  g.add(lid);
  // Rotten patches.
  const rot = detail('#4d6b3c');
  for (const [y, a, r] of [
    [0.38, 0.55, 0.06],
    [0.62, -1.95, 0.075],
    [0.84, 2.3, 0.06],
    [0.3, -2.8, 0.05],
  ]) {
    const patch = stick(mesh(new THREE.SphereGeometry(r, 10, 8), rot, 0, 0, 0, false), y, a, -0.012);
    patch.scale.z = 0.3;
    g.add(patch);
  }
  // Grubby bandages round the middle, one wrap coming loose.
  const linen = toon('#e3dcc4');
  for (const [y, tilt, r] of [
    [0.33, 0.22, 0.284],
    [0.4, -0.16, 0.29],
  ]) {
    const wrap = mesh(new THREE.TorusGeometry(r, 0.028, 6, 28), linen, 0, y, 0);
    wrap.rotation.set(Math.PI / 2 + tilt, 0, 0);
    wrap.scale.z = 1.4;
    g.add(wrap);
  }
  const loose = stick(mesh(new THREE.BoxGeometry(0.06, 0.16, 0.012), linen, 0, 0, 0), 0.26, 2.2, 0.01);
  loose.rotateX(0.25);
  g.add(loose);
  g.add(stick(mesh(new THREE.SphereGeometry(0.022, 8, 6), detail('#8f1d21'), 0, 0, 0, false), 0.36, -0.7, 0.03));
  return g;
}

/** An elf's hat, whose pom-pom is the worker's status bulb (it sits right on the tip). */
export function elfHat(): THREE.Group {
  const g = new THREE.Group();
  const brim = mesh(new THREE.TorusGeometry(0.205, 0.05, 8, 28), toon('#fffaf3'), 0, 0.9, 0);
  brim.rotation.x = Math.PI / 2;
  g.add(brim);
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.3, 24), toon('#2e9e48'), 0, 1.05, 0));
  const band = mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 24), toon('#d62828'), 0, 1.0, 0, false);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  return g;
}

/** An elf's pointy ears (in the worker's own color), a jester's collar with bells, and a belt. */
export function elfWorker(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.045, 0.17, 10), skin, sx * 0.27, 0.85, 0.0);
    ear.rotation.set(0, 0, -sx * 1.05);
    g.add(ear);
  }
  const flap = new THREE.ConeGeometry(0.075, 0.15, 4).rotateX(Math.PI).scale(1, 1, 0.35).translate(0, -0.07, 0.01);
  const red = toon('#d62828');
  const green = toon('#2e9e48');
  const gold = detail('#ffc233');
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const f = stick(mesh(flap, i % 2 ? green : red, 0, 0, 0, false), 0.57, a, 0.012);
    f.rotateX(-0.3);
    g.add(f);
    if (i % 2 === 0) g.add(stick(mesh(new THREE.SphereGeometry(0.022, 8, 6), gold, 0, 0, 0, false), 0.43, a, 0.045));
  }
  const belt = mesh(new THREE.TorusGeometry(0.273, 0.03, 6, 28), toon('#2b2d42'), 0, 0.3, 0, false);
  belt.rotation.x = Math.PI / 2;
  g.add(belt);
  g.add(stick(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.02), detail('#ffc233'), 0, 0, 0, false), 0.3, 0, 0.03));
  g.add(stick(mesh(new THREE.BoxGeometry(0.055, 0.035, 0.02), detail('#2b2d42'), 0, 0, 0, false), 0.3, 0, 0.037));
  return g;
}

/** A curly-toed elf boot with a bell on the toe, for a worker's foot (its capsule's middle is 0,0,0). */
export function elfBoot(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  const sole = mesh(new THREE.SphereGeometry(0.075, 12, 8), red, 0, -0.06, 0.02);
  sole.scale.set(1, 0.65, 1.3);
  g.add(sole);
  const toe = new THREE.Group();
  toe.position.set(0, -0.06, 0.09);
  toe.rotation.x = -0.75;
  toe.add(mesh(new THREE.ConeGeometry(0.04, 0.13, 8).rotateX(Math.PI / 2).translate(0, 0, 0.06), red, 0, 0, 0, false));
  toe.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), detail('#ffc233'), 0, 0, 0.135, false));
  g.add(toe);
  return g;
}
