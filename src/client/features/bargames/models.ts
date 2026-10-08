import * as THREE from 'three';
import { mesh, toon } from '../../world/toon';

/** A toon material of its own, left out of the outlines (they'd swamp something as thin as a dart). */
export function plain(color: string, side: THREE.Side = THREE.FrontSide): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, side, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

let dartParts: { steel: THREE.Material; barrel: THREE.Material; shaft: THREE.Material; flights: Map<string, THREE.Material> } | null = null;

/**
 * A dart, its tip at the origin pointing +z: steel tip, tungsten barrel, shaft, and flights in
 * `color`. Half as big again as a real one, like everything here, so it shows from the oche.
 */
export function dartModel(color: string): THREE.Group {
  const m = (dartParts ??= { steel: plain('#dfe3ea'), barrel: plain('#4a4e69'), shaft: plain('#eaeaea'), flights: new Map() });
  let flight = m.flights.get(color);
  if (!flight) m.flights.set(color, (flight = plain(color, THREE.DoubleSide)));
  const g = new THREE.Group();
  const along = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  g.add(mesh(along(new THREE.ConeGeometry(0.004, 0.035, 6)).translate(0, 0, -0.0175), m.steel, 0, 0, 0, false));
  g.add(mesh(along(new THREE.CylinderGeometry(0.0075, 0.006, 0.055, 8)), m.barrel, 0, 0, -0.062, false));
  g.add(mesh(along(new THREE.CylinderGeometry(0.003, 0.003, 0.045, 6)), m.shaft, 0, 0, -0.11, false));
  for (const r of [0, Math.PI / 2]) {
    const fin = mesh(new THREE.BoxGeometry(0.004, 0.042, 0.045), flight, 0, 0, -0.14, false);
    fin.rotation.z = r;
    g.add(fin);
  }
  g.scale.setScalar(1.5);
  return g;
}

/** An axe (see AXE): a wooden handle with black tape round the grip, and a steel head with its edge forward. */
export function axeModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.46, 8), toon('#c68b59'), 0, 0.17, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), toon('#1d1d1d'), 0, -0.01, 0, false));
  // The head: a block round the top of the handle, the blade flaring out forward from it to the edge.
  const steel = toon('#8d99ae');
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.08, 0.07), steel, 0, 0.365, 0, false));
  const blade = new THREE.Shape();
  blade.moveTo(0.02, 0.335);
  blade.lineTo(0.105, 0.3);
  blade.quadraticCurveTo(0.125, 0.365, 0.105, 0.43);
  blade.lineTo(0.02, 0.395);
  blade.closePath();
  const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.006, 0, 0);
  g.add(mesh(geo, steel, 0, 0, 0, false));
  // A bright line along the edge, freshly sharpened.
  g.add(mesh(new THREE.BoxGeometry(0.014, 0.12, 0.012), toon('#e9ecef'), 0, 0.365, 0.112, false));
  return g;
}
