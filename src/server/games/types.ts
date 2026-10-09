// The seam between the gaming platform and a game. The platform (floor/arena.ts) owns the lobby, the
// sides, the clock and the rounds, and keeps nothing about shooting; the game owns what a player
// carries, what a shot does and who won the round, and keeps nothing about lobbies.
//
// A second game is another GameRules in games/, a row in shared/games/games.ts, and nothing else.
import type { GameId, Side, TeamId } from '../../shared/games/games.js';
import type { MatchSettings, Player } from '../../shared/games/match.js';
import type { GamesClientMsg, MatchEvent, Pose, YouState } from '../../shared/protocol.js';
import type { Client } from '../office/client.js';

/** One person in the match, as the office keeps them: what everyone sees, and what only they do. */
export interface Seat {
  readonly client: Client;
  /** Their connection id, the same one their peer goes by. */
  readonly id: string;
  account?: string;
  team: Side;
  ready: boolean;
  host: boolean;
  admin: boolean;
  /** Playing right now, rather than waiting to come back or watching. */
  alive: boolean;
  health: number;
  armour: boolean;
  /** What they're carrying, what's in their hands, and what's in it. */
  weapons: string[];
  weapon: string;
  ammo: Map<string, { mag: number; spare: number }>;
  gear: Map<string, number>;
  money: number;
  /** When their gun may next go off, when their reload finishes, and when they may throw again (office clock). */
  nextShot: number;
  reloadingUntil: number;
  nextThrow: number;
  /** When they come back, 0 when they aren't waiting to. */
  respawnAt: number;
  /** Blinded by a flash until this moment. */
  blindUntil: number;
  /** Where they last said they were, and when: what shots are worked out against. */
  pose: Pose;
  poseAt: number;
  /** How many poses the office has thrown away for moving further than anyone can (see the speed check). */
  warps: number;
  /** Who hurt them since they last came back, for the assists. */
  hurtBy: Map<string, number>;
  /** This match so far. */
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  score: number;
  /** This round so far, for the multi-kill bonus. */
  roundKills: number;
  /** XP earned this match, which is what goes into their profile at the end. */
  xp: number;
  /** Rounds they were on a side for. */
  rounds: number;
  /** Their level coming in, for the lobby list. */
  level: number;
  joinedAt: number;
}

/** What the game's rules can do back to the match they're part of. */
export interface Room {
  readonly settings: MatchSettings;
  readonly round: number;
  /** Everyone on a side, playing or waiting to come back. */
  seats(): Seat[];
  seat(id: string): Seat | undefined;
  /** The office's clock. */
  now(): number;
  /** To everyone on the floor, players and the people watching from the lobby. */
  toFloor(msg: MatchEvent): void;
  /** Just to one player. */
  toSeat(seat: Seat, msg: MatchEvent): void;
  /** A shot for everyone on the floor to draw. */
  shot(seat: Seat, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, hit: boolean): void;
  /** `who` was eliminated by `by` (nobody for a fall or a frag of their own): the office counts it. */
  eliminated(who: Seat, by: Seat | undefined, withWhat: string, headshot: boolean): void;
  /** Their own state changed (health, ammo, money): send it to them. */
  changed(seat: Seat): void;
  /** The lobby's own state changed (scores, who's alive): send it to the floor. */
  lobbyChanged(): void;
  /** Tells one person why what they asked for didn't happen. */
  warn(seat: Seat, text: string): void;
}

/** A game the office can run a match of. */
export interface GameRules {
  readonly id: GameId;
  /** What may be bought or carried, for checking a match's settings. */
  readonly weapons: readonly string[];
  readonly gear: readonly string[];
  /** What someone has to spend when they first come in. */
  startMoney(): number;
  /** Sets a player up for a fresh round: their health, what they carry and what they have to spend. */
  startRound(room: Room, seat: Seat, n: number): void;
  /** Puts a player back on their feet mid-round, where the mode has them come back. */
  respawn(room: Room, seat: Seat, n: number): void;
  /** Where player `n` of `team` comes in. */
  spawnOf(team: TeamId, n: number): { x: number; y: number; z: number; rotY: number };
  /** Who has won the round, if anyone has yet. `timeUp` is the clock having run out. */
  decide(room: Room, timeUp: boolean): { winner: Side; reason: string } | undefined;
  /** The game's own messages: firing, reloading, buying, throwing. True when it took the message. */
  handle(room: Room, seat: Seat, msg: GamesClientMsg): boolean;
  /** Runs a few times a second while a round is live: grenades in the air, people coming back. */
  tick(room: Room): void;
  /** Everything a round left behind (grenades, smoke) goes. */
  clear(): void;
  /** What only this player sees of the match. */
  you(seat: Seat, inMatch: boolean): YouState;
  /** What everyone sees of this player, for the lobby list. */
  publish(seat: Seat): Pick<Player, 'alive' | 'health'>;
}
