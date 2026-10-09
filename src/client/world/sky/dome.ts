import * as THREE from 'three';

/** The way to (el, az) from the middle of the sky. */
export const skyward = (el: number, az: number, out: THREE.Vector3) => out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));

/** A dome behind everything, shading from the horizon up to the zenith, with a glow low down and round the moon: Halloween's. */
export function gradientDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      glow: { value: new THREE.Color() },
      glowK: { value: 0 },
      moonDir: { value: new THREE.Vector3(0, 0, 1) },
      moonGlow: { value: new THREE.Color() },
      opacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 glow;
      uniform float glowK;
      uniform vec3 moonDir;
      uniform vec3 moonGlow;
      uniform float opacity;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        vec3 c = mix( horizon, top, smoothstep( 0.0, 0.6, d.y ) );
        c = mix( c, glow, glowK * exp( -abs( d.y ) * 7.0 ) );
        float m = max( dot( d, moonDir ), 0.0 );
        c += moonGlow * ( pow( m, 60.0 ) * 0.9 + pow( m, 10.0 ) * 0.14 );
        gl_FragColor = vec4( c, opacity );
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  // The outline pass would paint the inside of the dome over in ink.
  mat.userData.outlineParameters = { visible: false };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(185, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.visible = false;
  return dome;
}

/** A pale moon with darker seas on it. */
export function moonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(120, 110, 130, ${0.12 + Math.random() * 0.2})`;
    g.beginPath();
    g.ellipse(Math.random() * 256, 20 + Math.random() * 88, 6 + Math.random() * 18, 5 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/** Soft round blob, for halos and snowflakes. */
export function blobTexture(inner: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(inner, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
