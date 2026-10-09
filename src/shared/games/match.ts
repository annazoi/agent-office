// A match, as both sides see it: what an administrator set it up to be, who's in the lobby and on
// which side, and where the match has got to. The office owns all of it; a browser only ever asks.
//
// None of this is about shooting: a second game would keep the same lobby, the same teams and the
// same lifecycle, and bring its own rules (see fps/ for the first one's).

import { GAME_BY_ID, type GameId, type Side, type TeamId, isGameId, isTeam } from './games.js';

/** How a match is set up. Administrators change these; everything is checked again by the office. */
export interface MatchSettings {
  game: GameId;
  mode: string;
  map: string;
  /** The most on one side, and in the lobby at all. */
  perTeam: number;
  maxPlayers: number;
  /** Fewest who have to be in before it can start. */
  minPlayers: number;
  rounds: number;
  /** Seconds a round runs for, and the count-in before the match and between rounds. */
  roundSeconds: number;
  countdown: number;
  betweenRounds: number;
  /** Seconds before someone comes back, where the mode has them come back at all. */
  respawnSeconds: number;
  friendlyFire: boolean;
  /** The office puts people on sides and evens them up itself. */
  autoTeams: boolean;
  /** Players may move themselves between sides while the lobby is open. */
  pickTeams: boolean;
  /** It starts by itself as soon as enough people are ready. */
  autoStart: boolean;
  /** Everyone starts a round with the same gun, rather than buying one. */
  buyMenu: boolean;
  /** What may be bought or carried; empty means everything the game has. */
  weapons: readonly string[];
  gear: readonly string[];
}

export const DEFAULT_SETTINGS: MatchSettings = {
  game: 'fps',
  mode: 'elim',
  map: 'depot',
  perTeam: 5,
  maxPlayers: 10,
  minPlayers: 2,
  rounds: 9,
  roundSeconds: 110,
  countdown: 10,
  betweenRounds: 7,
  respawnSeconds: 5,
  friendlyFire: false,
  autoTeams: true,
  pickTeams: true,
  autoStart: true,
  buyMenu: true,
  weapons: [],
  gear: [],
};

/** Where a match has got to. */
export type MatchPhase =
  /** Nobody has opened a lobby yet. */
  | 'idle'
  /** The lobby is open and taking players. */
  | 'lobby'
  /** Enough are ready: the count-in before the first round. */
  | 'countdown'
  /** A round is being played. */
  | 'live'
  /** The round is over and the next one is coming. */
  | 'between'
  /** An administrator stopped the clock. */
  | 'paused'
  /** The match is over; its result is on the board until someone opens a new lobby. */
  | 'over';

/** One person in the lobby or the match. */
export interface Player {
  /** Their connection, which is also their peer id. */
  id: string;
  name: string;
  color: string;
  /** Their account, where they have one: what their stats are kept under. */
  account?: string;
  team: Side;
  ready: boolean;
  /** Playing, rather than watching from the lobby. */
  alive: boolean;
  health: number;
  kills: number;
  deaths: number;
  assists: number;
  /** What they've scored this match, which is what the round and match XP goes by. */
  score: number;
  /** Their level coming in, for the lobby list. */
  level: number;
  /** They opened this lobby: they may change its settings as an administrator can. */
  host: boolean;
  /** An administrator of the office. */
  admin: boolean;
}

/** A line of the kill feed. */
export interface FeedLine {
  at: number;
  by: string;
  byTeam: Side;
  who: string;
  whoTeam: Side;
  /** What did it: a weapon id, a gear id, or 'fall'. */
  with: string;
  headshot?: boolean;
  /** They did it to themselves, or to their own side. */
  own?: boolean;
}

/** The match as everyone on the floor sees it. */
export interface MatchState {
  phase: MatchPhase;
  settings: MatchSettings;
  players: Player[];
  /** Rounds each side has won. */
  score: Record<TeamId, number>;
  round: number;
  /** When the phase's clock runs out, as the office's clock (0 when nothing is counting). */
  until: number;
  /** Who opened the lobby. */
  host: string;
  /** The last few eliminations, newest last. */
  feed: FeedLine[];
  /** How the match ended, once it has. */
  result?: { winner: Side; reason: string };
}

export const EMPTY_MATCH: MatchState = { phase: 'idle', settings: DEFAULT_SETTINGS, players: [], score: { a: 0, b: 0 }, round: 0, until: 0, host: '', feed: [] };

/** How many lines of kill feed are kept. */
export const FEED_KEPT = 8;

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const ids = (v: unknown, known: readonly string[]): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.includes(x)))] : []);

/**
 * Settings as the office will have them: anything missing or out of range comes back to what `was`
 * had (the defaults, for a new lobby). Nothing here trusts a browser.
 */
