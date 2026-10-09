import * as THREE from 'three';
import type { DogAct } from '../../../shared/toys/dog';

// Fitting a dog's model once it's loaded: the capsules the mouse picks it by, and how far its top sinks in each clip.

/** What it's doing, as its clips have it: one of its acts, or on its way there at a trot or, in a hurry, a gallop. */
export type Act = DogAct | 'walk' | 'run';

/**
 * What the mouse picks it by: a capsule on each of these bones, from the bone to the next one down its
 * chain (null at the end of one), fitted to whichever breed it is (see fitPicking). Picking its skin
 * itself, three would pose every vertex in JavaScript for each ray, some 6 ms a ray, and in first person
 * the crosshair casts one every frame.
 */
const PICK: [bone: string, next: string | null][] = [
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['head', null],
  ['jaw', null],
  ['tail_1', 'tail_2'],
  ['tail_2', 'tail_3'],
  ['tail_3', null],
  ...['L', 'R'].flatMap((s): [string, string | null][] => [
    [`front_upper_${s}`, `front_lower_${s}`],
    [`front_lower_${s}`, `front_paw_${s}`],
    [`front_paw_${s}`, null],
    [`back_upper_${s}`, `back_lower_${s}`],
    [`back_lower_${s}`, `back_paw_${s}`],
    [`back_paw_${s}`, null],
    [`ear_${s}`, `ear_tip_${s}`],
    [`ear_tip_${s}`, null],
  ]),
];

/** How much of the skin a bone pulls on its capsule is thick enough to take in (the odd stray vertex is left out). */
const PICK_REACH = 0.9;

/**
 * The picking capsules' material: never drawn (nor outlined), yet rays still hit them. Hiding the capsules
 * with `visible = false` instead would get their hits skipped in main.ts.
 */
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });

/**
 * A vertex belongs to a bone's capsule when the bone pulls on it this much or more (not the blend between
 * two). A bone with fewer than PICK_FEW such (a short leg shared out between its bones) takes the vertices
 * it pulls on more than any other bone does instead.
 */
const PICK_OWN = 0.6;
const PICK_FEW = 12;

/**
 * The picking capsules for a model at rest (see PICK), on its bones, and how tall it stands. Each bone's
 * capsule runs from it to the next bone down its chain, or at the end of a chain through the middle of the
 * skin the bone pulls on, the way that's longest, its round ends where the skin ends. It's as thick as
 * that skin reaches round it (see PICK_REACH), so it fits a corgi's legs as well as a dachshund's head.
 */
