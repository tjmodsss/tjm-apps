# Parked Games: the game interface

Parked Games is one iDrive app (`apps/parked_games`) that holds every game. The shell owns
everything around a game: the parked check, the menu, the controller, pausing, and high scores.
A game only plays.

**Every game is played with the iDrive knob** (turn, press, and push up / down / left / right).
The touchscreen may add to that, but nothing may need it. The steering wheel and the pedals are
not inputs: the shell doesn't read them and a game must not ask for them.

## Where a game lives

```
apps/parked_games/games/<id>/index.js     the game (required)
apps/parked_games/games/<id>/*.js         any other modules it needs (require('./logic'))
```

The shell finds games at start by reading `games/*/index.js`, so adding a game needs no change to
`app.json` or to the shell. Each folder is copied into the package as it is.

Rules:

- **Node 8** runs this on the car: no `?.`, no `??`, no class fields, no object spread (`{...a}`);
  use `Object.assign`. Arrow functions, classes, `const`/`let`, template strings and `async` are fine.
- **No new signals.** The shell subscribes to every vehicle signal (the app has one `app.json`). If a
  game needs one more, ask the shell's owner to add it to `api`.
- **No `require` of the kit** from a game: everything comes through `api` and `cv`. Keep the game logic
  free of drawing, so it can be tested with plain `node`.
- **Original designs only.** Familiar genres are fine; no names, art, levels or rules of existing games.

## The module

```js
module.exports = {
    id: 'lane-runner',             // the folder's name
    title: 'Lane Runner',          // the menu tile's title (ASCII, up to ~16 characters)
    blurb: 'Dodge cones lane by lane',  // one line under it on the tile (up to ~28 characters)
    order: 10,                     // menu position, low first
    needs: [],                     // always [] (or left out): every game is knob (and touch) only
    score: { unit: 'm', lower: false },  // unit shown after scores; lower: true when less is better (times)
    create(api) { return new Game(api); },
};
```

`create(api)` is called for **every round**: a new round is a new object, so a game needs no reset.

## `api` (what the shell gives a game)

| | |
|---|---|
| `api.W`, `api.H` | 1600, 520: the canvas size, in logical pixels |
| `api.now()` | a steady clock in ms (never jumps) |
| `api.random()` | 0 ≤ x < 1 |
| `api.log.info/warn/error(...)` | the app's log |
| `api.theme()` | the kit's colour theme: `bg`, `text`, `dim`, `accent`, `warn`, `crit`, `cold`, `panel` ... |
| `api.best()` | the best score so far, or `null` |
| `api.top()` | the best scores, best first: `[{ score, at }]` (up to 5; `at` = ms since 1970) |
| `api.end(score)` | the round is over: the shell saves the score, shows the result and offers Play again. Call it once; after it `update` is not called any more (`draw` still is, under the result card) |
| `api.store.get(key)`, `api.store.set(key, value)` | this game's own saved values (JSON), kept across restarts |

### When the games play

- The whole app plays only while the car stands (≤ 3 km/h). This is always on; there is no setting for it.
  When the car moves the round pauses and the shell goes back to the menu.
- All input comes as events to `input(ev)` (below). Knob clicks are discrete: a game that wants a
  position (a paddle, a throttle) keeps its own and moves it per click; one that wants a held
  action can use `push` ... `release`.

## The game object

```js
class Game {
    update(dtMs) {}        // advance; dtMs since the last update, at most 50 (called only while playing)
    draw(cv) {}            // draw the whole 1600 x 520 frame; called every frame, also while paused / ended
    input(ev) {}           // one controller or touch event (below)
    pause() {}             // optional: the round stops for now (BACK, a call, driving off)
    resume() {}            // optional: it goes on
}
```

Input events:

