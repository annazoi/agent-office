// What playing leaves behind, kept in the office's database: a profile per account per game, and a
// log of what each match added, so a leaderboard can look back over a week or a month as well as
// over everything. The office writes both itself, at the end of a round and at the end of a match;
// nothing a browser sends ever lands here.
import { stateDoc, type Doc } from '../db/state.js';
import type { GameId } from '../../shared/games/games.js';
import { BOARD_ROWS, RANKED_MATCHES, emptyProfile, kd, levelFor, rankBy, winRate, type BoardKey, type BoardRow, type Profile, type Span } from '../../shared/games/stats.js';

/** What one match added to one player's profile, kept so the week's and the month's boards can be added up. */
export interface MatchRecord {
  at: number;
  account: string;
  name: string;
  color: string;
  xp: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  rounds: number;
  played: number;
  result: 'win' | 'loss' | 'draw';
}

/** How many matches the log keeps before the oldest drop off. */
const LOG_KEPT = 4000;
/** How far back each span looks, in ms. */
const SPAN_MS: Record<Exclude<Span, 'all'>, number> = { week: 7 * 86_400_000, month: 30 * 86_400_000 };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A profile read back from the database, with anything broken in it made good. */
function checkProfile(raw: unknown, account: string, game: GameId): Profile {
  const o = (raw ?? {}) as Partial<Profile>;
  const p = emptyProfile(account, game, typeof o.name === 'string' ? o.name.slice(0, 32) : '', typeof o.color === 'string' ? o.color : '#4f86f7');
  for (const k of ['xp', 'matches', 'wins', 'losses', 'draws', 'rounds', 'kills', 'deaths', 'assists', 'headshots', 'best', 'played', 'at'] as const) p[k] = Math.max(0, Math.round(num(o[k])));
  return p;
}

/** Everyone's profiles for one game, and the log of the matches that made them. */
interface Saved {
  profiles: Record<string, Profile>;
  log: MatchRecord[];
}

/**
 * The office's record of who has played what. One of these per game, made as the office starts; the
 * floors' gaming rooms hand it what each match came to.
 */
export class GameStats {
  private profiles = new Map<string, Profile>();
  private log: MatchRecord[] = [];
  private doc: Doc<Saved>;

  constructor(
    dataDir: string,
    private readonly game: GameId,
  ) {
    this.doc = stateDoc<Saved>(dataDir, `games-${game}`);
    this.load();
  }

  /** `account`'s profile, an empty one when they've never played. */
  profile(account: string, name?: string, color?: string): Profile {
    const p = this.profiles.get(account) ?? emptyProfile(account, this.game, name, color);
    return { ...p, name: name ?? p.name, color: color ?? p.color };
  }

  /** What level `account` is, for the lobby list. */
  level(account: string | undefined): number {
    return account ? levelFor(this.profiles.get(account)?.xp ?? 0) : 1;
  }

  /** Where `account` stands on the all-time XP board (0 when they've never played). */
  rank(account: string): number {
    const mine = this.profiles.get(account);
    if (!mine) return 0;
    let above = 0;
    for (const p of this.profiles.values()) if (p.xp > mine.xp) above++;
    return above + 1;
  }

  /**
   * Adds what a match came to for one player. Called once per player per match, from the office's own
   * end-of-match handling: `at` is the match's id-ish moment, and a record with the same account and
   * moment already in the log is ignored, so a retry can't pay twice.
   */
  record(r: MatchRecord): Profile {
    if (this.log.some((e) => e.account === r.account && e.at === r.at)) return this.profile(r.account);
    const p = checkProfile(this.profiles.get(r.account), r.account, this.game);
    p.name = r.name || p.name;
    p.color = r.color || p.color;
    p.xp += Math.max(0, Math.round(r.xp));
    p.matches += 1;
    p.wins += r.result === 'win' ? 1 : 0;
    p.losses += r.result === 'loss' ? 1 : 0;
    p.draws += r.result === 'draw' ? 1 : 0;
    p.rounds += Math.max(0, r.rounds);
    p.kills += Math.max(0, r.kills);
    p.deaths += Math.max(0, r.deaths);
    p.assists += Math.max(0, r.assists);
    p.headshots += Math.max(0, r.headshots);
    p.best = Math.max(p.best, Math.max(0, r.kills));
    p.played += Math.max(0, Math.round(r.played));
    p.at = r.at;
    this.profiles.set(r.account, p);
    this.log.push(r);
    if (this.log.length > LOG_KEPT) this.log.splice(0, this.log.length - LOG_KEPT);
    this.save();
    return { ...p };
  }

