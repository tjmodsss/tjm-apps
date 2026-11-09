# Misfire Watch

Logs every misfire the engine counts, per cylinder, across every drive, with what the car was doing at
that moment.

Version 0.1.0 · iDrive 7 · package `aref_misfire` · [all apps and how to install](../../README.md)

> [!NOTE]
> Not tested on a car yet. It reads the same misfire counters as cauliflowermossgrape's M Vitals (OBD
> service 06 over the head unit's own diagnostic link).

## Who it's for

Owners of a tuned or high-mileage engine who want to catch a weak ignition coil or a worn spark plug
early.

The engine unit (DME) counts misfires per cylinder, but only for the current drive: the count starts again
at 0 on every engine start, and a scan tool or M Vitals shows the total so far, not when the misfires
happened. Misfire Watch reads the counters every few seconds while the engine runs and logs each new
misfire: which cylinder, how many, when, and the rpm, speed, gear, torque, coolant temperature and drive
mode at that moment. It keeps them across drives. A pattern shows up: always cylinder 3, always above
5,000 rpm in third gear. That points to the coil or plug on that cylinder.

## What it shows

- **Overview:** this drive's misfires, one column per cylinder, with each cylinder's all-time total and
  the DME's own average over the last 10 drives (which covers drives from before you installed the app).
  The last misfire and its conditions, and the cylinder with the most.
- **Misfire log:** every misfire, newest first, with its conditions.
- **Drives:** every drive with its total and the count per cylinder.
- **Warning:** a banner when a drive passes the warning count (Settings), and the home-screen widget
  turns red.
- **Export CSV:** writes `misfires.csv` to the app's data folder, for a spreadsheet.

A few misfires on a cold start or at idle are normal on most engines. A count that keeps growing on one
cylinder, or misfires under load, is worth a look.

Misfires counted before the app's first reading of a drive (the first ~20 seconds after the car starts)
are logged as **before the first reading**: their conditions are those of that first reading.

## Screens

Screens rendered on a PC from the app's own drawing code with made-up data (`tools/screens.js`), not photos of a car.

### Overview

![Overview](../../docs/screenshots/aref_misfire/overview.png)

This drive per cylinder, the all-time totals and the DME's 10-drive average.

### Misfire log

![Misfire log](../../docs/screenshots/aref_misfire/log.png)

Every misfire with the rpm, speed, gear, torque, coolant and drive mode at the time.

### Drives

![Drives](../../docs/screenshots/aref_misfire/drives.png)

Each drive's total and its count per cylinder.

### Home-screen widget

![Home-screen widget](../../docs/screenshots/aref_misfire/widget.png)

This drive's count, the cylinder with the most and the last misfire. The small size shows the same as two
lines of text.

## Settings

| Setting | Values | Default |
|---|---|---|
| Warn at misfires per drive | 1, 5, 10, 25, 50 | 10 |
| Read every | 2, 4, 8, 15 s | 4 s |
| Units | mph, F and lb-ft; km/h, C and Nm | mph, F and lb-ft |

## Safety

Read-only. It sends only OBD service 06 requests (on-board monitor results) to the engine unit, or the UDS
form `22 F6xx` on an engine that only answers that. It never clears a fault or a counter and never writes.

## Data

Kept in `misfires.json` and `misfires.csv` in the app's data folder: up to 2,000 misfires and 300 drives.
Removing the app removes them.

## Credits

`obd/dids.js` (the service 06 reader) is from cauliflowermossgrape's idrive7-apps (MIT, see `LICENSE`).