export function checkSettings(raw: unknown, was: MatchSettings = DEFAULT_SETTINGS, known: { weapons: readonly string[]; gear: readonly string[] } = { weapons: [], gear: [] }): MatchSettings {
  const o = (raw ?? {}) as Partial<MatchSettings>;
  const game = GAME_BY_ID.get(isGameId(o.game) ? o.game : was.game)!;
  const mode = game.modes.find((m) => m.id === o.mode)?.id ?? game.modes.find((m) => m.id === was.mode)?.id ?? game.modes[0].id;
  const map = game.maps.find((m) => m.id === o.map)?.id ?? game.maps.find((m) => m.id === was.map)?.id ?? game.maps[0].id;
  const perTeam = clamp(o.perTeam, 1, Math.ceil(game.maxPlayers / 2), was.perTeam);
  const maxPlayers = clamp(o.maxPlayers, 2, game.maxPlayers, was.maxPlayers);
  return {
    game: game.id,
    mode,
    map,
    perTeam,
    maxPlayers: Math.max(2, Math.min(maxPlayers, perTeam * 2)),
    minPlayers: Math.max(game.minPlayers, Math.min(clamp(o.minPlayers, game.minPlayers, game.maxPlayers, was.minPlayers), maxPlayers)),
    rounds: clamp(o.rounds, 1, 30, was.rounds),
    roundSeconds: clamp(o.roundSeconds, 20, 600, was.roundSeconds),
    countdown: clamp(o.countdown, 3, 60, was.countdown),
    betweenRounds: clamp(o.betweenRounds, 3, 60, was.betweenRounds),
    respawnSeconds: clamp(o.respawnSeconds, 1, 30, was.respawnSeconds),
    friendlyFire: bool(o.friendlyFire, was.friendlyFire),
    autoTeams: bool(o.autoTeams, was.autoTeams),
    pickTeams: bool(o.pickTeams, was.pickTeams),
    autoStart: bool(o.autoStart, was.autoStart),
    buyMenu: bool(o.buyMenu, was.buyMenu),
    weapons: o.weapons === undefined ? was.weapons : ids(o.weapons, known.weapons),
    gear: o.gear === undefined ? was.gear : ids(o.gear, known.gear),
  };
}

/** Whether `id` may be carried in a match whose list is `list` (an empty list is everything). */
export const allowed = (list: readonly string[], id: string): boolean => list.length === 0 || list.includes(id);

/** Everyone on `team`. */
export const onTeam = (players: readonly Player[], team: TeamId): Player[] => players.filter((p) => p.team === team);

/** The side a new player goes on: the emptier one, and none at all when both are full. */
export function openSide(players: readonly Player[], settings: MatchSettings): Side {
  const a = onTeam(players, 'a').length;
  const b = onTeam(players, 'b').length;
  if (a <= b && a < settings.perTeam) return 'a';
  if (b < settings.perTeam) return 'b';
  return 'none';
}

/** Whether moving `who` to `team` would leave a side over its limit. */
export function canJoinSide(players: readonly Player[], settings: MatchSettings, who: string, team: Side): boolean {
  if (team === 'none') return true;
  return onTeam(players, team).filter((p) => p.id !== who).length < settings.perTeam;
}

/**
 * Everyone put on a side, evened up: the ones already on one stay where they are where that fits, and
 * the rest (and anyone over a side's limit) go where there's room, strongest first so the sides match.
 * `shuffle` throws the sides away and deals everyone out again at random.
 */
export function balance(players: readonly Player[], settings: MatchSettings, shuffle = false): Map<string, Side> {
  const out = new Map<string, Side>();
  const sides: Record<TeamId, number> = { a: 0, b: 0 };
  const order = [...players];
  if (shuffle) order.sort(() => Math.random() - 0.5);
  else order.sort((p, q) => q.level - p.level || q.score - p.score);
  const keep = shuffle ? [] : order.filter((p) => isTeam(p.team));
  for (const p of keep) {
    const t = p.team as TeamId;
    if (sides[t] >= settings.perTeam) continue;
    sides[t]++;
    out.set(p.id, t);
  }
  for (const p of order) {
    if (out.has(p.id)) continue;
    const t: TeamId = sides.a <= sides.b ? 'a' : 'b';
    if (sides[t] >= settings.perTeam) {
      out.set(p.id, 'none');
      continue;
    }
    sides[t]++;
    out.set(p.id, t);
  }
  return out;
}

/** Why a match set up this way can't start with these players, or nothing when it can. */
export function cannotStart(players: readonly Player[], settings: MatchSettings): string | undefined {
  const inIt = players.filter((p) => isTeam(p.team));
  if (inIt.length < settings.minPlayers) return `${settings.minPlayers} players have to be on a side; there ${inIt.length === 1 ? 'is' : 'are'} ${inIt.length}.`;
  if (!onTeam(inIt, 'a').length || !onTeam(inIt, 'b').length) return 'Both sides need somebody on them.';
  return undefined;
}
