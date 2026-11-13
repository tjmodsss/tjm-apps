# HUD Widgets

<img src="icon.png" width="72" align="left" alt="HUD Widgets icon">

Puts your own readouts on the windshield HUD: gear, a shift bar, boost, oil and coolant temperatures, a clock, or any car sensor you pick. BMW's HUD already shows the speed, so these layouts leave it out. Open **HUD Widgets** from the apps menu on the center screen and set it up on its page.

<p align="center"><img src="../../docs/images/hud-redline.gif" width="600" alt="Redline layout"></p>

<p align="center"><img src="../../docs/images/page-hud-layouts.png" width="900" alt="The HUD Widgets page on the center screen"></p>

## Layouts

<table align="center">
  <tr>
    <th align="center">Daily</th>
    <th align="center">Sport</th>
    <th align="center">Redline</th>
  </tr>
  <tr>
    <td><img src="../../docs/images/hud-daily.png" width="300" alt="Daily layout"></td>
    <td><img src="../../docs/images/hud-sport.png" width="300" alt="Sport layout"></td>
    <td><img src="../../docs/images/hud-redline.png" width="300" alt="Redline layout at the shift point"></td>
  </tr>
</table>

<table align="center">
  <tr>
    <th align="center">Minimal</th>
    <th align="center">Shift only</th>
  </tr>
  <tr>
    <td><img src="../../docs/images/hud-minimal.png" width="300" alt="Minimal layout"></td>
    <td><img src="../../docs/images/hud-shiftonly.png" width="300" alt="Shift only layout"></td>
  </tr>
  <tr>
    <th align="center">Boost</th>
    <th align="center">Warm-up</th>
  </tr>
  <tr>
    <td><img src="../../docs/images/hud-boost.png" width="300" alt="Boost layout"></td>
    <td><img src="../../docs/images/hud-warmup.png" width="300" alt="Warm-up layout"></td>
  </tr>
  <tr>
    <th align="center">Track</th>
    <th align="center">Cruise</th>
  </tr>
  <tr>
    <td><img src="../../docs/images/hud-track.png" width="300" alt="Track layout"></td>
    <td><img src="../../docs/images/hud-cruise.png" width="300" alt="Cruise layout"></td>
  </tr>
  <tr>
    <th align="center">Retro</th>
    <th align="center"></th>
  </tr>
  <tr>
    <td><img src="../../docs/images/hud-retro.png" width="300" alt="Retro layout"></td>
    <td></td>
  </tr>
</table>

