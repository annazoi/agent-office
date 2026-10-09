// What playing leaves behind: a profile per account per game, the XP it earns and the level that
// makes, and how the leaderboards are ordered. The office keeps every one of these itself (see
// server/games/stats.ts); nothing a browser sends ever adds to them.

import type { GameId } from './games.js';

/** What someone has done in a game, all the matches they've played of it added up. */
export interface Profile {
  /** The account it belongs to, and the game it's for. */
  account: string;
  game: GameId;
  /** Their name as it was when they last played, for the leaderboard. */
  name: string;
  color: string;
  xp: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  /** The most they've killed in one match. */
  best: number;
  /** Seconds played. */
  played: number;
  at: number;
}

export const emptyProfile = (account: string, game: GameId, name = '', color = '#4f86f7'): Profile => ({
  account,
  game,
  name,
  color,
  xp: 0,
  matches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  rounds: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  headshots: 0,
  best: 0,
  played: 0,
  at: 0,
});

/** What each thing you do is worth. The office is the only one that ever hands these out. */
export const XP = {
  kill: 100,
  headshot: 40,
  assist: 40,
  roundWin: 150,
  roundLoss: 40,
  matchWin: 600,
  matchDraw: 250,
  matchLoss: 120,
  /** Every elimination after the first in one round, on top of the kill itself. */
  multiKill: 60,
  /** The last one standing who wins the round for their side. */
  clutch: 200,
} as const;

/** How much XP a level takes, on top of the one before: it climbs, so the levels keep their weight. */
export const levelCost = (level: number): number => 800 + (level - 1) * 260;

/** The level `xp` makes, from 1 up. */
export function levelFor(xp: number): number {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < LEVEL_CAP && left >= levelCost(level)) {
    left -= levelCost(level);
    level++;
  }
  return level;
}

export const LEVEL_CAP = 60;

/** How far through their level someone is: how much XP into it, and how much the level takes. */
export function levelProgress(xp: number): { level: number; into: number; need: number } {
  const level = levelFor(xp);
  let spent = 0;
  for (let l = 1; l < level; l++) spent += levelCost(l);
  return { level, into: Math.max(0, xp - spent), need: level >= LEVEL_CAP ? 0 : levelCost(level) };
}

/** Kills per death, with a death assumed where there are none, so one kill isn't an infinite ratio. */
export const kd = (p: Pick<Profile, 'kills' | 'deaths'>): number => p.kills / Math.max(1, p.deaths);
/** Matches won out of matches played, as a fraction. */
export const winRate = (p: Pick<Profile, 'wins' | 'matches'>): number => (p.matches ? p.wins / p.matches : 0);
/** Headshots out of kills, as a fraction. */
export const headshotRate = (p: Pick<Profile, 'headshots' | 'kills'>): number => (p.kills ? p.headshots / p.kills : 0);

/** The ways the leaderboard can be ordered. */
export const BOARDS = ['xp', 'level', 'wins', 'winRate', 'kills', 'kd'] as const;
export type BoardKey = (typeof BOARDS)[number];

export const BOARD_NAMES: Record<BoardKey, string> = {
  xp: 'XP',
  level: 'Level',
  wins: 'Wins',
  winRate: 'Win rate',
  kills: 'Kills',
  kd: 'K/D',
};

/** How long a leaderboard looks back. */
export const SPANS = ['week', 'month', 'all'] as const;
export type Span = (typeof SPANS)[number];
export const SPAN_NAMES: Record<Span, string> = { week: 'This week', month: 'This month', all: 'All time' };

export function isBoard(v: unknown): v is BoardKey {
  return typeof v === 'string' && (BOARDS as readonly string[]).includes(v);
}

export function isSpan(v: unknown): v is Span {
  return typeof v === 'string' && (SPANS as readonly string[]).includes(v);
}

/** What a profile is worth on the board `key`. */
export function rankBy(p: Profile, key: BoardKey): number {
  switch (key) {
    case 'level':
      return levelFor(p.xp);
    case 'wins':
      return p.wins;
    // A win rate off two matches isn't a win rate: too few played counts for nothing.
    case 'winRate':
      return p.matches >= RANKED_MATCHES ? winRate(p) : -1;
    case 'kills':
      return p.kills;
    case 'kd':
      return p.matches >= RANKED_MATCHES ? kd(p) : -1;
    default:
      return p.xp;
  }
}

/** Matches someone has to have played before their rates go on a board. */
export const RANKED_MATCHES = 3;

/** One row of a leaderboard, as the office works it out. */
export interface BoardRow {
  rank: number;
  account: string;
  name: string;
  color: string;
  level: number;
  xp: number;
  matches: number;
  wins: number;
  winRate: number;
  kills: number;
  deaths: number;
  kd: number;
  headshots: number;
  /** It's you. */
  you?: boolean;
}

/** How many rows a leaderboard sends. */
export const BOARD_ROWS = 25;
