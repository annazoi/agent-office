import { EMPTY_MATCH, type MatchState } from '../../../shared/games/match';
import type { YouState } from '../../../shared/protocol';
import type { Slice } from '../store';

/** Not in a match: what the page starts with, and what it goes back to when you leave one. */
const NOT_PLAYING: YouState = { in: false, team: 'none', alive: false, health: 0, armour: false, weapons: [], weapon: '', ammo: {}, gear: {}, money: 0, respawnAt: 0 };

declare module '../store' {
  interface Store {
    /** The match in the gaming room on your floor, as the office has it. */
    game: MatchState;
    /** Your own side of it: your health, what you carry, and when you come back. */
    gameYou: YouState;
  }
  interface Topics {
    game: true;
    gameYou: true;
  }
}

export const games: Slice = {
  init(s) {
    s.game = EMPTY_MATCH;
    s.gameYou = NOT_PLAYING;
  },
  on: {
    game(s, m) {
      s.game = m.match;
      return ['game'];
    },
    'game.you'(s, m) {
      s.gameYou = m.you;
      return ['gameYou'];
    },
  },
  enter(s, v) {
    // A floor's match is its own: walking onto another one leaves the last one behind.
    s.game = v.game ?? EMPTY_MATCH;
    s.gameYou = NOT_PLAYING;
    return ['game', 'gameYou'];
  },
};
