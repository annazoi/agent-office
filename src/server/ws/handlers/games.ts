// The gaming room on every floor: its lobby, its match, and the game being played in it. The floor's
// Arena (server/floor/arena.ts) owns all of it; this file only hands it what a browser asked for,
// having first checked who is allowed to ask.
import { isGameId, isTeam } from '../../../shared/games/games.js';
import { isBoard, isSpan } from '../../../shared/games/stats.js';
import type { GamesClientMsg } from '../../../shared/protocol.js';
import { LOBBY_EVERY } from '../../floor/arena.js';
import { throttle, type Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

/** The gaming room `c` is in: their floor's, or the building's own while they're on none (the roof has none). */
const arenaOf = (ctx: Ctx, c: Client) => ctx.floorOf(c)?.arena ?? (c.peer.floor ? undefined : ctx.lobbyArena);

/** The match on the floor someone walks onto, or the building's own when they're on none. */
export const gameView: ViewPieces['game'] = (ctx, floor) => (floor ? floor.arena.state() : ctx.lobbyArena.state());

/** Anything to do with the lobby: the floor's arena, and a limit on how often anyone can ask. */
function lobby(ctx: Ctx, c: Client) {
  const arena = arenaOf(ctx, c);
  if (!arena || !throttle(c, 'game.lobby', LOBBY_EVERY)) return undefined;
  return arena;
}

export const gamesHandlers = {
  'game.open'(ctx, c, msg) {
    const arena = lobby(ctx, c);
    if (!arena) return;
    if (!isGameId(msg.game)) return ctx.warn(c, "The office doesn't have that game.");
    ctx.warn(c, arena.openLobby(c, msg.game, msg.settings));
  },
  'game.config'(ctx, c, msg) {
    const arena = lobby(ctx, c);
    if (arena) ctx.warn(c, arena.configure(c, msg.settings));
  },
  'game.join'(ctx, c) {
    const arena = lobby(ctx, c);
    if (arena) ctx.warn(c, arena.join(c));
  },
  'game.leave'(ctx, c) {
    arenaOf(ctx, c)?.leave(c);
  },
  'game.ready'(ctx, c, msg) {
    const arena = lobby(ctx, c);
    arena?.ready(c, msg.ready === true);
  },
  'game.team'(ctx, c, msg) {
    const arena = lobby(ctx, c);
    if (!arena) return;
    const team = isTeam(msg.team) ? msg.team : 'none';
    ctx.warn(c, arena.team(c, team, msg.who === undefined ? undefined : str(msg.who, 64)));
  },
  'game.control'(ctx, c, msg) {
    const arena = lobby(ctx, c);
    if (arena) ctx.warn(c, arena.control(c, msg.act));
  },
  'game.kick'(ctx, c, msg) {
    const arena = lobby(ctx, c);
    if (arena) ctx.warn(c, arena.kick(c, str(msg.who, 64)));
  },
  // What someone does in a match: the arena checks they're in one, and the game's rules do the rest.
  'game.pose': play,
  'game.fire': play,
  'game.reload': play,
  'game.weapon': play,
  'game.throw': play,
  'game.buy': play,
  'game.profile'(ctx, c, msg) {
    if (!isGameId(msg.game) || !throttle(c, 'game.profile', 500)) return;
    const stats = ctx.games(msg.game);
    // Anyone's profile can be looked at; only accounts have one.
    const account = msg.account === undefined ? c.accountId : str(msg.account, 64);
    if (!account) return ctx.warn(c, 'Stats are kept per account: sign in with one to build a profile.');
    const who = ctx.accounts.get(account);
    ctx.sendTo(c, { t: 'game.profile', profile: stats.profile(account, who?.name), rank: stats.rank(account) });
  },
  'game.board'(ctx, c, msg) {
    if (!isGameId(msg.game) || !throttle(c, 'game.board', 500)) return;
    const key = isBoard(msg.key) ? msg.key : 'xp';
    const span = isSpan(msg.span) ? msg.span : 'all';
    ctx.sendTo(c, { t: 'game.board', key, span, rows: ctx.games(msg.game).board(key, span, c.accountId) });
  },
} satisfies HandlerMap<GamesClientMsg>;

/** Something done inside a match, passed to the floor's arena. */
function play(ctx: Ctx, c: Client, msg: GamesClientMsg) {
  arenaOf(ctx, c)?.play(c, msg);
}

export const gamesHooks: FeatureHooks = {
  // The match is the floor's: leaving the floor leaves the match.
  leaving: (ctx, c, was) => void (was?.arena ?? ctx.lobbyArena).leave(c, 'left'),
  closed: (ctx, c) => ctx.lobbyArena.leave(c, 'left'),
  closedOn: (ctx, c, floor) => floor.arena.leave(c, 'left'),
};
