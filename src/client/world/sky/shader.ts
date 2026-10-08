import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_HEIGHT, WALL_T, WING, wingMinZ } from '../../../shared/building/layout';
import { DEG } from './math';

/*
 * Day, night and the weather outside the windows. The server says where the office is and what the
 * weather is doing (server/floor/sky.ts). From that and the office's clock, sped up so a whole day and
 * night go by every hour (see skyTime), this works out where the sun is, and every frame it sets
 * the sky's color, the fog, the sun (or the moon), the lamps that come on at night, and the rain or snow.
 *
 * The office has no roof, and the sun and the sky light everything, inside and out, so at night the
 * room would go as dark as the street. A few lines added to every lit material (below) give light
 * back where there are lamps: the office and the garage fill with lamplight, and each street lamp,
 * the balcony's string lights and the lamp over the exit throw a pool of light around them. The
 * same lines darken the ground outside when it's wet and lay snow on whatever faces up out there.
 */


export const MAX_LAMPS = 24;
/**
 * The furthest off the haze ever is, however high up you are: past that nothing's built (the grass
 * and the road round the office end there, the city round the roof just past it), so it hides that.
 */
export const HAZE_MAX = 300;
/**
 * The haze thins out with height over the street: past HAZE_CLEAR meters up, every HAZE_ABOVE
 * meters more you see as far again as down on the street (from the roof of six floors, 3.4 times).
 */
const HAZE_CLEAR = 6;
const HAZE_ABOVE = 17.5;

/**
 * How far off something's lost in the haze (with the fog's far edge down on the street at `far`),
 * seen from or standing `above` meters over the street, whichever's higher (see HAZE).
 */
export function hazeReach(above: number, far: number): number {
  return Math.min(HAZE_MAX, far * (1 + Math.max(0, above - HAZE_CLEAR) / HAZE_ABOVE));
}
/** The building, walls included: the office upstairs and the garage under it. */
export const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

export const uniforms = {
  /** Off while drawing your hands in first person, which live in a scene of their own. */
  skyOn: { value: 1 },
  /** Off up on the roof, where the office and the garage (which are under your feet there) aren't lit. */
  skyInside: { value: 1 },
  /** Lamplight filling the office, and the garage: color × strength, in the units of three.js lights. */
  skyOffice: { value: new THREE.Color(0, 0, 0) },
  skyGarage: { value: new THREE.Color(0, 0, 0) },
  skyLampCount: { value: 0 },
  /** Each lamp's position and reach, and its color × strength. */
  skyLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
  skyLampColors: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color()) },
  /** Around all the lamps' pools, so everywhere else skips them. */
  skyLampMin: { value: new THREE.Vector3() },
  skyLampMax: { value: new THREE.Vector3() },
  /** How wet the ground is, and how much snow lies on it: 0–1. */
  skyWet: { value: 0 },
  skySnow: { value: 0 },
  /** How much further down the garage is than from the bottom floor: a storey for each floor below yours. */
  skyDrop: { value: 0 },
  /** Where the street is, which the haze thins out with height over. */
  skyStreet: { value: STREET_Y },
  /** The back office, when the floor's built out into one (see WING): minX, maxX, minZ, maxZ. Empty without. */
  skyWing: { value: new THREE.Vector4(1, 0, 1, 0) },
};

const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`;

const PARS = /* glsl */ `
varying vec3 vSkyWorld;
uniform float skyOn;
uniform float skyInside;
uniform vec3 skyOffice;
uniform vec3 skyGarage;
uniform int skyLampCount;
uniform vec4 skyLamps[${MAX_LAMPS}];
uniform vec3 skyLampColors[${MAX_LAMPS}];
uniform vec3 skyLampMin;
uniform vec3 skyLampMax;
uniform float skyWet;
uniform float skySnow;
uniform float skyDrop;
uniform vec4 skyWing;

// Inside the office's walls (and up through its open top), or the back office's, up to its ceiling
// and no further: its roof, and the cornice over where the wall came down, are outdoors.
float skyInOffice( vec3 p ) {
  vec3 d = max( ${v3(FLOOR.minX - 0.02, -0.06, FLOOR.minZ - 0.02)} - p, p - ${v3(FLOOR.maxX + 0.02, 40, FLOOR.maxZ + 0.02)} );
  vec3 w = max( vec3( skyWing.x, -0.06, skyWing.z ) - p, p - vec3( skyWing.y, ${(WALL_HEIGHT + 0.005).toFixed(3)}, skyWing.w ) );
  float wing = length( max( w, 0.0 ) ) + step( ${(WALL_HEIGHT + 0.005).toFixed(3)}, p.y );
  return 1.0 - smoothstep( 0.0, 0.12, min( length( max( d, 0.0 ) ), wing ) );
}

