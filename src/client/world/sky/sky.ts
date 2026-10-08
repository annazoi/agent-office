import * as THREE from 'three';
import { FLOOR, STREET_Y, WALL_T, WING, wingMinZ } from '../../../shared/layout';
import type { SkyState, Theme, Weather } from '../../../shared/protocol';
import { guessPlace, skyNow, sunPosition } from '../../../shared/sun';
import type { NightParts } from '../outside';
import { DEG, clamp01, ease, lerp, rand, smooth } from './math';
import { B, MAX_LAMPS, uniforms } from './shader';
import { C, FULL_DAY, SPOOKY, SPOOKY_MOON } from './palette';
import { blobTexture, gradientDome, moonTexture, skyward } from './dome';
import { WetGlass } from './wetglass';

export interface SkyLights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
}



/** The back office, walls included, when the floor you're on is built out into one (see Sky.setWing). */
let wingBox: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

/** Is (x, z) under the building, where no rain or snow falls? */
const sheltered = (x: number, z: number) =>
  (x > B.minX - 0.05 && x < B.maxX + 0.05 && z > B.minZ - 0.05 && z < B.maxZ + 0.05) || (!!wingBox && x > wingBox.minX - 0.05 && x < wingBox.maxX + 0.05 && z > wingBox.minZ - 0.05 && z < wingBox.maxZ);

export class Sky {
  private preview: { hour?: number; weather?: Weather; intensity?: number } = {};
  /** Lightning struck; its thunder should follow `delay` seconds later. */
  onThunder: ((delay: number, loud: number) => void) | null = null;

  /** 1 in daylight, 0 at night. */
  daylight = 1;
  /** How hard it's raining (storms too) and snowing right now, 0–1, easing from one spell to the next. */
  rain = 0;
  snow = 0;
  /** How far the lamps are on, 0–1: at night, and on the darkest of days. */
  lampsOn = 0;
  /** Up on the roof: out in the open, over the whole city (see setRoof). */
  private roof = false;
  /** In a hall with a roof and walls all round (a map other than the office's, see setIndoors). */
  private indoors = false;
  /**
   * How far out into the country you are, 0–1 (out on the scenic loop, see shared/scenic.ts): the
   * haze near the ground thins out to more than twice as far, so the mountains and the sea show from the road.
   */
  open = 0;
  /** Where the street is from up there (the roof is at 0), for the haze. */
  private roofStreet = 0;

  private state: SkyState;
  private heard = false;
  private snap = true;
  /** The building's holiday (see setTheme), and how far into Halloween's and Christmas's skies it's eased, 0–1. */
  private theme: Theme | null = null;
  spooky = 0;
  private festive = 0;
  /** Seconds left of hurrying the weather along, after the theme changed. */
  private rush = 0;
  /** When a far-off flash lights the Halloween sky next. */
  private nextSpook = 0;
  private readonly spookyDome = gradientDome();
  private readonly moonAt = new THREE.Vector3();
  private readonly moonTo = new THREE.Vector3();
  private cover = 0;
  private fog = 0;
  private storm = 0;
  private wet = 0;
  private lying = 0;
  private flash = 0;
  private flashes: number[] = [];
  private nextFlash = 0;
  /** How much light the sun and the sky give (1 on a clear day), for your hands. */
  private level = 1;
  private readonly tmp = new THREE.Color();
  private readonly tmp2 = new THREE.Color();
  private readonly dir = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

  private readonly dome = new THREE.Group();
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunDisc: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly moonDisc: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly halos: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  /** The halos down by the street, which go down with it. */
  private readonly groundHalos = new THREE.Group();
  /** Where the street was when the lamps were last put in place (see NightParts.street). */
  private street = NaN;
  private readonly rainLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly drops: Float32Array;
  private readonly flakes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly flakeState: Float32Array;
  private readonly glass: WetGlass;

