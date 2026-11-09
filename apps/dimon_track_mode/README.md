# Track Mode

A lap timer for the head unit, drawn in the house style. Press **Lap** at the
start/finish line: the first press starts timing, each next press closes a lap and
opens the next. **Sector** splits the current lap without closing it.

## Why it is manual

The MGU does not expose a GPS position to apps over SOME/IP — the vehicle services
here report speed and acceleration, not latitude/longitude. So a lap is marked by a
press at the line rather than by crossing a GPS start/finish line. Speed
(`Vehicle2.statusCarSpeed2`, centre-of-gravity speed, BMW scaling) still drives the
max/avg speed per lap and, with *Start first lap on movement*, an automatic start.

## Pages

- **Live** — the current lap clock, the current sector and live speed, the sector
  splits of this lap against your best sector times, and Last / Best / Optimal.
- **Laps** — every lap with its sectors, delta to the best lap and top speed; the best
  lap is highlighted, and the theoretical best (the sum of your best sectors) is shown.

Best lap, best sectors and recent laps are saved in `data/track_laps.json` and restored
on the next start. **Reset** (two presses) clears them.

## Settings

Speed unit (km/h / mph), *Start first lap on movement*, colour theme, screen layout and
renderer, and demo data (Auto / Always / Never). With no car present the app shows a
synthetic car lapping a short circuit so the screen is alive; demo laps are never saved.

## Build and test

```sh
python3 kit/tools/build.py dimon_track_mode     # offline preview without the SDK
node kit/tools/emu.js dimon_track_mode          # live emulator (needs the SDK)
node kit/tools/test_track_mode.js               # the LapTimer logic
```
