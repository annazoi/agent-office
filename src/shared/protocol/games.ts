// The gaming rooms: the lobby on your floor, the match it runs, and the first game played in it.
//
// Everything that decides anything (who is on which side, who shot whom, what a round was worth) is
// the office's; a browser only ever says what its player did, and hears what came of it.

import type { GameId, Side } from '../games/games.js';
import type { FeedLine, MatchState } from '../games/match.js';
import type { GearId } from '../games/fps/gear.js';
import type { HitPart } from '../games/fps/weapons.js';
import type { BoardKey, BoardRow, Profile, Span } from '../games/stats.js';

/** Where a player is and where they're looking, as everyone else's page draws them. */
export interface Pose {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Which way they face, and how far up or down they're looking. */
  yaw: number;
  pitch: number;
  crouch: boolean;
  moving: boolean;
  /** The gun in their hands. */
  weapon: string;
}

/** Your own side of a match, which is nobody else's business: what you have and how you're doing. */
export interface YouState {
  /** In the match at all. */
  in: boolean;
  team: Side;
  alive: boolean;
  health: number;
  armour: boolean;
  /** What you're carrying, and which of it is in your hands. */
  weapons: string[];
  weapon: string;
  /** Rounds in the magazine and in reserve, per weapon. */
  ammo: Record<string, { mag: number; spare: number }>;
  gear: Record<string, number>;
  /** What you have to spend at the buy menu. */
  money: number;
  /** When you come back, as the office's clock; 0 when you're not waiting. */
  respawnAt: number;
  /** Where the office put you when the round began, to start from. */
  spawn?: { x: number; y: number; z: number; rotY: number };
  /** Blinded until this moment on the office's clock. */
  blindUntil?: number;
}

/** Something that happened in the match, for the feed, the sounds and the effects. */
export type MatchEvent =
  /** Someone was eliminated. */
  | { e: 'kill'; line: FeedLine }
  /** You were hit (sent only to the one hit), or you hit someone (sent only to the shooter). */
  | { e: 'hurt'; by: string; damage: number; part: HitPart; health: number }
  | { e: 'hitmark'; who: string; part: HitPart; killed: boolean }
  /** A round began or ended. */
  | { e: 'round'; round: number; of: number }
  | { e: 'roundOver'; winner: Side; reason: string; score: { a: number; b: number } }
  /** The match ended. */
  | { e: 'matchOver'; winner: Side; reason: string; xp: number }
  /** Somebody threw something: everyone's page flies it the same way from here (see flyGrenade). */
  | { e: 'throw'; id: string; gear: GearId; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  /** A grenade went off at a spot everyone can see. */
  | { e: 'burst'; gear: GearId; x: number; y: number; z: number }
  /** You were flashed, until this moment on the office's clock. */
  | { e: 'blind'; until: number }
  /** Somebody joined or left in a way worth saying out loud. */
  | { e: 'say'; text: string };

export type GamesClientMsg =
  /**
   * Open a lobby on your floor for `game` (administrators only), or change what an open one is set up
   * to be. The office answers with `game` either way.
   */
  | { t: 'game.open'; game: GameId; settings?: unknown }
  | { t: 'game.config'; settings: unknown }
  /** Join the lobby on your floor, or leave it; leaving mid-round gives the round to the other side if it empties yours. */
  | { t: 'game.join' }
  | { t: 'game.leave' }
  | { t: 'game.ready'; ready: boolean }
  /** Move to a side. `who` is someone else, which only the host and administrators may do. */
  | { t: 'game.team'; team: Side; who?: string }
  /** The match controls, all of them the host's and the administrators' (see server/floor/arena). */
  | { t: 'game.control'; act: 'start' | 'stop' | 'reset' | 'pause' | 'resume' | 'shuffle' | 'balance' | 'lock' | 'unlock' | 'close' }
  | { t: 'game.kick'; who: string }
  /** Buy a gun, a piece of gear or armour, while the round's buy time is on. */
  | { t: 'game.buy'; weapon?: string; gear?: string; armour?: boolean }
  /** Where you are and where you're looking, a few times a second while you're in a match. */
  | { t: 'game.pose'; x: number; y: number; z: number; yaw: number; pitch: number; crouch: boolean; moving: boolean }
  /** A shot, from where you were aiming: the office shoots the ray itself and says what it hit. */
  | { t: 'game.fire'; yaw: number; pitch: number }
  | { t: 'game.reload' }
  /** Take out one of the guns you're carrying. */
  | { t: 'game.weapon'; weapon: string }
  /** Throw a piece of gear the way you're looking. */
  | { t: 'game.throw'; gear: string; yaw: number; pitch: number }
  /** Ask for a profile (yours with no `account`), or for a leaderboard page. */
  | { t: 'game.profile'; game: GameId; account?: string }
  | { t: 'game.board'; game: GameId; key: BoardKey; span: Span };

export type GamesServerMsg =
  /** The match on your floor as it stands, whenever anything about it changes. */
  | { t: 'game'; match: MatchState }
  /** Your own side of it: your health, what you're carrying and where the office put you. */
  | { t: 'game.you'; you: YouState }
  /** Where everyone in the match is, several times a second (dropped under load, like peer.move). */
  | { t: 'game.poses'; at: number; poses: Pose[] }
  /** A shot somebody fired: from (x, y, z) to wherever it stopped, so every page draws the same tracer. */
  | { t: 'game.shot'; id: string; weapon: string; x: number; y: number; z: number; tx: number; ty: number; tz: number; hit: boolean }
  /** Something that happened in the match. */
  | { t: 'game.event'; event: MatchEvent }
  /** Sent to whoever asked (see game.profile and game.board). */
  | { t: 'game.profile'; profile: Profile; rank: number }
  | { t: 'game.board'; key: BoardKey; span: Span; rows: BoardRow[] };
