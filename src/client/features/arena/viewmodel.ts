import * as THREE from 'three';
import { weaponOf, type Weapon } from '../../../shared/games/fps/weapons';
import { mesh, toon } from '../../world/toon';

// The gun in your own hands: a blocky toon thing held in the corner of the screen, which kicks when
// it goes off, swings as you walk, and comes up to the sights when you hold the right button. It is
// drawn on the camera itself, so it never clips into a wall.

/** Where the gun sits from the hip, and where it comes to when you aim. */
const HIP = new THREE.Vector3(0.2, -0.17, -0.62);
const AIM = new THREE.Vector3(0, -0.1, -0.5);
/** How big the gun is held: smaller than life, the way a first-person weapon always is. */
const SCALE = 0.5;
const RELOAD_DROP = 0.22;

/** How a gun is shaped, by what kind it is: body, barrel and what's on top. */
function build(w: Weapon): THREE.Group {
  const g = new THREE.Group();
  const body = toon('#5c636e');
  const metal = toon('#a4acb8');
  const wood = toon('#9c6838');
  const long = w.kind === 'sniper' || w.kind === 'heavy' || w.kind === 'rifle';
  if (w.kind === 'melee') {
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.17), body, 0, 0, 0.06, false));
    const blade = mesh(new THREE.BoxGeometry(0.016, 0.05, 0.26), metal, 0, 0.01, -0.14, false);
    blade.rotation.x = 0.06;
    g.add(blade);
    return g;
  }
  const bodyLen = long ? 0.42 : 0.24;
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.1, bodyLen), body, 0, 0, -bodyLen / 2 + 0.05, false));
  g.add(mesh(new THREE.BoxGeometry(0.045, 0.045, long ? 0.34 : 0.14), metal, 0, 0.012, -bodyLen - (long ? 0.12 : 0.04), false));
  // The grip, and a magazine under it on anything that holds one.
  const grip = mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), body, 0, -0.1, 0.02, false);
  grip.rotation.x = -0.22;
  g.add(grip);
  if (w.mag !== Infinity) g.add(mesh(new THREE.BoxGeometry(0.05, 0.13, 0.05), body, 0, -0.1, -0.1, false));
  if (w.kind === 'shotgun' || w.kind === 'sniper') g.add(mesh(new THREE.BoxGeometry(0.06, 0.075, 0.16), wood, 0, -0.01, 0.12, false));
  // What it's aimed with.
  if (w.sight === 'scope') {
    const scope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), body, 0, 0.085, -0.1, false);
    scope.rotation.x = Math.PI / 2;
    g.add(scope);
  } else if (w.sight === 'dot') {
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.07), body, 0, 0.08, -0.05, false));
    g.add(mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), toon('#ff5a5a', { emissive: '#ff2d2d' }), 0, 0.08, -0.08, false));
  } else if (w.sight === 'iron') {
    g.add(mesh(new THREE.BoxGeometry(0.008, 0.022, 0.008), metal, 0, 0.068, -bodyLen - 0.02, false));
  }
  return g;
}

/**
 * The gun you're holding. Like the office's own hands (world/hands.ts) it lives in a small scene of
 * its own with its own lights, drawn over the world after it with the depth buffer cleared, so it
 * never clips into a wall you walk up to.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5);
  readonly group = new THREE.Group();
  private built = new Map<string, THREE.Group>();
  private shown?: THREE.Group;
  private flash: THREE.Mesh;
  private flashUntil = 0;
  /** How far the gun is kicked back and up, easing off. */
  private kick = 0;
  private sway = 0;
  private t = 0;
  /** 0 from the hip, 1 at the sights. */
  private aim = 0;

  constructor() {
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false }));
    this.flash.visible = false;
    this.group.add(this.flash);
    const sun = new THREE.DirectionalLight('#fff1d6', 2.1);
    sun.position.set(-0.6, 1.4, 0.9);
    for (const l of [new THREE.HemisphereLight('#fff5e6', '#9aa3b0', 1.4), new THREE.AmbientLight('#ffffff', 0.6), sun]) this.scene.add(l);
    this.scene.add(this.group);
  }

  /**
   * The gun has a narrower lens than the world's, the way a first-person weapon always does: it keeps
   * its size in the corner whatever the sights are doing to the view.
   */
  private setLens(aspect: number) {
    if (this.camera.aspect === aspect) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Draws the gun over the frame just rendered, keeping what's already on the screen. */
  draw(renderer: THREE.WebGLRenderer, aspect: number) {
    if (!this.group.visible) return;
    this.setLens(aspect);
    const was = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = was;
  }

  /** Puts gun `id` in your hands. */
  hold(id: string) {
    const w = weaponOf(id);
    let g = this.built.get(w.id);
    if (!g) {
      g = build(w);
      g.scale.setScalar(SCALE);
      this.built.set(w.id, g);
    }
    if (this.shown === g) return;
    if (this.shown) this.group.remove(this.shown);
    this.shown = g;
    this.group.add(g);
    const long = w.kind === 'sniper' || w.kind === 'heavy' || w.kind === 'rifle';
    this.flash.position.set(0, 0.012, -(long ? 0.72 : 0.36));
  }

  /** It went off: a kick and a flash at the muzzle. */
  fired(w: Weapon) {
    this.kick = Math.min(0.9, this.kick + 0.35 + w.recoil * 4);
    this.flashUntil = this.t + 0.05;
    this.flash.scale.setScalar(w.kind === 'shotgun' || w.kind === 'sniper' ? 1.5 : 1);
  }

  /** How far your hands are off the hip toward the sights, this frame. */
  setAim(on: boolean, dt: number) {
    this.aim += ((on ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
  }

  update(dt: number, opts: { walking: boolean; walkPhase: number; reloading: boolean; hidden: boolean }) {
    this.t += dt;
    this.group.visible = !opts.hidden && !!this.shown;
    if (!this.group.visible) return;
    this.kick = Math.max(0, this.kick - dt * 5.5);
    this.sway += ((opts.walking ? 1 : 0) - this.sway) * Math.min(1, dt * 6);
    this.flash.visible = this.t < this.flashUntil;
    const g = this.shown!;
    const base = HIP.clone().lerp(AIM, this.aim);
    const bobX = Math.sin(opts.walkPhase) * 0.016 * this.sway;
    const bobY = Math.abs(Math.cos(opts.walkPhase)) * 0.014 * this.sway;
    g.position.set(base.x + bobX, base.y - bobY - (opts.reloading ? RELOAD_DROP : 0) - this.kick * 0.05, base.z + this.kick * 0.09);
    g.rotation.set(this.kick * 0.5 + (opts.reloading ? -0.7 : 0), 0.04 * (1 - this.aim), 0);
  }
}
