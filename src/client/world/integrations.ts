// The Composio stations on the office floor: the Linear board, the Notion bookshelf, the Slack TV,
// the calendar on the wall and the mailroom desk. Each is built the way the office's own boards, TV
// and bookshelf are (toon.ts), with a label over it and a little light that's green once you've
// connected that toolkit and grey until you have. Walk up and press E to open its panel (ui/integrations/).
import * as THREE from 'three';
import { CALENDAR_WALL, LINEAR_BOARD, MAILROOM, NOTION_SHELF, SLACK_TV, STATION_SPOTS, stationFootprint, type StationSpot } from '../../shared/integrations';
import { COMPOSIO_TOOLKIT_META, type ComposioConnection, type ComposioToolkit } from '../../shared/protocol';
import { wallFacing } from '../../shared/decor';
import type { Ctx } from '../core/context';
import { aside, hintTitle, key, onE } from '../core/hint';
import { store } from '../state';
import { STATUS_BULB } from './character/worker-badges';
import type { Fixture } from './office/fixture';
import { PALETTE } from './office/materials';
import { wallBoard } from './office/props';
import { canvasTexture } from './texture';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import type { Collider, Interactable } from './types';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts): one per station.
declare module './types' {
  interface InteractKinds {
    linearboard: true;
    notionshelf: true;
    slacktv: true;
    calendarwall: true;
    mailroom: true;
  }
  interface OfficeHandles {
    /** The Composio stations, to light up and to paint. */
    integrations: IntegrationStations;
  }
}

const KIND: Record<ComposioToolkit, 'linearboard' | 'notionshelf' | 'slacktv' | 'calendarwall' | 'mailroom'> = {
  linear: 'linearboard',
  notion: 'notionshelf',
  slack: 'slacktv',
  googlecalendar: 'calendarwall',
  gmail: 'mailroom',
};

const LIGHT: Record<ComposioConnection | 'none', string> = { connected: STATUS_BULB.done, pending: STATUS_BULB.working, off: STATUS_BULB.exited, none: STATUS_BULB.exited };

/** The little light on a station: green connected, amber while you're connecting, grey otherwise. */
class StatusLight {
  readonly mesh: THREE.Mesh;
  private mat = toonUnique(LIGHT.none);
  private state: ComposioConnection | 'none' = 'none';
  private pulse = 0;
  constructor(x: number, y: number, z: number, r = 0.045) {
    this.mat.emissive = new THREE.Color(LIGHT.none).multiplyScalar(0.5);
    this.mesh = mesh(new THREE.SphereGeometry(r, 12, 10), this.mat, x, y, z, false);
  }
  set(state: ComposioConnection | 'none') {
    if (state === this.state) return;
    this.state = state;
    this.mat.color.set(LIGHT[state]);
    this.mat.emissive.set(LIGHT[state]).multiplyScalar(0.7);
  }
  update(dt: number) {
    if (this.state !== 'pending') return;
    this.pulse += dt * 4;
    this.mat.emissiveIntensity = 0.6 + Math.sin(this.pulse) * 0.4;
  }
}