export function fitPicking(model: THREE.Object3D): { pick: THREE.Mesh[]; top: number } {
  model.updateMatrixWorld(true);
  // Every vertex at rest, under the bone that pulls on it (see PICK_OWN), and under the one that pulls most.
  const owned = new Map<string, THREE.Vector3[]>();
  const most = new Map<string, THREE.Vector3[]>();
  const add = (map: Map<string, THREE.Vector3[]>, bone: string, v: THREE.Vector3) => {
    const list = map.get(bone);
    if (list) list.push(v);
    else map.set(bone, [v]);
  };
  let top = 0;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const { position, skinIndex, skinWeight } = m.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(m.matrixWorld);
      top = Math.max(top, v.y);
      let k = 0;
      for (let c = 1; c < 4; c++) if (skinWeight.getComponent(i, c) > skinWeight.getComponent(i, k)) k = c;
      add(most, m.skeleton.bones[skinIndex.getComponent(i, k)].name, v);
      if (skinWeight.getComponent(i, k) >= PICK_OWN) add(owned, m.skeleton.bones[skinIndex.getComponent(i, k)].name, v);
    }
  });
  const pick: THREE.Mesh[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const on = new THREE.Vector3();
  /** How far out from a to b the skin reaches (see PICK_REACH). */
  const thickness = (verts: THREE.Vector3[], a: THREE.Vector3, b: THREE.Vector3) => {
    const line = new THREE.Line3(a, b);
    return quantile(verts.map((v) => line.closestPointToPoint(v, true, on).distanceTo(v)));
  };
  for (const [name, next] of PICK) {
    const bone = model.getObjectByName(name);
    const own = owned.get(name);
    const verts = own && own.length >= PICK_FEW ? own : most.get(name);
    if (!bone || !verts) continue;
    const a = bone.getWorldPosition(new THREE.Vector3());
    const child = next ? model.getObjectByName(next) : undefined;
    let b: THREE.Vector3;
    let radius: number;
    if (child) {
      b = child.getWorldPosition(new THREE.Vector3());
      radius = thickness(verts, a, b);
    } else {
      // The end of a chain (a paw, the head, the tip of the tail or an ear): through the middle of its
      // skin, the way that skin is longest, with its round ends where it ends.
      const middle = verts.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(verts.length);
      const along = longest(verts, middle);
      let near = 0;
      let far = 0;
      for (const v of verts) {
        const t = on.subVectors(v, middle).dot(along);
        near = Math.min(near, t);
        far = Math.max(far, t);
      }
      radius = thickness(verts, middle.clone().addScaledVector(along, near), middle.clone().addScaledVector(along, far));
      const ends = [Math.min(near + radius, 0), Math.max(far - radius, 0)];
      a.copy(middle).addScaledVector(along, ends[0]);
      b = middle.clone().addScaledVector(along, ends[1]);
    }
    const length = a.distanceTo(b);
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 2, 8), UNSEEN);
    capsule.position.lerpVectors(a, b, 0.5);
    if (length > 1e-6) capsule.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    bone.attach(capsule);
    pick.push(capsule);
  }
  return { pick, top };
}

/** The way a cloud of points around `middle` is longest: its spread's main axis, found by power iteration. */
function longest(points: THREE.Vector3[], middle: THREE.Vector3): THREE.Vector3 {
  let [xx, xy, xz, yy, yz, zz] = [0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const x = p.x - middle.x;
    const y = p.y - middle.y;
    const z = p.z - middle.z;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const spread = new THREE.Matrix3().set(xx, xy, xz, xy, yy, yz, xz, yz, zz);
  // Any start that isn't square to the answer will do.
  const axis = new THREE.Vector3(0.3, 0.5, 0.8).normalize();
  for (let i = 0; i < 32 && axis.lengthSq() > 0; i++) axis.applyMatrix3(spread).normalize();
  return axis.lengthSq() > 0 ? axis : new THREE.Vector3(0, 1, 0);
}

/** The value PICK_REACH of the way up a list of them. */
function quantile(values: number[]): number {
  values.sort((x, y) => x - y);
  return values[Math.floor((values.length - 1) * PICK_REACH)];
}

/**
 * How far the top of it sinks from standing at rest in each clip, at its tallest of four moments through
 * it, for its name tag and bubbles to sink with it: sitting up it's as tall, sniffing only its tail is up,
 * lying down its head is. Every fifth vertex is posed (in JavaScript, once), on a mixer of its own, which
 * puts every bone back at rest when it stops.
 */
export function drops(model: THREE.Object3D, clips: THREE.AnimationClip[], standing: number): Partial<Record<Act, number>> {
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  const v = new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(model);
  const drop: Partial<Record<Act, number>> = {};
  for (const clip of clips) {
    const action = mixer.clipAction(clip).play();
    let top = 0;
    for (let k = 0; k < 4; k++) {
      mixer.setTime((clip.duration * k) / 4);
      model.updateMatrixWorld(true);
      for (const m of meshes) {
        for (let i = 0; i < m.geometry.attributes.position.count; i += 5) top = Math.max(top, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y);
      }
    }
    drop[clip.name as Act] = Math.max(0, standing - top);
    action.stop();
  }
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
  return drop;
}
