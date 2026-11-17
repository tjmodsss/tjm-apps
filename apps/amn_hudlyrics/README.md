# HUD

Synced lyrics for the song playing over CarPlay (Apple Music, Spotify...), one line at a time in the
head-up display, with a Now Playing page on the centre screen. iDrive 7 · package `amn_hudlyrics` · version 0.3.0.

## Centre screen

The song, its artist and album and a progress line on the left; the lyrics on the right, the line being sung
large and white, the line before and the line after dim. Along the bottom, four status pills say what each
part is doing, each with a coloured dot (green working, amber waiting, grey off, red a problem):

| Pill | Says |
|---|---|
| Song | Playing, Paused, or Nothing playing |
| Timing | From the car, or "Tap Song just started" for a source that sends no time |
| Lyrics | Synced (and how many lines), Searching, Not synced, Not on LRCLIB, Car offline |
| HUD · experimental | Off, Showing lyrics, Waiting - HUD in use, Hidden - route guidance, Needs Cluster renderer |

If the HUD stays dark, the pills say which part stopped.

## The HUD (experimental)

The app starts with the car (from 0.3.1) and runs in the background: once the HUD is on in Settings, the lyrics follow
the music without opening the app. After installing, restart the head unit once.

Off until you switch on **Settings > Lyrics in the HUD (experimental)**. Then, while a song with synced lyrics
plays, the line being sung shows in the HUD, inside its visible window and above the speed readout, drawn at
the HUD's own resolution (no stretching). One line: a new line fades in where the last one was. Two lines: the
next one dim below. Three lines: the line before dim above, the line sung white, the next dim below, and at each
new line all three slide up one place, as Apple Music scrolls its lyrics. It hides during route guidance (BMW navigation, CarPlay, Android Auto), when
paused for 30 s, and for a song without synced lyrics.

Only one app can draw in the HUD at a time: with HUD on, other HUD apps (bimmer-lab HUD Widgets, G's Dash
HUD, Redline's HUD) wait, and the other way round. Needs the **Cluster renderer** tool from the Store. If a
black box stays in the HUD after switching off or removing the app, restart the head unit (Store > Settings >
Restart head unit).

The text area comes from measurements on a 2020 X3. If it sits off-centre on your car, report it.

## Settings

| Setting | Choices | Default |
|---|---|---|
| Lyrics in the HUD (experimental) | on / off | off |
| HUD lines | One line; Two lines (next one dim); Three lines (before, now, after) | One line |
| HUD text size | Small (26 px), Medium (32 px), Large (38 px) | Medium |
| Show during navigation | on / off | off |
| Lyrics timing | 3 s earlier to 3 s later | 0 |

**Song just started** (bar button): for a source that sends no time, tap it as the song starts.

## What it uses

- **Car:** reads the track from BMW's MediaPlayer, CarPlayManager, HmiMediaState and DynamicMediaPlayer, and
  route guidance from NavigationStatus and the Android Auto manager. It subscribes and reads only; it never
  writes a value or calls a method.
- **Internet:** one host, `lrclib.net`, through the Store's uplink. `net/http.js` refuses any other host.
- **HUD:** the Store's Cluster renderer, through its own client on the head unit.
- **Log:** the track's title, artist and timing, the lyrics lookup's result and the HUD layer's state.
- **No** accounts, album art, analytics or crash-report uploads.

## Credits

Built from [arefahmad/idrive7-apps](https://github.com/arefahmad/idrive7-apps)' Car Lyrics (MIT): `car/nowplaying.js`,
`net/http.js` and the song clock. `stage/lyrics.js` and `hud/` (the HUD layer) are from nickgcode's G's Music
(MIT, `LICENSE`). Fonts: Inter (SIL Open Font License, `data/fonts/LICENSE-Inter.txt`). See the repository's NOTICE.

## Screens

Rendered on a computer from the app's own drawing code, with a made-up song and made-up lyrics; not photos of a car.

![Now Playing](../../docs/screenshots/amn_hudlyrics/screen-playing.png)

![Nothing playing](../../docs/screenshots/amn_hudlyrics/screen-empty.png)

The HUD, one line (default), two lines and three lines, over a mock windshield. Green: the HUD's visible window measured on a
2020 X3. Orange: where the text may go. Grey: BMW's speed readout.

![HUD, one line](../../docs/screenshots/amn_hudlyrics/hud-one-line-medium.png)

![HUD, two lines](../../docs/screenshots/amn_hudlyrics/hud-two-lines-medium.png)

![HUD, three lines](../../docs/screenshots/amn_hudlyrics/hud-three-lines-medium.png)

## Sport mode: the rev tach instead of the lyrics (0.5.0)

In **Sport, Sport+ and Sport Individual** the HUD shows a rev tach in place of the lyrics: Redline's **Ramp**
layout, after the G80/G82 M3 and M4's own head-up display. The rail climbs from the left and runs flat, the revs a
band under it; eight slanted lights over it count in to the shift point (yellow, then red) and all flash red there;
the gear big and squared with D / S / M beside it; oil under the gear and water on the right (blue while cold, red
when hot). In **Comfort, Eco Pro and Adaptive** the lyrics come back. Nothing else of Redline comes with it: no shift
learning, scoring or logs, and Redline need not be installed.

Readouts (0.6.0), each on or off in Settings: **oil**, **gearbox** (from the gearbox unit with read-only diagnostic
requests, as Redline reads it; else BasicDataSet) and **water** temperatures, and the **cold-engine rev limit**: while
the oil is under **Oil warm at** (80 °C), the shift point is pulled down (4,500 rpm at 30 °C, rising to your shift point
as the oil warms; **Lower the shift lights while the oil is cold**), the lights flash there, and LIMIT shows under the
gear. The centre screen's Sport HUD panel lists the values the car sends.

Settings: **Sport mode: rev tach on the HUD** (on by default), **Shift lights flash at** (6,200 rpm by default; the
lights count in over the 1,500 rpm before it) and **Redline** (6,500 rpm, where the limiter flash starts and the
scale ends a little after). **Test Sport HUD** on the main screen plays an 8-second rev sweep on the HUD, parked.

**Size and place** (0.6.1): Settings → *Sport HUD: size*, *left (-) / right (+)*, *up (-) / down (+)*, as Redline's
HUD place settings. The default (-40 px, +50 px) centres the tach on the part of the glass the driver sees and sets it
low, just above BMW's limit sign and speed; Redline's own 0 / 0 reads high and right. Each change shows the tach in its
new place for 10 seconds, in any drive mode.

The drawing is Redline's own (`hud/redline/`: hud-draw.js, hud-m.js and hud-theme.js from Redline 2.0.42,
cauliflowermossgrape/idrive7-apps, MIT; HUD by @biscotit), copied unchanged; `hud/sport.js` feeds it from the car.
If the Redline app itself is installed and holds the HUD, both the lyrics and this tach give way to it
(**Give the HUD to the Redline app while it shows**).