export interface StationModel {
  group: THREE.Group;
  light: StatusLight;
  /** A screen to paint, where the station has one (the Slack TV, the calendar). */
  screen?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

/** The label over a station, flat against it, like the boards' and the bookshelf's. */
function label(spot: StationSpot, y: number, z = 0.02): THREE.Mesh {
  const meta = COMPOSIO_TOOLKIT_META[spot.toolkit];
  const sign = textPlane(`${meta.icon} ${meta.label}`, { size: 40, bg: '#fffaf3' });
  sign.position.set(0, y, z);
  return sign;
}

// ---------------------------------------------------------------- The models (each built facing +z, standing at the origin)

/** A cork board on two legs with wheels, a few cards pinned on it: the Linear board. */
function linearBoard(): StationModel {
  const { width: W, height: H } = LINEAR_BOARD;
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const boardH = 1.4;
  const top = H;
  const { group: board, face } = wallBoard(W - 0.3, boardH, PALETTE.wood);
  (face.material as THREE.MeshBasicMaterial).color.set(PALETTE.cork);
  board.position.set(0, top - boardH / 2 - 0.15, 0);
  group.add(board);
  // Three columns of cards, the way the issue boards lay theirs out.
  const paper = ['#fffaf3', '#ffe8d6', '#d8f3dc', '#e0fbfc'];
  let i = 0;
  for (let col = 0; col < 3; col++) {
    const n = 3 - (col === 1 ? 1 : 0);
    for (let row = 0; row < n; row++) {
      const card = mesh(roundedBox(0.5, 0.26, 0.01, 0.02), toon(paper[i++ % paper.length]), -0.68 + col * 0.68, top - 0.5 - row * 0.34, 0.09, false);
      parts.add(card);
      parts.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), toon(PALETTE.chairs[i % PALETTE.chairs.length]), -0.68 + col * 0.68, top - 0.5 - row * 0.34 + 0.11, 0.1, false));
    }
  }
  // Legs, a foot bar and wheels.
  const leg = toon('#3d405b');
  for (const sx of [-1, 1]) {
    parts.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, top - 0.2, 8), leg, sx * (W / 2 - 0.3), (top - 0.2) / 2, 0));
    parts.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.5), leg, sx * (W / 2 - 0.3), 0.08, 0));
    for (const sz of [-1, 1]) parts.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), toon('#2b2d42'), sx * (W / 2 - 0.3), 0.05, sz * 0.22));
  }
  group.add(mergeByMaterial(parts));
  group.add(label(LINEAR_BOARD, top + 0.2, 0.05));
  const light = new StatusLight(W / 2 - 0.25, top - 0.02, 0.06);
  group.add(light.mesh);
  return { group, light };
}

/** A low case of binders and notebooks in black, white and grey: the Notion bookshelf. */
function notionShelf(): StationModel {
  const { width: W, depth: D, height: H } = NOTION_SHELF;
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const wood = toon('#9c6644');
  const woodDark = toon('#7f5539');
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => parts.add(mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z));
  box(W, H, 0.03, woodDark, 0, H / 2, -D / 2 + 0.015);
  for (const sx of [-1, 1]) box(0.05, H, D, wood, sx * (W / 2 - 0.025), H / 2, 0);
  box(W + 0.06, 0.06, D + 0.04, wood, 0, H + 0.03, 0.01);
  box(W - 0.1, 0.08, D - 0.03, woodDark, 0, 0.04, -0.015);
  let seed = 20261004;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spines = ['#2b2d42', '#fffaf3', '#8d99ae', '#edf2f4', '#3d405b', '#fffaf3'];
  const bays = 3;
  const bay = (H - 0.08 - 0.03) / bays;
  for (let s = 0; s < bays; s++) {
    const floor = 0.08 + s * bay + 0.03;
    box(W - 0.1, 0.03, D - 0.03, wood, 0, floor - 0.015, -0.015);
    let x = -W / 2 + 0.08;
    while (x < W / 2 - 0.12) {
      const t = 0.045 + rand() * 0.035;
      const h = bay * (0.6 + rand() * 0.3);
      box(t, h, 0.22, toon(spines[Math.floor(rand() * spines.length)]), x + t / 2, floor + h / 2, D / 2 - 0.14);
      // A ring binder's label strip.
      if (rand() < 0.5) box(t + 0.004, 0.04, 0.224, toon('#adb5bd'), x + t / 2, floor + h * 0.7, D / 2 - 0.14);
      x += t + 0.004;
    }
  }
  group.add(mergeByMaterial(parts));
  // A lamp and a plant on top, like the desks have.
  group.add(mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 10), toon('#e76f51'), -W / 2 + 0.25, H + 0.12, 0));
  group.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), toon('#52b788'), -W / 2 + 0.25, H + 0.25, 0));
  group.add(label(NOTION_SHELF, H + 0.45, 0.02));
  const light = new StatusLight(W / 2 - 0.2, H + 0.1, 0.08);
  group.add(light.mesh);
  return { group, light };
}