// Under the bottom floor: walled at the back and on the west side, open to the street on the south and east.
float skyInGarage( vec3 p ) {
  if ( p.x < ${(B.minX + 0.05).toFixed(3)} || p.z < ${(B.minZ + 0.05).toFixed(3)} || p.y + skyDrop < ${(STREET_Y - 0.5).toFixed(3)} || p.y + skyDrop > ${(-SLAB + 0.02).toFixed(3)} ) return 0.0;
  return 1.0 - smoothstep( 0.0, 3.0, length( max( p.xz - vec2( ${B.maxX.toFixed(3)}, ${B.maxZ.toFixed(3)} ), 0.0 ) ) );
}

vec3 skyLampsAt( vec3 p, vec3 n ) {
  vec3 sum = vec3( 0.0 );
  if ( any( lessThan( p, skyLampMin ) ) || any( greaterThan( p, skyLampMax ) ) ) return sum;
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    if ( i >= skyLampCount ) break;
    vec3 d = skyLamps[ i ].xyz - p;
    float r = length( d );
    float k = 1.0 - clamp( r / skyLamps[ i ].w, 0.0, 1.0 );
    sum += skyLampColors[ i ] * k * k * ( 0.3 + 0.7 * max( dot( n, d / max( r, 0.001 ) ), 0.0 ) );
  }
  return sum;
}
`;

/** Wet ground is darker; snow covers what faces up. Only outdoors. Runs before the lights. */
const SURFACE = /* glsl */ `
vec3 skyN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
float skyIndoor = skyOn * skyInside * skyInOffice( vSkyWorld );
float skyGar = skyOn * skyInside * skyInGarage( vSkyWorld );
float skyUp = skyOn * ( 1.0 - max( skyIndoor, skyGar ) ) * smoothstep( 0.45, 0.85, skyN.y );
material.diffuseColor *= 1.0 - 0.38 * skyWet * skyUp;
material.diffuseColor = mix( material.diffuseColor, vec3( 0.93, 0.96, 1.0 ), skySnow * skyUp );
`;

/** The lamps' light, added to what the sun and the sky give. */
const LIGHT = /* glsl */ `
if ( skyOn > 0.0 ) {
  vec3 skyLight = skyIndoor * skyOffice * ( 0.65 + 0.35 * skyN.y ) + ( 1.0 - skyIndoor ) * ( skyGar * skyGarage + skyLampsAt( vSkyWorld, skyN ) );
  reflectedLight.indirectDiffuse += skyLight * BRDF_Lambert( material.diffuseColor );
}
`;

const WORLD = /* glsl */ `
{
  vec4 skyW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    skyW = batchingMatrix * skyW;
  #endif
  #ifdef USE_INSTANCING
    skyW = instanceMatrix * skyW;
  #endif
  vSkyWorld = ( modelMatrix * skyW ).xyz;
}
`;

/**
 * The haze, over three.js's own fog: it thins out with height over the street (see HAZE_ABOVE), as
 * thin as it is at your eye or at what you're looking at, whichever is higher. So from high up you
 * see further, the street below included, and from down on the street the top of the building is
 * as clear as the view from up there. Past HAZE_MAX there's nothing to see, whatever the height.
 */
const HAZE_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vSkyFogY;
#endif
`;

/** How high the vertex is: the view matrix undone (its rotation's transpose), from the camera. */
const HAZE_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vSkyFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;
#endif
`;

const HAZE_PARS = /* glsl */ `
#ifdef USE_FOG
  varying float vSkyFogY;
  uniform float skyStreet;
#endif
`;

const HAZE = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // How many times as far off the haze is as down on the street; and past HAZE_MAX, from 45% of
    // the way there, as the haze on the roof always went.
    float skyReach = 1.0 + max( max( cameraPosition.y, vSkyFogY ) - skyStreet - ${HAZE_CLEAR.toFixed(1)}, 0.0 ) / ${HAZE_ABOVE.toFixed(1)};
    float fogFactor = max( smoothstep( fogNear, fogFar, vFogDepth / skyReach ), smoothstep( ${(HAZE_MAX * 0.45).toFixed(1)}, ${HAZE_MAX.toFixed(1)}, vFogDepth ) );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

// Everything with fog gets the haze above; every lit material also gets the lines before that,
// sharing one set of uniforms. Nothing else in the office uses onBeforeCompile, so this is its
// default; unlit ones (glass, signs, outlines) only get the haze.
THREE.Material.prototype.onBeforeCompile = function (shader) {
  if (shader.fragmentShader.includes('#include <fog_fragment>')) {
    shader.uniforms.skyStreet = uniforms.skyStreet;
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>\n${HAZE_PARS_VERTEX}`).replace('#include <fog_vertex>', `#include <fog_vertex>\n${HAZE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${HAZE_PARS}`).replace('#include <fog_fragment>', HAZE);
  }
  if (!shader.fragmentShader.includes('#include <lights_fragment_end>')) return;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSkyWorld;').replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace('#include <lights_fragment_begin>', `${SURFACE}\n#include <lights_fragment_begin>`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${LIGHT}`);
};
