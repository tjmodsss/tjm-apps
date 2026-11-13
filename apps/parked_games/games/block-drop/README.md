# Block Drop

A falling-blocks puzzle for Parked Games, with our own pieces and rules. Played with the iDrive
knob or the touchscreen, so it works for the driver and the passengers.

## Rules

- **Shards** fall into a well 10 wide and 12 deep. A shard is 1 to 3 cells, and **every cell has
  its own colour**: Bar (3 in a line), Hook (3 in an L), Pair (2), and now and then a **Spark**.
- A **full row** clears.
- **4 or more cells of one colour** touching side by side **burst**, whatever row they are in.
- After a clear every loose cell falls straight down on its own. New rows or groups made by that
  fall clear too, as a **chain**: chain step 2 scores double, step 3 triple, and so on.
- A **Spark** (white) wipes every cell of the colour it lands on, all over the well.
- Every 36 cleared cells is a new level: shards fall faster, and from level 4 a fourth colour
  (green) joins, which makes bursts harder.
- The round ends when a new shard has no room at the top.

Scoring, times the level and the chain step: rows 100 / 300 / 600 / 1000 for 1 to 4 at once;
bursts 10 a cell plus 20 for each cell over 4; a Spark 15 a cell it wipes; a drop 2 a row it falls.

## Controls

| | Knob | Touch |
|---|---|---|
| Move | turn (one column a click), or push left / right | **Left** / **Right** buttons |
| Rotate | press | **Rotate** button |
| Swap colours (they move round the shard's cells) | push up | tap the well |
| Drop | push down | **Drop** button |

## Files

| | |
|---|---|
| `engine.js` | the rules alone, no drawing (seeded, testable with plain `node`) |
| `index.js` | the game module for the shell (`GAMES.md`): input, drawing |
| `test.js` | `node apps/parked_games/games/block-drop/test.js` |
| `dev/preview.html` | open it in a browser to play on a PC (the browser's canvas stands in for the car's) |
