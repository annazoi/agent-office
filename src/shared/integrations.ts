// Where the Composio stations stand on the office floor (see src/client/world/integrations.ts), in
// the spots the plan in layout.ts leaves free: two on the walls, three on the floor against them.
// Kept here, beside layout.ts, so the server's pathfinding (nav.ts) can walk around them too.
import { FLOOR } from './layout.js';
import type { ComposioStationToolkit } from './protocol/composio.js';

export interface StationSpot {
  toolkit: ComposioStationToolkit;
  /** Where its middle stands (or hangs), and the way it faces (0 is +z). */
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Its footprint along the wall and out from it, and its height. */
  width: number;
  depth: number;
  height: number;
}

/**
 * The Linear board: a cork board on a stand, on the floor north of the desks, between the PR agent's
 * kiosk and the whiteboard, facing the room.
 */
export const LINEAR_BOARD: StationSpot = { toolkit: 'linear', x: 2.6, y: 0, z: -8.3, rotY: 0, width: 2.4, depth: 0.5, height: 2.2 };
/** The Notion bookshelf: a low case against the west wall's windows, in the aisle west of the desks, facing east. */
export const NOTION_SHELF: StationSpot = { toolkit: 'notion', x: -14.6, y: 0, z: 0, rotY: Math.PI / 2, width: 1.6, depth: 0.42, height: 1.5 };
/** The Slack TV: on the south wall between the balcony doors and the east window. */
export const SLACK_TV: StationSpot = { toolkit: 'slack', x: -1.5, y: 2.0, z: FLOOR.maxZ - 0.08, rotY: Math.PI, width: 1.5, depth: 0.14, height: 0.9 };
/** The calendar display: on the east wall between the Services board and the TV. */
export const CALENDAR_WALL: StationSpot = { toolkit: 'googlecalendar', x: FLOOR.maxX - 0.08, y: 2.2, z: -4.2, rotY: -Math.PI / 2, width: 1.3, depth: 0.12, height: 0.9 };
/** The mailroom desk: a desk with pigeonholes, between the front desks and the stairs to the loft. */
export const MAILROOM: StationSpot = { toolkit: 'gmail', x: 3.6, y: 0, z: 7.6, rotY: 0, width: 2.2, depth: 1.1, height: 0.78 };

export const STATION_SPOTS: readonly StationSpot[] = [LINEAR_BOARD, NOTION_SHELF, SLACK_TV, CALENDAR_WALL, MAILROOM];

/** The floor a station takes up, as [minX, maxX, minZ, maxZ], for colliders and the pathfinding. */
export function stationFootprint(s: StationSpot, pad = 0.05): [number, number, number, number] {
  const along = Math.abs(Math.cos(s.rotY)) > 0.5;
  const hw = (along ? s.width : s.depth) / 2 + pad;
  const hd = (along ? s.depth : s.width) / 2 + pad;
  return [s.x - hw, s.x + hw, s.z - hd, s.z + hd];
}

/** The stations that stand on the floor (the wall-hung ones are over everyone's head). */
export function stationObstacles(): [number, number, number, number][] {
  return STATION_SPOTS.filter((s) => s.y === 0).map((s) => stationFootprint(s, 0.1));
}