/** A screen in a bezel on the wall, the TV's and the machine monitor's way: the Slack TV and the calendar. */
function wallScreen(spot: StationSpot): StationModel {
  const { width: W, height: H } = spot;
  const group = new THREE.Group();
  const bezel = mesh(roundedBox(W + 0.16, 0.1, H + 0.16, 0.06), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  group.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  screen.position.z = 0.06;
  group.add(screen);
  group.add(label(spot, H / 2 + 0.3, 0.02));
  const light = new StatusLight(W / 2 + 0.02, -H / 2 - 0.02, 0.07, 0.035);
  group.add(light.mesh);
  return { group, light, screen };
}

/** A desk with a rack of pigeonholes on it, envelopes in some: the mailroom. */
function mailroomDesk(): StationModel {
  const { width: W, depth: D, height: H } = MAILROOM;
  const group = new THREE.Group();
  const parts = new THREE.Group();
  parts.add(mesh(roundedBox(W - 0.06, 0.08, D - 0.04, 0.08), toon(PALETTE.desk), 0, H - 0.04, 0));
  const legMat = toon('#8d99ae');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, H - 0.08, 8), legMat, sx * (W / 2 - 0.14), (H - 0.08) / 2, sz * (D / 2 - 0.12)));
  parts.add(mesh(new THREE.BoxGeometry(W - 0.3, 0.32, 0.03), toon(PALETTE.deskLeg), 0, H - 0.26, -D / 2 + 0.06));
  // The pigeonholes: a grid of little cubbies along the back of the desk.
  const wood = toon('#9c6644');
  const cols = 5;
  const rows = 2;
  const cw = 0.3;
  const ch = 0.26;
  const rackW = cols * cw + 0.03;
  const rackH = rows * ch + 0.03;
  const rackZ = -D / 2 + 0.2;
  parts.add(mesh(new THREE.BoxGeometry(rackW, rackH, 0.02), toon('#7f5539'), 0, H + rackH / 2, rackZ - 0.13));
  for (let c = 0; c <= cols; c++) parts.add(mesh(new THREE.BoxGeometry(0.03, rackH, 0.28), wood, -rackW / 2 + 0.015 + c * cw, H + rackH / 2, rackZ));
  for (let r = 0; r <= rows; r++) parts.add(mesh(new THREE.BoxGeometry(rackW, 0.03, 0.28), wood, 0, H + 0.015 + r * ch, rackZ));
  // Envelopes in a few of them, a parcel on the desk, and a stamp pad.
  const envelope = toon('#fffaf3');
  for (const [c, r] of [[0, 0], [2, 1], [3, 0], [4, 1], [1, 1]] as const) {
    const e = mesh(new THREE.BoxGeometry(cw - 0.08, 0.14, 0.01), envelope, -rackW / 2 + 0.03 + c * cw + cw / 2, H + 0.03 + r * ch + 0.09, rackZ + 0.08, false);
    e.rotation.x = -0.25;
    parts.add(e);
  }
  parts.add(mesh(roundedBox(0.3, 0.2, 0.24, 0.02), toon('#c98b5a'), W / 2 - 0.4, H + 0.1, 0.15));
  parts.add(mesh(new THREE.BoxGeometry(0.34, 0.02, 0.03), toon('#b23a48'), W / 2 - 0.4, H + 0.21, 0.15, false));
  parts.add(mesh(roundedBox(0.16, 0.03, 0.12, 0.01), toon('#2b2d42'), -W / 2 + 0.4, H + 0.015, 0.25, false));
  group.add(mergeByMaterial(parts));
  group.add(label(MAILROOM, H + rackH + 0.3, rackZ));
  const light = new StatusLight(rackW / 2 - 0.02, H + rackH + 0.06, rackZ);
  group.add(light.mesh);
  return { group, light };
}

// ---------------------------------------------------------------- The screens' pictures

