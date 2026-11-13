# Cluster Layouts

*Part of [iDrive 7 cluster apps](../../README.md), with Cluster Info and [Cluster Centre](../cluster_centre/README.md).*

Custom layouts for the whole instrument cluster of a BMW with iDrive 7 (MGU), **drawn by the cluster
itself**. Eight original layouts (Analog sport, Digital round, Modern wide, Digital dash, Freedom, Retro, Track and
Pulse), Classic M, and GT3, M and Sport (after bimmer-lab's), each in comfort, sport and efficient colours (following the selector's S / M
programme, or chosen), each with three centres: the **readings**, **Waze** or the **stock** centre content.

With the car's own bottom strip (the default) the strip shows the gear, the drive mode, the ranges, the time and the
outside temperature, so no layout shows them a second time (M, Sport and Classic M never show the time, the outside
temperature or the fuel range at all): the places the time and temperature had show the
battery's temperature (intake air on a petrol or diesel car) and the gearbox oil's, and where a layout had its gear
it now has the digital speed or another reading. With **Waze** in the centre, Waze on cluster (0.9.107 or later,
[eroobeeroo/idrive-apps](https://github.com/eroobeeroo/idrive-apps)) draws the map in the layout's own panel,
above it, filling the window exactly; under the layout the cluster drew its own map screen (its speed, edge shading)
over the map. Needs **Central display area: Map view** on the car.

Every reading goes to the cluster within a frame of arriving: the needles and bars at 60 updates a second, the
digits and the road's motion every frame, and the battery's power the moment eDrive Live reads it (it writes each
reading at once and this app watches for it, instead of a quarter-second file cycle and a half-second scan). The
battery's own pace sets the limit: its current answers 10-20 times a second over diagnostics.

### Analog sport

Deep analog dials with satin metal bezels and warm backlit markings, coolant and oil dials set into them, and a
slim display between them with the digital speed, large, and the battery's power. On a plug-in hybrid in an
electric mode the rev counter reads the battery's power (Digital round and Retro likewise): 0 a quarter of the way
round, the power drawn above it and regeneration below it in green, each to the battery's own limit as eDrive Live
reads it (100 and 35 kW without eDrive Live); in the hybrid, sport and battery control modes it is the rev counter
with a small power gauge inside, on the same scale (its 0 a quarter along the arc). Every power gauge in every layout
works this way.

![Analog sport](../../docs/analog_sport.png)

| Sport colours (S on the selector) | Map in the centre |
|---|---|
| ![](../../docs/analog_sport_sport.png) | ![](../../docs/analog_sport_map.png) |

### Digital round

Round dials drawn as a display, a lit arc running to each needle, the fuel range in the speedometer and the
electric range and charge in the rev counter, oil and coolant arcs set into the dials, and a card between them
with the digital speed and the battery's power. The rev counter turns power gauge in the electric modes, as
Analog sport's does.

![Digital round](../../docs/digital_round.png)

| Efficient colours | Map in the centre |
|---|---|
| ![](../../docs/digital_round_efficient.png) | ![](../../docs/digital_round_map.png) |

### Modern wide

No round dials: segmented arcs frame the cluster, a hairline outside each. With the car's own bottom strip (the
default) it is laid out like a new car's: the speed large in the middle over the road ahead (its lane line runs
toward you with the car, the dashes 3 m in 12 as painted, moved by the distance actually driven each frame), the
battery's temperature and the engine speed in the top corners, a glass card on the left with the battery's power, a
power bar (0 a quarter along: regenerating left, drawing right, each to the battery's limit) and its trend, and one on the right with oil, coolant, the
charge and the gearbox oil, each with its icon, over a softly lit, finely dotted background. Its colours follow
the drive mode. On a plug-in hybrid the right arc
turns into the battery's power gauge (0 a quarter up, regeneration green below it) while the engine is off, and is
the tach again, with a small power gauge inside it, as soon as the engine runs.

The road shows what the car's driving assistant sees, from the same feeds as BMW's assisted driving view: your car
from behind (every car is a 3D model of our own, rendered once by `tools/render_cars.py` with soft lighting and
shipped as a small texture the cluster samples at the size each car needs), the car the cruise control follows (its tail lights lit when it brakes), the nearest car in each lane
beside (orange with a lane change warning), the lane edges green while the steering assist holds the lane (orange
on a lane departure warning), the cruise control's gap as bars ahead of your car, and its set speed and ASSIST over
the road. Without the assistant (or on a car without it) the road shows the lanes and your car alone. The cars glide between the assistant's updates instead of jumping. The feeds
haven't been read on a car yet: each source's first values go to the log ('dap raw ...'), and how far a unit of an
object's position is lives in config.dap.posScale, to be set from a drive's log. Full screen or with the map, it keeps its earlier layout.

![Modern wide](../../docs/modern_wide.png)

| Sport colours | Map in the centre |
|---|---|
| ![](../../docs/modern_wide_sport.png) | ![](../../docs/modern_wide_map.png) |

### Digital dash

No dials at all, as much as the car tells: the engine speed as a long segmented bar under the camera's cowl,
the speed and battery power (charging or drawing) on the left, the charge large on the right with the gearbox
oil under it, and six tiles in
the middle (oil, coolant, gearbox oil, intake air, the battery's temperature, boost; boost reads `--` with
the engine off), each with a trend line of its last two minutes and a bar that turns red where it is too
hot. With the map in the centre the tiles become a strip under it. 60 pieces: within the 64 layers the renderer gives an app.

Every layout keeps its readings off what the glass hides (from photos of a G05): the slanted top
corners, the camera's cowl over the top middle (to y 128), the KOMBI's dark box right of centre and its
small eDrive box at the top right (`layout_common.js`; `tools/clearance.js` checks every layout, and
`tools/test_engine.js` asserts it).

![Digital dash](../../docs/digital_dash.png)

| Sport colours | Map in the centre |
|---|---|
| ![](../../docs/digital_dash_sport.png) | ![](../../docs/digital_dash_map.png) |

### Freedom

Over the top and American: the stars and stripes wave behind everything, bald eagles fly across and
fireworks go off in red, white and blue, all drawn and moved by the cluster itself (`shaders.js`: `FLAG_FS`,
`EAGLE_FS`, `FIREWORKS_FS`, on the renderer's clock, so nothing is sent to animate them). Over it: a huge speed
inside a red-to-blue tach arc, the battery's power large on the left (the gear there without the car's own strip), a
FREEDOM banner, a gold-edged plaque of readings along the bottom, and the gearbox oil on the right.

![Freedom](../../docs/freedom.png)

### Retro

A tribute to the round-dial clusters of the 1980s and 90s: matte black faces with a thin dark rim, numerals
and ticks lit orange the way those clusters glowed at night, long slim red-orange needles over black hub caps.
A fuel gauge is set into the speedometer (the reserve in red), an economy gauge into the tach (the battery's
power on a plug-in hybrid, 0 a quarter round, recuperation below it in green; boost with Vehicle: ICE), a small coolant gauge sits
between the dials over an amber LCD with the speed. With the engine off the tach's legend reads the battery's power. Comfort colours
are the classic orange, Sport a deeper red-orange, Efficient white daytime markings. An original design: no
maker's marks or names.

![Retro](../../docs/retro.png)

| Sport colours | Efficient colours |
|---|---|
| ![](../../docs/retro_sport.png) | ![](../../docs/retro_efficient.png) |

### Track

A motorsport data display: a row of shift lights (green, yellow, then red, all flashing red 300 rpm before
the red line) over a segmented rpm bar, a huge gear with the engine speed in the middle, tiles for oil,
coolant, boost and battery power either side of it (over the car's own strip, which shows the gear, the card holds
the engine speed, large, instead) (timing and torque with Vehicle: ICE), the speed large on
the left with a **0-60 timer** (it times every run from a stop to 60 mph, or 0-100 km/h, and keeps the best of
the drive) and the drive's peak power (or boost), and the ranges and charge right of the KOMBI's box.

![Track](../../docs/track.png)

| Sport colours at the shift point |
|---|
| ![](../../docs/track_sport.png) |

### Pulse

Made for the car's own bottom strip, in large type: the speed large in the middle with the battery's power and the
engine speed either side of it at the same height, one long segmented bar under all three for the engine speed,
nearly the panel's width, red from the red line, and one row along the bottom: oil, coolant, the charge, the
battery's temperature and the gearbox oil. Its colours follow the drive mode. With Waze in the centre the speed
sits beside it and the rpm bar runs under it.

![Pulse](../../docs/pulse.png)

| Sport | Map in the centre |
|---|---|
| ![](../../docs/pulse_sport.png) | ![](../../docs/pulse_map.png) |

### GT3

A race dash, after bimmer-lab's GT3 theme for Cluster Themes ([bimmer-lab/apps](https://github.com/bimmer-lab/apps), MIT):
its arrangement and its shift grading, redrawn with this app's engine and fitted to the G05 and a plug-in hybrid.
Eighteen round shift lights over a segmented rev bar (the lights fill to the shift point, the red line less 300
rpm, pulled down while the oil is cold, and all flash there); the gear huge in the middle with the coolant and oil
under it; on the left the speed, the engine speed (OFF in an electric drive) and the **tyres**: pressure and
temperature at each corner from the car's tyre monitor (read every 10 s); on the right the battery's power, the
charge, and the last upshift with its grade (EARLY, SPOT ON, LATE, COLD REV or LIMITER). On a petrol or diesel car,
or with Show: Engine, boost and the shift point take the battery's places.

![GT3](../../docs/gt3.png)

| Sport colours at the shift point |
|---|
| ![](../../docs/gt3_sport.png) |

### M

The M8's M view: the backdrop and the two bowed glass rev blades from bimmer-lab's M theme
([bimmer-lab/apps](https://github.com/bimmer-lab/apps), MIT; their own shaders, traced off an M8's cluster), the
scale 0-8 with the numerals every 2000, the gear's number with the shift programme's stack beside it, the speed under
the line, and the M8's flat gauges in its own manner (an icon over the bar, the unit at the right, a white fill over a
thin track with its red zones, the scale's numbers under it; each temperature's reading in figures beside its icon,
red when hot): in the cards the coolant and oil temperatures (the gearbox oil's in place of the oil on a petrol
or diesel car) on the
left, and on the right the battery's power (its first quarter, left of the 0, regeneration in green) and
temperature on a plug-in hybrid, the boost and torque on a petrol or diesel car; along the bottom, as the M8's fuel
gauge, long flat bars for the fuel level (left) and the charge with its percentage (right; the oil temperature on a
petrol or diesel car), so the strip's own bars aren't added. In an
electric drive the blades read the battery's power in kW: 0 at the 2000 mark, regeneration below it in green to the
battery's limit, the power drawn above it to the blades' top. Its colours follow the drive mode as the M8's: silver
glass in comfort, lit red in a sport mode, blue in ECO PRO and on electricity alone. With the Waze map the map goes
in the window between the blades.

![M](../../docs/m.png)

| Map in the centre |
|---|
| ![](../../docs/m_map.png) |

### Sport

The iDrive 8 M cars' Sport view, from bimmer-lab's Sport theme (their shader, MIT) brought closer to BMW's own: the
blue speed bracket and the red rev bracket with flares where they bend and meet the bottom line, segmented fuel and
oil bars, and the bottom bar's halves as gauges (the charge on blue and the battery's power on red, green while
regenerating; boost and coolant on a petrol or diesel car). In an electric drive the rev bracket reads **ePower %**
(the share of the most the battery gives), as BMW's electric M cars do, its bottom quarter regeneration (green, to
the most it takes). The rev bracket's colour follows the drive mode: red in a sport mode (as BMW's Sport view),
silver in comfort, teal in ECO PRO and on electricity alone. The cruise control's
icon is grey, and green with the set speed beside it while the cruise control holds a speed (the driving assistant's
own services, as Modern wide's road; those send nothing on the G05 tried, so else the head-up display's set speed,
`DisplayDataServer.functionalLibraryData`). Pressed 5% in height to end at the car's own strip; with the Waze map the map
goes in the window between the brackets.

