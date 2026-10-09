// The gaming room on a floor: its lobby, its sides, its clock and its rounds. Everything here is the
// platform's and knows nothing about shooting; the game it's running (see server/games/) says what
// people carry, what a shot does and who won the round.
//
// Nobody is in a match by walking in. You join, you pick a side or the office picks one, you ready
// up, and an administrator (or the lobby filling up, where it's set to start by itself) starts it.
import { GAME_BY_ID, isTeam, type GameId, type Side, type TeamId } from '../../shared/games/games.js';
import { EMPTY_MATCH, FEED_KEPT, balance, cannotStart, canJoinSide, checkSettings, openSide, type FeedLine, type MatchPhase, type MatchSettings, type MatchState, type Player } from '../../shared/games/match.js';
import { XP, levelProgress } from '../../shared/games/stats.js';
import type { GamesClientMsg, ServerMsg, YouState } from '../../shared/protocol.js';
import type { Client } from '../office/client.js';
import { BUY_SECONDS, FpsRules } from '../games/fps.js';
import { rulesFor } from '../games/index.js';
import { NOT_PLAYING, newSeat, publishSeat, resetSeat } from '../games/seats.js';
import type { GameStats } from '../games/stats.js';
import type { GameRules, Room, Seat } from '../games/types.js';

/** How often the match's clock is looked at, and how often everyone's poses go out. */
const TICK_MS = 100;
const POSES_MS = 66;
/** The quickest anyone may ask for anything of the lobby's, in ms. */
export const LOBBY_EVERY = 250;

/** What a gaming room needs from the floor around it. */
export interface ArenaContext {
  /** The office's record of who has played what, for this game. */
  stats(game: GameId): GameStats;
  /** To everyone on the floor. */
  toFloor(msg: ServerMsg, droppable?: boolean): void;
  toClient(c: Client, msg: ServerMsg): void;
  toast(text: string, level?: 'info' | 'warn' | 'error'): void;
}

export class Arena {
  private phase: MatchPhase = 'idle';
  private settings: MatchSettings = EMPTY_MATCH.settings;
  private rules: GameRules = new FpsRules();
  private seats = new Map<string, Seat>();
  private score: Record<TeamId, number> = { a: 0, b: 0 };
  private round = 0;
  /** When the phase's clock runs out; 0 when nothing is counting. */
  private until = 0;
  /** What was left on the clock when an administrator paused it. */
  private paused = 0;
  private host = '';
  private hostId = '';
  private feed: FeedLine[] = [];
  private result?: { winner: Side; reason: string };
  /** The lobby is shut to anyone new. */
  private locked = false;
  private timer?: NodeJS.Timeout;
  private poseTimer?: NodeJS.Timeout;
  /** When the match began, and whether its result has gone into everyone's profile yet. */
  private startedAt = 0;
  private recorded = false;

  constructor(private ctx: ArenaContext) {}

  // ---- What everyone sees ---------------------------------------------------------------------

  state(): MatchState {
    return {
      phase: this.phase,
      settings: this.settings,
      players: [...this.seats.values()].map((s) => this.publish(s)),
      score: { ...this.score },
      round: this.round,
      until: this.until,
      host: this.host,
      feed: [...this.feed],
      ...(this.result ? { result: this.result } : {}),
    };
  }

  /** Whether the lobby is open to anyone new. */
  open(): boolean {
    return this.phase !== 'idle' && !this.locked;
  }

  private publish(s: Seat): Player {
    return publishSeat(s, this.rules, this.hostId);
  }

  private changed() {
    this.ctx.toFloor({ t: 'game', match: this.state() });
  }

  /** Someone's own side of the match: their health, what they carry, where they stand. */
  you(c: Client): YouState {
    const s = this.seats.get(c.id);
    return s ? this.rules.you(s, true) : NOT_PLAYING;
  }

  private sendYou(s: Seat) {
    this.ctx.toClient(s.client, { t: 'game.you', you: this.rules.you(s, true) });
  }

  // ---- Opening and closing a lobby ---------------------------------------------------------------

  /** Whether `c` may set the match up and run it: an administrator, or whoever opened the lobby. */
  runs(c: Client): boolean {
    return c.admin || (this.phase !== 'idle' && c.id === this.hostId);
  }

