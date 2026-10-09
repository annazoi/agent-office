# Gaming rooms

Back to the [README](../README.md).

Every floor has an arena off the lounge: a room the office plays games in, with a lobby you watch
from. Nobody is in a game by walking in. You join it, you pick a side (or the office picks one), you
ready up, and an administrator starts the match. Everyone who would rather keep working carries on
exactly as before: a match happens in a room of its own, and nothing about it reaches the floor.

The first game is **Breach**, a round-based tactical shooter. The gaming platform underneath it —
the lobby, the sides, the clock, the rounds, the stats and the leaderboards — knows nothing about
shooting, so a second game is a rules module and a row in a table (see [Adding a
game](#adding-a-game)).

## Walking in

The shutter is on the lounge's east wall, between the **🌐 Services** board and the TV, with
**🎯 BREACH ARENA** lit over it. Press **E** at it and you're in the arena's lobby: a room behind
glass, looking onto the pitch. The board on its back wall opens the match window (**E** there, or
**Tab** anywhere in the arena), and the green door beside it takes you back to the office.

The hint bar at the shutter says what's going on inside before you commit — *no match yet*,
*lobby open · 3 in*, *round 4 · 6 playing* — so you can glance in and walk on.

## The match window

One window does the whole job, and it redraws itself as the match moves:

- **Before a match** it's the lobby: both sides with their rosters, how many places are left, who has
  readied up, and **🎮 Join the game**, **☐ Ready up** and **🚪 Leave the game**.
- **While one runs** it's the scoreboard: the round, the score, and every player's kills, deaths and
  assists. **Tab** brings it up and takes it away again, and it gets out of your way by itself when
  a round goes live.
- **🏆 Leaderboard** is the other tab (see [XP and the leaderboards](#xp-and-the-leaderboards)).

## Playing

A round starts you at your side's spot with whatever you bought last round, reloaded. The office's
own walking, looking and jumping are unchanged — the match adds the gun on top of them, and leaving
it (or the arena) hands them straight back with no extra click.

| Control | What it does |
| --- | --- |
| Left mouse | Fire (hold it down on an automatic) |
| Right mouse | Up to the sights; the wheel steps a scope's zoom |
| R | Reload |
| 1–5 / Q | Take out a gun you're carrying / the next one |
| B | The buy menu (open for the first 18 seconds of a round) |
| F / G | Pick what you throw / throw it |
| C or Ctrl | Crouch (hold) |
| Tab | The scoreboard |
| Esc | Frees the mouse, as everywhere else |

The crosshair opens up as you move and closes as you crouch, and it shows exactly how wide the gun
is shooting right now. A hit flicks it red.

### Weapons

Nine of them, in the buy menu by kind: a knife and the P-9 sidearm you always carry, the Magnum, the
Vector SMG, the AR-15 and the Bullpup, the Breacher shotgun, the Longshot sniper rifle and the Mule
LMG. Each has its own damage, rate of fire, magazine, reload, recoil, spread, range, price, and what
it is aimed with — iron sights, a red dot, or a scope with two zooms. Headshots multiply, legs take
less, and damage falls off past the gun's range. Armour takes about half off what hits your body.

The whole table is `src/shared/games/fps/weapons.ts`, and an administrator can cut the list down to
whichever of them a match allows.

### Equipment

Three throwables, each with its own fuse, radius and effect: **💨 Smoke** stands a cloud nobody sees
through (and nobody shoots through) for twenty seconds, **✨ Flashbang** blinds whoever was looking at
it for as long as they were looking, and **💥 Frag** hurts anyone near it. Every throw flies the same
arc on every screen, because the office flies it itself and everyone's page draws that same arc.

## Running a match

Opening a lobby takes an administrator; once it's open, whoever opened it is its host and can run it
as an administrator can. Everyone else joins, and (where the match allows it) picks a side.

Administrators set the game mode and the arena, how many a side and the most players, how many have
to be in before it starts, the number of rounds and how long each one runs, the count-in, the gap
between rounds, how long a respawn takes, friendly fire, whether the office picks the sides and
whether players may move themselves, whether it starts by itself once everyone is ready, whether
there's a buy menu, and which weapons and equipment it allows.

The controls are **▶️ Start**, **⏸️ Pause** and **▶️ Resume**, **⏹️ End the match**, **↺ Reset**,
**🔀 Shuffle sides**, **⚖️ Even the sides**, **🔒 Close the lobby** / **🔓 Open it**, and
**🧹 Shut the gaming room**. Each player's row has arrows to move them between sides and an **✕** to
take them out.

Every one of those is checked again by the office. Nothing in this window is what decides anything:
a browser that sent the messages by hand would get the same answers.

### Modes

- **Elimination** — one life a round. Wipe the other side, or hold out the clock with more people
  standing.
- **Team deathmatch** — you come back a few seconds after you go down, and the round goes to whoever
  led when the clock ran out.

A match is won by taking more than half the rounds, or by leading when the last one is played. A side
that empties out hands the match to the other one.

## XP and the leaderboards

Eliminations, headshots, assists, rounds and matches all pay XP, and XP makes levels (they cost more
as you climb, up to level 60). It's kept per account, so a shared office password plays but keeps
nothing.

The 🏆 tab ranks everyone by XP, level, wins, win rate, kills or K/D, over this week, this month or
all time. Win rate and K/D need three matches played before they count. Everything on it is worked
out by the office from what it saw happen, so there is nothing for a page to inflate.

## Fair play

The office decides every outcome and keeps the state behind all of them:

- It holds where everyone is, and throws away a pose that covers more ground than a person can.
- A browser that fires sends **where it was aiming**, not what it hit. The office shoots the ray
  itself, through the same arena boxes the page drew, and works out the damage from the same weapon
  table.
- Rate of fire, magazines, reloads, grenade cooldowns, prices and the buy window are all its own.
- Smoke blocks its rays as it blocks your view, and a flash only blinds someone who could see it.
- Who may open a lobby, change its settings, start, pause, end or reset it, move people between sides
  or remove them is checked on the server, not by what the window shows.
- Lobby messages are rate limited, and a match's XP goes into the players' profiles once.

## Adding a game

The gaming platform is `src/shared/games/` (the game table, a match's settings, sides, lifecycle and
stats) and `src/server/floor/arena.ts` (the lobby, the clock and the rounds). None of it names a
game. A game is:

1. A row in `GAMES` in `src/shared/games/games.ts`: its name, its two sides, its modes and its arenas.
2. Its own numbers in `src/shared/games/<game>/`, shared by the page and the office.
3. A `GameRules` in `src/server/games/<game>.ts` (see `src/server/games/types.ts` for the seam: what
   people carry into a round, what their messages do, who has won, and what only they see), and its
   line in `RULES` in `src/server/games/index.ts`.
4. A feature folder on the page, `src/client/features/<game>/`, for its arena, its controls and its
   HUD.

The lobby, the sides, the match controls, the stats and the leaderboards come as they are.