/** What the Slack TV shows: the channel count, or an invitation to connect. */
export function paintSlackScreen(screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, lines: readonly string[], connected: boolean) {
  const tex = canvasTexture(640, 384, (g) => {
    const grad = g.createLinearGradient(0, 0, 640, 384);
    grad.addColorStop(0, '#3a0ca3');
    grad.addColorStop(1, '#7209b7');
    g.fillStyle = grad;
    g.fillRect(0, 0, 640, 384);
    g.fillStyle = '#ffffff';
    g.font = '900 56px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText('💬 Slack', 36, 80);
    g.font = '700 28px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    const shown = connected ? lines.slice(0, 6) : ['Press E to connect your Slack'];
    shown.forEach((l, i) => g.fillText(l.length > 40 ? `${l.slice(0, 39)}…` : l, 36, 140 + i * 40));
  });
  screen.material.map?.dispose();
  screen.material.map = tex;
  screen.material.color.set('#ffffff');
  screen.material.toneMapped = false;
  screen.material.needsUpdate = true;
}

/** What the calendar on the wall shows: today's date and what's next. */
export function paintCalendarScreen(screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, next: readonly string[], connected: boolean, now = new Date()) {
  const tex = canvasTexture(640, 448, (g) => {
    g.fillStyle = '#fffaf3';
    g.fillRect(0, 0, 640, 448);
    g.fillStyle = '#ef476f';
    g.fillRect(0, 0, 640, 110);
    g.fillStyle = '#ffffff';
    g.font = '900 44px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(now.toLocaleDateString(undefined, { weekday: 'long' }), 36, 70);
    g.fillStyle = '#2b2d42';
    g.font = '900 150px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(String(now.getDate()), 36, 260);
    g.font = '800 40px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(now.toLocaleDateString(undefined, { month: 'long' }), 36, 310);
    g.font = '700 26px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillStyle = '#4a4e69';
    const shown = connected ? (next.length ? next.slice(0, 3) : ['Nothing on the calendar']) : ['Press E to connect Google Calendar'];
    shown.forEach((l, i) => g.fillText(l.length > 42 ? `${l.slice(0, 41)}…` : l, 36, 360 + i * 32));
  });
  screen.material.map?.dispose();
  screen.material.map = tex;
  screen.material.color.set('#ffffff');
  screen.material.toneMapped = false;
  screen.material.needsUpdate = true;
}

// ---------------------------------------------------------------- The fixture

/** What the office keeps of the stations: each one's light and screen, by toolkit. */
export interface IntegrationStations {
  readonly models: ReadonlyMap<ComposioToolkit, StationModel>;
  /** Lights each station by whether you've connected it ('none' for a toolkit the office doesn't show). */
  setConnections(mine: Partial<Record<ComposioToolkit, ComposioConnection>>, shown: readonly ComposioToolkit[]): void;
  update(dt: number): void;
}

/** One station, built at the origin facing +z (the props lab shows them this way too). */
export function buildStation(spot: StationSpot): StationModel {
  switch (spot.toolkit) {
    case 'linear':
      return linearBoard();
    case 'notion':
      return notionShelf();
    case 'slack':
    case 'googlecalendar':
      return wallScreen(spot);
    case 'gmail':
      return mailroomDesk();
  }
}

