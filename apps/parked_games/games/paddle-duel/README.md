# Paddle Duel

A ball-and-paddle duel for the parked car, part of Parked Games
(interface: [`../../GAMES.md`](../../GAMES.md)). Original design.

## Who plays

You play your paddle with the **iDrive knob** (each click moves it, pushing the controller up or
down slides it) or with a **finger** on your half of the screen. The car plays the other side.

**Two players** (driver and passenger): a second player takes the car's paddle by touching the
other half of the screen. Then one plays on the knob and the other on the touchscreen, and your
half stops answering touch so nobody moves the other's paddle.

The knob's paddle is on the left. Push the controller right (or left) before the first serve to
move it to that side; it is remembered. So either seat can take the knob, and the other the screen.

## Rules

- First to 7 points. The score saved to the high-score table is the match's **longest rally**.
- Where the ball meets the paddle sets the angle it leaves at: the edge sends it steep.
- A paddle that is moving at the hit puts **spin** on the ball, and the ball curves in flight.
- Every hit is a little faster; every 6th hit of a rally is a **hot shot** (red, much faster).
- After the first point a **bumper** drifts up and down the centre line and knocks the ball off course.
- The car's own player aims worse the faster the ball goes, so long rallies end.

## Files

- `game.js`: the rules and the drawing (no shell, no kit), testable with plain node
- `index.js`: the plug-in: maps the shell's inputs onto the paddles
- `test.js`: `node apps/parked_games/games/paddle-duel/test.js`
