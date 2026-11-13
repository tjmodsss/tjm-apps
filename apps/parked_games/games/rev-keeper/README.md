# Rev Keeper

A Parked Games game: keep the needle inside a green zone that keeps moving, on a throttle you work
with the iDrive knob. Original design.

- **Throttle:** each knob click clockwise opens it by 4 %, anticlockwise closes it; pushing the
  controller up or down moves it 20 % at once (handy for the jumps). It stays where you leave it.
- **Needle:** follows the throttle with engine-like inertia. It climbs fast and falls back slower, so
  you have to lift early.
- **Zone:** moves in phases: drift, hold, jump, sweep, breathe (gets narrower and wider). A jump is
  announced by a blinking outline at the new spot about a second before it moves.
- **Score:** points while inside. Staying in builds a multiplier, up to x8 (+1 every 2 s). The
  middle third of the zone (between the white marks) scores half again.
- **Engine strain:** rises while you're outside the zone. It rises faster when over-revving than
  when bogging down, and faster the further off you are. It cools while you're inside. At 100 % the
  engine blows and the round ends.
- **Levels:** every 12 s the zone gets narrower (11 % of the scale down to 5 %) and moves faster.

The engine and rpm are only a picture: the game reads and sends nothing to the car.

| File | |
|---|---|
| `index.js` | the module the shell loads (`GAMES.md`) |
| `logic.js` | the rules, no drawing |
| `look.js` | the picture in the shell's look; `draw.js` a plain fallback |
| `test.js` | `node apps/parked_games/games/rev-keeper/test.js`: scripted players for balance, plus interface checks |

Balance, from the tests: a player who anticipates perfectly survives indefinitely, and only the
jumps cost them strain. A player who follows the zone 0.25 s late lasts about 80 s on average.
Doing nothing blows the engine in about 3 s.
