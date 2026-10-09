// The games the office has, and what the gaming platform knows about each one. A new game adds its
// row here and its own module beside this one; everything the platform does (the arena door, the
// lobby, teams, the match lifecycle, stats and the leaderboards) goes by this table rather than by
// naming a game, so a second game plugs in without the platform changing.

/** Every game the office can run a match of. */
export const GAME_IDS = ['fps'] as const;
export type GameId = (typeof GAME_IDS)[number];

/** The two sides of a match. Teams are the platform's; what they're called is the game's. */
export const TEAMS = ['a', 'b'] as const;
export type TeamId = (typeof TEAMS)[number];
/** Who isn't on a side: in the lobby, watching, or waiting to be put on one. */
export type Side = TeamId | 'none';

export interface TeamDef {
  id: TeamId;
  name: string;
  /** The color its players wear, and the one its score is in. */
  color: string;
}

/** One way a game can be played (see MatchSettings.mode). */
export interface ModeDef {
  id: string;
  name: string;
  blurb: string;
  /** Players come back after a few seconds instead of sitting the round out. */
  respawns: boolean;
}

export interface GameDef {
  id: GameId;
  name: string;
  emoji: string;
  blurb: string;
  teams: readonly [TeamDef, TeamDef];
  modes: readonly ModeDef[];
  /** The arenas it can be played in (see ARENAS in fps/arena.ts for the first game's). */
  maps: readonly { id: string; name: string }[];
  /** Fewest players a match can start with, and the most a lobby holds. */
  minPlayers: number;
  maxPlayers: number;
}

export const FPS: GameDef = {
  id: 'fps',
  name: 'Breach',
  emoji: '🎯',
  blurb: 'Round-based tactical shooting, two teams, one arena.',
  teams: [
    { id: 'a', name: 'Raiders', color: '#f0a04b' },
    { id: 'b', name: 'Wardens', color: '#4f86f7' },
  ],
  modes: [
    { id: 'elim', name: 'Elimination', blurb: 'One life a round. Wipe the other team, or hold out the clock.', respawns: false },
    { id: 'dm', name: 'Team deathmatch', blurb: 'Respawn and keep going; the round goes to whoever leads when the clock runs out.', respawns: true },
  ],
  maps: [{ id: 'depot', name: 'The Depot' }],
  minPlayers: 2,
  maxPlayers: 10,
};

export const GAMES: readonly GameDef[] = [FPS];
export const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));

export function isGameId(v: unknown): v is GameId {
  return typeof v === 'string' && GAME_BY_ID.has(v as GameId);
}

export function isTeam(v: unknown): v is TeamId {
  return v === 'a' || v === 'b';
}

/** The other side. */
export const otherTeam = (t: TeamId): TeamId => (t === 'a' ? 'b' : 'a');

/** What a team is called in `game`, and the color it wears. */
export function teamDef(game: GameDef, team: TeamId): TeamDef {
  return game.teams[team === 'a' ? 0 : 1];
}
