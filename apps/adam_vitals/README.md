<img src="icon.png" width="70" alt="Engine Vitals icon">

# Engine Vitals for iDrive 7

M Vitals and Warm-Up in one app for BMW iDrive 7 (MGU), for the
[mgu-store](https://github.com/robertnisipeanu/mgu-store). The Main page shows boost, power, torque, the gear,
oil, coolant and transmission temperatures in M Vitals' style. While the engine is still cold, the warm-up view
(time to ready, safe rev limit, trend) takes Main's place until you hide it or oil, coolant and transmission reach
their operating temperature. A Cool down page tells you whether to idle or keep driving gently after hard driving,
so you don't park with a hot turbo.

Adapted from upstream idrive7-apps `apps/car_vitals` 2.25.0 and `apps/warmup` 1.7.3 (MIT, see `NOTICE`).
Built for a 2024 X3 M40i (G01 LCI, B58).

## Status

0.1.0 ran on Adam's G01 (2026-11-04): boost, power, torque, oil, coolant and the warm-up view worked. 0.2.0 has
run only in the upstream idrive7-apps emulator (manual and demo signals) and in Node 8 unit tests. What only the
car can prove:

- The transmission temperature: whether this G01's gearbox unit answers `22 6000` (the log shows
  `raw EGS 6000: ...` lines and `gearbox unit identification (22 F150): ...` once). Without an answer the
  transmission gauge stays hidden (Auto) and the warm-up uses oil and coolant only.
- Whether coolant reaches 220 °F on every drive: BMW's heat management may hold it lower under load or in Sport;
  then it counts once it settles within 27 °F of the mark (see Warm-up takeover).
- The engine unit DIDs (boost, fuel pressures, timing, misfires) answering on this B58.
- The gear and D / S / M signals, and the tyre values in the car's units.
- The seven tabs fitting the real header, and Hide warm-up working from the controller.
- Max power: the default 285 kW (382 hp) is the 2024 X3 M40i's published figure [U] (third-party spec pages,
  e.g. https://www.cars.com/research/bmw-x3-2024/specs/443367; not checked against BMW USA). Change it in
  Settings for a tuned car.

## Pages

| Tab | What |
|---|---|
| Main | Boost (psi, -10 to 30), power, torque, gear, oil, coolant and transmission (when the gearbox answers). No rpm or speed. The gear card's left side says READY, WARMING ~N min, COOL-DOWN N s, OK TO SHUT OFF, or OIL / COOLANT / TRANS HOT. |
| Thermals | Coolant, engine oil, gearbox oil, transmission (EGS), ambient with 5-minute traces (M Vitals) |
| Fuel & ign. | Intake air, fuel pressures, timing, boost and air charge target vs actual, misfires (M Vitals, from the engine unit) |
| Chassis | G-force circle, tyres, xDrive split (M Vitals) |
| Warm-up | Oil, coolant and transmission gauges (colour zones, a green tick at each ready mark), time to ready with the targets, safe rev limit, 20-minute trend (Warm-Up) |
| Cool down | Turbo cool-down advice with a countdown, oil, coolant and transmission over the last 10 minutes, a boost strip |
| Settings | Added by the kit |

## Warm-up takeover

- Main shows the warm-up view while oil, coolant or transmission is under its "is warm at" setting and the engine
  hasn't been warm yet this drive. Defaults (0.2.0): oil 220 °F, coolant 220 °F, transmission 160 °F. 0.1.0 had
  176 °F (80 °C) for oil and coolant and no transmission; a settings file saved by 0.1.0 moves to the new marks once
  (its log says `settings: warmOil 80 -> 104.4 (moved to this version)`), later choices are kept.
- The transmission counts only with **Include transmission in warm-up** on (default) and a reading; with no
  reading it neither blocks nor counts.
