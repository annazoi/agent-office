// The people in a match, as the office keeps them: a fresh seat for someone who just joined, and the
// part of it everyone else gets to see. Nothing here is about any one game.
import type { Side } from '../../shared/games/games.js';
import type { Player } from '../../shared/games/match.js';
import type { Pose, YouState } from '../../shared/protocol.js';
import type { Client } from '../office/client.js';
import type { GameRules, Seat } from './types.js';

/** What someone who isn't in a match is sent, so their page knows it has nothing to draw. */
export const NOT_PLAYING: YouState = { in: false, team: 'none', alive: false, health: 0, armour: false, weapons: [], weapon: '', ammo: {}, gear: {}, money: 0, respawnAt: 0 };

export const emptyPose = (id: string): Pose => ({ id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, moving: false, weapon: 'sidearm' });

/** Somebody who just joined a lobby: on no side, carrying nothing, with their level from their profile. */
export function newSeat(c: Client, rules: GameRules, level: number): Seat {
  return {
    client: c,
    id: c.id,
    ...(c.accountId ? { account: c.accountId } : {}),
    team: 'none' as Side,
    ready: false,
    host: false,
    admin: c.admin,
    alive: false,
    health: 0,
    armour: false,
    weapons: [],
    weapon: 'sidearm',
    ammo: new Map(),
    gear: new Map(),
    money: rules.startMoney(),
    nextShot: 0,
    reloadingUntil: 0,
    nextThrow: 0,
    respawnAt: 0,
    blindUntil: 0,
    pose: emptyPose(c.id),
    poseAt: Date.now(),
    warps: 0,
    hurtBy: new Map(),
    kills: 0,
    deaths: 0,
    assists: 0,
    headshots: 0,
    score: 0,
    roundKills: 0,
    xp: 0,
    rounds: 0,
    level,
    joinedAt: Date.now(),
  };
}

/** Everything a seat back to the lobby, for a match that's starting over. */
export function resetSeat(s: Seat, rules: GameRules) {
  Object.assign(s, { ready: false, alive: false, health: 0, armour: false, kills: 0, deaths: 0, assists: 0, headshots: 0, score: 0, roundKills: 0, xp: 0, rounds: 0, weapons: [], weapon: 'sidearm', money: rules.startMoney() });
  s.ammo.clear();
  s.gear.clear();
  s.hurtBy.clear();
}

/** The part of a seat everyone on the floor sees. */
export function publishSeat(s: Seat, rules: GameRules, hostId: string): Player {
  return {
    id: s.id,
    name: s.client.peer.name,
    color: s.client.peer.color,
    ...(s.account ? { account: s.account } : {}),
    team: s.team,
    ready: s.ready,
    ...rules.publish(s),
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    score: s.score,
    level: s.level,
    host: s.id === hostId,
    admin: s.admin,
  };
}