![Sport](../../docs/sport.png)

| Map in the centre |
|---|
| ![](../../docs/sport_map.png) |

### Classic M

The round dials of BMW's M cars of the late 2000s, drawn after a photo of an E92 M3's cluster at night: black faces,
a ring of cool white-blue light round each scale (open across the bottom), white bars, dots and numerals (one scale:
mph or km/h, as set), thin glowing red needles over dark hubs, the fuel gauge across the speedometer's foot
and the oil temperature across the tach's, and one amber LCD between them under the M tricolour: the battery's
power along the top, the speed in large figures in the middle, the charge along the bottom (and the gear, full screen; the charge is in the display, so the strip's charge bar isn't added). In
an electric drive the tach reads the battery's power in kW: 0 a quarter round, the ring green below it for
regeneration. An original drawing.

![Classic M](../../docs/classic.png)

*(Drawn by `tools/preview.js` from the same shaders the cluster runs; the map is a stand-in for the real one.)*

## Readings and where they come from

| Reading | Source |
|---|---|
| speed, engine speed, gear, oil, coolant | the car's signals (`kit/car.js`); both apps read through `shared/data.js` |
| S / M programme (the gear's letter, the Auto colours) | `MDrive.dataDisplayGearbox` |
| outside temperature | `EnvironmentalInformation.ExteriorTemperature` |
| gearbox oil | `BasicDataSet.basicDataSet` |
| battery temperature, where the power goes | `Efficiencytainment2.statusBatteryTemperature`, `KombiIF.statusDisplayElectricalPowerDistribution` |
| intake air, boost | the engine unit over UDS, as M Vitals reads it (only while a layout that shows them is up) |
| battery charge and power | eDrive Live, through the shared folder `/dev/shm/cluster-info` (asked for while the layout shows and the car is switched on, as Cluster Info does) |
| fuel range, electric range | an app that shares them (eDrive Live, `values.frange.km` / `values.erange.km` in that folder), else the car's `KombiIF.statusRangeTankStatus` and `VehicleInformation.Range`, numbers picked by field name (`shared/data.js` `rangesOf`) |
| drive mode (SPORT, SPORT INDIVIDUAL, HYBRID, HYBRID COMFORT, HYBRID ECO PRO, ELECTRIC, ELECTRIC INDIVIDUAL, BATTERY CONTROL, ADAPTIVE, + XTRABOOST) | `FES.statusFESVehicleDynamicSwitchHMI` (and `statusSwitchDriveDynamicSport2`), decoded with BMW's FES mode table (TAB_FES_MODUS_ARG); the Auto colours follow it |
| steering angle, yaw rate | `SteeringAngle.ActualSteeringAngleDriver`, `CDS2.statusYawVelocityVehicle` (scaling in `config.scaling`, from the CAN signals, to confirm) |
| engine running, why it started | `CDS.statusEngineStatus` (its strings as the car sends them), else engine speed |
| time | the head unit's clock |

**Signals page.** Every field above is one an installed app already declares with the same flags
(`tools/known_signals.json`; a field the car's catalog doesn't have makes the install fail). Where the field
names inside a value differ by car, the app shows what the car sends: press **Signals** on its page for (1)
the raw drive-mode, range, engine, steering and yaw values, (2) what the cluster has up besides this app
(every display slot the KOMBI reports), then (3...) every range, fuel and
charge signal in the head unit's own catalog. A photo of those pages is what's needed to wire anything that
still reads `--`.

**Needs Cluster renderer 0.4.2 or later**, the Store's own (it draws 64 layers an app, and every piece of a
layout is a layer), from [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps), one of
the Store's own sources; the Store installs it with the app.