- Coolant and transmission also count once they stop rising within 27 °F (15 °C) under their mark: a thermostat
  holds them there (BMW's heat management drops the coolant target to about 203 °F under high load on its sibling
  engines; the 8HP's cooler thermostat opens at about 167 °F), so the view never waits for good on a mark the car
  won't reach. The table then says SETTLED. Oil has to reach its mark.
- **Hide warm-up** (on the page, or the bar button) shows the vitals for the rest of the drive.
- Once all are warm it goes for the drive, even if a temperature dips later.
- A new drive is the engine off for 10 minutes then running again (the longer of the steady and the wall clock,
  so a head unit that slept counts), or the app starting again. A start-stop stop at a light is not a new drive.
- Safe rev limit: 3500 rpm at 86 °F oil rising to the redline at the oil mark (0.2.0: 220 °F, 0.1.0: 176 °F).
- Setting **Show warm-up screen when cold** off: never.

## Temperature marks

Every temperature gauge is coloured the same way: cold (blue) under the ready mark minus 36 °F, warming (amber)
up to the mark, ready (green), hot (amber), red.

| | Ready (setting) | Hot (amber) | Red |
|---|---|---|---|
| Oil | 220 °F (104 °C) | 265 °F (129 °C) | 275 °F (135 °C), the "Oil temp warning" setting (0.1.0: 257 °F) |
| Coolant | 220 °F (104 °C) | 250 °F (121 °C) | 260 °F (127 °C) (0.1.0: red from 234 °F) |
| Transmission | 160 °F (71 °C) | 230 °F (110 °C) | 250 °F (121 °C) |

What the research found (2026-11-04; [V] = the words are in the source, [U] = not proven):

- No BMW document I could read gives the B58's own oil or coolant targets or Check Control thresholds [U].
- B58: no wax thermostat, a heat management module, and "the engine oil as well as the transmission fluid are
  cooled using coolant" [V] (BMW training ST1505 *B58 Engine*, p. 38:
  https://archive.org/download/BMWTechnicalTrainingDocuments/ST1505%20B58%20Engine/B58%20Engine.pdf).
- BMW's sibling engines with a map thermostat run coolant at 228 °F (109 °C, economy), 222 °F (106 °C, normal),
  203 °F (95 °C, high load) [V] (ST1111 *N20 Engine*, p. 96:
  https://archive.org/download/BMWTechnicalTrainingDocuments/ST1111%20N20%20Engine/N20%20Engine.pdf); N55:
  226 °F (108 °C) economy, 219 °F (104 °C) normal [V] (ST916 *N55 Engine*:
  https://archive.org/download/BMWTechnicalTrainingDocuments/ST916%20N55%20Engine/N55_Engine_web.pdf). So 220 °F
  matches BMW's part-load coolant on those engines; on the B58 it is Adam's reading [U].
- Oil: a BMW 1M owner's manual snippet puts warm oil at 210 to 300 °F [U] (snippet only); the 265 / 275 °F marks
  follow this job's request [U].
- Coolant hot / red: above the highest documented setpoint (228 ±2 °F) with room to spare [U].
- ZF 8HP: the transmission oil cooler circuit fills once the oil is "over 75°C" (167 °F) [V] (ZF Service
  Information 1087.754.107c, p. 9:
  https://aftermarket.zf.com/app/controller/ti/download/Binary/207b8f86-028b-11f1-a321-00505690da53.pdf), so the
  cooler thermostat opens around there and normal running is above it. No ZF or BMW page defines a "ready"
  temperature: 160 °F (Adam's number) is kept as the default since nothing contradicts it; 170 °F is the
  closest setting to the thermostat. BMW's gearbox unit has staged "Hotmode" protection [V] (BMW SI B24 03 16:
  https://static.nhtsa.gov/odi/tsbs/2016/MC-10151357-9999.pdf, no temperatures given); the 230 / 250 °F marks are
  ours [U].

## Transmission temperature

- Read: the gearbox unit (EGS, 0x18) with UDS `22 6000` (`_GETRIEBEOELTEMPERATUR`, 1 byte, °C + 40), the read
  Transmission Config (upstream `apps/zf8hp`) makes: `catalog.js` line 58 and `reader.js` lines 75-76 at
  cauliflowermossgrape/idrive7-apps@990c105 (1800 ms, no retries, the same timeouts), read on a G22 (PR #29).
  0.1.0's unconfirmed `DA12` candidate is gone. The gearbox identification (`22 F150`) is read once and only logged.
- Asked every 5 s on every page (one request at a time with the engine-unit poll); 3 failed reads in a row: every
  30 s. A reading older than 20 s shows as `--` (never the old number). The first reading counts once it changed
  1 °C (then `seen.json` remembers this car has it). The DISABLE file and the 5-errors stop end it with the rest.
- **Transmission temp (EGS)**: Auto (default: shown once this car's gearbox answered), Show (always, `--` and why
  when there is none), Hide (no gearbox reads at all).

## Units

**Units**: US (psi, °F, hp, lb-ft; the default), Metric (bar, °C, kW, Nm), or Follow the car's display units.
US or Metric always beats what the car says. Values are kept in °C, bar, kW and Nm and converted where drawn.
The threshold settings show both units ("176 °F (80 °C)", "382 hp (285 kW)").

## Measured or estimated

| Value | Where it comes from |
|---|---|
| Oil temperature | Measured: the car's CDS signal. With nothing from it for 15 s, the engine unit over OBD (also measured; the label then says "engine unit"). |
| Coolant | Measured (CDS) |
| Transmission | Measured: the gearbox unit (22 6000). The Thermals tile "Gearbox oil" is the car's own BasicDataSet value (scaling a guess, not used by the warm-up) |
| Boost | Measured: the sport display (FES), else the engine unit's charge pressure minus outside pressure |
| Torque | Measured (FES, crankshaft torque) |
| Power | The sport display's % x Max power; **estimated** from torque x rpm when the car sends no %, labelled so |
| Gear | The gearbox signal; **estimated** from rpm / speed when it's missing (EST.) |
| Minutes to warm | **Estimate**: typical rates blended with the measured rate over the first 2 min (EST.), then measured (transmission's typical rate is ours [U]) |
| Safe rev limit | Rule of thumb (Warm-Up's): the cold limit at 30 °C oil rising to the redline at "oil is warm at" |
| Cool-down time | **Estimate** from recent load (rpm, power, boost), not a turbo temperature sensor |

## Cool-down thresholds

| Name | Value | Where from |
|---|---|---|
| Hard use | over 3800 rpm or 90 kW (121 hp) | Warm-Up 1.7.3 |
| Hard use by boost | over 0.8 bar (11.6 psi) | new here [U] |
| Gentle (counts down) | under 2800 rpm and 40 kW (54 hp), engine running | Warm-Up 1.7.3 |
| Hard use before it asks | 8 s | Warm-Up 1.7.3 |
| Cool-down asked | 30 s + 3 s per hard second, 30 to 180 s | Warm-Up 1.7.3 |
| Short bursts fade | at 0.2 s per second without a cool-down | Warm-Up 1.7.3 |
| "Cooled" shown for | 20 s | Warm-Up 1.7.3 |
| Stopped (idle advice) | under 5 km/h (3 mph) | new here |
| Engine off | doesn't count down; off 15 min clears it | new here [U] |

Sources: I found no BMW wording for the B58 or the X3 G01 on cooling a turbo before switching off, so "no
forced idle needed after normal driving" is [U]. Other makers' manuals ask for about a minute of idling after
high speed or heavy load, e.g. Kia: https://ownersmanual.kia.com/full_webhelp/MQ4A/2026/en_US/topics/t00377.html
(not BMW's guidance). The 30 to 180 s range is Warm-Up's.

## Settings

Units, Start page, Show warm-up screen when cold, Oil is warm at (176 to 230 °F), Coolant is warm at (176 to
230 °F), Transmission is warm at (120 to 190 °F), Include transmission in warm-up, Transmission temp (EGS),
Turbo cool-down guidance, Oil temp warning, Rev limit when cold, Redline, Max power, then M Vitals' own: Power from,
Boost from, Engine, peaks, xDrive card, the Auto / Show / Hide of each value, theme, layout, renderer, demo data.
A bad saved value goes back to its default once, with a line in the log.

## Safety

- It reads only. The only active traffic is M Vitals' read-only engine unit poll (UDS 22, OBD 01 / 06) and the
  gearbox unit's temperature (UDS 22 6000 every 5 s, F150 once). Nothing goes to the cluster or the HUD.
- Kill switches, fastest first: Transmission temp (EGS) Hide stops the gearbox reads; a `DISABLE` file in the
  app's data folder (`<dataDir>/DISABLE`, its path is in the log at start) stops all engine and gearbox unit reads
  within 2 s, and the screen says so; Remove in the Store.
- Every callback is guarded: an error is logged and counted, never thrown. 5 errors in 10 s stop the engine
  unit reads (the screen says STOPPED) until the app starts again.
- Missing signals show `--` or a line saying why.
- Never restart or kill the app or MainApp by hand on the car, and never reinstall an app that crashed:
  remove it with the Store.

## Install

1. In the Store: Settings, **Add source**, type `pinguinooo/idrive7-apps`, OK (skip if it's already there;
   the Store refreshes the source and lists new apps by itself).
2. In the Store: Engine Vitals, Install.
3. Open it once with the engine cold to see the warm-up view, then Hide.

## Changes

- 0.2.0 (2026-11-04): oil and coolant ready at 220 °F (were 176 °F), transmission temperature (gearbox unit
  22 6000) on Main, Warm-up, Thermals and Cool down and in the warm-up (setting), colour zones on every
  temperature gauge, oil warning 275 °F (was 257 °F), coolant red from 260 °F (was 234 °F), 0.1.0 settings moved
  once, the new-drive rule survives a sleeping head unit, a clock set back no longer stalls any timer, "Cooled"
  clears without an rpm signal.
- 0.1.0 (2026-11-04): first version.
