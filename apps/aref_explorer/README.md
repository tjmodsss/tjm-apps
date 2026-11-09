# Car Explorer

Finds the head unit's services behind a car feature and shows what each one offers. A tool for building
apps: every new feature starts with knowing which service the car exposes for it.

Version 0.2.1 · iDrive 7 · package `aref_explorer` · [all apps and how to install](../../README.md)

## Who it's for

- **Anyone who wants a feature nobody has built yet** (ambient light scenes, the navigation ETA, the
  car's GPS position). Install it, save the report, and share it: it shows whether the car exposes that
  feature to apps at all, and under which name.
- **App developers** looking for an interface without reading a 10 MB JSON file over SSH.

## What it does

The head unit keeps a catalog of every SOME/IP interface an app can be given
(`/etc/oap/someip/someip-interfaces.json`): each with its fields (values to read or subscribe to), methods
(requests) and broadcasts (events). Car Explorer searches it by topic and lists the interfaces whose names
or members match, best first:

| Topic | Looks for |
|---|---|
| Ambient light | interior and ambient lighting, colours, brightness, light profiles |
| Route guidance and ETA | arrival time, remaining time and distance, destination, maneuvers |
| GPS position | latitude, longitude, heading, altitude, GPS speed (velocity, speed over ground) |
| Media now playing | title, artist, album, playing time |
| Climate | temperatures, fan, seat heating and ventilation |
| Exterior lights | welcome lights, daytime running lights, headlights |
| Doors, locks, windows | doors, locks, windows, tailgate, mirrors, sunroof |
| Fuel, range, odometer | tank, range, mileage, consumption |

**Next topic** steps through them; **More** pages through a long list. **Details** opens the first
match and lists every member it has (fields, methods, broadcasts) with what the catalog says about each:
whether a field can be read, written or subscribed to, its type, a method's arguments. Tap it again for
the next match; after the last, it goes back to the list. Members that match the topic are highlighted.

## Screens

Screens rendered on a PC from the app's own drawing code with a made-up catalog (`tools/screens.js`), not
photos of a car.

![Ambient light](../../docs/screenshots/aref_explorer/ambient.png)

![Details](../../docs/screenshots/aref_explorer/details.png)

## The report

`explorer-report.txt` in the app's data folder is written at every start and with **Save report**: every
topic's matches, the members that matched, and the first definitions in full. Attach it to an issue on
this repository to ask for an app for a feature.

## Safety

Read-only. It reads two files the platform keeps (the interface catalog and oap-mainapp's interface
folder). It subscribes to nothing, calls nothing and sends nothing to the car.
