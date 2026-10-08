// Building a Person's parts and posing its limbs for the cycles that need no state of their own.
import * as THREE from 'three';
import { HeldCard } from '../../features/carrying/card';
import { mesh, toon } from '../toon';
import { cigarette, coffeeMug } from './props';

/** The head: skull, hair (put on by `styleHair`), eyes, cheeks, the smile and the mouth that opens while talking. */
export function buildFace(skin: THREE.Material, ink: THREE.Material, hair: THREE.Group, styleHair: () => void) {
  const head = new THREE.Group();
  head.position.y = 1.32;
  head.add(mesh(new THREE.SphereGeometry(0.34, 20, 16), skin));
  head.add(hair);
  styleHair();
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
    head.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#ff9f9f'), sx * 0.2, -0.08, 0.27, false));
  }
  const smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.08, 0.32, false);
  smile.rotation.z = Math.PI;
  head.add(smile);
  // Talking mouth: a flattened ball pressed into the face, scaled open and shut with the voice.
  const mouth = mesh(new THREE.SphereGeometry(1, 16, 12), toon('#7a2635'), 0, -0.1, 0.295, false);
  const tongue = mesh(new THREE.SphereGeometry(1, 12, 10), toon('#ff8fa3'), 0, -0.5, 0, false);
  tongue.scale.set(0.6, 0.45, 1.15);
  mouth.add(tongue);
  mouth.visible = false;
  head.add(mouth);
  return { head, smile, mouth };
}

/** What the hands hold or point with: the mug, the cigarette, the card and book holders, and the pointing finger and thumb. */
export function buildHandProps(
  body: THREE.Group,
  armL: THREE.Object3D,
  armR: THREE.Object3D,
  mug: THREE.Group,
  cardHolder: THREE.Group,
  bookHolder: THREE.Group,
  skin: THREE.Material,
) {
  // Forward is +z, so the character's left arm is the one on +x. The handle faces the hand.
  const cup = coffeeMug(1.4);
  cup.position.set(0.02, -0.08, 0.1);
  cup.rotation.y = -Math.PI / 2;
  mug.add(cup);
  mug.position.set(0, -0.38, 0);
  mug.visible = false;
  armR.add(mug);
  // For smoke breaks: a cigarette sticking out of the right fist (the arm on -x, see reach), lit end
  // pointing down at your side and up and away when it's at your mouth.
  const cig = cigarette();
  const along = new THREE.Vector3(0, -0.9, -0.44).normalize();
  cig.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
  cig.group.position.set(0, -0.38, 0).addScaledVector(along, 0.07);
  cig.group.visible = false;
  armL.add(cig.group);
  // Between the hands when both arms are out in front (see update), its front to whoever they walk up to.
  cardHolder.position.set(0, 0.8, 0.36);
  cardHolder.rotation.x = -0.1;
  body.add(cardHolder);
  const card = new HeldCard(cardHolder, 0.46);
  // Held out at chest height, turned round and tipped up so the pages face their eyes, top edge
  // away from them, with the hands on its bottom corners.
  bookHolder.position.set(0, 1, 0.48);
  bookHolder.rotation.set(0.85, Math.PI, 0);
  bookHolder.scale.setScalar(1.25);
  body.add(bookHolder);
  // Along the arm (the fist's -y) the finger points; the thumb sticks out of the front of the fist,
  // which is up once the arm is out in front.
  const thumb = mesh(new THREE.CapsuleGeometry(0.035, 0.07, 4, 8).rotateX(Math.PI / 2), skin, 0, -0.38, 0.1, false);
  const finger = mesh(new THREE.CapsuleGeometry(0.03, 0.09, 4, 8), skin, 0, -0.5, 0.02, false);
  for (const m of [thumb, finger]) {
    m.visible = false;
    armL.add(m);
  }
  return { cup, cig: cig.group, ember: cig.ember, card, thumb, finger };
}

export interface Limbs {
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
}

/** The limbs for one step of the walk cycle (`swing` is how far round it is), or flung out when airborne. */
export function walkPose({ legL, legR, armL, armR }: Limbs, swing: number, airborne: boolean) {
  if (airborne) {
    legL.rotation.x = -0.5;
    legR.rotation.x = 0.3;
    armL.rotation.z = -2.4;
    armR.rotation.z = 2.4;
    armL.rotation.x = armR.rotation.x = 0;
  } else {
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing;
    armR.rotation.x = swing;
    armL.rotation.z = THREE.MathUtils.lerp(armL.rotation.z, -0.1, 0.3);
    armR.rotation.z = THREE.MathUtils.lerp(armR.rotation.z, 0.1, 0.3);
  }
}

/** Hanging on a ladder (climbing, `phase` is the walk phase) or sliding down a pole. */
export function gripPose({ legL, legR, armL, armR }: Limbs, body: THREE.Object3D, grip: 'ladder' | 'pole' | null, phase: number) {
  if (grip === 'ladder') {
    const c = Math.sin(phase);
    armL.rotation.set(-2.55 + c * 0.35, 0, -0.12);
    armR.rotation.set(-2.55 - c * 0.35, 0, 0.12);
    legL.rotation.set(-0.55 - c * 0.45, 0, 0);
    legR.rotation.set(-0.55 + c * 0.45, 0, 0);
    body.rotation.x = -0.08;
  } else if (grip === 'pole') {
    armL.rotation.set(0, 0, 2.95);
    armR.rotation.set(0, 0, 2.45);
    legL.rotation.set(-0.35, 0, 0.25);
    legR.rotation.set(-1.15, 0, 0.35);
    body.rotation.z = -0.16;
  }
}

/** Both arms swung up over the head for a shot, `k` of the way there. */
export function shootPose({ armL, armR }: Limbs, k: number) {
  for (const [arm, side] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -2.75, k);
    arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, side * 0.12, k);
  }
}

/** The smile while quiet, the mouth open `open` (0 to 1) of the way while talking. */
export function mouthPose(smile: THREE.Object3D, mouth: THREE.Object3D, talking: boolean, open: number) {
  smile.visible = !talking;
  mouth.visible = talking;
  if (talking) mouth.scale.set(0.07 * (1 - open * 0.2), 0.01 + open * 0.045, 0.05);
}

/** Legs out over the edge of a seat and hands in the lap, `k` of the way there. */
export function sitPose({ legL, legR, armL, armR }: Limbs, k: number) {
  for (const leg of [legL, legR]) leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, -1.35, k);
  for (const arm of [armL, armR]) arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -0.55, k);
}

/** An arm moved `k` of the way to being swung out to `x` and `z`. */
export function armOut(arm: THREE.Object3D, x: number, z: number, k: number) {
  arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, x, k);
  arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, z, k);
}

/** Both arms out in front at `x`, their hands `spread` in from either side. */
export function armsForward({ armL, armR }: Limbs, x: number, spread: number) {
  armL.rotation.set(x, 0, spread);
  armR.rotation.set(x, 0, -spread);
}