- **Daily:** the gear, the clock and the oil temperature.
- **Sport:** a segmented shift bar, a big gear, a boost gauge, oil and coolant.
- **Redline:** a slanted rev bar with 12 shift lights, a big gear, your shift point and your last shift with its grade.
- **Minimal:** built round BMW's own speed and speed-limit sign without covering them: a thin shift bar beside them, the gear right of BMW's speed, and one readout.
- **Shift only:** 12 shift lights and the gear, and SHIFT at the shift point.
- **Boost:** a boost gauge with a dot that holds the peak for 4 seconds, the boost in figures, and the peak since your last 0 to 60 run.
- **Warm-up:** oil, coolant and intake air temperature as bars with figures, and WARMING UP until the oil reaches 80°C. The intake temperature is read from the engine unit (read-only), like the boost fallback.
- **Track:** 12 shift lights, the gear with SHIFT beside it, and a G-meter: a dot shows the cornering and braking or accelerating force (into the turn and up when you speed up), white, then amber from 0.5 g, then red from 0.8 g, with a fading trail and an outline of the most g this drive in every direction. Beside it the g now (left or right, accelerating or braking) and the best of the drive.
- **Cruise:** four quiet figures in soft white: range, outside temperature, your average speed this drive (time moving only, after the first minute) and the time.
- **Retro:** an 80s digital look in amber: a segmented rev bar, the gear in seven-segment digits, and boost, oil and water as figures with bar graphs.
- The clock, oil, coolant and shift point readouts can each show another sensor instead (page's Readouts tab).
  - **Shift lights:** they come on from 3000 rpm and fill up to the shift point. At the shift point everything goes red and SHIFT shows.
  - **Shift grades:** every upshift is graded on its peak rpm. EARLY means more than 250 rpm under the shift point, LATE more than 200 over it, COLD REV the same while the cold guard is on, LIMITER within 60 rpm of the redline, and anything in between is SPOT ON.
  - **Cold-engine guard:** until the oil reaches 80°C, the shift point starts at 4500 rpm and climbs as the oil warms up.

## Themes

Classic, M and Night, plus Auto, which switches to Night at sunset. You choose which theme Auto uses in daytime. Cruise and Retro always keep their own colours (soft white and teal, amber and green).

<table align="center">
  <tr>
    <th align="center">Classic</th>
    <th align="center">M</th>
    <th align="center">Night</th>
  </tr>
  <tr>
    <td><img src="../../docs/images/hud-theme-classic.png" width="300" alt="Classic theme"></td>
    <td><img src="../../docs/images/hud-theme-m.png" width="300" alt="M theme"></td>
    <td><img src="../../docs/images/hud-theme-night.png" width="300" alt="Night theme"></td>
  </tr>
</table>

## Off and drive modes

- **Off (BMW's own HUD):** the first card on the Layouts tab. Tap it and the app draws nothing in any drive mode, so BMW's HUD comes back.
- **Change with SPORT / COMFORT / ECO PRO** (on by default): the HUD follows the drive mode buttons, with a layout for each mode. Out of the box, Comfort shows Daily, and Sport and Eco Pro hand the HUD back to BMW. In Sport, BMW's own HUD adds its rev band bottom left, next to its speed; every layout leaves that corner empty, so any layout can be used in Sport too. Until the car reports a mode, the plain layout setting is used.
- **With Redline:** while Redline holds the HUD, HUD Widgets draws nothing and the status line says so. It comes back by itself when Redline lets go, and Redline hands the HUD back when the car is switched off.
- **M cars:** the Efficient, Sport and Sport+ modes of M cars are not recognised yet, so the layout doesn't change with them. The last line of the Settings tab shows the value your car sends; please post it in an issue so it can be added.
- **With Cluster Themes:** on cluster-render 0.5.1 and newer, a HUD layout and a cluster theme show at the same time. On older cluster-render they share one screen slot and take turns: pick a layout while a cluster theme is on and the page asks whether to turn the theme off, and it asks the same the other way round.

## Settings

Layout, drive mode switching, which sensor each readout shows, where the HUD sits on the glass and its size, theme, daytime theme for Auto, units (mph, °F, psi or km/h, °C, bar), 12- or 24-hour clock, time zone, fuel tank size, redline, shift point before redline, cold-engine rev guard, which readouts show (clock, oil, coolant, boost), and demo data. Changes show on the HUD right away, and the HUD keeps running after you leave the page.

**Time zone (clock):** the head unit's clock runs on UTC, so pick your zone once. Named zones (US Eastern, Central, Mountain, Pacific, Alaska, Hawaii, Arizona, Canada Atlantic, Mexico, UK / Ireland / Portugal, Central Europe, Eastern Europe) change for daylight saving by themselves; for anywhere else, pick your offset from UTC. The Auto theme uses the same zone to work out sunset.

**Fuel:** the fuel readout asks the engine unit for the level in %. Where the engine unit doesn't answer, it works it out from the litres the car reports and the Fuel tank size setting (65 L on an X3, 59 L on a 3 Series). Plug-in hybrids can also show **Hybrid battery**, the high-voltage battery's charge in % (not yet checked on a hybrid).

**G-meter:** the range (0.8, 1.0, 1.2, 1.5 or 2.0 g at the edge; 1.2 by default), the trail (off, 1, 2 or 4 seconds), **Swap left / right** (if the dot goes the wrong way in a turn) and **Brake on top**, the best left, right, accelerating, braking and overall g of the drive with a Reset button, and a live copy of the meter. The g comes from the car's own acceleration sensor: parked on level ground it reads 0.00, and a hill adds a little.

**Alerts:** oil, coolant and boost limits (a readout over its limit flashes red; oil 130°C and coolant 115°C by default, boost off), and a button that runs the shift lights up to the shift point for about 4 seconds while the car stands.

The last line of the Settings tab says what the HUD is doing, the drive mode it sees, and why anything is not drawn (for example "waiting: another app has this display").

**Boost:** read from the car's sport display signal. When the car does not send it, the app asks the engine computer directly (read only), the same way Car Vitals does.

## The visible window

The HUD is an 800x480 screen, but only part of it comes through the windshield. When you change the HUD height in iDrive, BMW shows corner brackets around the picture; measured on a photo of them on a 2020 X3 (Nov 2026), the visible window is **x 120, y 100, 560 x 280**, and every layout sits inside it. (A first measurement from a calibration grid photo, Nov 5, gave 485 x 278: the phone's angle cut off the right side.)

BMW keeps drawing its own HUD content over ours, bottom left: the speed and speed-limit sign in every mode, and in Sport also its segmented rev band above them. Every layout keeps **x 120..350, y 235..380** free for it.

**Window calibration:** a 50 px grid over the whole HUD with a frame where the visible window is assumed to be; photograph it while moving the HUD height so BMW's own adjustment frame shows the real edges.

**Calibration grid:** pick it as the layout to see lines every 50 px with labels on the glass. A photo of it shows exactly which part of the HUD is visible; take a new one if the HUD height or the seat changes a lot. The grid also carries a few test marks used to measure cluster-render's limits on the car.

## Requirements

[cluster-render](https://github.com/robertnisipeanu/idrive-apps), installed from the `robertnisipeanu/idrive-apps` Store source. Version 0.5.1 or newer lets the HUD show together with a cluster theme. Without it, the status row reads "HUD off: cluster-render is not installed or not running".

## On the car

Tested on a 2020 X3 M40i. It runs, the rpm is smooth at idle, the layouts are fitted to the window BMW's own height-adjust frame shows, and Redline and Warm-up were checked on the glass in Sport, next to BMW's own rev band. Still to be checked:

- the other layouts on the glass: nothing cut off on the right, nothing under BMW's speed or sign;
- a HUD layout and a cluster theme showing together (0.12.5);
- the clock with a named time zone, and the fuel % from the engine unit;
- how the colours look on the real glass, especially the M blues in sunlight.

See [Use at your own risk](../../README.md#use-at-your-own-risk) before installing.

Version history is in the repo's [CHANGELOG.md](../../CHANGELOG.md).
