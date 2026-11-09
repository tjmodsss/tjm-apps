# Drive Log

A record of every drive, kept by the head unit itself: distance, time moving, top speed, 0-60 mph, peak
rpm, peak g-forces and temperatures. With a Dragy, it learns its own error and shows a Dragy-adjusted 0-60.

Version 0.3.1 · iDrive 7 · package `aref_drivelog` · [all apps and how to install](../../README.md)

> [!NOTE]
> Not tested on a car yet. It uses the same driving signals as G's Dash and M Vitals (speed, rpm,
> g-forces, temperatures, gear).

## Who it's for

- **Owners of modified cars** who want to see what a change did, drive after drive, without mounting a
  phone or a datalogger. Drive Log starts with the car and records in the background.
- **Dragy owners** who don't want to mount the Dragy for every run. Calibrate Drive Log against it a few
  times, and every later run gets a time close to what the Dragy would have shown.
- **Anyone who wants a history:** how far, how long, how hot the oil got, how hard the car braked.

## What it records

Per drive: distance, time moving, top speed, best 0-60 mph and how many runs, peak rpm, the most
acceleration, braking and cornering g, and the highest oil and coolant temperatures.

A drive starts when the car first moves and ends after 30 seconds in P, 5 minutes standing still, or when
the car switches off. Moves shorter than 200 m (the driveway) aren't kept. Up to 300 drives are kept.

## Screens

Screens rendered on a PC from the app's own drawing code with made-up data (`tools/screens.js`), not photos of a car.

### This drive

![This drive](../../docs/screenshots/aref_drivelog/this-drive.png)

The drive going on, or the last one, with the Dragy-adjusted 0-60 under the car's own time.

### History

![History](../../docs/screenshots/aref_drivelog/history.png)

Every drive kept, newest first.

### 0-60 runs

![0-60 runs](../../docs/screenshots/aref_drivelog/runs.png)

Each run with its Dragy time, the difference, and the adjusted time. The offset is in the top right.

### Enter Dragy time

![Enter Dragy time](../../docs/screenshots/aref_drivelog/enter-dragy.png)

Setting the Dragy's time for a run with the bar buttons.

### Home-screen widget

![Home-screen widget](../../docs/screenshots/aref_drivelog/widget.png)

Add it to the iDrive home screen like BMW's own widgets: this drive or the last one: distance, top speed, time, and the 0-60 (Dragy-adjusted once calibrated). The small size shows the same as two lines of text.

## Views

- **This drive:** the drive going on, or the last one when parked, as ten tiles.
- **History:** every drive kept, newest first.
- **0-60 runs:** every timed run, with its Dragy time and the adjusted time once known.
- **Save CSV:** writes `drives.csv` to the app's data folder, one row per drive.

## 0-60 timing and Dragy calibration

Drive Log times 0-60 mph from the car's own wheel speed: from the moment the car leaves a standstill to
60 mph, interpolated between samples. Lifting off on the way cancels the run.

Wheel speed isn't GPS. It reads high when the tires are larger or more worn than the car expects, it counts
wheelspin as speed, and it is filtered. So its times run a little quick. A GPS meter such as a Dragy is the
reference.

**Compare with Dragy** (Settings, off by default) closes that gap:

1. Do a run with the Dragy mounted.
2. Tap **Enter Dragy time** and set the time the Dragy shows, in steps of 0.1 s and 0.01 s, then **Save**.
   **No Dragy time** skips a run.
3. After 3 runs timed both ways, every run shows a **Dragy-adjusted** time: the car's time plus the median
   of the Dragy-minus-car differences. The median ignores the odd bad pair (wheelspin, weak satellites).
   The 0-60 runs screen shows the offset and how far a single adjusted run typically lands from it.

The adjustment keeps working after you turn the setting off. Enter the Dragy's time the same way every run
(with or without its 1-ft rollout), and calibrate again after a change of tire size.

## Safety

Read-only. It only listens to the driving signals the car already sends to the head unit. It draws only on
the centre screen.

## Data

Kept in `drivelog.json` in the app's data folder (drives, the drive going on, the 0-60 runs). Removing the
app removes it.
