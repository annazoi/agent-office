// The games the office can run a match of, by id. A second game is one more row here and its own
// rules module beside this one; nothing in the gaming platform names a game anywhere else.
import type { GameId } from '../../shared/games/games.js';
import { FpsRules } from './fps.js';
import type { GameRules } from './types.js';

const RULES: Record<GameId, () => GameRules> = { fps: () => new FpsRules() };

/** A fresh set of rules for `game`, for a lobby that's just been opened. */
export const rulesFor = (game: GameId): GameRules => RULES[game]();
