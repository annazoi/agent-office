import * as THREE from 'three';
import { ARENA_SITE } from '../../../shared/games/fps/arena';
import { GEAR_BY_ID, type GearId } from '../../../shared/games/fps/gear';
import { flyGrenade, type Vec3 } from '../../../shared/games/fps/hit';
import { mesh, toon } from '../../world/toon';

// What a fight looks like: the streak a shot leaves, the chip it takes out of a wall, grenades on
// their way and what they leave behind. Everything here is drawn from what the office said happened,
// so every screen sees the same thing in the same place.

/** How long a tracer and a chip stay, in seconds. */
const TRACER_LIFE = 0.07;
const MARK_LIFE = 6;
const TRACERS = 24;
const MARKS = 40;

/** Something drawn for a moment and then put back in the box it came from. */
interface Live<T extends THREE.Object3D> {
  obj: T;
  until: number;
}

/** A grenade in the air, flown the same way on every screen (see flyGrenade). */
interface Flying {
  obj: THREE.Mesh;
  from: Vec3;
  dir: Vec3;
  speed: number;
  at: number;
  fuse: number;
}

/** Everything a fight leaves on the screen. The arena's group is where it all goes. */
export class Effects {
  readonly group = new THREE.Group();
  private tracers: Live<THREE.Mesh>[] = [];
  private marks: Live<THREE.Mesh>[] = [];
  private flying: Flying[] = [];
  private clouds: Live<THREE.Mesh>[] = [];
  private t = 0;

  private readonly tracerMat = toon('#ffe6a0', { emissive: '#ffc43d', transparent: true, opacity: 0.9 });
  private readonly markMat = toon('#20242a', { transparent: true, opacity: 0.85 });
  private readonly nadeMat = toon('#3f5d3a');
  private readonly smokeMat = new THREE.MeshBasicMaterial({ color: '#e8ecf2', transparent: true, opacity: 0.84, depthWrite: false });

  constructor() {
    this.group.position.set(ARENA_SITE.x, ARENA_SITE.y, ARENA_SITE.z);
  }

  /** `from` and `to` are in the arena's own frame. */
  shot(from: Vec3, to: Vec3, hit: boolean) {
    const d = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = d.length();
    if (len < 0.2) return;
    const m = mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 5), this.tracerMat, 0, 0, 0, false);
    m.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.group.add(m);
    this.tracers.push({ obj: m, until: this.t + TRACER_LIFE });
    if (this.tracers.length > TRACERS) this.drop(this.tracers.shift());
    if (!hit) this.mark(to);
  }

  /** A chip out of whatever stopped a shot. */
  private mark(at: Vec3) {
    const m = mesh(new THREE.SphereGeometry(0.055, 6, 5), this.markMat, at.x, at.y, at.z, false);
    this.group.add(m);
    this.marks.push({ obj: m, until: this.t + MARK_LIFE });
    if (this.marks.length > MARKS) this.drop(this.marks.shift());
  }

  /** Somebody threw something: it flies from here exactly as the office flew it. */
  thrown(gear: GearId, from: Vec3, dir: Vec3) {
    const g = GEAR_BY_ID.get(gear);
    if (!g) return;
    const obj = mesh(new THREE.SphereGeometry(0.11, 8, 6), this.nadeMat, from.x, from.y, from.z, false);
    this.group.add(obj);
    this.flying.push({ obj, from: { ...from }, dir: { ...dir }, speed: g.speed, at: this.t, fuse: g.fuse });
  }

  /** It went off. A smoke leaves a cloud behind; the others leave a flash of light. */
  burst(gear: GearId, at: Vec3) {
    const g = GEAR_BY_ID.get(gear);
    if (!g) return;
    if (gear === 'smoke') {
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(g.radius, 14, 10), this.smokeMat);
      cloud.position.set(at.x, Math.max(1.2, at.y + 0.8), at.z);
      cloud.scale.setScalar(0.2);
      this.group.add(cloud);
      this.clouds.push({ obj: cloud, until: this.t + g.duration });
      return;
    }
    const flash = new THREE.Mesh(new THREE.SphereGeometry(gear === 'frag' ? 1.6 : 1.1, 10, 8), new THREE.MeshBasicMaterial({ color: gear === 'frag' ? '#ffb347' : '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    flash.position.set(at.x, at.y + 0.3, at.z);
    this.group.add(flash);
    this.clouds.push({ obj: flash, until: this.t + 0.3 });
  }

  update(dt: number) {
    this.t += dt;
    for (const list of [this.tracers, this.marks]) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].until <= this.t) this.drop(list.splice(i, 1)[0]);
    }
    // Grenades follow the same arc the office flew, so they land where it said they did.
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      const gone = this.t - f.at;
      if (gone >= f.fuse) {
        this.drop({ obj: f.obj, until: 0 });
        this.flying.splice(i, 1);
        continue;
      }
      const at = flyGrenade(f.from, f.dir, f.speed, gone);
      f.obj.position.set(at.x, at.y, at.z);
    }
    // Smoke blooms out and then thins away.
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      const left = c.until - this.t;
      if (left <= 0) {
        this.drop(this.clouds.splice(i, 1)[0]);
        continue;
      }
      const grown = Math.min(1, (c.obj.scale.x + dt * 1.6) / 1);
      c.obj.scale.setScalar(Math.max(grown, 0.2));
      const mat = c.obj.material as THREE.Material & { opacity: number };
      if (left < 2) mat.opacity = Math.max(0, mat.opacity * (left / 2));
    }
  }

  /** Everything gone: a round ended, or you walked out. */
  clear() {
    for (const list of [this.tracers, this.marks, this.clouds]) {
      for (const live of list.splice(0)) this.drop(live);
    }
    for (const f of this.flying.splice(0)) this.drop({ obj: f.obj, until: 0 });
  }

  private drop(live: Live<THREE.Object3D> | undefined) {
    if (!live) return;
    this.group.remove(live.obj);
    const m = live.obj as THREE.Mesh;
    m.geometry?.dispose?.();
  }
}
