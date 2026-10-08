import * as THREE from 'three';
import { disposeSprite, mesh, textSprite, toon } from '../../world/toon';
import { KEEP, STEPS, lieText, type Flight, type Hit } from './flight';
import { BALL_R } from './shot';

export function golfBall(): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(BALL_R, 14, 10), toon('#ffffff'), 0, 0, 0, false);
}

interface Flying {
  flight: Flight;
  /** Seconds since the hit. */
  t: number;
  ball: THREE.Mesh;
  trail: THREE.Line;
  /** The next of `flight.hits` still to happen. */
  next: number;
  who: string;
  mine: boolean;
  /** Seconds since it stopped, or -1 while it's still going. */
  still: number;
  label: THREE.Sprite | null;
}

/** How long a stopped ball stays lying there, and its label over it, in seconds. */
const LIE_SECONDS = 90;
const LABEL_SECONDS = 14;
/** At most this many balls lying about: the oldest go first. */
const MAX_BALLS = 12;

/** The balls in the air or lying where they stopped, everyone's, played back along their flights. */
export class GolfBalls {
  readonly group = new THREE.Group();
  private balls: Flying[] = [];
  /** It hit something: `mine` if it's your ball. */
  onHit: ((hit: Hit, mine: boolean) => void) | null = null;
  /** It stopped (or went in). */
  onRest: ((flight: Flight, who: string, mine: boolean) => void) | null = null;

  /** Sends a ball off along `flight`, hit by `who`. */
  launch(flight: Flight, who: string, mine: boolean): void {
    const ball = golfBall();
    ball.position.set(flight.path[0], flight.path[1], flight.path[2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(flight.path, 3));
    geo.setDrawRange(0, 1);
    const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: mine ? '#ffd166' : '#fffaf3', transparent: true, opacity: 0.85 }));
    trail.frustumCulled = false;
    this.group.add(ball, trail);
    this.balls.push({ flight, t: 0, ball, trail, next: 0, who, mine, still: -1, label: null });
    while (this.balls.length > MAX_BALLS) this.drop(this.balls[0]);
  }

  /** Your ball still on its way (or just stopped), for the camera to follow. */
  get mine(): { at: THREE.Vector3; flight: Flight; still: number } | null {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.mine) return { at: b.ball.position, flight: b.flight, still: b.still };
    }
    return null;
  }

  update(dt: number): void {
    for (const b of [...this.balls]) {
      const f = b.flight;
      if (b.still < 0) {
        b.t = Math.min(b.t + dt, f.seconds);
        const i = b.t * (STEPS / KEEP);
        const i0 = Math.min(Math.floor(i), f.path.length / 3 - 1);
        const i1 = Math.min(i0 + 1, f.path.length / 3 - 1);
        const k = i - i0;
        const p = f.path;
        b.ball.position.set(p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * k, p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * k, p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * k);
        b.trail.geometry.setDrawRange(0, i1 + 1);
        while (b.next < f.hits.length && f.hits[b.next].t <= b.t) this.onHit?.(f.hits[b.next++], b.mine);
        if (b.t >= f.seconds) {
          b.still = 0;
          // In the cup, it's out of sight.
          b.ball.visible = !f.holed;
          const text = `${b.mine ? '' : `${b.who} · `}${f.holed ? '⛳ ' : ''}${lieText(f)}`;
          b.label = textSprite(text, { bg: f.holed ? '#ffd166' : '#2b2d42', color: f.holed ? '#2b2d42' : '#fffaf3', size: 44, border: '#fffaf3' });
          b.label.position.copy(f.rest).add(new THREE.Vector3(0, f.holed ? 1.2 : 0.7, 0));
          this.group.add(b.label);
          this.onRest?.(f, b.who, b.mine);
        }
        continue;
      }
      b.still += dt;
      // The trail fades once it's down, then the label, and in the end the ball's picked up.
      const trail = b.trail.material as THREE.LineBasicMaterial;
      trail.opacity = Math.max(0, 0.85 - b.still * 0.5);
      b.trail.visible = trail.opacity > 0;
      if (b.label) {
        b.label.material.opacity = THREE.MathUtils.clamp(LABEL_SECONDS - b.still, 0, 1);
        if (b.still > LABEL_SECONDS) {
          this.group.remove(b.label);
          disposeSprite(b.label);
          b.label = null;
        }
      }
      if (b.still > LIE_SECONDS) this.drop(b);
    }
  }

  /** Every ball, gone: off to another floor. */
  clear(): void {
    for (const b of [...this.balls]) this.drop(b);
  }

  private drop(b: Flying) {
    this.balls = this.balls.filter((o) => o !== b);
    this.group.remove(b.ball, b.trail);
    b.ball.geometry.dispose();
    b.trail.geometry.dispose();
    (b.trail.material as THREE.Material).dispose();
    if (b.label) {
      this.group.remove(b.label);
      disposeSprite(b.label);
    }
  }
}