**Logs.** The apps can't be reached from a phone over Wi-Fi: the head unit's firewall lets nothing connect
in, and an app's traffic out only through what the uplink allows. Instead, **Logs** on Cluster Layouts' page
shows what's needed (the renderer's status and slot report, the raw signals, the data now, the last lines of
the renderer's, this app's and Cluster Centre's logs) as QR codes, three to a page: photograph each page
(press Logs for the next) and send the photos; `python3 tools/decode_logs.py photo*.jpg -o logs.txt` puts the
text back together. The full logs go to a file on any USB stick plugged into the car
(`cluster-logs/cluster-logs-<time>.txt`) and to the app's data folder.

**Background: pure black** (the default; Settings > Background): backgrounds and dial faces black, so the
KOMBI's black box where its own gear readout sits blends in. *Tinted* is the layouts as designed.

**The dark box right of centre** while a layout is up is the KOMBI's own: the stock gear readout's place,
left empty when the panel covers it (the gear letter moves to the bottom bar). The layouts keep their
readings out of it. The renderer's slot report (Signals, page 2) shows what the KOMBI has up there. A gear letter drawn into the
box doesn't show on the car (only its top edge peeks out): the box sits above the panel, so nothing an app
draws can fill it. By default the layouts leave plain black round it, so the box's black window
disappears into the background; Settings > Frame behind the gear box puts a grey frame round it instead.