  /** Opens a lobby for `game` (an administrator). */
  openLobby(c: Client, game: GameId, raw: unknown): string | undefined {
    if (!c.admin) return 'Only an administrator can open a gaming room.';
    const def = GAME_BY_ID.get(game);
    if (!def) return "The office doesn't have that game.";
    if (this.phase !== 'idle' && this.phase !== 'over') return `A ${GAME_BY_ID.get(this.settings.game)?.name ?? 'match'} is already going on here.`;
    this.rules = rulesFor(game);
    this.settings = checkSettings({ ...raw ?? {}, game }, { ...EMPTY_MATCH.settings, game }, { weapons: this.rules.weapons, gear: this.rules.gear });
    this.phase = 'lobby';
    this.host = c.peer.name;
    this.hostId = c.id;
    this.locked = false;
    this.score = { a: 0, b: 0 };
    this.round = 0;
    this.until = 0;
    this.feed = [];
    this.result = undefined;
    this.recorded = false;
    this.seats.clear();
    this.changed();
    this.ctx.toast(`${def.emoji} ${c.peer.name} opened a ${def.name} lobby in the arena.`);
    return undefined;
  }

  /** Changes an open match's settings (the host or an administrator). */
  configure(c: Client, raw: unknown): string | undefined {
    if (!this.runs(c)) return 'Only the host or an administrator can change the match.';
    if (this.phase === 'idle') return 'There is no match to set up.';
    this.settings = checkSettings(raw, this.settings, { weapons: this.rules.weapons, gear: this.rules.gear });
    if (this.settings.autoTeams) this.applySides(balance([...this.seats.values()].map((s) => this.publish(s)), this.settings));
    this.changed();
    return undefined;
  }

  // ---- Joining and leaving ------------------------------------------------------------------------

  join(c: Client): string | undefined {
    if (this.phase === 'idle') return 'Nobody has opened a match here yet.';
    if (this.seats.has(c.id)) return undefined;
    if (this.locked) return 'This lobby is closed.';
    if (this.seats.size >= this.settings.maxPlayers) return 'The lobby is full.';
    const seat = newSeat(c, this.rules, this.ctx.stats(this.settings.game).level(c.accountId));
    this.seats.set(c.id, seat);
    const players = [...this.seats.values()].map((s) => this.publish(s));
    seat.team = this.settings.autoTeams ? openSide(players, this.settings) : 'none';
    this.changed();
    this.sendYou(seat);
    this.say(`${c.peer.name} joined the lobby.`);
    return undefined;
  }

  /** Someone left, by asking, by walking off the floor, or by closing their browser. */
  leave(c: Client, why = 'left') {
    const seat = this.seats.get(c.id);
    if (!seat) return;
    this.seats.delete(c.id);
    if (seat.alive) seat.alive = false;
    this.ctx.toClient(c, { t: 'game.you', you: NOT_PLAYING });
    this.say(`${c.peer.name} ${why} the match.`);
    // The host walking out hands the lobby to the next administrator in it, or the first one left.
    if (c.id === this.hostId) {
      const next = [...this.seats.values()].find((s) => s.admin) ?? [...this.seats.values()][0];
      this.hostId = next?.id ?? '';
      this.host = next?.client.peer.name ?? '';
    }
    if (this.live()) this.settle(false);
    this.changed();
  }

  ready(c: Client, ready: boolean) {
    const seat = this.seats.get(c.id);
    if (!seat || this.phase !== 'lobby') return;
    seat.ready = ready;
    this.changed();
    this.maybeAutoStart();
  }

  /** Moves someone to a side: yourself when the match lets you, anyone when you run it. */
  team(c: Client, team: Side, who?: string): string | undefined {
    const target = who && who !== c.id ? this.seats.get(who) : this.seats.get(c.id);
    if (!target) return 'They are not in this lobby.';
    if (who && who !== c.id && !this.runs(c)) return 'Only the host or an administrator can move other players.';
    if (!who && !this.settings.pickTeams && !this.runs(c)) return 'This match puts people on sides itself.';
    if (team !== 'none' && !isTeam(team)) return undefined;
    const players = [...this.seats.values()].map((s) => this.publish(s));
    if (!canJoinSide(players, this.settings, target.id, team)) return 'That side is full.';
    target.team = team;
    if (team === 'none') target.alive = false;
    this.changed();
    this.sendYou(target);
    return undefined;
  }

  kick(c: Client, who: string): string | undefined {
    if (!this.runs(c)) return 'Only the host or an administrator can remove players.';
    const seat = this.seats.get(who);
    if (!seat) return 'They are not in this lobby.';
    this.leave(seat.client, 'was removed from');
    return undefined;
  }