/** The five stations, in the free spots integrations.ts lists. */
export const integrations: Fixture<'integrations'> = (site) => {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const models = new Map<ComposioToolkit, StationModel>();
  for (const spot of STATION_SPOTS) {
    const m = buildStation(spot);
    m.group.position.set(spot.x, spot.y, spot.z);
    m.group.rotation.y = spot.rotY;
    group.add(m.group);
    models.set(spot.toolkit, m);
    const ahead = { x: Math.sin(spot.rotY), z: Math.cos(spot.rotY) };
    const onWall = spot.y > 0;
    // You stand a step in front of a floor piece, further back from a screen on the wall.
    const back = onWall ? 2.2 : 1.3;
    const it: Interactable = { kind: KIND[spot.toolkit], x: spot.x + ahead.x * back, z: spot.z + ahead.z * back, radius: onWall ? 2.6 : 1.6 };
    interactables.push(it);
    m.group.userData.interact = it;
    if (onWall) {
      const wall = wallFacing(spot.rotY);
      site.wall(wall, wall === 'north' || wall === 'south' ? spot.x : spot.z, spot.y, spot.width + 0.3, spot.height + 0.5);
    } else {
      const [minX, maxX, minZ, maxZ] = stationFootprint(spot);
      colliders.push({ minX, maxX, minZ, maxZ, top: spot.height + 0.1 });
    }
  }
  const handle: IntegrationStations = {
    models,
    setConnections(mine, shown) {
      for (const [toolkit, m] of models) m.light.set(shown.includes(toolkit) ? mine[toolkit] ?? 'off' : 'none');
    },
    update(dt) {
      for (const m of models.values()) m.light.update(dt);
    },
  };
  return { group, colliders, interactables, update: (_t, dt) => handle.update(dt), handle: { integrations: handle } };
};

// ---------------------------------------------------------------- Using them

export interface IntegrationsDeps {
  /** Opens a station's panel (ui/integrations/). */
  open(toolkit: ComposioToolkit): void;
  /** A teammate's character, to float what they did over their head. */
  personOf(peerId: string): { say(text: string, seconds?: number): void } | undefined;
}

/** What the stations do: E opens the panel, and what anyone does through one floats over their head. */
export function installIntegrations(ctx: Ctx, deps: IntegrationsDeps) {
  const connection = (toolkit: ComposioToolkit): string => {
    const { office, mine } = store.composio;
    if (!office.configured) return 'not set up yet';
    if (!office.toolkits.includes(toolkit)) return 'switched off';
    const c = mine.toolkits[toolkit];
    return c === 'connected' ? 'connected' : c === 'pending' ? 'connecting…' : 'not connected';
  };
  const station = (toolkit: ComposioToolkit) => {
    const meta = COMPOSIO_TOOLKIT_META[toolkit];
    return {
      reach: toolkit === 'slack' || toolkit === 'googlecalendar' ? 6 : 4,
      hint: () => {
        const state = connection(toolkit);
        return { k: state, parts: [hintTitle(`${meta.icon} ${meta.station}`), aside(state), key('E', 'Open')] };
      },
      use: onE(() => deps.open(toolkit)),
    };
  };
  ctx.interactions.define('linearboard', station('linear'));
  ctx.interactions.define('notionshelf', station('notion'));
  ctx.interactions.define('slacktv', station('slack'));
  ctx.interactions.define('calendarwall', station('googlecalendar'));
  ctx.interactions.define('mailroom', station('gmail'));

  const paint = () => {
    const { office, mine } = store.composio;
    ctx.office.integrations.setConnections(mine.toolkits, office.toolkits);
    const slack = ctx.office.integrations.models.get('slack')?.screen;
    if (slack) paintSlackScreen(slack, slackLines, mine.toolkits.slack === 'connected');
    const cal = ctx.office.integrations.models.get('googlecalendar')?.screen;
    if (cal) paintCalendarScreen(cal, calendarLines, mine.toolkits.googlecalendar === 'connected');
  };
  let slackLines: string[] = [];
  let calendarLines: string[] = [];
  store.on('composio', paint);
  paint();
  ctx.net.send({ t: 'composio.get' });

  ctx.messages.on('composio:activity', (msg) => {
    const text = `${msg.summary}`;
    if (msg.peer && msg.peer === store.you) ctx.me.say(text, 4);
    else if (msg.peer) deps.personOf(msg.peer)?.say(text, 4);
  });

  return {
    /** The panels tell the screens what they fetched, so the TV and the calendar show it from across the room. */
    showSlack(lines: string[]) {
      slackLines = lines;
      paint();
    },
    showCalendar(lines: string[]) {
      calendarLines = lines;
      paint();
    },
  };
}