  constructor(
    private scene: THREE.Scene,
    private lights: SkyLights,
    private night: NightParts,
    /** The office's clock (ms since 1970), which everyone's sky keeps time by. */
    private clock: () => number = Date.now,
  ) {
    const here = guessPlace();
    this.state = { ...here, utcOffset: -new Date().getTimezoneOffset(), weather: 'clear', intensity: 0 };
    scene.fog ??= new THREE.Fog('#bfe3ff', 40, 90);
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color('#bfe3ff');

    this.placeLamps();

    // Stars, the sun and the moon, far off, always around you.
    const starPos: number[] = [];
    for (let i = 0; i < 700; i++) {
      const y = rand(0.08, 1);
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * r * 170, y * 170, Math.sin(a) * r * 170);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    const disc = (r: number, color: string) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, fog: false, depthWrite: false }));
      m.material.userData.outlineParameters = { visible: false };
      return m;
    };
    this.sunDisc = disc(5, '#fff4c8');
    this.moonDisc = disc(3.2, '#f2f1ea');
    this.moonDisc.material.map = moonTexture();
    this.dome.add(this.spookyDome, this.stars, this.sunDisc, this.moonDisc);
    scene.add(this.dome);

    // Halos round the bulbs at night, one set of points per size (and per floor or street).
    const halo = blobTexture(0.25);
    const bySize = new Map<string, { size: number; ground: boolean; pos: number[]; col: number[] }>();
    for (const h of night.halos) {
      const key = `${h.size}|${!!h.ground}`;
      let set = bySize.get(key);
      if (!set) bySize.set(key, (set = { size: h.size, ground: !!h.ground, pos: [], col: [] }));
      set.pos.push(h.at.x, h.at.y, h.at.z);
      const c = new THREE.Color(h.color);
      set.col.push(c.r, c.g, c.b);
    }
    for (const { size, ground, pos, col } of bySize.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const p = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: halo, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      p.visible = false;
      this.halos.push(p);
      (ground ? this.groundHalos : scene).add(p);
    }
    scene.add(this.groundHalos);

    // Rain: streaks falling around you (x, y, z, speed per drop).
    const RAIN = 3000;
    this.drops = new Float32Array(RAIN * 4);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#bcd0e6', transparent: true, opacity: 0.5, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    for (let i = 0; i < RAIN; i++) this.drops.set([rand(-24, 24), rand(0, 26), rand(-24, 24), rand(14, 20)], i * 4);
    scene.add(this.rainLines);

    // Snow: flakes drifting down around you (x, y, z, speed per flake).
    const SNOW = 3500;
    this.flakeState = new Float32Array(SNOW * 4);
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.flakes = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.14, map: blobTexture(0.5), transparent: true, depthWrite: false, color: '#ffffff' }));
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    for (let i = 0; i < SNOW; i++) this.flakeState.set([rand(-20, 20), rand(0, 22), rand(-20, 20), rand(0.7, 1.3)], i * 4);
    scene.add(this.flakes);

    this.glass = new WetGlass(night.wetGlass);
  }

  /** The server's word on the sky. The weather eases from one spell to the next; a new place lands at once. */
  set(state: SkyState) {
    if (!this.heard || state.lat !== this.state.lat || state.lon !== this.state.lon) this.snap = true;
    this.state = state;
    this.heard = true;
  }

  /**
   * The building's holiday: Halloween's sky is a creepy one, purple and blood orange with a harvest
   * moon hanging low and the odd far-off flash, dim enough that the lamps and the jack-o'-lanterns
   * glow; Christmas brings snow. Either eases in over a few seconds.
   */
  setTheme(theme: Theme | null) {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.heard) this.rush = 10;
  }

  /** For quick checks from the console: show this hour of the office's day, or this weather, right away. */
  show(preview: { hour?: number; weather?: Weather; intensity?: number }) {
    this.preview = preview;
    this.snap = true;
  }

  /**
   * The lamps' pools of light, and the box around all of them. The ones down by the street are as
   * far down as the street is from the floor you're on.
   */
  private placeLamps() {
    this.street = this.night.street;
    const drop = STREET_Y - this.street;
    uniforms.skyDrop.value = drop;
    this.groundHalos.position.y = -drop;
    const lo = uniforms.skyLampMin.value.set(Infinity, Infinity, Infinity);
    const hi = uniforms.skyLampMax.value.set(-Infinity, -Infinity, -Infinity);
    this.night.lamps.slice(0, MAX_LAMPS).forEach((l, i) => {
      const y = l.ground ? l.y - drop : l.y;
      uniforms.skyLamps.value[i].set(l.x, y, l.z, l.reach);
      lo.min(new THREE.Vector3(l.x - l.reach, y - l.reach, l.z - l.reach));
      hi.max(new THREE.Vector3(l.x + l.reach, y + l.reach, l.z + l.reach));
    });
  }

  /**
   * Up on the roof, `drop` over the street (or back down on a floor). Up there it's all outdoors: no
   * lamplight from the office under your feet, no pools of light from the street lamps far below, and
   * rain everywhere. The haze thins out with height over the street far below (see HAZE).
   */
  setRoof(on: boolean, drop = 0) {
    this.roof = on;
    this.roofStreet = -drop;
    uniforms.skyInside.value = on || this.indoors ? 0 : 1;
  }

  /**
   * Inside a hall of a map of its own (the castle), walled and roofed all round, or back in the
   * office (false): no rain or snow falls where you are, nothing gets wet or snowy, and the office's
   * lamps and the street's don't light it (it lights itself: see World.mood).
   */
  setIndoors(on: boolean) {
    this.indoors = on;
    uniforms.skyInside.value = on || this.roof ? 0 : 1;
  }

  /**
   * The floor you're on is built out `level` rows into the back office (see WING): lit like the
   * office inside, and out of the rain.
   */
  setWing(level: number) {
    const minZ = wingMinZ(level);
    wingBox = level > 0 ? { minX: WING.minX - WALL_T, maxX: WING.maxX + WALL_T, minZ: minZ - WALL_T, maxZ: FLOOR.minZ } : null;
    if (level > 0) uniforms.skyWing.value.set(WING.minX - 0.02, WING.maxX + 0.02, minZ - 0.02, FLOOR.minZ);
    else uniforms.skyWing.value.set(1, 0, 1, 0);
  }

  /** Under a roof, out of the rain: the building, unless you're up on top of it. */
  private sheltered(x: number, z: number): boolean {
    return this.indoors || (!this.roof && sheltered(x, z));
  }

  /** Whether the lamps' light (and wet and snow) apply: off while your hands are drawn. */
  shading(on: boolean) {
    uniforms.skyOn.value = on ? 1 : 0;
  }

  /** How lit it is at `p`, 0–1 (1 is a clear day, or a room with its lights on), for your hands. */
  lightAt(p: THREE.Vector3): number {
    if (this.indoors) return 1;
    const inside = !this.roof && ((p.x > FLOOR.minX && p.x < FLOOR.maxX && p.z > FLOOR.minZ && p.z < FLOOR.maxZ) || (sheltered(p.x, p.z) && (p.y < 0 || p.z < FLOOR.minZ)));
    if (inside) return 1;
    let lamp = 0;
    if (!this.roof) {
      const drop = STREET_Y - this.street;
      for (const l of this.night.lamps) lamp = Math.max(lamp, 1 - Math.hypot(l.x - p.x, (l.ground ? l.y - drop : l.y) - p.y, l.z - p.z) / l.reach);
    }
    return Math.min(1, Math.max(this.level, lamp * this.lampsOn));
  }

  /** The time of day in the sky (see skyTime), or the previewed hour today. */
  private now(): number {
    const h = this.preview.hour;
    if (h === undefined) return skyNow(this.clock(), this.state);
    const off = this.state.utcOffset * 60_000;
    const midnight = Math.floor((this.clock() + off) / 86_400_000) * 86_400_000;
    return midnight - off + h * 3_600_000;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    if (this.night.street !== this.street) this.placeLamps();
    const s = this.state;
    let weather = this.preview.weather ?? s.weather;
    let k = this.preview.intensity ?? (this.preview.weather ? 0.8 : s.intensity);
    // It snows all through Christmas, whatever the forecast says.
    if (this.theme === 'christmas' && !this.preview.weather) {
      k = weather === 'snow' ? Math.max(k, 0.5) : 0.6;
      weather = 'snow';
    }
    const snap = this.snap;
    this.snap = false;
    // Just after the theme changed, the weather turns in seconds rather than minutes.
    const quick = this.rush > 0 ? 0.2 : 1;
    this.rush = Math.max(0, this.rush - dt);
    const step = (x: number, to: number, secs: number) => (snap ? to : ease(x, to, dt, secs * quick));
    this.spooky = step(this.spooky, this.theme === 'halloween' ? 1 : 0, 12);
    this.festive = step(this.festive, this.theme === 'christmas' ? 1 : 0, 12);
    const sp = this.spooky;

    // The weather, easing from one spell to the next.
    const want = {
      cover: { clear: 0, cloudy: k, rain: 0.8 + 0.2 * k, storm: 1, snow: 0.85, fog: 0.5 }[weather],
      rain: weather === 'rain' ? k : weather === 'storm' ? Math.max(0.8, k) : 0,
      snow: weather === 'snow' ? k : 0,
      fog: weather === 'fog' ? k : weather === 'rain' ? 0.12 * k : weather === 'snow' ? 0.3 * k : 0,
      storm: weather === 'storm' ? 1 : 0,
    };
    // A thin, creepy mist hangs about all Halloween.
    if (this.theme === 'halloween') want.fog = Math.max(want.fog, 0.3);
    this.cover = step(this.cover, want.cover, 20);
    this.rain = step(this.rain, want.rain, 12);
    this.snow = step(this.snow, want.snow, 12);
    this.fog = step(this.fog, want.fog, 20);
    this.storm = step(this.storm, want.storm, 10);
    // Wet ground dries off slowly; snow piles up over a few minutes and takes a while to melt.
    this.wet = snap ? (this.rain > 0.05 ? 1 : 0) : ease(this.wet, this.rain > 0.05 ? 1 : 0, dt, this.rain > 0.05 ? 30 : 400);
    this.lying = snap ? (this.snow > 0.05 ? 1 : 0) : ease(this.lying, this.snow > 0.05 ? 1 : 0, dt, (this.snow > 0.05 ? 120 : 900) * (this.rush > 0 ? 0.04 : 1));
    uniforms.skyWet.value = this.indoors ? 0 : this.wet * (1 - this.lying);
    uniforms.skySnow.value = this.indoors ? 0 : this.lying * 0.9;

    // The sun, and how much light it and the sky give.
    const { el, az } = sunPosition(this.now(), s.lat, s.lon);
    const elD = el / DEG;
    // Halloween's days are a long, gloomy dusk.
    const day = smooth(-8, 4, elD) * (1 - 0.6 * sp);
    const dusk = Math.max(0, 1 - Math.abs(elD + 1) / 9) * (1 - this.cover);
    this.daylight = day;
    if (sp > 0.5 && this.storm < 0.5 && t >= this.nextSpook) {
      if (this.nextSpook > 0) {
        this.flashes.push(t, t + rand(0.12, 0.3));
        this.onThunder?.(rand(1.5, 4), rand(0.25, 0.45));
      }
      this.nextSpook = t + rand(25, 70);
    }
    this.lightning(t, dt);
    const flash = this.flash;
    const sunI = 2.2 * smooth(-3, 10, elD) * (1 - 0.8 * this.cover) * (1 - 0.6 * this.fog) * (1 - 0.65 * sp);
    const moonI = 0.4 * smooth(-4, -12, elD) * (1 - 0.75 * this.cover);
    const hemiI = lerp(0.38, 1.5 * (1 - 0.25 * this.cover) * (1 - 0.35 * this.storm), day);
    const ambI = lerp(0.12, 0.5, day);
    const { sun, hemi, ambient } = this.lights;
    hemi.intensity = hemiI + flash * 3;
    hemi.color.copy(C.hemiSkyNight).lerp(C.hemiSky, day).lerp(SPOOKY.hemiSky, sp * 0.5);
    hemi.groundColor.copy(C.hemiGroundNight).lerp(C.hemiGround, day).lerp(SPOOKY.hemiGround, sp * 0.5);
    ambient.intensity = ambI + flash;
    ambient.color.copy(C.ambientNight).lerp(C.white, day);
    // A cartoon sun: never so low its shadows fill the room. At night the moon lights things, from across the sky.
    const moonlit = elD < -4;
    const lightEl = (moonlit ? 50 : 25 + Math.max(0, elD) * 0.6) * DEG;
    const lightAz = moonlit ? az + Math.PI : az;
    this.dir.set(Math.cos(lightEl) * Math.sin(lightAz), Math.sin(lightEl), -Math.cos(lightEl) * Math.cos(lightAz));
    sun.position.copy(sun.target.position).addScaledVector(this.dir, 45);
    sun.intensity = moonlit ? moonI : sunI;
    if (moonlit) sun.color.copy(C.moon).lerp(SPOOKY.moonLight, sp);
    else sun.color.copy(C.sunLow).lerp(C.sunHigh, smooth(0, 25, elD)).lerp(SPOOKY.sun, sp);
    this.level = clamp01((hemiI + ambI + 0.6 * (sunI + moonI)) / FULL_DAY);

    // Lamps come on as it gets dark: the office's and the garage's, and the ones outside.
    const need = 1 - this.level;
    this.lampsOn = smooth(0.45, 0.62, need);
    uniforms.skyOffice.value.copy(C.office).lerp(C.officeNight, 1 - day).multiplyScalar(need * 3.2);
    uniforms.skyGarage.value.copy(C.garage).multiplyScalar(need * 2);
    const lamps = Math.min(this.night.lamps.length, MAX_LAMPS);
    uniforms.skyLampCount.value = this.lampsOn > 0.005 && !this.roof && !this.indoors ? lamps : 0;
    for (let i = 0; i < lamps; i++) {
      const l = this.night.lamps[i];
      uniforms.skyLampColors.value[i].set(l.color).multiplyScalar(l.power * this.lampsOn);
    }
    for (const b of this.night.bulbs) b.mat.emissiveIntensity = lerp(b.day, 1, this.lampsOn);
    for (const m of this.night.windows) m.emissiveIntensity = this.lampsOn * 1.1;
    for (const h of this.halos) {
      h.material.opacity = this.lampsOn * 0.85;
      h.visible = this.lampsOn > 0.01 && !this.roof && !this.indoors;
    }
    for (const g of this.night.glows) {
      g.mat.opacity = g.max * this.lampsOn;
      g.mat.visible = this.lampsOn > 0.01 && !this.roof && !this.indoors;
    }

    // The sky's color, and the fog, which fades far things into it. Halloween's is its own.
    const pal = (key: 'day' | 'dusk' | 'night' | 'greyDay' | 'greyNight' | 'fogDay' | 'fogNight', out: THREE.Color) => out.copy(C[key]).lerp(SPOOKY[key], sp);
    const a = this.tmp;
    const b = this.tmp2;
    const sky = (this.scene.background as THREE.Color).copy(pal('night', a)).lerp(pal('day', b), day);
    // Halloween's gloomy days glow at the horizon all day; its nights keep only a rim of it (the dome's).
    sky.lerp(pal('dusk', a), Math.max(dusk, sp * THREE.MathUtils.lerp(0.08, 0.35, Math.min(1, day / 0.4))) * 0.55);
    sky.lerp(pal('greyNight', a).lerp(pal('greyDay', b), day), this.cover * 0.85);
    sky.lerp(pal('fogNight', a).lerp(pal('fogDay', b), day), this.fog);
    sky.lerp(C.flash, flash * 0.5);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const precip = Math.max(this.rain, this.snow);
    // How far off the haze is down on the street; the higher up, the thinner it is (see HAZE), so
    // the street never goes into it from the top floors, and from the roof you see across the city.
    // Out in the country (see open) it's further off again.
    const open = 1 + 1.4 * this.open;
    fog.near = lerp(40, 3, this.fog) * (1 - 0.4 * precip) * open;
    fog.far = lerp(90, 28, this.fog) * (1 - 0.3 * precip) * open;
    uniforms.skyStreet.value = this.roof ? this.roofStreet : this.indoors ? 0 : this.night.street;
    this.night.clouds.color.copy(C.white).lerp(C.cloudGrey, this.cover).lerp(SPOOKY.cloud, sp);
    this.night.clouds.visible = this.fog < 0.6;
    // Halloween's gradient, over the flat sky: dark overhead, the sky's color at the horizon, which the fog fades into.
    const u = this.spookyDome.material.uniforms;
    this.spookyDome.visible = sp > 0.005;
    if (this.spookyDome.visible) {
      u.opacity.value = sp;
      u.horizon.value.copy(sky);
      u.top.value.copy(SPOOKY.zenithNight).lerp(SPOOKY.zenithDay, Math.min(1, day / 0.4)).lerp(sky, this.fog * 0.6 + flash * 0.5);
      u.glow.value.copy(SPOOKY.glow);
      u.glowK.value = 0.55 * (1 - this.fog * 0.6) * (1 - this.cover * 0.5);
      u.moonGlow.value.copy(SPOOKY.moon).multiplyScalar(0.55 * (1 - this.cover * 0.6));
    }

    // Stars, the sun and the moon ride along with you, so they look infinitely far off.
    camera.getWorldPosition(this.camPos);
    this.dome.position.copy(this.camPos);
    const clear = (1 - this.cover) * (1 - this.fog);
    this.stars.material.opacity = (1 - day) ** 2 * clear;
    this.stars.visible = this.stars.material.opacity > 0.01;
    const up = (e: number, a: number, m: THREE.Mesh) => m.position.set(Math.cos(e) * Math.sin(a) * 160, Math.sin(e) * 160, -Math.cos(e) * Math.cos(a) * 160);
    up(el, az, this.sunDisc);
    this.sunDisc.material.color.copy(C.sunLow).lerp(C.white, smooth(0, 20, elD));
    this.sunDisc.material.opacity = smooth(-3, 0, elD) * clear;
    this.sunDisc.visible = this.sunDisc.material.opacity > 0.01;
    // At Halloween the sun hides, and a big orange harvest moon hangs low over the street all day.
    this.sunDisc.material.opacity *= 1 - sp;
    this.sunDisc.visible = this.sunDisc.material.opacity > 0.01;
    skyward(-el, az + Math.PI, this.moonAt);
    skyward(SPOOKY_MOON.el, SPOOKY_MOON.az, this.moonTo);
    u.moonDir.value.copy(this.moonTo);
    this.moonAt.lerp(this.moonTo, sp);
    this.moonDisc.position.copy(this.moonAt.lengthSq() > 1e-6 ? this.moonAt : this.moonTo).normalize().multiplyScalar(160);
    this.moonDisc.scale.setScalar(1 + 2.2 * sp);
    this.moonDisc.material.color.copy(C.white).lerp(SPOOKY.moon, sp);
    this.moonDisc.material.opacity = Math.max(smooth(2, -2, elD) * clear, sp * (1 - 0.5 * this.cover));
    this.moonDisc.visible = this.moonDisc.material.opacity > 0.01;

    // Rain and snow fall outside, lit about as much as everything else is.
    const lit = 0.3 + 0.7 * Math.max(this.level, this.lampsOn * 0.5);
    this.rainLines.material.color.set('#bcd0e6').multiplyScalar(lit);
    this.flakes.material.color.setScalar(lit);
    this.fall(dt, t);
    this.glass.update(dt, this.rain, lit);
  }

  /** In a storm, now and then the sky flashes (twice, quickly) and thunder rolls in after. */
  private lightning(t: number, dt: number) {
    if (this.storm > 0.5 && t >= this.nextFlash) {
      if (this.nextFlash > 0) {
        this.flashes.push(t, t + rand(0.1, 0.25));
        if (Math.random() < 0.5) this.flashes.push(t + rand(0.35, 0.6));
        this.onThunder?.(rand(0.3, 3), rand(0.5, 1));
      }
      this.nextFlash = t + rand(6, 20);
    }
    this.flash *= Math.exp(-dt * 10);
    while (this.flashes.length && this.flashes[0] <= t) {
      this.flashes.shift();
      this.flash = Math.max(this.flash, rand(0.7, 1));
    }
  }

  private fall(dt: number, t: number) {
    const cx = this.camPos.x;
    const cz = this.camPos.z;
    // Down to the street, or to a little below you when that's a long way down.
    const floor = Math.max(this.street, this.camPos.y - 12);
    const wrap = (v: number, c: number, half: number) => (v - c > half ? v - 2 * half : v - c < -half ? v + 2 * half : v);

    const rainN = Math.round((this.drops.length / 4) * this.rain);
    this.rainLines.visible = rainN > 0;
    if (rainN > 0) {
      const pos = this.rainLines.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      const slant = 0.1 + 0.3 * this.storm;
      for (let i = 0; i < rainN; i++) {
        const d = i * 4;
        const speed = this.drops[d + 3];
        let x = wrap(this.drops[d] + slant * speed * dt, cx, 24);
        let y = this.drops[d + 1] - speed * dt;
        let z = wrap(this.drops[d + 2], cz, 24);
        if (y < floor || y > floor + 26) {
          y = y < floor && y > floor - 1 ? y + 26 : floor + rand(0, 26);
          x = cx + rand(-24, 24);
          z = cz + rand(-24, 24);
        }
        this.drops[d] = x;
        this.drops[d + 1] = y;
        this.drops[d + 2] = z;
        const len = this.sheltered(x, z) ? 0 : 0.5;
        a.set([x, y, z, x - slant * len, y + len, z], i * 6);
      }
      pos.needsUpdate = true;
      this.rainLines.geometry.setDrawRange(0, rainN * 2);
    }

    const snowN = Math.round((this.flakeState.length / 4) * this.snow);
    this.flakes.visible = snowN > 0;
    if (snowN > 0) {
      const pos = this.flakes.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < snowN; i++) {
        const f = i * 4;
        const speed = this.flakeState[f + 3];
        let x = wrap(this.flakeState[f] + Math.sin(t * 0.9 + i) * 0.3 * dt + 0.15 * dt, cx, 20);
        let y = this.flakeState[f + 1] - speed * dt;
        let z = wrap(this.flakeState[f + 2] + Math.cos(t * 0.7 + i * 1.3) * 0.3 * dt, cz, 20);
        if (y < floor || y > floor + 22) {
          y = y < floor && y > floor - 1 ? y + 22 : floor + rand(0, 22);
          x = cx + rand(-20, 20);
          z = cz + rand(-20, 20);
        }
        this.flakeState[f] = x;
        this.flakeState[f + 1] = y;
        this.flakeState[f + 2] = z;
        a.set([x, this.sheltered(x, z) ? -1000 : y, z], i * 3);
      }
      pos.needsUpdate = true;
      this.flakes.geometry.setDrawRange(0, snowN);
    }
  }
}

