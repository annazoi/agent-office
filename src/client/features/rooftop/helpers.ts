import * as THREE from 'three';
import { FLOOR, SEATING_BY_ID, WALL_T } from '../../../shared/layout';
import { canvasTexture } from '../../world/texture';
import type { Collider, Interactable } from '../../world/types';

/** The building, walls included: the roof's edge. */
export const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
export const INK = '#2b2d42';

// The pieces the rooftop's parts are built from: the dance floor's sparkle, the colors, the deck's paving,
// the light beams, and seats and boxes to bump into.

/** 0–1, the same for the same tile on the same beat. */
export function sparkle(c: number, r: number, beat: number): number {
  const x = Math.sin(c * 12.9898 + r * 78.233 + beat * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

/** Sets `g`'s font to `px` pixels, or smaller so `text` fits in `width`. */
export function fitFont(g: CanvasRenderingContext2D, text: string, px: number, width: number) {
  const font = (n: number) => `900 ${n}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > width) g.font = font(Math.floor((px * width) / w));
}

/** A color round the wheel (0–1) at full saturation, as an sRGB color. */
export function hue(c: THREE.Color, h: number, l = 0.55): THREE.Color {
  return c.setHSL(((h % 1) + 1) % 1, 1, l, THREE.SRGBColorSpace);
}

/** Teak decking, the boards running east–west. */
export function deckTexture(): THREE.CanvasTexture {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const px = 24;
  return canvasTexture(Math.round(w * px), Math.round(d * px), (g) => {
    g.fillStyle = '#b98457';
    g.fillRect(0, 0, w * px, d * px);
    const board = 0.14 * px;
    for (let y = 0, row = 0; y < d * px; y += board, row++) {
      // Each row of boards a slightly different tone, with joints staggered along it.
      const tone = 0.9 + ((row * 37) % 11) / 55;
      g.fillStyle = `rgb(${Math.round(185 * tone)}, ${Math.round(132 * tone)}, ${Math.round(87 * tone)})`;
      g.fillRect(0, y, w * px, board - 1.5);
      g.fillStyle = 'rgba(70, 40, 20, 0.35)';
      for (let x = ((row * 53) % 7) * px * 0.4; x < w * px; x += 2.4 * px) g.fillRect(x, y, 1.5, board);
    }
  });
}

/** A beam of light: a cone that fades along its length and toward its edges, added onto what's behind. */
export function beamMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
    vertexShader: `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vN = normalize( normalMatrix * normal );
        vView = normalize( -mv.xyz );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float edge = pow( abs( dot( normalize( vN ), normalize( vView ) ) ), 1.6 );
        float a = opacity * vAlong * vAlong * edge;
        gl_FragColor = vec4( color * a, a );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/**
 * Leaves light out of looking and clicking, so the crosshair goes through it: a beam or a laser
 * (a line picks from a meter off it) would otherwise be in the way of whatever's behind.
 */
export function unpickable<T extends THREE.Object3D>(obj: T): T {
  obj.raycast = () => {};
  return obj;
}

/** Makes `obj` somewhere to sit (see SEATING): walk up to it, or look at it, and press E. */
export function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[]) {
  const seat = SEATING_BY_ID.get(seatId)!;
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, y: seat.y, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

/** A collider round a box `w` wide and `d` deep at (x, z), turned by `rotY` (square turns only). */
export function boxCollider(x: number, z: number, w: number, d: number, rotY: number, top: number): Collider {
  const turned = Math.abs(Math.sin(rotY)) > 0.5;
  const hw = (turned ? d : w) / 2;
  const hd = (turned ? w : d) / 2;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, top };
}