| `ev` | |
|---|---|
| `{ type: 'knob', delta }` | the knob turned by `delta` clicks, + = clockwise |
| `{ type: 'press' }` | the knob pressed (a long press then pauses: the game gets no event for it) |
| `{ type: 'push', dir }` | the controller pushed `'N'`, `'E'`, `'S'` or `'W'` (sent once per push) |
| `{ type: 'release' }` | the push let go (back in the middle) |
| `{ type: 'touch', phase, x, y }` | a finger on the screen: `phase` `'down'`, `'move'`, `'up'`; x, y in canvas pixels |
| `{ type: 'tap', x, y }` | a short tap (also sent as touch down / up) |

The app is one screen. While a game runs, the header's tabs are GAMES (back to the menu, the round
paused) and the game's own name (tapped on the touchscreen; the app has no settings). The game holds the iDrive
controller the whole time: every turn, press and push is the game's, the knob never moves onto the
header's tabs. A **long press** of the knob is the shell's: it pauses the round, and the pause card
offers *Go on* or *Games menu* (turn the knob to one, press; or tap). The first 0.6 s after a game
opens, the controller is ignored (the press that opened it is not the game's). BACK, MENU and
OPTION always stay with the car's HMI: BACK leaves the app, the round pauses and goes on when the
app is opened again.

## Drawing (`cv`)

`cv` is the kit's GPU recorder at 1600 x 520 logical pixels, already cleared to the theme's
background. Colours are `'#rrggbb'` strings or `[r, g, b, a]` arrays (a = 0..255).

| | |
|---|---|
| `cv.fillRect(x, y, w, h, c)` | |
| `cv.roundRect(x, y, w, h, r, c)`, `cv.strokeRoundRect(x, y, w, h, r, width, c)` | |
| `cv.gradientRect(x, y, w, h, stops)` | `stops` = `[[0, c0], [1, c1]]`, top to bottom |
| `cv.circle(cx, cy, r, c)` | |
| `cv.arc(cx, cy, r0, r1, a0, a1, c)` | a ring segment, angles in degrees |
| `cv.line(xa, ya, xb, yb, width, c)`, `cv.polyline(pts, width, c)` | `pts` = `[[x, y], ...]` |
| `cv.quad(pts, c)` | a filled four-corner shape, `pts` = `[[x, y] x 4]` (a triangle: repeat a corner) |
| `cv.text(str, x, baselineY, size, c, { font, align })` | `font`: `label`, `bold`, `num`, `light`; `align`: `left`, `center`, `right`. Returns its width |
| `cv.textWidth(str, size, opts)` | |
| `cv.alpha(a)` ... `cv.alpha(1)` | draw see-through |
| `cv.clip(x, y, w, h)` ... `cv.noclip()` | |

**Where to draw.** On the car's full-screen layout the HMI's status strip covers roughly the top
40 pixels of the page and the sides are cropped by about 12 pixels; the screen can have spare room
below 520. Keep scores and anything important between y = 44 and y = 512 and x = 16 to 1584.

Large text sizes only have digits and a few letters baked in; keep big numbers numeric and words
at size 40 or below. There are no pixel reads.

## Trying a game

```sh
python3 kit/tools/build.py --preview-only parked_games
node kit/tools/emu.js parked_games          # http://localhost:8077
```

No BMW SDK is needed for this: without `oap-sdk/` the emulator builds an offline preview.

In the emulator: the menu's tiles are tapped (or turn the knob and press), the GAMES tab goes back to the menu, the mouse wheel or `[` `]`
turns the knob, `Enter` presses, arrow keys push, `Backspace` is BACK. Under *Vehicle signals*,
*Manual* feeds the car: set the speed above 3 km/h to see the games pause (the Steering, Pedal and
Parking brake sliders are the kit's, and Parked Games ignores them). A save under
`apps/parked_games/` rebuilds and restarts the app.

Unit tests: put them next to the game as `games/<id>/test.js` (plain `node`, `assert`; files named
`test*.js` are not packed for the car), run with `node apps/parked_games/games/<id>/test.js`. `node kit/tools/test_parked_games.js` checks every game
against this interface.