  /** The board `key` over `span`, best first, with `you` marked. */
  board(key: BoardKey, span: Span, you?: string): BoardRow[] {
    const profiles = span === 'all' ? [...this.profiles.values()] : this.since(Date.now() - SPAN_MS[span]);
    const rows = profiles
      .filter((p) => p.matches > 0)
      .sort((a, b) => rankBy(b, key) - rankBy(a, key) || b.xp - a.xp || a.name.localeCompare(b.name))
      .slice(0, BOARD_ROWS)
      .map((p, i): BoardRow => ({
        rank: i + 1,
        account: p.account,
        name: p.name,
        color: p.color,
        level: levelFor(p.xp),
        xp: p.xp,
        matches: p.matches,
        wins: p.wins,
        winRate: p.matches >= RANKED_MATCHES ? winRate(p) : 0,
        kills: p.kills,
        deaths: p.deaths,
        kd: p.matches >= RANKED_MATCHES ? kd(p) : 0,
        headshots: p.headshots,
        ...(you && p.account === you ? { you: true } : {}),
      }));
    return rows;
  }

  /** Profiles made up of only what the log holds since `from`: the week's and the month's boards. */
  private since(from: number): Profile[] {
    const by = new Map<string, Profile>();
    for (const r of this.log) {
      if (r.at < from) continue;
      const p = by.get(r.account) ?? emptyProfile(r.account, this.game, r.name, r.color);
      p.name = r.name || p.name;
      p.color = r.color || p.color;
      p.xp += r.xp;
      p.matches += 1;
      p.wins += r.result === 'win' ? 1 : 0;
      p.losses += r.result === 'loss' ? 1 : 0;
      p.draws += r.result === 'draw' ? 1 : 0;
      p.rounds += r.rounds;
      p.kills += r.kills;
      p.deaths += r.deaths;
      p.assists += r.assists;
      p.headshots += r.headshots;
      p.best = Math.max(p.best, r.kills);
      p.played += r.played;
      p.at = Math.max(p.at, r.at);
      by.set(r.account, p);
    }
    return [...by.values()];
  }

  private load() {
    const saved = this.doc.read();
    if (!saved || typeof saved !== 'object') return;
    for (const [account, raw] of Object.entries(saved.profiles ?? {})) this.profiles.set(account, checkProfile(raw, account, this.game));
    if (Array.isArray(saved.log)) {
      for (const raw of saved.log) {
        const r = raw as Partial<MatchRecord>;
        if (typeof r?.account !== 'string' || typeof r.at !== 'number') continue;
        this.log.push({
          at: r.at,
          account: r.account,
          name: typeof r.name === 'string' ? r.name : '',
          color: typeof r.color === 'string' ? r.color : '#4f86f7',
          xp: num(r.xp),
          kills: num(r.kills),
          deaths: num(r.deaths),
          assists: num(r.assists),
          headshots: num(r.headshots),
          rounds: num(r.rounds),
          played: num(r.played),
          result: r.result === 'win' || r.result === 'loss' ? r.result : 'draw',
        });
      }
    }
  }

  private save() {
    this.doc.write({ profiles: Object.fromEntries(this.profiles), log: this.log });
  }
}