**M cars** (Settings > Cluster > M car): an M car's KOMBI leaves two more dark boxes in the middle of the
panel while a layout is up, over whatever is drawn there. With the setting on, each layout moves its readings
round them: Digital dash makes its middle and right top tiles one line high above the boxes, Track moves its gear
card and right tiles below them, Modern wide moves its centre readings and gear below them, Freedom moves the
speed to the left and the gear to the right, and the panel between the dials narrows. The rev counters of
Analog sport, Digital round and Retro are too big to move out of the middle, so the boxes still sit on their
faces. The boxes' places were measured from one photo of a car (`layout_common.M_BOXES`, to within about 10 px):
a straight-on photo would tighten them. With Bottom strip
set to the car's own (the default) the KOMBI leaves no boxes, so every layout keeps its own places on an M car too.

**Bottom strip** (Settings > Bottom strip > The car's own, the default): the layout ends at y 646, so the KOMBI's own
strip along the bottom shows below it (the fuel range, the time, the street, the drive mode and gear, the outside
temperature and the electric range, and the warning lights; 660 just touched the top of its drive mode), and the
black boxes some cars' KOMBIs leave over a full-screen layout go away. Found and tested on cars by thatgrayg22.
With nothing of the KOMBI's to keep clear of, each layout takes its centred form there: the round dials of Analog
sport, Digital round and Retro stand either side of the middle again as first drawn, sized to end above the
strip; the side columns of Track, Digital dash and Freedom balance either side of the middle; Modern wide's arcs
end higher. The layouts' own fuel and electric range numbers are left out (the strip shows both), and with the
readings in the centre a fuel gauge sits above the strip's fuel range (bottom left) and a charge gauge above its
electric range (bottom right), bars with no numbers. With the stock centre the layout takes the same form as with Waze, its window left clear for the car's own centre
content. `tools/preview.js --strip` shows it.

### Nothing asked of a parked car

Every diagnostic read (and every read eDrive Live makes for the shared power) goes through the car's gateway and
wakes its networks. **Show** stays on with the car locked, so the layout alone can't say when to stop: until 0.27.2
it kept asking, and the car couldn't sleep (body controller 801C16 - 801C18 "no sleep in parking state", the engine
unit's switch-off time missing, *Battery management: malfunction while shutting down the vehicle electronics*). Now
`shared/data.js` reads nothing and asks eDrive Live for nothing unless the car is switched on, by its own state
(`VehicleCondition`, `kit/awake.js`: ignition on, ready to drive, driving), or, before the car has said, moved or ran
in the last 3 minutes. The layout itself stays up; its readings simply stop until the car is on again. After
installing, clear the stored faults once (Fault Scanner) and check they stay away.

## Vehicles

Made and measured on a G05 X5 xDrive45e (iDrive 7 MGU, the 12.3" Live Cockpit Professional cluster); every
car is taken to have the same cluster. What differs between cars is a setting, or found from the car:

- **Vehicle** (default **Auto**): found from the car the way other apps identify one before assuming
  anything: a plug-in hybrid's drive mode names, eDrive Live sharing its battery readings or the car giving an
  electric range say plug-in hybrid; none of these in 90 s shown, while the engine unit answers, says petrol
  or diesel. A petrol or diesel car gets the engine readings (boost, timing, torque, fuel rail), its own drive
  modes and no eDrive page. Or set it.
- **Fuel tank size** (40-90 L, 69 for an X5 45e): the fuel bar.
- The battery's charge and power come from **eDrive Live** only: this app never asks the battery unit itself
  (two apps asking it in turn left both without answers).
- **Battery power (kW)**: *Fast* (the default) moves every power gauge as the car accelerates or regenerates, without
  waiting for eDrive Live's next reading. The car's own signals that move with the battery's power, each fitted
  continuously to eDrive Live's readings of the battery (`shared/kwfuse.js`), the best fitting one shown: the stock
  cluster's own power meter (`Efficiencytainment2.statusPowerRelativHybrid`, electric drive and recuperation in %),
  the sport display's powertrain power (`FES.displaySportPowertrain`, on electricity), the onboard computer's
  consumption now x the speed (`ResetLogic.currentConsumption`), and the power at the wheels from the speed and
  acceleration (on electricity). With the engine running and none of the car's signals fitted, and with *eDrive
  Live's readings only*, the readings as they are. Nothing shows when eDrive Live has said nothing for 4 s. Logs >
  *fast power* shows each source: how often it came, its fit and its average miss in kW.
- **Electric range when full**: the estimate shown (with ~) until the car's own electric range arrives.
- The glass and the KOMBI's boxes (the camera cowl, the gear bracket, the eDrive box, the warning lights)
  are taken as the same on every car with this cluster (`layout_common.js`; every layout is checked against
  them by `tools/clearance.js`).

**Clock:** the unit runs its apps on UTC, so both apps take the time zone from Settings > Time zone (US
Eastern by default; US and EU daylight saving built in; Korea / Japan as a fixed UTC+9) and Settings > Clock
(12- or 24-hour).

## How it gets onto the cluster

The head unit never sends a picture of the cluster: a whole 1920x720 frame is 5.5 MB, and the link to
the KOMBI carries about 11.5 MB/s for everything, including the HMI's own content.

- The cluster is drawn with **RAMSES**: the head unit publishes a *scene* (a graph of quads, shaders,
  textures and uniforms), and the KOMBI's own renderer subscribes to it and draws it on the cluster's GPU.
  BMW's HMI draws its own cluster content this way.
- The [cluster render service](https://github.com/robertnisipeanu/idrive-apps/tree/main/native/cluster-render)
  (`cluster-render`, from idrive-apps) is that publisher for apps. It asks the KOMBI for display slots
  through Dcsm2. Its **`panel`** target is slot **0x203**: the whole 1920x720 cluster, over the stock
  gauges and **under the warning lights**.
- Each piece of a layout is an **effect layer**: a small GLSL ES 1.00 fragment shader over its own rectangle
  (`shared/shaders.js`). The dial (face, ticks, red zone, numerals, needle, hub) is one shader; each text is
  another; the background is a flat colour.
- **The render service draws at most 8 layers for an app** (32 for all apps together), so only a layout's
  first 8 pieces show today; the rest are refused (the app's page says so). Drawing many pieces with one big
  generated shader instead made the cluster restart, so that is not done. The way on is the render
  service allowing more layers an app.
- What is sent:
  - **once**: the shaders, their colours and one glyph atlas (a 1.5 KB-per-glyph distance field, ~96 KB):
    about **128 KB** in all;
  - **while driving**: the needles' values when they moved, and texts and colours when they changed: about **2.5 KB/s** at most (`tools/test_engine.js` measures it); **nothing** while nothing
    changes.

## Install on the car

1. Nothing else to add first: the Store installs what the apps need from its own sources, the cluster
   renderer from [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps) and the GPU
   renderer and controller gate from [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps).
2. In the Store, add the GitHub repository `eroobeeroo/idrive7-cluster-info` as a source. The head unit builds
   the apps from source; no token is needed.
3. Open **Cluster Layouts** and press **Show on the cluster**. Settings: layout, colours (Auto follows S / M),
   centre (readings, map or stock), mph / km/h, °F / °C, Nm / kgm, red zone, rev scale, the needle sweep at start.

## Safety

- **Off by default.** Nothing covers the stock cluster until *Show on the cluster* is on.
- **Warning lights stay on top**: the panel slot is under the telltales.
- **The stock cluster comes back by itself** when the app stops, when the render service stops (its layers
  go with the connection), when *Show on the cluster* is off, and while the car's signals do not answer.
- The speed is the car's speed signal (`Vehicle2.statusCarSpeed2`, the centre of gravity), not the
  cluster's indicated speed, which by law reads a little high: expect this layout to read a few % below the
  stock speedometer.
- **The panel and the HUD share a scene id** (the KOMBI takes only two): while another app draws on the
  HUD, the panel cannot come up and the app's page says `scene id in use by another target`. Stop the HUD
  apps to use a layout.
- **Not seen on the car yet:** the KOMBI's renderer running these shaders (precision and speed on its
  GPU), whether the stock Check Control pop-ups still show above the panel, whether the map (slot 0x100)
  shows through the map window while the panel is up, and where the warning lights sit against the strips
  above and below the map. Check these parked before driving with it, and switch it off if anything is hidden.

## Writing a layout

The renderer side both apps use (engine, shaders, glyph atlas, render client, providers, signal finder) lives
in `shared/`; edit it there and run `node tools/sync_shared.js` (each app ships its own copy).

A layout is one file, `apps/cluster_layouts/layout_<id>.js`, listed in `layouts.js` and in `app.json`'s
`layout` setting. It lists **pieces** and draws nothing; `layout_common.js` has helpers (texts, readings,
bars, units, the map window). A piece is one shader in its rectangle (`engine.js` has the full list of fields; a
dynamic text's `chars` sets how many glyphs it can show):

| kind | what the cluster draws | main fields |
|---|---|---|
| `flat` | a colour | `colors: { color }` |
| `panel` | a rounded card: gradient, top light, border | `params.u_box` (radius, border, light, opacity) |
| `dial` | a round dial with its needle: face, metal bezel, ticks, red zone, numerals, backlight, value arc, shadow, hub, glass | `params.u_scale`, `u_arc`, `u_needle_dim`, `u_look`, `u_look2`; `value(d)`, `max` |
| `band` | a gauge along an arc (or a straight bar): segments, gradient fill, red zone, glowing tip, marks, numerals | `params.u_geo`, `u_span`, `u_marks`, `u_red`; `value(d)` 0..1 |
| `mdash`, `mtach`, `sdash`, `licon` | bimmer-lab's M backdrop, M rev blade, whole Sport view and line icons (their shaders) | their layout JSON's numbers as `params`; readings through `dyn` |
| `mbar` | an M8 side gauge's bar: thin track, thicker fill (white, or blue below its zero), red zones, start tick, notches | `params.u_zero`, `u_zones`, `u_marks`; `value(d)` 0..1 |
| `e9x` | a classic M dial: ring of light, bars, dots, numerals, a second scale, a small gauge at its foot, needles | `params.u_scale`, `u_arc`, `u_inner`, `u_sub`; `value(d)`, `dyn` `u_subv` |
| `chevron` | a gauge along two straight segments (A, the corner B, C): track, gradient fill, white marker, glowing outer line, inner line, shift dashes, ticks, numerals beside it | `params.u_ab`, `u_c`, `u_lines`, `u_marks`, `u_nums`, `u_red`; `value(d)` 0..1 |
| `text` | a line of glyphs with an optional glow | `text` (fixed, or `(d, t) => string`), `align`, `tracking` |

```js
const C = require('./layout_common');
module.exports = {
    id: 'my_layout', title: 'My layout', gearText: C.gearText,
    palette: (look) => ({ bg: '#000000', text: '#ffffff', glow: '#3fa6ff', dim: '#5d6f82' }),
    pieces(o) {
        return [
            C.flat('bg', 0, 0, 1920, 720, 'bg'),
            C.text('gear', 800, 150, 320, 190, C.gearText, (t) => ({ color: [t.text, 1], glow: [t.glow, 0.5] })),
        ].concat(C.reading('fuel', 800, 400, 320, 40, (d) => C.distText(o, d.frange), 'FUEL RANGE',
            (t) => ({ color: [t.text, 1], glow: [t.glow, 0] }), (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] })));
    },
};
```

`o` holds the options (units, red zone, rev scale, centre: `info`, `map` or `stock`); `d` the car's data
(`speed` km/h, `rpm`, `gear`, `stage`, `mode`, `oil`, `coolant`, `outside` °C, `soc` %, `kw`, `erange` and
`frange` km); `t` the layout's palette for the look now. Texts use the glyphs in `font.js`; add more there. A layout's
`font` picks its face for every text and numeral: `'bold'` (the default), `'light'`, `'wide'` (Michroma, Sport) or
`'orb'` (Orbitron, M); its `mapWindow` ({ x, y, w, h }) where Waze on cluster draws the map, if not the native map area.

Check it before the car:

```sh
node tools/preview.js --layout my_layout --look sport --centre map --out preview.png   # WebGL, the cluster's shader language
node tools/test_engine.js && node tools/test_app.js && node tools/test_finder.js && node tools/test_centre.js && node tools/test_shared.js
node tools/preview_centre.js --page edrive --accent orange --out page.png                # a Cluster Centre page
python3 kit/tools/build.py cluster_layouts     # needs an oap-sdk/ folder (a stub is enough to check the build)
```

`preview.js` needs Node with Playwright and Chromium.

## Free and open source — the credit mark

These apps are free. If you paid for one, ask for a refund. Each app shows this on its own screen on the head
unit (the app menu), with a link to this repo. The notice is not drawn on the cluster glass — only in the app.

The credit is **signed** (`shared/attribution.js`, `shared/attribution_sig.js`):

- `attribution_sig.js` holds the author's **public** key, a signature over the credit text, and a key
  fingerprint. It is committed.
- The matching **private** key lives only in `secret/attribution_key.pem`, which is git-ignored and never
  pushed. Keep a backup of it somewhere safe.
- At start-up each app verifies the signature. An official build shows the dim credit and its key fingerprint. A
  build whose credit text was changed can't be re-signed without the private key, so it fails the check and shows
  a red **MODIFIED BUILD** notice on the app screen instead.

Honest limit: this is open source, so anyone can fork it and delete the check in their own copy — nothing can
stop that. What the signature does stop is a reseller passing a modified build off as an official, unmodified
one: users can see the mark flip and check the fingerprint against this repo.

After an **intended** change to the credit text, re-sign:

```sh
node tools/sign_attribution.js     # signs with secret/attribution_key.pem, rewrites attribution_sig.js
node tools/sync_shared.js          # copies the shared files into each app
```

## Notices

See [NOTICE.md](../../NOTICE.md).
