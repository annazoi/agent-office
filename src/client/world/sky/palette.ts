import * as THREE from 'three';
import { DEG } from './math';

export const C = {
  day: new THREE.Color('#bfe3ff'),
  dusk: new THREE.Color('#ffb48c'),
  night: new THREE.Color('#0b1431'),
  greyDay: new THREE.Color('#aab3bf'),
  greyNight: new THREE.Color('#11151d'),
  fogDay: new THREE.Color('#d7dce2'),
  // Lit from below by the town, so it still reads as fog at night.
  fogNight: new THREE.Color('#3a414d'),
  flash: new THREE.Color('#e4e9ff'),
  sunHigh: new THREE.Color('#fff1d6'),
  sunLow: new THREE.Color('#ffa566'),
  moon: new THREE.Color('#a9bcff'),
  hemiSky: new THREE.Color('#fff5e6'),
  hemiGround: new THREE.Color('#c9a27a'),
  hemiSkyNight: new THREE.Color('#4b5b90'),
  hemiGroundNight: new THREE.Color('#1d1b29'),
  ambientNight: new THREE.Color('#8797cc'),
  white: new THREE.Color('#ffffff'),
  office: new THREE.Color('#fff2de'),
  officeNight: new THREE.Color('#ffd49c'),
  garage: new THREE.Color('#f6f2e4'),
  cloudGrey: new THREE.Color('#a3abb6'),
};

/** Halloween's sky: a bruised purple overhead going blood orange at the horizon, and a big harvest moon. */
export const SPOOKY = {
  day: new THREE.Color('#6f5b8e'),
  dusk: new THREE.Color('#ff5a1f'),
  night: new THREE.Color('#24102f'),
  greyDay: new THREE.Color('#5b5068'),
  greyNight: new THREE.Color('#150d1f'),
  fogDay: new THREE.Color('#7e7194'),
  fogNight: new THREE.Color('#34223f'),
  zenithDay: new THREE.Color('#3a2358'),
  zenithNight: new THREE.Color('#07020d'),
  glow: new THREE.Color('#ff6a2a'),
  cloud: new THREE.Color('#5a4f6e'),
  hemiSky: new THREE.Color('#c3b0ff'),
  hemiGround: new THREE.Color('#5a3d2b'),
  sun: new THREE.Color('#ff8a45'),
  moon: new THREE.Color('#ffc46b'),
  moonLight: new THREE.Color('#c9b3ff'),
};
/**
 * Where Halloween's harvest moon hangs, whatever the hour: low in the south, just over the roofs across
 * the street from the balcony, and in sight through the south windows.
 */
export const SPOOKY_MOON = { el: 21 * DEG, az: 182 * DEG } as const;


/** How strong the sun and the sky's light are on a clear day, which is what the lamps make up for. */
export const FULL_DAY = 1.5 + 0.5 + 0.6 * 2.2;