  /** The match controls, all of them the host's and the administrators'. */
  control(c: Client, act: Extract<GamesClientMsg, { t: 'game.control' }>['act']): string | undefined {
    if (!this.runs(c)) return 'Only the host or an administrator can do that.';
    switch (act) {
      case 'start':
        return this.start();
      case 'stop':
        this.finish('none', 'Stopped by the host');
        return undefined;
      case 'reset':
        this.reset();
        return undefined;
      case 'pause':
        if (!this.live()) return 'Nothing is running.';
        this.paused = Math.max(0, this.until - Date.now());
        this.phase = 'paused';
        this.changed();
        return undefined;
      case 'resume':
        if (this.phase !== 'paused') return 'The match is not paused.';
        this.until = Date.now() + this.paused;
        this.phase = this.round > 0 ? 'live' : 'countdown';
        this.changed();
        return undefined;
      case 'shuffle':
      case 'balance':
        this.applySides(balance([...this.seats.values()].map((s) => this.publish(s)), this.settings, act === 'shuffle'));
        this.changed();
        return undefined;
      case 'lock':
      case 'unlock':
        this.locked = act === 'lock';
        this.changed();
        return undefined;
      case 'close':
        this.shut();
        return undefined;
    }
  }

  private applySides(sides: Map<string, Side>) {
    for (const [id, team] of sides) {
      const s = this.seats.get(id);
      if (!s) continue;
      s.team = team;
      this.sendYou(s);
    }
  }

  /** Shuts the gaming room: everyone is out of the match and the lobby is gone. */
  shut() {
    for (const s of this.seats.values()) this.ctx.toClient(s.client, { t: 'game.you', you: NOT_PLAYING });
    this.seats.clear();
    this.stopClock();
    this.rules.clear();
    this.phase = 'idle';
    this.round = 0;
    this.until = 0;
    this.result = undefined;
    this.host = '';
    this.hostId = '';
    this.feed = [];
    this.changed();
  }

  /** Back to the lobby with the same people, the score wiped. */
  private reset() {
    this.stopClock();
    this.rules.clear();
    this.phase = 'lobby';
    this.score = { a: 0, b: 0 };
    this.round = 0;
    this.until = 0;
    this.result = undefined;
    this.recorded = false;
    this.feed = [];
    for (const s of this.seats.values()) {
      resetSeat(s, this.rules);
      this.sendYou(s);
    }
    this.changed();
  }

  // ---- The clock ---------------------------------------------------------------------------------

  private live(): boolean {
    return this.phase === 'live';
  }

  private maybeAutoStart() {
    if (!this.settings.autoStart || this.phase !== 'lobby') return;
    const players = [...this.seats.values()].map((s) => this.publish(s));
    const inIt = players.filter((p) => isTeam(p.team));
    if (cannotStart(players, this.settings) || !inIt.every((p) => p.ready)) return;
    this.start();
  }

  private start(): string | undefined {
    if (this.phase !== 'lobby') return 'The match has already started.';
    if (this.settings.autoTeams) this.applySides(balance([...this.seats.values()].map((s) => this.publish(s)), this.settings));
    const why = cannotStart([...this.seats.values()].map((s) => this.publish(s)), this.settings);
    if (why) return why;
    this.phase = 'countdown';
    this.until = Date.now() + this.settings.countdown * 1000;
    this.startedAt = Date.now();
    this.recorded = false;
    this.startClock();
    this.changed();
    return undefined;
  }

