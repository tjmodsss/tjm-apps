# Car Care

Your own service intervals, tracked by the car's odometer and kept separate from BMW's Condition Based
Service (CBS) reminders.

Version 0.2.1 · iDrive 7 · package `aref_carcare` · [all apps and how to install](../../README.md)

> [!NOTE]
> Not tested on a car yet. The odometer comes from the same instrument-cluster signal that
> cauliflowermossgrape's Live Data reads (`KombiIF.statusRangeTankStatus.mileageKilometre`).

## Who it's for

Owners who service their car more often than BMW's schedule asks, and don't want to lose what BMW
provides.

The common case: you change your own oil every 3,000 miles, but your car is also on a BMW maintenance plan
(BMW Ultimate Care, or a dealer's prepaid plan) that pays for an oil service only when CBS says it's due.
Resetting CBS after your own change would push that free service further out, or lose it. So CBS stays as
it is, and you need a second counter for your own interval. Car Care is that counter, on the car's own
screen, reading the car's own odometer.

It's also for anyone who tracks maintenance BMW's CBS doesn't show at all: spark plugs on a tuned engine,
ignition coils, differential and transfer case fluid, transmission fluid.

## What it does

- **Items:** engine oil, spark plugs, ignition coils, differential fluid, transfer case fluid,
  transmission fluid, brake fluid, engine air filter, cabin filter.
- **Intervals you set:** each item has its own interval in Settings, in miles or in months. Engine oil is
  due at 3,000 miles or 12 months by default, whichever comes first.
- **Done today:** records the current odometer reading and today's date for the selected item. Press it
  twice to confirm.
- **Done earlier:** records a service from before you installed the app, in miles and months ago.
- **At a glance:** each item shows a bar of the interval used and what is left, in amber when due soon
  (from 90 %) and red when overdue.

## Screens

Screens rendered on a PC from the app's own drawing code with made-up data (`tools/screens.js`), not photos of a car.

### Items

![Items](../../docs/screenshots/aref_carcare/items.png)

Each item, the interval used, and what is left. Due soon in amber, overdue in red.

### Done earlier

![Done earlier](../../docs/screenshots/aref_carcare/done-earlier.png)

Recording a service from before the app: miles and months ago.

### Home-screen widget

![Home-screen widget](../../docs/screenshots/aref_carcare/widget.png)

Add it to the iDrive home screen like BMW's own widgets: the item closest to due, with what is left and a bar. The small size shows the same as two lines of text.

## What it doesn't do

- It never resets, changes or reads BMW's CBS items. Your dealer's reminders stay exactly as they are.
- It doesn't send anything to the car: the only data it uses is the odometer the instrument cluster
  already sends to the head unit.

## Settings

| Setting | Values | Default |
|---|---|---|
| Units | Miles, Kilometres | Miles |
| Engine oil every | 2,000 to 10,000 mi | 3,000 mi |
| Spark plugs every | 15,000 to 60,000 mi | 30,000 mi |
| Ignition coils every | 30,000 to 100,000 mi | 60,000 mi |
| Diff fluid every | 20,000 to 60,000 mi | 50,000 mi |
| Transfer case fluid every | 20,000 to 60,000 mi | 50,000 mi |
| Transmission fluid every | 30,000 to 80,000 mi | 60,000 mi |
| Brake fluid every | 12, 24, 36 months | 24 months |
| Air filter every | 15,000 to 45,000 mi | 30,000 mi |
| Cabin filter every | 6, 12, 24 months | 12 months |

The defaults are starting points, not recommendations. Use the intervals your tuner, your oil and your
driving call for.

## Data

Kept in `carcare.json` in the app's data folder: each item's last odometer reading and date, and the last
odometer reading seen. Removing the app removes it.
