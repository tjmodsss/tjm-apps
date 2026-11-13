# M Track Cluster (`adam_mtrack`) 0.1.7

An M Track style cover over the instrument cluster, drawn by the cluster-render service on its `panel` target
(1920 x 720): two bracket tachs from 0 to 7 (x1000 rpm, the B58's 7,000 rpm limit), the gear over a line over the speed
in mph, our shift-light slats above the gear, side panels you pick, fuel and oil corner gauges, range, clock and outside
temperature. Built for a 2024 X3 M40i (G01 LCI, iDrive 7, US units). **Off when installed.**

It covers the real speedometer, so it only shows while every guard holds, and drops at once when one fails.

**No OEM-exact claim.** The 2026-11-05 car photo that 0.1.4 and 0.1.5 were compared with is M Track 0.1.3's own cover
running on the car (iDrive-Apps KB-ANY-213), so those "matches BMW" measurements are void. The one real photo of BMW's
stock M display is from another car (iDrive-Apps `docs/reference/mtrack/stock-bmw-m-other-car.jpg`: 0-8 scale, km/h,
oblique and cropped); 0.1.7 is compared with it for structure only (iDrive-Apps `docs/emulator/mtrack-0.1.7/compare.md`).
Adam's own Cover Off photo of the stock Sport+ view is still the reference to get.

**0.1.7: the Codex-designed M display.** Adam saw a Codex design of the M display (ai-brain `codex-mdash-test/out/`)
and said it looks a lot better than ours; 0.1.7 ports it with his two corrections.
- *Tachs.* Codex's twin brackets: a dark track, a grey fill that fades from the revs line down, a deep red pointer with
  a bright line, a thin red zone at the top, a soft bloom on the outer edge, ticks every 500 rpm and numerals in
  Codex's own digit outlines. **The scale runs 0 to 7** (Adam: on his car the stock display stops at 7, not 8): Codex's
  9 spine anchors now span 0 to 7,000 rpm, so every numeral 0..7 sits on its tick and 7 is at the top. The red zone
  and red ticks start at 6,500 (the top 7 % of the scale); 0.1.5's amber dashes are gone. Shift Lights' slats and
  Look > Tach lead work as before (the lead moves the revs line along the same scale).
- *Fuel and oil gauges.* Not round any more (Adam: BMW's are bar-like with flat and angled ends): each is a faceted
  band of three straight legs with 3 px gaps at the bends, the high end cut flat, the low end cut at 45 deg, filled solid
  from the low end, no needle. The fill turns red under 12 % fuel or in the oil gauge's hot zone.
  Their labels keep 8 px clear of the band: each is pushed out by its own measured box (`geom.gaugeLabelOff`, Codex's
  labelOff), so the wide F labels (120, 210, 300) sit off the band instead of on it.
- *Centre.* Codex's gear (91 x 112) over the three-bar stack and a thin line with bright caps, over the speed; the unit
  in muted grey. **The M badge and the SPORT+ tag are gone**: neither Codex's design nor BMW's photo has them, the badge
  would collide with the gear at its new height, and they freed about 59 KB of the renderer budget. The slats moved up
  to y 190. DSC OFF, PARK and the stability warning are not drawn: the app has no signal for them and a drawn one would be
  a false warning over the real cluster (BMW's own telltales still draw over our layer).
- *Side panels and bottom row.* Codex's strips (a thin baseline, ticks and labels at the ends and middle, the reading
  over it, an indicator, a red end), Codex's tyre block and bottom row. US units throughout (mph, mi, psi, F); Metric
  still follows the Units setting.
- *Background.* Codex draws pure black; this cluster's LCD shows 0 as its lit backlight (KB-ANY-214), so the panel is a
  flat 16 and the tachs shader never outputs under 15 before brightness.
- Renderer memory 2.88 MiB (3,017,808 bytes counted; 0.1.6: 3,135,520). No settings change and no `reset`; the
  dead-man, the 40 ms rpm poll, Tach lead (default Off), the rpm log line and the M0 recovery are unchanged.
- Compared with the other-car stock photo: the same structure (mirrored brackets with a rising fill and pointer, gear
  over a line over the speed, the three-bar stack, the tyre block on the right, lower corner gauges, a dark field);
  different on purpose in the scale (7, not 8), the units, the gauge shapes (Adam's correction) and the missing
  telltales; no BMW font.

**0.1.6: the whole panel dark, the gear as a digit, Tach lead, the rpm log line.**
- *Full panel.* The car photo showed a lit lavender frame around the drawn dash: the art painted everything outside the
  dash silhouette pure black (0), and the cluster's LCD shows 0 as its lit backlight, not as black. The tachs layer
  already covered the whole 1920 x 720 opaque, so nothing was "uncovered" in the layer sense. The background now fills
  the whole panel with the dash's own dark gradient (no byte darker than 15), so the frame is gone and there is no
  seam where the silhouette was. No geometry, shader, layer, dead-man or recovery change. The tone holds at Brightness
  100; Brightness 20 or Night dim scales the whole panel down evenly towards the LCD's black.
- *Gear.* The engaged gear's digit replaces the letter in the big gear spot, the same size (Shift Lights' convention):
  P, R and N stay letters, D with a gear number (drive or manual: the car's selector enums have no M or S, so manual
  stays D with its gear) shows that number, D with no gear number shows D. No M prefix, no small digit, no guessing
  from rpm and speed. Both car fields are in app.json already (`statusGearboxDrive`, `DataPowerTrain2`); the app logs
  the first 12 distinct raw `gearbox:` values (and the kit `gear selection:`) for the car-day check.
- *RPM.* The app adds no smoothing; the lag is the car's update rate. The rpm getter is polled every 40 ms while the
  cover shows (was 50); the side boxes redraw one per 100 ms tick, round robin (one box is ~7 ms of drawing under
  Node 8), so an rpm sample is never held behind two. **Look > Tach lead** (Off, 20 to 80 ms; default Off) runs the bar
  and the slats ahead of the rpm by its recent slope (Shift Lights' lead, capped at 300 rpm). Its default is Off
  because in simulation every lead overshot a throttle blip's peak by the full 300 rpm (iDrive-Apps
  docs/emulator/mtrack-0.1.6/lead-sim.md); try it on the car. Every 30 s the log has
  `rpm notified/s ... (gap p50/p90), rpm poll .../s (rtt p50, fails), sample->send max, box draw max, socket blocked k of
  m pump ticks, tach lead`.

**0.1.5: the art redrawn after a car photo** (which turned out to be 0.1.3's own cover, above). The rpm fill became a
solid orange-red block at the revs with a crimson-to-pink glow under a 6 px grid; the shift markers pale yellow; the
band flat and lighter with a bright white inner edge; the side gauges' tracks, ticks and labels bright white; new
coolant and oil icons; SPORT+ and mph near-white; thicker glowing corner arcs and a cyan cold end on the oil gauge. The
art's text (mph, the drive-mode tags) is drawn from a committed Liberation Sans (SIL OFL 1.1), so the art no longer
depends on the build machine. No change to the dead-man, the recovery or settings.

**0.1.4: the panel already fills; coolant over oil on the left.** On Adam's car (2026-11-05) Test 1 KNOWN drew. The two round
dials in that photo are M Track's own (the KNOWN shader's), not BMW's: the layer is one 1920 x 720 effect that the car
maps 1:1 onto the whole visible panel (dial centres within about 20 px of the code's), and the cover's tachs layer is
the same full rect, so there is nothing larger to scale to; only the sensor housing at the top centre and the rounded
top corners hide pixels. Step 1 now adds a 2 px frame and an edge ruler (ticks every 40 px, long every 200 px) so the
next photo shows exactly where the glass clips the panel, and its card says the dials are ours. The left side now
defaults to coolant (160/210/270 F) over oil (120/210/300 F) instead of tyre data (Adam's pick from the car photo); both settings
carry `"reset": 1`, so a car that saved tyres from 0.1.3 moves to coolant over oil once, and later choices are kept. A refused
test step now says "parked only (in P or barely moving)" with no speed unit, so a US car no longer sees km/h.

**0.1.3: why 0.1.1 drew nothing, and the rebuild.** On Adam's car G's Dash's "Full-screen cluster test"
(nickgcode/idrive7-apps, MIT) draws over the whole cluster, while M Track's cover drew nothing and only moved BMW's gear
letter. The one code difference that explains both: every one of the old cover's 8 layers multiplied its alpha by
`u_alive`, whose own value was **0**, lifted to 1 only by a renderer animation re-sent every 250 ms under the same number
(cluster-render's `play()` first runs `stop()`, which puts the client's 0 back, then starts a new animation stamped with
the head unit's clock that the KOMBI plays on its own). A KOMBI that does not play that animation in step draws every
layer at alpha 0 while still showing the scene (so it re-lays out its cluster: the gear letter moved). G's Dash keeps
its value at **1** while shown. 0.1.3 does the same, and rebuilds the cover the way G's Dash draws (details in
"How it draws"): 4 layers instead of 8, 2.9 MiB of the renderer's 16 MiB instead of 8.2, built one stage at a time and
each confirmed by the renderer before the next. Safety > Test pattern step 2 (BAR) proves the cause on the car: its blue
bar is exactly 0.1.1's dead-man.

## Settings (on the centre screen)

| Page | What |
|---|---|
| Home | **Cover the cluster** On/Off (default Off); **When to show**: Sport+ only (default), Sport and above (Sport, Sport individual, Sport+), Always; "Why the cover is off right now: ..." and the signals it reads (speed, drive mode, BMW popups) |
| Panels | Left panel, left lower half, right panel, right lower half (from the 22-widget catalogue: a whole widget takes both halves), Swap sides. Defaults (0.1.4): Coolant over Oil left, Torque over Power right. Widgets with no signal on the car are skipped and say "No signal on this car" |
| Look | Units: US (mph, psi, F, lb-ft, hp, mi, mpg), Metric, Follow car; Brightness; Night dim; Shift lights in the cover; Tach lead (0.1.6: Off, 20 to 80 ms, default Off) |
| Safety | **BMW popups**: Use if sent (default), Require, Ignore; **Drop the cover if the drive-mode signal is missing** (default Off); **Speed timeout** 0.5 to 3 s (default 1 s, the guard itself is always on); **Test pattern (parked)**: steps 1 to 6 and STOP (below); why the cover is off right now (or which build stage it is at, or where it stopped and why); every signal the guards read (present / missing / stale) and what cluster-render says (the panel's and the HUD's state, the last error event); every always-on guard with its state and why it has no switch, the cover's build stage, and the last release check (or, after a test step, what the renderer said) |
| About | Version, what is unproven on the car, the widgets not in this version, how to remove it safely, Shift Lights |

Settings apply live and are saved; a bad saved value falls back to its default (logged once), and a bad Safety value
to its strict side (BMW popups: Require; drop if no drive mode: On; speed timeout: 1 s). The pages are drawn only when
something changes (a setting, the reason the cover is off, a signal's status): no timers, no preview.

Widgets in 0.1.0: Tyre data, G-meter, Trip data, Drive-mode column, Coolant, Boost, Torque, Power, Consumption (average),
Oil temperature, Fuel level, Range, 0-60 mph timer, Warm-up, Empty. Not in 0.1.0 (no car signal for apps): Entertainment,
Intake air, Oil pressure, Gearbox oil, xDrive split, Battery voltage, Dyno peak, Service due.

## Safety

The cover shows only when every guard has held for 1 s (`logic.decide`); any one failing drops every layer (`drop`,
not hidden) within one 100 ms tick. Home and the Safety tab say which guard holds it off and its signal's status
("Why the cover is off right now: Speed timeout: speed signal stale (none for 1 s)"); the log has the same line
(`why off: ...`, once a reason per 10 s) and the popup signal's state (`BMW popup signal (CheckControlMaster): ...`).

| Guard (reason) | Protects | Switch |
|---|---|---|
| Cover the cluster (`off`) | the master switch | Home |
| Kill switch (`kill`): a file named `DISABLE` in the app's data folder; a failed check counts as found | an off switch that needs no screen | none |
| Error guard (`error`, `tripped`): any error drops it for 1 s; 5 in 10 s disarm it until Cover the cluster goes off and on | a broken app over the speedometer | none |
| Live data only (`demo`) | invented numbers over the real gauges | none |
| Art check (`noart`): art missing or damaged, never arms | a half-drawn cover | none |
| Cluster renderer (`renderer`), another app (`busy`): Shift Lights' HUD or cluster (any other client) wants the panel or the HUD, which share one scene; BMW's panel (`held`): BMW's popup or speech dialog holds slot 0x203, then the cover waits 10 s before asking again | the renderer's own arbitration; no map / unmap churn | none |
| **BMW popups** (`nocc`, `ccwait`, `cc`): CheckControlMaster `basicList` (an active message) and KombiInterface_2 `newCCMessage` (a new one, 1 s) | BMW warnings stay visible | Safety: Use if sent / Require / Ignore |
| **Speed timeout** (`nospeed`): a valid `Vehicle2.statusCarSpeed2` (not 65535) within the timeout, notified or polled every 250 ms; a speed stamped in the future (a clock jump) counts as stale | a frozen speed over the real speedometer | always on; only the time, 0.5 to 3 s |
| **Drop if no drive mode** (`nomode`) | no cover while the drive mode is unknown | Safety: On / Off (default Off) |
| When to show (`mode`): FES `statusFESVehicleDynamicSwitchHMI`, Shift Lights' decoding | the owner's choice of modes | Home |
| Show delay 1 s, clock-jump guard (a backward jump restarts the delay and the heartbeat, a future speed is stale) | flicker; an old speed kept alive | none |
| Heartbeat (dead-man), exit and crash cleanup | a hung or dead app's cover | none |
| Staged build (0.1.3): each layer made hidden, confirmed by the renderer's status, written, before the next; a refusal, the renderer's pixel memory full, or a stage not done in 10 s stops it (an error: the stage and why on Home and Safety) | a half-built cover; the 0.1.1 blind spot | none |
| Hand-over (0.1.3): 3.5 s after another app's HUD lets go of the shared scene id before asking for the panel | the KOMBI's "mapped and never drawn" scene swap | none |

There is no engine-running guard (the cover can show with the engine off when the speed is fresh), so none was added.

**BMW popups.** *Use if sent* (default): when the car sends the Check Control signal, a popup drops the cover; a car
that never answers it does not block (the signal is "missing", not "present and idle": an empty list that arrived,
or a provider that answered, is present). For the first 10 s after start, before its watch has settled, the signal is
"waiting" and the cover waits for it. *Require* is 0.1.0's rule: no popup signal, no cover. *Ignore* is risky: a BMW
warning can be hidden under the cover (whether popups draw above it is unknown until the car); BMW holding the panel
still drops it. **0.1.0 blocked here on Adam's car**: CheckControlMaster never answered (parked, diagnostic mode),
and `requireCheckControl: true` (a config switch, no setting) kept the cover off for good.

Any error inside a callback drops it at once; five errors in 10 s stop it until Cover the cluster is turned off and
on. Turning the cover off disarms in the settings callback itself and closes the connection.

**Dead-man switch (0.1.3, G's Dash's recipe).** Every layer's shader multiplies its output by `u_alive`. While shown its
own value is **1**, and every 60 ms the app starts a **new** renderer animation that holds it at 1 for 200 ms and fades it
to 0 in 40 ms, then stops the previous one (never a moment with none). If the app hangs and the KOMBI plays renderer
animations, the cover fades by itself about 0.24 s after the last re-arm. If the KOMBI does not play them (Test pattern
step 2: the blue bar missing), a hung app's cover stays as it was until the app resumes or ends: then only the exit and
crash cleanup protect (a crash or exit closes the connection and the service drops its layers at once). 0.1.1 had 0 as
its own value, which on such a KOMBI drew nothing at all. If the service itself dies, the KOMBI drops the content within
about 10 s.

**Kill switches**, fastest first: Home > Cover the cluster Off; a file named `DISABLE` in the app's data folder (its path
is the first log line); Store > M Track Cluster > Remove. Never kill or restart the app or MainApp by hand: three
crashes in about 30 s wipe every app. No saved setting can switch an always-on guard off: the speed timeout is held to
0.5 to 3 s in the decision itself, and the kill file name, the error limit and the heartbeat live in `config.js` only.

## With Shift Lights

The `hud` and `panel` targets share one scene id (0x01000400) and are never up at once (cluster-render.conf). Since
0.1.2 the cover refuses to start while any other app wants the HUD or the panel, and Home and Safety say "Another app
is using the cluster: turn off Shift Lights cluster/HUD" (Safety names the app from the renderer's status). Turn
Shift Lights' HUD and cluster off to use the cover. 0.1.1 read that state as "BMW holds the cluster panel". 0.1.3 also
waits 3.5 s after the HUD lets go before it asks for the panel (G's Dash's `HANDOVER_MS`, past the 3 s linger).

## Cleanup and what cluster-render said (0.1.2)

- **Every release is checked.** A guard drop keeps the connection: the panel must report idle again (after the
  service's 3 s linger) and the renderer's status must list none of our layers, else `release NOT confirmed (...)` is
  logged with whoever still holds the panel. Cover off, the kill file and the error trip close the connection at once
  (the service drops a client's layers with it) and a watcher client, which never makes a layer or asset, checks the
  same. The Safety page shows the last verdict.
- **The renderer's replies are surfaced:** target events (state, holder, reason, rendering) for the panel and the HUD,
  layer states, error events and the upload cap, on Safety and in the log; the status text when it matters.
- **Diagnostic log** `mtrack-diag.log` in the app's data folder (its path is logged at start; 256 KB, then `.1`):
  every op sent (shaders as their length, asset bytes; uniforms, dead-man re-arms and stops counted every 10 s), every
  build stage (made hidden, confirmed and written, stopped and why), every event that came back, the status texts (a
  repeated one counted), each test step and release check.
- **Collect the evidence** from the car, read-only, with the repo's `tools/car-logs.sh` (its comments say how).

## Test pattern (Safety page, parked)

Each step draws on its own cluster-render client (`adam_mtrack-test`), only with the cover off and the car parked (in
P or under 3 km/h; it stops at once if the car moves), refuses while another app holds the cluster scene, shows for
10 s once drawn and removes itself; the page shows what cluster-render said (for a built step, the stage it reached
and, if it stopped, why) and then the release check. Run them in order and note what each one shows:

| Step | Draws | Proves |
|---|---|---|
| 1 KNOWN | G's Dash's full-screen cluster test shape in M Track's own code: one effect layer over the whole panel (content z 90, never exclusive), one r8 1024 x 576 bilinear asset (1.1 MiB), made hidden, confirmed, lifted, written, shown with the dead-man held at 1: two dials with live needles (ours, not BMW's), a "KNOWN-GOOD TEST" card and (0.1.4) a 2 px frame with an edge ruler on the panel's exact edges | our client and G's call sequence draw on this car (G's Dash's own test did; ours did on 2026-11-05); where the glass clips the panel |
| 2 BAR | three 240 x 44 bars, no asset: **amber** u_alive 1, no animation; **green** 0.1.3's dead-man; **blue** exactly 0.1.1's (own value 0, the same animation number sent again every 250 ms) | the panel path; whether the KOMBI plays renderer animations (blue missing = the 0.1.1 cause, and no hang fade on this car) |
| 3 TINT | a translucent blue over the whole 1920 x 720 panel | a whole-panel layer |
| 4 IMAGE | a 256 x 128 test card as an image layer (left, blue) and as an asset sampled by an effect (right, orange), 131 KB each | uploads |
| 5 TACHS | the cover's stage 1 (its opaque tachs layer, 5 assets, 1.6 MiB), built as the cover builds it | the big shader and its art |
| 6 COVER | the whole cover, 4 stages (4 layers, 11 assets, 3.0 MiB), each confirmed before the next | everything |

## How it draws (0.1.3, art 0.1.7)

The static art (0.1.7: Codex's design, ai-brain `codex-mdash-test/out/HANDOFF.md`) is drawn in headless Chromium
(`tools/mtrack-art/`, re-run gives the same bytes) into `art/art.json` (v2), placed by `geom.js` (the tach scale 0-7,
the faceted gauges). Four effect layers on `panel`, content class z 90 to 93, never exclusive, never contending (G's
Dash's), one a stage (`stages.js`):

| Stage | Layer | Assets (as cluster-render counts them, twice) |
|---|---|---|
| 1 TACHS | the whole panel, opaque: the background (its right half at half resolution, mirrored); inside the tach's shape the track, the red zone, the fill from the revs down and the red pointer (in the shader, no glow); the edges and ticks (the right tach's, as coverage + palette index, mirrored for the left); the numerals 0..7 from the glyph atlas | bgR2, overR, its palette, band, atlas: 1.5 MiB |
| 2 PANELS | both side panels and both corners (drawn in software, sent as coverage + palette index, only the changed rows, at most twice a second) | 4 boxes, palette: 1.37 MiB |
| 3 CENTRE | gear (letter or digit), speed, unit, the stack, line and caps (0.1.7: no badge, no tag) | the atlas only (shared) |
| 4 SLATS | the shift-light slats (Shift Lights' shader), only with "Shift lights in the cover" on | none |

The build follows G's Dash's call sequence: nothing before the first status answer; each stage's assets (checked against
the renderer's pixel memory first), its layer made hidden, confirmed by a status asked after it (no error for it),
lifted clear (u_alive 0, visible: the renderer then asks for the panel and writes the art), bound once the status says
every asset is written, then the next stage; shown once all are, with u_alive 1 and the dead-man, the opaque tachs last
(dropped first). Assets go once per arm; a drop and a re-show build the layers again without re-sending art.

## The emulator

Yes, the cluster can be emulated. On the Mac (or claudius-vm), from this repo:

    bash test/adam_mtrack/view.sh        # then open http://localhost:8090 ; Ctrl-C stops everything

It runs the idrive7-apps emulator (centre screen, embedded in the page) with M Track talking to a stand-in
cluster-render service, and draws the panel from the app's real messages in the browser's WebGL, with buttons for
idle, a pull to 7,000, the drive modes, a speed loss, a Check Control popup, BMW holding the panel, the kill file and
the BMW popups choice, and the app's own "why off" line under the panel. `NO_POPUPS=1 bash test/adam_mtrack/view.sh`
plays a car that sends no Check Control signal (Adam's G01 in the 0.1.0 test).
`EMU_DIR` points at an idrive7-apps clone (default `~/Documents/Projects/idrive7-apps-upstream`).
The scripted sweep (`test/adam_mtrack/emu-run.sh`, on claudius-vm) runs every guard (first with no popup signal at
all: Use if sent shows, Require keeps it off and says why), the hang and the crash, and saves PNGs (every settings tab,
the Safety tab with a guard holding the cover off) and the pull clip; it also draws the cover as a renderer that plays
no animation would, where it must still draw. `CR_ANIMS=off bash test/adam_mtrack/view.sh` shows the live view that way.
`test/adam_mtrack/shader_check.mjs` compiles every shader under WebGL1 and probes pixels.

**The emulator proves:** the app's logic and every guard with its timing (mode, speed loss, popup, BMW take-over, kill
file, error, hang, crash); the exact message stream (layers, assets, uniforms, animations); the shaders compiling and
drawing in GLSL ES 1.00; the art and geometry at 1920 x 720; the settings pages. `SCRIPT=emu_ladder.mjs
test/adam_mtrack/emu-run.sh` runs the test pattern (each step drawn, removed after 10 s, released; refusals).
**Only the car proves:** that a G01 shows the `panel` scene at all, and in Sport+; that its opaque pixels hide the OEM
gauges; whether Check Control popups draw above or below; the KOMBI GPU's shader compile and frame rate; the renderer's
clock for the dead-man; pixel mapping, brightness, latency; the real signal values (drive modes, speed getter, boost
scale, range unit) and the speed factor against the OEM speedometer; coexistence with Shift Lights' HUD.
cluster-render's own unit emulator needs the head unit's root filesystem, so it is not used here.

## On the car (0.1.1, 2026-11-04; G's Dash 2026-11-05) and what is untested

2026-11-05: G's Dash's full-screen cluster test draws over the whole cluster on Adam's car, so the panel path works;
M Track 0.1.1 drew nothing even with Shift Lights off. 0.1.3's top section names the cause and the fix; the older
ranking below is kept as it was written.


0.1.1 on Adam's car, parked, When to show Always: the cover never appeared, and BMW's gear letter moved to the bottom
of the cluster and stayed there after Cover the cluster went off. Ranked causes, from the code: (1) Shift Lights'
HUD (it autostarts) holding the scene id the panel shares, so the panel is never even asked for, which 0.1.1 showed
as "BMW holds the cluster panel"; (2) the dead-man keeping every pixel transparent if the KOMBI's renderer clock
differs from the head unit's (Shift Lights' slats, which have no dead-man, do show on this car's panel; step 1's blue
bar tests it); (3) the shared scene id handed over from the HUD (the service's README: such a scene was once
"reported mapped and never drawn"); (4) the 4.3 MB upload; (5) a shader the KOMBI's GPU refuses. The gear letter
moving is the KOMBI laying out its own cluster for content 0x01000400 (also BMW's speech dialog), in the panel's slot
or the HUD's [unproven]. M Track's own cover-off path drops every layer and closes at once. 0.1.1's log tells (1)
from (2): `cluster-render: target panel waiting` vs `shown`.

Untested: the panel on a G01, the speed factor (`config.speedFactor` 1.0: the OEM speedometer usually over-reads), popups above or
below, the KOMBI shader compile and GPU, the renderer clock for the dead-man, the speed getter poll, FES values, the boost
scale, the range unit, the clock time zone, and which signals the car sends at all (in 0.1.0 CheckControlMaster never
answered, parked in diagnostic mode; the Safety tab lists each one as present, missing or stale). First car test: parked,
engine on, cover on, Sport+ only (or Always if the car sends no drive mode parked); read the Safety tab; check it appears
only when allowed and drops when leaving it. Never drive with it until the drops are proven parked, and never drive with
BMW popups on Ignore.

## Files

`main.js` wiring; `logic.js` decisions (pure); `geom.js` geometry; `stages.js` the cover's and the KNOWN step's layers,
assets and uniforms, the coverage + palette encoder, the memory count; `output.js` the cluster-render side (the staged
build, the dead-man); `renderer.js` what cluster-render says (status text, uploads, pixel memory, whose the scene is,
release checks, the diag tap); `ladder.js` the test pattern;
`diaglog.js` mtrack-diag.log; `shader.js`;
`widgets.js` the live boxes; `pages.js` / `ui.js` the settings pages; `units.js`, `settings_check.js`, `safety.js`, `poll.js`
(copies from the sibling apps, extended); `catalogue.js`; `config.js` every tunable; `emufeed.js` emulator only (loaded only
when `MTRACK_EMU_FEED` is set, never on a car); `cluster_render_client.js` the pinned MPL client (see NOTICE).
Tests: `test/adam_mtrack/` (`node test/run.js`).
