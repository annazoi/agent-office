import * as THREE from 'three';
import { mesh } from '../toon';
import { STOREY, BAY } from './shared';

/** Wall faces piling up for one material, to be one mesh. */
export class Walls {
  pos: number[] = [];
  norm: number[] = [];
  uv: number[] = [];
  index: number[] = [];

  /** A quad from its bottom-left corner `a` along `u` (across) and up `h`, facing `n`; `uv` is [u0, v0, u1, v1]. */
  quad(a: [number, number, number], u: [number, number, number], h: number, n: [number, number, number], uv: [number, number, number, number]) {
    const i = this.pos.length / 3;
    const [x, y, z] = a;
    const up: [number, number, number] = n[1] === 1 ? [0, 0, -h] : [0, h, 0];
    this.pos.push(x, y, z, x + u[0], y + u[1], z + u[2], x + u[0] + up[0], y + u[1] + up[1], z + u[2] + up[2], x + up[0], y + up[1], z + up[2]);
    for (let k = 0; k < 4; k++) this.norm.push(...n);
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** The four walls of a box from y0 to y1, windows a bay across and a storey up, lit windows from (ou, ov) of the pattern. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, ou: number, ov: number) {
    const hw = w / 2;
    const hd = d / 2;
    const floors = Math.max(1, Math.round((y1 - y0) / STOREY));
    const h = y1 - y0;
    const across = (span: number) => Math.max(1, Math.round(span / BAY));
    const cw = across(w);
    const cd = across(d);
    this.quad([cx - hw, y0, cz + hd], [w, 0, 0], h, [0, 0, 1], [ou, ov, ou + cw, ov + floors]);
    this.quad([cx + hw, y0, cz - hd], [-w, 0, 0], h, [0, 0, -1], [ou + 3, ov, ou + 3 + cw, ov + floors]);
    this.quad([cx + hw, y0, cz + hd], [0, 0, -d], h, [1, 0, 0], [ou + 7, ov, ou + 7 + cd, ov + floors]);
    this.quad([cx - hw, y0, cz - hd], [0, 0, d], h, [-1, 0, 0], [ou + 11, ov, ou + 11 + cd, ov + floors]);
  }

  /** A flat top at y. */
  top(cx: number, cz: number, w: number, d: number, y: number) {
    this.quad([cx - w / 2, y, cz + d / 2], [w, 0, 0], d, [0, 1, 0], [0, 0, 1, 1]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}