  private startClock() {
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.timer.unref?.();
    }
    if (!this.poseTimer) {
      this.poseTimer = setInterval(() => this.sendPoses(), POSES_MS);
      this.poseTimer.unref?.();
    }
  }

  private stopClock() {
    if (this.timer) clearInterval(this.timer);
    if (this.poseTimer) clearInterval(this.poseTimer);
    this.timer = undefined;
    this.poseTimer = undefined;
  }

  private tick() {
    const now = Date.now();
    if (this.phase === 'paused') return;
    if (this.phase === 'countdown' && now >= this.until) return this.beginRound(1);
    if (this.phase === 'between' && now >= this.until) return this.beginRound(this.round + 1);
    if (!this.live()) return;
    this.rules.tick(this.room);
    // Anyone whose time to come back is up, where the mode has them come back at all.
    const mode = GAME_BY_ID.get(this.settings.game)?.modes.find((m) => m.id === this.settings.mode);
    if (mode?.respawns) {
      for (const s of this.seats.values()) {
        if (s.alive || !isTeam(s.team) || !s.respawnAt || now < s.respawnAt) continue;
        this.rules.respawn(this.room, s, this.indexOf(s));
      }
    }
    this.settle(now >= this.until);
  }

  /** Whether the round is over, and what to do about it. */
  private settle(timeUp: boolean) {
    const done = this.rules.decide(this.room, timeUp);
    if (!done) return;
    this.endRound(done.winner, done.reason);
  }

  private beginRound(n: number) {
    this.round = n;
    this.phase = 'live';
    this.until = Date.now() + this.settings.roundSeconds * 1000;
    this.rules.clear();
    const bySide: Record<TeamId, number> = { a: 0, b: 0 };
    for (const s of this.seats.values()) {
      if (!isTeam(s.team)) {
        s.alive = false;
        continue;
      }
      this.rules.startRound(this.room, s, bySide[s.team]++);
    }
    this.ctx.toFloor({ t: 'game.event', event: { e: 'round', round: n, of: this.settings.rounds } });
    this.changed();
  }

  private endRound(winner: Side, reason: string) {
    if (winner !== 'none') this.score[winner]++;
    // Everyone who played the round gets something for it; the winners get more.
    for (const s of this.seats.values()) {
      if (!isTeam(s.team)) continue;
      const won = s.team === winner;
      s.xp += won ? XP.roundWin : XP.roundLoss;
      s.score += won ? 2 : 0;
      // The last one standing who takes the round is worth more.
      if (won && s.alive && [...this.seats.values()].filter((o) => o.team === s.team && o.alive).length === 1) s.xp += XP.clutch;
    }
    if (this.rules instanceof FpsRules) this.rules.moneyForRound(this.room, winner);
    this.ctx.toFloor({ t: 'game.event', event: { e: 'roundOver', winner, reason, score: { ...this.score } } });
    const need = Math.floor(this.settings.rounds / 2) + 1;
    if (this.score.a >= need || this.score.b >= need || this.round >= this.settings.rounds) {
      const champion: Side = this.score.a === this.score.b ? 'none' : this.score.a > this.score.b ? 'a' : 'b';
      return this.finish(champion, this.score.a === this.score.b ? 'Drawn' : `${need} round${need === 1 ? '' : 's'} taken`);
    }
    this.phase = 'between';
    this.until = Date.now() + this.settings.betweenRounds * 1000;
    for (const s of this.seats.values()) s.alive = false;
    this.changed();
  }

  /** The match is over: everyone's XP goes into their profile, once. */
  private finish(winner: Side, reason: string) {
    this.stopClock();
    this.rules.clear();
    this.phase = 'over';
    this.until = 0;
    this.result = { winner, reason };
    const played = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    const stats = this.ctx.stats(this.settings.game);
    for (const s of this.seats.values()) {
      s.alive = false;
      if (!isTeam(s.team)) continue;
      const result = winner === 'none' ? 'draw' : s.team === winner ? 'win' : 'loss';
      s.xp += result === 'win' ? XP.matchWin : result === 'draw' ? XP.matchDraw : XP.matchLoss;
      this.ctx.toClient(s.client, { t: 'game.event', event: { e: 'matchOver', winner, reason, xp: s.xp } });
      // Only an account keeps anything: on the shared password there's nowhere to keep it.
      if (!s.account || this.recorded) continue;
      const profile = stats.record({
        at: this.startedAt,
        account: s.account,
        name: s.client.peer.name,
        color: s.client.peer.color,
        xp: s.xp,
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        headshots: s.headshots,
        rounds: s.rounds,
        played,
        result,
      });
      s.level = levelProgress(profile.xp).level;
    }
    this.recorded = true;
    this.ctx.toFloor({ t: 'game.event', event: { e: 'matchOver', winner, reason, xp: 0 } });
    this.changed();
  }

  /** Whether the buy menu is open: the count-in, the gap between rounds, and the first stretch of one. */
  private buying(): boolean {
    if (this.phase === 'countdown' || this.phase === 'between') return true;
    if (!this.live()) return false;
    const began = this.until - this.settings.roundSeconds * 1000;
    return Date.now() <= began + BUY_SECONDS * 1000;
  }

  private indexOf(seat: Seat): number {
    let n = 0;
    for (const s of this.seats.values()) {
      if (s === seat) return n;
      if (s.team === seat.team) n++;
    }
    return n;
  }

  private sendPoses() {
    if (!this.live()) return;
    const poses = [...this.seats.values()].filter((s) => s.alive).map((s) => s.pose);
    if (poses.length) this.ctx.toFloor({ t: 'game.poses', at: Date.now(), poses }, true);
  }

  private say(text: string) {
    this.ctx.toFloor({ t: 'game.event', event: { e: 'say', text } });
  }

  // ---- The game's own messages -------------------------------------------------------------------

  /** A message the game itself handles (moving, firing, buying); true when it was one. */
  play(c: Client, msg: GamesClientMsg): boolean {
    const seat = this.seats.get(c.id);
    if (!seat) return false;
    // Nothing is fired outside a live round.
    if (msg.t !== 'game.pose' && msg.t !== 'game.buy' && !this.live()) return true;
    if (msg.t === 'game.buy' && !this.buying()) {
      this.ctx.toClient(c, { t: 'toast', text: 'The buy menu is only open at the start of a round.', level: 'warn' });
      return true;
    }
    return this.rules.handle(this.room, seat, msg);
  }

  // ---- What the game's rules talk back through ------------------------------------------------------

  /** What the game's rules talk back to the match through (see Room). */
  private readonly room: Room = this.makeRoom();

  private makeRoom(): Room {
    const arena = this;
    return {
      get settings() {
        return arena.settings;
      },
      get round() {
        return arena.round;
      },
      seats: () => [...arena.seats.values()].filter((s) => isTeam(s.team)),
      seat: (id) => arena.seats.get(id),
      now: () => Date.now(),
      toFloor: (event) => arena.ctx.toFloor({ t: 'game.event', event }, event.e !== 'kill'),
      toSeat: (seat, event) => arena.ctx.toClient(seat.client, { t: 'game.event', event }),
      shot: (seat, from, to, hit) => arena.ctx.toFloor({ t: 'game.shot', id: seat.id, weapon: seat.weapon, x: from.x, y: from.y, z: from.z, tx: to.x, ty: to.y, tz: to.z, hit }, true),
      eliminated: (who, by, withWhat, headshot) => arena.eliminated(who, by, withWhat, headshot),
      changed: (seat) => arena.sendYou(seat),
      lobbyChanged: () => arena.changed(),
      warn: (seat, text) => arena.ctx.toClient(seat.client, { t: 'toast', text, level: 'warn' }),
    };
  }

  /** Somebody went down: the office counts it, pays for it and puts it on the feed. */
  private eliminated(who: Seat, by: Seat | undefined, withWhat: string, headshot: boolean) {
    who.alive = false;
    who.health = 0;
    who.deaths++;
    const own = !!by && (by.id === who.id || by.team === who.team);
    if (by && by.id !== who.id && !own) {
      by.kills++;
      by.roundKills++;
      by.score += 2;
      by.xp += XP.kill + (headshot ? XP.headshot : 0) + (by.roundKills > 1 ? XP.multiKill : 0);
      if (headshot) by.headshots++;
      if (this.rules instanceof FpsRules) by.money = Math.min(14_000, by.money + this.rules.killMoney());
      this.sendYou(by);
      // Whoever softened them up in the last few seconds gets something too.
      if (this.rules instanceof FpsRules) {
        for (const helper of this.rules.assists(this.room, who, by)) {
          helper.assists++;
          helper.xp += XP.assist;
          helper.score++;
          this.sendYou(helper);
        }
      }
    } else if (by && own) {
      by.score = Math.max(0, by.score - 1);
    }
    const line: FeedLine = {
      at: Date.now(),
      by: by?.client.peer.name ?? who.client.peer.name,
      byTeam: by?.team ?? who.team,
      who: who.client.peer.name,
      whoTeam: who.team,
      with: withWhat,
      ...(headshot ? { headshot: true } : {}),
      ...(own || !by ? { own: true } : {}),
    };
    this.feed = [...this.feed, line].slice(-FEED_KEPT);
    this.ctx.toFloor({ t: 'game.event', event: { e: 'kill', line } });
    const mode = GAME_BY_ID.get(this.settings.game)?.modes.find((m) => m.id === this.settings.mode);
    who.respawnAt = mode?.respawns ? Date.now() + this.settings.respawnSeconds * 1000 : 0;
    this.sendYou(who);
    this.changed();
  }

  /** Stops everything: the office is closing, or the floor is. */
  close() {
    this.stopClock();
    this.rules.clear();
    this.seats.clear();
  }
}
