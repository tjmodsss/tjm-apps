'use strict';
/**
 * The drawing engine, shared by every bimmer-lab app that draws through cluster-render
 * (robertnisipeanu/idrive-apps, native/cluster-render): it connects, builds the active layout's layers in
 * the active theme (one effect layer per shader widget, the image widgets packed into sheets, below), and
 * keeps live widgets updated from the kit's car.js.
 * Started by an app's main.js with the kit's ctx (settings, signals, log, spec, dataDir).
 * It lives in the repo's shared/ folder; app.json "shared" ships it with each app.
 *
 * Which display: app.json config.target, "hud" (800x480, the windshield HUD; the default) or
 * "panel" (1920x720, the whole instrument cluster, drawn over BMW's own gauges).
 * config.statusName names it on the status row ("HUD", "Cluster").
 * Which layout: with the "byMode" setting on and the car's drive mode known (FES
 * statusFESVehicleDynamicSwitchHMI), the "inComfort" / "inSport" / "inEco" setting; otherwise "hudLayout".
 * The layout name "off" draws nothing, so BMW's own HUD or cluster shows (and the other app can have the
 * shared scene: cluster-render never shows the HUD and the cluster panel at once). The two apps tell each other
 * what they show (screen.js): when the driver gives the screen to the other one (page.js asks first), this one
 * draws nothing until a theme or layout is picked on its own page again.
 * The colour theme is the layout's own "theme" when it has one (the cluster themes), else the "hudTheme"
 * setting (auto = Night after sunset).
 *
 * Effect shaders: cluster-render's v_uv has (0,0) at the TOP-left (PROTOCOL.md; confirmed on the car,
 * Nov 4 2026, when a box's header strip drew at the bottom). The bench draws the same way.
 *
 * Layer packing (Nov 5 2026): cluster-render draws at most 8 layers per client connection (its
 * CompositorLimits.per_client; 32 across all clients; a 9th is refused with "too many layers"), which the car
 * photos showed as a theme's shaders plus the first few text widgets. So the image widgets (text, scale, stripe, gridlabels, icon, swatchimg) are
 * packed into SHEETS, one image layer per sheet, instead of one layer each. Widgets are grouped by
 * (class, z) and placed in file order: a widget goes into the first sheet of its group opened after every
 * earlier layer or widget its rect intersects (so an image widget never clobbers one it overlaps, and
 * file order still decides what is on top) AND whose union box with it stays within the sheet size limit,
 * else a new sheet is opened. A sheet's rect is the union box of its members (iw/ih that size). On create
 * every member is painted into a local buffer and the sheet is sent whole once (a 1920x720 RGBA whole write
 * is 5,529,600 bytes, under the 5,529,664 message limit; the client keeps its own whole copy); after that
 * every member update is a dirty rect of the sheet, translated by the sheet's offset (_blit; gridlabels
 * keeps its small-rects path). Effect widgets are one layer each, as before. An image widget with
 * "own": true gets its own layer as before (the calibration probes use it to count how many layers the car
 * draws).
 * Sheet size vs layer count: a rebuild re-sends every sheet whole, through the car's upload budget (floor
 * 2000 KB/s, ceiling 5500, the HUD gets at most half), so sheets are kept small: the limit starts at a
 * quarter of the target area (345,600 px on the panel, 96,000 on the HUD). If that needs more than
 * LAYER_BUDGET (8) layers in all (effects + own + sheets), the limit is doubled and the layout re-planned,
 * up to unlimited; if even unlimited needs more than 8, a warning says so and the layout is drawn anyway.
 * The rebuild log line names the layout, widget and layer counts, the limit used and the bytes of the
 * whole-sheet writes; the status row names the layer count, not the widget count; and two seconds after a
 * rebuild cluster-render's own status text is asked for and logged.
 *
 * Widget types (hud/layouts/*.json, or <data>/layouts/ overrides, see layouts.js):
 *   text      image layer; template tokens below, a font from hud/fonts, colour role
 *   scale     image layer; the shift bar's rpm numbers (0 .. bar max / 1000), evenly spread
 *   stripe    image layer; the M tricolour stripe
 *   shiftbar  effect layer; shaders.js shiftbar, lit by rpm, zones from the redline
 *   arc       effect layer; shaders.js arc, lit by a signal between min and max
 *   revbar    effect layer; shaders.js revbar, the G20-style slanted rev bar (Redline layout):
 *             "barH" bar height, "top" room for the marks above it, "slant" px, "over" rpm past the
 *             redline's thousand the scale runs to (1000: a 7000 redline gives 0..8)
 *   lights    effect layer; shaders.js lights, shift lights filling from "from" rpm (3000) up to the shift point
 *   fill      effect layer; a solid colour (role "color", default "bg") over the whole widget, with an
 *             optional see-through "hole": [x, y, w, h] in target px, cut only while the bool setting
 *             "holeWhen" is on (true: always; the cluster's map window), shrunk by "holeInset" px on every side (6) with
 *             "holeRadius" px corners (28), so BMW's own cluster doesn't peek out at the window's corners.
 *             Opaque fill hides BMW's gauges under it.
 *   box       effect layer; a framed box: "fill" and "line" roles, "border" px, "radius" px, and a
 *             header strip "head" px tall in role "headColor" (its label is a text widget on top)
 *   mdash     effect layer; the M theme's whole backdrop (shaders.js mdash): "card" [x, yBottom, rBottom, rTop] (the
 *             left card, traced off the M8 photo: outer edge x, bottom y, the big round at the bottom outer corner, the
 *             rounding where the top curve meets the outer edge; the right card is its mirror), "cardTop" [a, b, c] (the
 *             card's top edge, y = a x^2 + b x + c), "cardCutR" [cx, cy, r] (the right card's lower outer corner cut on
 *             that circle, in the mirrored left frame), "cardFill" 0..1 (grey level, 0 = black: outline only), "blade" { xm, ym,
 *             kTop, kBot, round } (the left rev blade's outer edge, as mtach; the card ends "bladeGap" px before it),
 *             "line" [x0, y, x1, cap], "tyres" [cx, cy, scale] (the tyre block's car glyph and dividers; the eight
 *             readouts are text widgets with {{tyreP:FL}} .. {{tyreT:RR}} and {{u:pressure}}), "gaugeL" / "gaugeR" { cx, cy, r, (a dial as the M8's: a thin glass bracket whose outer edge is the circle cx, cy, r, lit from the bottom up to the value, drawn over the card; the right one is the left one's mirror)
 *             signal, min, max }, "mark" [x, y, scale], "segbars" [{ x, y, w, h, max, signal } x up to 4] (the
 *             setup level bars, "segSlant" px; the segment at round(signal) is red). Positions in target px.
 *   mtach     effect layer; the M rev bar: "side" left|right, "max" rpm, and in target px for the LEFT bar
 *             "y0" (0 rpm), "y8" (max), "ym" (the bend), "xm" (outer edge x at the bend; the right bar gives
 *             its own, mirrored), "kTop" / "kBot" (x per y px above / below the bend), "round", "wBot" / "wTop" / "wBend"
 *   sdash     effect layer; the whole Sport theme (shaders.js sdash): "geo" [yTop, yBend, yBottom, xBend] and
 *             "k" [above, below, round] for the left bracket's outer line (the right one is mirrored), "band"
 *             width, "inner" (the inner line's distance from the outer one), "scale" [y of 0, y of the top mark],
 *             "ticks" [speed, rpm], "rpmMax" (speed follows SPEED_SCALE), "fuelSeg" / "oilSeg" [fullX, fullY,
 *             emptyX, emptyY], "strip" [left end x, y, h, slant], "topEnd" x; the middle is black, and the map
 *             window is cut see-through while "holeWhen" is on ("hole", "holeInset", "holeRadius" as fill)
 *   segbar    effect layer; "max" segments, the first round(signal) lit (e.g. "setupLevel:engine"), "slant" px
 *   icon      image layer; a line icon from icons.js ("icon": gauge, shock, wheel, cog, stack, therm, oilcan, fuel)
 *   arc also takes "start" and "sweep" in degrees (clockwise from 12 o'clock; negative = anticlockwise)
 *   grid      calibration: effect layer of lines every "step" px (brighter every "major" steps)
 *   gridlabels  calibration: image layer, "x/y" at every "step" px (only the labels are uploaded)
 *   swatch    calibration: effect layer (calibration.js SWATCH), "steps" (11) grey steps 0..1 over the top
 *             half, four dark test colours over the bottom half
 *   swatchimg calibration: image layer, the identical picture painted into pixels (calibration.js
 *             swatchImage), so a photo of the two strips shows how the effect and image paths differ
 *   atext     effect layer (shaders.js atext): text drawn by the GPU from a glyph atlas, the probe for the path
 *             that needs no pixel writes. The font's glyphs go up once per connection as an R8 asset (one byte a
 *             pixel, not a layer, shared by every atext widget on that font); the widget is "cells" equal cells
 *             across its width ("w" / cells wide each; the glyphs keep their shape when w = cells x the font's
 *             widest advance and h = its cell height, logged at creation), and a new value is one uniform
 *             message of glyph codes. "text" tokens as text, "font", "color" role, "align" left | right | center.
 *             Up to 32 cells; only the characters the font has.
 *   dial      effect layer (shaders.js dial): a classic round gauge, the Roadster's: "measure" speed | rpm | signal ("signal",
 *             "max", "ticks"); speed reads 0..160 mph / 0..240 km/h (DIAL_SPEED, labels {{dial:speed:<i>}}), rpm 0.."max"
 *             (8000) with the red band from the redline (_redMarks) and the ring in the shift red at the shift point;
 *             "start" / "sweep" degrees (225 / 270), "minor" ticks per step (4), "ringW" px (14), roles "ring" (line)
 *             fading to "ring2" (dim), "tick" (fg), "needle" (hot), "face" (bg). The numbers are text widgets.
 *   meter     effect layer (shaders.js meter): a segmented bar, "signal" between "min" and "max" (raw units: km/h, C,
 *             bar, rpm), "segments" (20), "gap" px (4), "vertical": true fills upward; "colors" [3 roles] lit below
 *             "at"[0] / up to "at"[1] / past it (fractions of the bar), "trackColor" (track); "peak": ms (true = 3 s)
 *             holds the highest segment lit in "peakColor" (fg). arc takes "peak" too: a dot on the stroke.
 *   gmeter    effect layer (shaders.js gmeter): a G-meter: a bezel, rings every 0.25 g (0.5 g past 1.2 g) out to the
 *             setting "gRange" (1.2 g; the layout's "max" only when the setting is missing), the grip envelope (the
 *             furthest g this drive in 48 directions, role "envColor", fg), a trail of the last "gTrail" seconds (2;
 *             0 = none) and the dot: role "dot" (fg) under 0.5 g, amber to 0.8 g, the shift red past it; roles "line"
 *             (dim), "lineAlpha" 0-255 (150; 255 on the HUD, where see-through is faint). The dot moves the way the
 *             car accelerates (into the turn, up when speeding up), as cauliflowermossgrape's G-Force draws it; the
 *             settings "gFlipLat" (the car's left / right the other way round) / "gFlipLong" (brake on top) swap the
 *             drawing, a layout's "flipX" / "flipY" swap again. g is averaged over 150 ms and a sample over 3 g is
 *             dropped (also for the tokens). The envelope and the bests (tokens, the page's G-meter tab) last until
 *             resetG(), the app's restart or the switch between demo and car data.
 *   revarc    effect layer (shaders.js revarc): a segmented rev arc, the Rally theme's: centre "center" [x, y] (layer px, may
 *             sit below the layer), outer radius "r", "band" px (40), "start" / "sweep" degrees clockwise from 12 o'clock,
 *             "segments" (30); colours, flash and scale as the shiftbar.
 *   tiles     effect layer (shaders.js tiles): the Dyno theme's readout tiles in ONE layer: the background (role "color",
 *             bg) and up to 14 rounded tiles "tiles": [{ id, x, y, w, h (target px), slot, bar (false: none), toggle }],
 *             each with a thin "accent" strip on top and a bar along the bottom for its slot's sensor (TILE_BAR; zoned
 *             ones run "colors" [bar1, bar2, hot] split at "at" [0.6, 0.85], the rest all bar1). A tile turns role
 *             "warn" while its oil / coolant / boost reading is over the warning limit (put "warnFlash": false on
 *             its texts). Roles "fill" (panel), "line", "trackColor" (track); "radius" (8), "border" (1.5), "strip"
 *             (3), "barH" (6) px. The labels and values are text widgets on top.
 * Any image widget: "own": true gives it its own image layer instead of a place in a packed sheet (above).
 * A text widget: "gpu": true (0.7.14, _gpuTexts) draws it with the atext shader instead of pixels, pixel for pixel the
 * same: a new value is one uniform message, no image upload (6WB Sport's and F30 basic's big speed). It becomes one
 * effect layer, or two when centred with an odd figure advance (6WB Sport), and a small atlas; "maxLen" (what fits) is
 * the longest value shown. Plain readouts only (one colour; no fit, glow, slot or colour rules), else it stays pixels.
 * Any widget: "conn": 0..3 puts its layer (or its sheet) on that connection to cluster-render. The 8-layer limit
 *   is per connection, so a second socket from the same app gets another 8 (DukeAPenguin saw 28 layers over four
 *   sockets on his car, Nov 5 2026; the calibration grids probe it here: L5..L16 on connections 2..4). 0 (the
 *   default) is the app's own connection; a layout never asks for more than it needs, each extra one is opened
 *   on first use and named <app id>_<n>. Sheets never span connections.
 * Pixel memory: cluster-render has 16 MiB for every app's images together and counts each image twice
 *   (Compositor::add_image; a layer past it is refused with "the service's pixel memory is full"), so every
 *   image layer costs w*h*8 bytes. The rebuild log and the status row say what a layout costs.
 * Text updates send only the one rectangle around the pixels that changed since the last paint
 *   (changes() below, after PenguinDukeYDAuto/idrive7-EVAHUD's eva_canvas.js, MIT): a 3-digit readout
 *   that goes 123 -> 124 sends its last digit, not the widget.
 *   boxes     effect layer; the GT3 dash's frame in ONE layer (shaders.js boxes; the car draws only a few effect
 *             layers): the background (role "color", default "bg") with the optional map "hole" as fill, and up to
 *             12 framed boxes "boxes": [{ id, x, y, w, h (target px), head (header strip px), border (2), radius
 *             (0), headColor "accent" (else the "head" role), toggle }]. Roles "fill" (panel), "line", "head",
 *             "accent" for all of them; the labels are text widgets on top. Sent as array uniforms (vec4 x 12).
 * Any widget: "toggle": "<bool setting>" hides it when that setting is off, "!<setting>" when it is on,
 * "<choice setting>=<value>" shows it only while that choice is picked (also with "!");
 * "own:range" / "own:clock" / "own:temp" / "own:nav" / "own:sign" / "own:info" while that item of BMW's bottom row is
 * ours: the one "bottomRow" setting ("allG20" BMW draws the row, "all6WB" we do), which only means anything while a
 * see-through layout shows - in the opaque themes our background covers BMW's row, so the row is ours there (_own;
 * it replaced the seven own* settings of package F, 2026-11-15, docs/ONE-SWITCH-DONE.md);
 * "cc:none" only while the car says no check-control message shows (car3 G:
 * this.ccShown === false; off while that is unknown), "cc:shown" only while it says one does, "cc:open" while BMW's
 * own message panel must be left see-through (_ccOpen: "cc:shown", or a car whose messages we cannot read at all);
 * token {{ambient1}}: the outside temperature as BMW shows it, "+3.5" (°C, 0.5 steps);
 * car3 H: "a&b" (any of the above, joined by "&") while every part is on;
 * "mapUp" (toggle or holeWhen) is not a saved setting: on while the Waze map shows inside the theme (waze.js; the
 * "mapInTheme" setting); the map is a content z 0 layer, so a frame meant to sit over it is content z 1 or more.
 * "themes": [...] shows it only in those themes. Text "color2": a second role, the colour at the bottom
 * of the box (a top-to-bottom gradient, the chrome look). Text: "hotWhen": "now" turns it the shift red
 * at the shift point; "coldWhen": "cold" turns it blue while the cold guard lowers the shift point.
 * scale: "over" as revbar; "redFrom": true draws the numbers from the redline on in red.
 * lights: "count" (12), "from" rpm (3000) where the first light comes on, "tail" (0): the last "tail" lights are blue
 *   (the GT3 look); "round": true for dots;
 * "off" the alpha of an unlit light (0.14).
 * Text "warnFlash": false: no flash over the warning limit (a tile that turns red itself).
 * Text "colorBy": "verdict" colours it by the last shift's grade; "cc" by the colour the car asked for its
 * check-control message (cCColor: red / yellow / orange / green / white). Text "near": ["speed" | "rpm", i] turns it
 * "nearColor" (fg) while scale label i is the one nearest the value (BMW lights up the label by the needle).
 *
 * rpm is smoothed (a 120 ms filter, and the readout moves in 50 rpm steps only when it changes by 40 or
 * more), so idle wobble doesn't show, as on BMW's own tach. Shift scoring uses the raw rpm.
 * Boost: FES displayBoostPressure while it's valid, else (app.json config.dme) the engine unit over
 * read-only UDS, absolute pressure minus outside air pressure, as cauliflowermossgrape's car_vitals does.
 *
 * Text tokens: {{speed}} {{u:speed}} {{oil}} {{coolant}} {{boost}} {{u:boost}} {{rpm}}
 * {{gear}} (P / R / N, D3 / S3 / M3 by the shifter programme, or just 3 when the selector position is unknown), {{gearnum}} (3, or P / R / N)
 * {{spd:<i>}} (speed scale label i of SPEED_SCALE: 0..200 mph, 0..320 km/h) {{range}} {{u:distLc}} (mi, km) {{u:dist}} (MI, KM) {{ambient}} (outside, signed: +75) {{u:speedLc}} (mph, km/h) {{ampmLc}} (am, pm) {{torque}} {{u:torque}} (lb-ft, Nm) {{torquePct}} {{powerPct}} (% of config.engine's peak) {{boostHi}} {{boostMid}}
 * (gauge labels for 1.4 / 0.7 bar in the display unit) {{stage}} (P R N, D / S / M by the shifter programme) {{gearInD}} (gear number while in D) {{mode}} (COMFORT, SPORT, SPORT PLUS, SPORT INDIVIDUAL, ECO PRO, ...)
 * {{temp:<deg C>}} (that temperature in the display unit, °F rounded to 10, for gauge labels) {{setup:engine|chassis|steering|gearbox}} (what that part is set to in the drive mode now)
 * {{time}} {{ampm}} {{u:temp}} (°F / °C) {{gLat}} {{gLong}} (g, 2 decimals) {{gSide}} ("0.42 L", "0.42 R")
 * {{gFwd}} ("0.31 ACC", "0.31 BRK") {{gBest}} (the most g this drive) {{gMax}} (the G-meter's range, "1.2") {{signal:<car.data() key>}} (raw, 1 decimal).
 * Redline (shift_score.js): {{rpm10}} (rpm to 10) {{shiftAt}} {{lastShift}} {{lastGears}} (4 > 5)
 * {{verdict}} {{shiftPrompt}} (SHIFT at the shift point) {{coldNote}} (only while the oil is cold).
 * Units follow the "units" setting: us = mph, °F, psi; metric = km/h, °C, bar.
 * {{intake}} (intake air, from the engine unit: app.json config.dme.intake) {{boostPeak}} (the highest boost since the last
 * 0-60 run started) {{avgSpeed}} (average moving speed this drive, from its first minute) {{run}} (the 0-60 clock running, else the last time, s) {{runBest}} {{runState}} (READY / GO / DONE)
 * {{runLabel}} (0-60 MPH, 0-100 KM/H): runs.js. {{warm}}: WARMING UP while the oil is under 80 C, then ENGINE WARM.
 * Bottom row (docs/BOTTOM-ROW-PACKAGE.md; each '' until the car sends one AND its setting is "ours"):
 * {{road}} (the bottom-centre road label) {{ccName}} {{ccDesc}} (the check-control message's name and description)
 * {{ccHead}} (package X: our one-line message, the headline; a text widget with "ccLine": true draws it with its
 * marker or hairline, "textY": its cell top in the box, and is what lets BMW's panel be covered: hud.js _ccOpen)
 * {{limitUnit}} {{limitSupp}} {{limitWarn}} {{nopassDist}} {{navDist}} {{navEta}} {{navMins}}.
 * Warnings: a text showing oil, coolant or boost (a {{oil}} / {{coolant}} / {{boost}} token, or a readout slot with that
 * sensor) flashes in the shift red while the value is over "warnOil" / "warnCoolant" (C) / "warnBoost" (bar); 0 = off.
 * Shift-light test (testShift(), the page's Alerts tab): for about 4 s the rpm every widget sees climbs from 1500 to just
 * past the shift point and holds there; only while the car stands. Shift scoring keeps the car's own rpm.
 * Night colours (Cluster Themes "nightDim" on Auto): after sunset (sun.js, config.location) a layout's own theme is
 * built with its whites and greys at 60 %; the minute timer rebuilds at sunset and sunrise.
 * (fix/colour-daynight: "night" is the CAR's own day/night first, config.dayNight / Vehicle.statusDayNightChangeOver,
 * applied as soon as it changes; the sunset above only while the car's value is missing or invalid: _isNight.)
 * Night looks (2026-11-14, "nightLook"): while the night colours are on ("nightDim" Auto after sunset, or Always), a
 * 6WB layout (WBDIAL / WBBACK layers) can take one of NIGHT_LOOKS instead of the plain dimmer: one colour transform for
 * the whole cluster, on the GPU for the dials and the backdrop (baked textures included) and here for the texts. A
 * change of either setting, and sunset / sunrise, is applied in place (_nightLive): no layer is made again.
 * 2026-11-16 (the owner): 6WB Sport and 6WB Eco Pro have no night colours at all (DAY_ONLY_THEMES, _nightOk): neither
 * the dimmer nor a look, and their 6WB shaders are made without the night look's code. Comfort (+ G20) keeps both.
 *
 * Boost is a PUSH signal, not a diagnostic poll: tracing cauliflowermossgrape's
 * car_vitals showed its boost reading is de.bmw.infotainment.drivingexcitement.FES /
 * statusSwitchDriveDynamicSport2.displayBoostPressure, factor 0.01, offset 0,
 * invalid 255. car_vitals itself treats that field as unreliable on some cars, so
 * whether this X3 fills it is checked on the first drive. Reported here in bar.
 *
 * Never throws out of a timer or event: the kit turns an uncaught exception into an
 * app exit, and on the car a second unexpected exit uninstalls the app.
 */
const fs = require('fs');
const path = require('path');
const sensors = require('./sensors');
const { ClusterRender, DEFAULT_PATH } = require('./cluster_render_client.js');
const Layouts = require('./layouts');
const { THEMES, M_STRIPE, LIGHTS, VERDICT, color } = require('./hud_themes');
const ShiftScore = require('./shift_score');
const sun = require('./sun');
const textRaster = require('./hud_text');
const data = require('./hud_data');
const { paintIcon } = require('./icons');
const shaders = require('./shaders');
const calibration = require('./calibration');
const Car = require('./kit/car');
const Waze = require('./waze');
const Screen = require('./screen');
const Runs = require('./runs');

const BOOST_SCALE = { factor: 0.01, offset: 0, invalid: 255 }; // see header comment
// the widget types drawn as pixels (image layers, packed into sheets unless "own": true); the rest are shaders
const IMAGE_TYPES = { text: true, scale: true, stripe: true, gridlabels: true, icon: true, swatchimg: true };
const STATUS_ASK_MS = 2000;      // after a rebuild: ask cluster-render for its own status text
const LAYER_BUDGET = 8;          // cluster-render's limit per client connection (CompositorLimits.per_client; confirmed on the car Nov 5 2026)
const MAX_CONN = 4;              // connections a layout may ask for ("conn"): 32 layers service-wide / 8 per connection
const PIXEL_BYTES = 16 * 1024 * 1024;   // cluster-render's pixel memory for every app's images together (CompositorLimits.pixel_bytes)
const SHEET_AREA_FRAC = 4;       // the first sheet size limit: 1/4 of the target area (see the header)
const TICK_MS = 50;              // 20 Hz: shift bar and gauges
const TEXT_MS = 200;             // text re-draws at most 5 times a second (what BMW's own readouts do)
const NEEDLE_MS = 33;            // 0.7.14: the speed and rev needles' own timer while "needleSmooth" is on (30 a second)
const PERF_LOG_MS = 10000;       // package P (opt-in only, see PERF in the class): the perf log's period
const EXACT_SPARE = 6;           // 0.7.14: spare cells in a "gpu" text's atlas, for cells the figures don't fill ("--")
const DEFAULT_LOCATION = { lat: 35.2271, lon: -80.8431 }; // Charlotte, NC: for the Auto theme's sunset
const TARGET_SIZES = { hud: [800, 480], panel: [1920, 720] };
const MODE_KEY = { comfort: 'inComfort', sport: 'inSport', eco: 'inEco' };
const TYRE_CORNERS = ['FL', 'FR', 'RL', 'RR'];
// the Roadster's speed dial: 0..160 mph or 0..240 km/h in 8 steps (labels {{dial:speed:<i>}})
// the 6WB-style dials' looks (shaders.js wbdial u_style)
const WB_STYLE = { comfort: 0, sport: 1, eco: 2, mini: 3, eff: 4 };
// the 6WB Comfort window's foot line (wbback "foot", shaders.js wbback u_foot): glass is the baked "line" texture
const WB_FOOT = { glass: 0, hair: 1, chrome: 2, none: 3 };
// --- package F (docs/POLISH-F-REPORT.md): settings of the 6WB layouts ---
// "dialShade" (6WB Dials + G20): the shade at our dials' inner edges over BMW's map, drawn by WBBACK's collar path
// (u_shade): strength at our rim, falloff px. "normal" is polish B's baked 0.8 / 20 px. fix/settings (2026-11-16): the
// shade now lies over the window's own 50 px rim veil, which hides its first px, so "weak" falls off over 16 px, not 12
// (at 12 it was at most 8 of 255 levels darker than "off"; at 16, 13 - and "normal" 17 more, "strong" 42 more)
const WB_SHADE = { off: [0, 20], weak: [0.5, 16], normal: [0.8, 20], strong: [0.95, 34] };
// settings that only change a uniform of a layer already there (_wbLive); "wbFoot" to or from "glass" rebuilds (texture)
const WB_LIVE_KEYS = ['dialShade', 'wbFoot'];
// --- end package F ---
const DIAL_SPEED = { us: { max: 160, ticks: 8 }, metric: { max: 240, ticks: 8 } };
// --- bottom row (docs/BOTTOM-ROW-PACKAGE.md) ---
// the supplemental sign under the limit, as a short word for the placeholder text ({{limitSupp}}); the faithful
// pictograms come with the design spec (docs/G20-DESIGN-SPEC.md)
const SUPP_TEXT = {
    rain: 'RAIN', snow: 'SNOW', snowRain: 'SNOW/RAIN', fog: 'FOG', time: 'TIME', zone: 'ZONE', school: 'SCHOOL',
    work: 'WORK ZONE', trailer: 'TRAILER', exitL: 'EXIT L', exitR: 'EXIT R', dist1: 'AHEAD', dist2: 'AHEAD',
    restriction: 'RESTRICTED',
};
// the colour the car asks for a check-control message (cCColor), as a theme role or an RGBA of our own
const CC_ROLE = {
    red: [255, 60, 54, 255], yellow: [255, 206, 48, 255], orange: [255, 150, 40, 255],
    green: [96, 220, 110, 255], white: 'fg', default: 'fg',
};
// settings of the bottom-row package that only change what a text shows or one uniform, so no rebuild is needed
// (package X: "ccStyle", our message's look, A or B, is drawn inside the message's own text raster)
const ROW_KEYS = ['limitArc', 'ccStyle'];
// ---- package X (docs/strip/X-REPORT.md): the row's logic -------------------------------------------------------------
// BMW's message panel is covered only once OUR text for that very message has been sent this long ago: the text, the
// backdrop (WBBACK u_cc) and the road bar (nav_bg) are on three different connections to cluster-render, which says
// nothing back, so "sent in an earlier tick, and this long ago" is the strongest "it is on the screen" we can know.
const CC_SETTLE_MS = 150;
// standby (BMW's vehicle condition COND_STANDBY below - not "P with the engine off") must hold this long, and so must
// leaving it, before the row changes hands: the row
// is rebuilt each time, and a shifter moved through P or an engine stalling must not rebuild it twice in a second
const STANDBY_MS = 1000;
// Standby = BMW's own vehicle condition (VehicleCondition statusConditionVehicle, data().condition) WOHNEN, 5. NOT
// "P with the engine off" (package P, 2026-11-16: photos 63 and 64 are P with the engine off and BMW draws its
// NORMAL row; only 65 shows the standby row). That 65 is condition 5 (and 63 condition 7, PRUEFEN_ANALYSE_DIAGNOSE) is
// a HYPOTHESIS: every new condition value is logged once ("bottom row: vehicle condition N") to confirm on the car.
const COND_STANDBY = 5;
// our message's two looks (the owner picks on the bench): A a severity marker + the headline, B a hairline above and a
// coloured segment under the headline
const CC_STYLE_KEY = 'ccStyle';
// a time zone is believed only if it is a whole number of quarter hours within +-14 h (config.clock's 15-minute step
// is a guess: anything else means the guess is wrong, and then the next source is used)
const tzOk = (v) => typeof v === 'number' && isFinite(v) && v % 15 === 0 && Math.abs(v) <= 14 * 60;
// ---- end package X ---------------------------------------------------------------------------------------------------
// the car's position is used for sunrise / sunset only, and only while it is this fresh (a parked car sends nothing)
const POS_STALE_MS = 6 * 3600 * 1000;
// the one control for the whole of BMW's bottom row ("bottomRow": every item BMW's, or every item ours), and the
// items it covers. The seven own* settings it replaced are read once by the migration in the app's main.js.
const ROW_KEY = 'bottomRow';
const ROW_OURS = 'all6WB', ROW_BMW = 'allG20';
const OWN_ITEMS = ['range', 'clock', 'temp', 'nav', 'sign', 'info'];
// (no timer of ours for several messages at once: the car numbers its frames and says which one it is on;
//  config.ccm.ccFrameDwellMs is carried as a parameter for a later animation package, unused here)
// --- end bottom row ---
// the HUD's place (the page's Position tab): settings that move / scale the layers already there, no rebuild
const PLACE_KEYS = ['hudX', 'hudY', 'hudScale'];
// settings that only change what a text shows (the next tick paints it), no rebuild
const LIVE_KEYS = ['warnOil', 'warnCoolant', 'warnBoost', 'gFlipLat', 'gFlipLong', 'gRange', 'gTrail'];
// g (after cauliflowermossgrape's G-Force, MIT, idea only): a sample over G_BAD is a bad reading, not a corner;
// the rest are averaged over G_AVG_MS so kerbs and potholes don't throw the dot about
const G_BAD = 3;
const G_AVG_MS = 150;
// the G-meter's grip envelope: G_SECTORS directions, a reading also lifts the G_SPREAD sectors either side of it
// (by the cosine), so the outline closes up between nearby readings; the trail holds G_TRAIL points
const G_AMBER = [255, 176, 40];         // the dot between 0.5 and 0.8 g
const G_SECTORS = 48, G_SPREAD = 3, G_TRAIL = 16;
// warnings (page.js Alerts): a readout of oil / coolant / boost over its limit flashes in the shift red
const WARN = { oil: 'warnOil', coolant: 'warnCoolant', boost: 'warnBoost' };
const WARN_FLASH_MS = 300;
// a tile's bar (the Dyno theme's "tiles") per sensor (sensors.js id): the raw reading (hud _raw) between min and
// max, "z" for a zoned bar (blue, dark blue, red past u_at); a sensor not here has no bar. rpm runs to the bar max.
const TILE_BAR = {
    rpm: { raw: 'rpm', min: 0, max: 'rpm', z: 1 }, speed: { raw: 'speed', min: 0, max: 260 },
    boost: { raw: 'boost', min: 0, max: 1.6, z: 1 }, torque: { raw: 'torquePct', min: 0, max: 100, z: 1 },
    power: { raw: 'powerPct', min: 0, max: 100, z: 1 }, torquePct: { raw: 'torquePct', min: 0, max: 100, z: 1 },
    powerPct: { raw: 'powerPct', min: 0, max: 100, z: 1 }, oil: { raw: 'oil', min: 40, max: 150, z: 1 },
    coolant: { raw: 'coolant', min: 40, max: 130, z: 1 }, intake: { raw: 'intake', min: 0, max: 80, z: 1 },
    ambient: { raw: 'ambient', min: -20, max: 45 }, gLat: { raw: 'gLat', min: 0, max: 1.2, z: 1, abs: true },
    gLong: { raw: 'gLong', min: 0, max: 1.2, z: 1, abs: true }, fuel: { raw: 'fuel', min: 0, max: 1 },
    range: { raw: 'range', min: 0, max: 700 }, hvSoc: { raw: 'hvSoc', min: 0, max: 100 },
};
const TILE_MAX = 14;       // half a flash: red, then the normal colour
// the shift-light test (page.js Alerts): rpm climbs from TEST_FROM to just past the shift point, then holds
const TEST_FROM = 1500, TEST_CLIMB_MS = 2500, TEST_HOLD_MS = 1200;
// night colours (Cluster Themes "nightDim"): after sunset the theme's whites and greys go to this brightness
const NIGHT_DIM = 0.6;
// 2026-11-14: the night looks ("nightLook"): how the night colours look on a 6WB layout. "plain" is the dimmer above
// (dimTheme); a look here recolours the whole cluster with one transform, the same on the GPU (shaders.js nightLook,
// u_nk0..2: the baked dial and window textures change with no second copy of them) and here for the theme's colours
// (lookTheme: the texts), so a figure and its tick agree. A colour's grey part, min(r, g, b), goes to "w"; what is
// left over of its red, green and blue to "r", "g", "b" (0..1 each). "floor": the baked window and floor's level on top
// (the brightest area that is not information). Judged on the bench only, not yet on the car at night.
//   amber: the scales a dimmed warm white, the red needle, red zone and lit segments amber-orange, the floor bronze
//   ice:   the scales an ice blue, the floor a deep blue, the needle stays red (the one warm thing, easy to find)
//   red:   everything in a low red (night vision), the needle a brighter orange-red, the floor almost off
// "sign": the road signs (WBSIGN) are only dimmed to that, never recoloured (a limit sign stays red and white).
const NIGHT_LOOKS = {
    amber: { w: [0.66, 0.59, 0.50], r: [1.0, 0.50, 0.06], g: [0.55, 0.45, 0.10], b: [0.62, 0.36, 0.08], floor: 0.55, sign: 0.66 },
    ice: { w: [0.50, 0.68, 0.86], r: [0.92, 0.16, 0.12], g: [0.20, 0.70, 0.80], b: [0.16, 0.42, 1.0], floor: 0.8, sign: 0.66 },
    red: { w: [0.60, 0.06, 0.03], r: [1.0, 0.34, 0.12], g: [0.40, 0.05, 0.02], b: [0.36, 0.04, 0.02], floor: 0.4, sign: 0.5 },
};
// settings the night colours follow (_nightLive: in place when every layer can take them, else a rebuild)
const NIGHT_KEYS = ['nightDim', 'nightLook'];
// 2026-11-16, the owner: "the night themes in Sport and Eco must go". A layout of these themes (wb_sport, wb_eco and
// wb_sport_dials, by their "theme") looks the same by night as by day: no plain dimmer, no night look, and its 6WB
// shaders are compiled without the night look (shaders.js NIGHT 0: no u_nk0..2, no nightLook()). Comfort and
// Comfort + G20 (theme wb_comfort) keep theirs; the other layouts of a theme of their own keep the plain dimmer.
const DAY_ONLY_THEMES = ['wb_sport', 'wb_eco'];
// 0.7.13, the KOMBI guard: when the cluster's display service goes away within KOMBI_GUARD_MS of our scene being shown,
// KOMBI_STRIKES times within KOMBI_WINDOW_MS, the theme is turned off (every theme, so a drive-mode change doesn't try
// another), and stays off, across restarts too (<data>/kombi-guard.json), until a theme is picked again. On 2026-11-14
// a 6WB scene made the KOMBI reset ~2.7 s after each mapping, and the scene was mapped again each time it came back:
// 6 to 13 resets in a row, with the driver-assistance warnings, until the theme was turned off by hand.
const KOMBI_GUARD_MS = 8000, KOMBI_WINDOW_MS = 120000, KOMBI_STRIKES = 2, KOMBI_FILE = 'kombi-guard.json';
const LOOK_KEYS = ['hudLayout', 'inComfort', 'inSport', 'inEco', 'byMode', 'g20'];
// "+ G20" (the owner, 2026-11-15; docs/ONE-SWITCH-DONE.md): the see-through look is the "g20" setting, not a theme of
// its own. A theme name maps to its see-through FILE while the toggle is on - the files are untouched, nothing new is
// drawn and no shader changes. Only Comfort has one: "6WB Sport + G20" was retired with the toggle and Eco Pro never
// had a variant, so both stay opaque with the toggle on (the setting's label says Comfort).
const G20_OF = { wb_comfort: 'wb_dials' };
// the way back, for the names on screen: a see-through file -> its theme (wb_sport_dials is kept here, and its layout
// file is kept, so a settings.json that still names it after a failed migration is still labelled and still drawn)
const G20_THEME = { wb_dials: 'wb_comfort', wb_sport_dials: 'wb_sport' };
// the car's display units (Vehicle statusNewCurrentUnitsStatusExt, as BMW's own x_call reads them; car_vitals, MIT)
const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F' };
const PRESS_TO_BAR = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 };
const unitName = (map, v) => map[v] || (Object.values(map).indexOf(v) >= 0 ? v : null);
// MDrive dataDisplayGearbox.displayProgramGearbox: the programme the cluster shows next to the gear (car_vitals, MIT)
const PROGRAMS = { S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 1: 'S', 2: 'M' };
const MODE_NAME = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco Pro' };
const FRESH_MS = 3000;
const TZ_AUTO = -9999;           // the "timeZone" setting's Automatic: the head unit's own time zone
// A plug-in hybrid's high-voltage battery charge: read-only UDS 22 DDBC from its battery unit (SME, 0x07), 0.1 %.
// The read Redline 2.0 and eDrive use (cauliflowermossgrape/idrive7-apps, MIT; apps/redline/electrical.js).
// Asked every HV_EVERY_MS only while a shown readout uses it; a car that doesn't answer is asked once a minute.
// Not checked on a car by us (no hybrid here, Nov 10 2026).
const HV_SOC = { ecu: 0x07, did: 'DDBC', bytes: 2, at: 0, factor: 0.1, offset: 0, min: 0, max: 100, timeoutMs: 1000 };
// The fuel level as a % from the engine unit: standard OBD-II PID 2F ("fuel tank level input", A x 100 / 255), as
// cauliflowermossgrape's Live Data lists it (apps/live_data/std.js, MIT). A % needs no tank size; the car's own fuel
// signal is litres only. Whether BMW engine units answer it is not known yet (Nov 11 2026): without an answer the
// gauge falls back to litres / the "tankLitres" setting.
const FUEL_OBD = { obd: '2F', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100, timeoutMs: 1000 };
const FUEL_EVERY_MS = 10000, FUEL_RETRY_MS = 300000, FUEL_STALE_MS = 60000;
const HV_EVERY_MS = 5000, HV_RETRY_MS = 60000, HV_STALE_MS = 20000;
// BMW's speed scale: even steps to 120 mph (180 km/h), then wider ones to 200 mph (320 km/h)
const SPEED_SCALE = { us: [0, 20, 40, 60, 80, 100, 120, 160, 200], metric: [0, 30, 60, 90, 120, 150, 180, 250, 320] };
/** speed (display unit) -> 0..1 along a scale of evenly spaced labels */
function scaleFrac(v, marks) {
    if (!(v > 0)) return 0;
    for (let i = 1; i < marks.length; i++) if (v <= marks[i]) return (i - 1 + (v - marks[i - 1]) / (marks[i] - marks[i - 1])) / (marks.length - 1);
    return 1;
}           // a boost reading older than this is not used

/**
 * The drive mode from FES statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience: names or wire
 * numbers (cauliflowermossgrape's live_data signals.js, MIT): 1 Sport, 2 Sport+, 3 Sport individual,
 * 4 Comfort, 5 Comfort+, 6 Comfort individual, 7 Eco Pro, 8 Eco Pro+, 9 Eco Pro individual, 10 Adaptive.
 */
/** The mode's variant: 'plus' (Sport+ / Comfort+ / Eco Pro+: wire 2, 5, 8, or PLUS / EXPERT in the name), 'individual'
 *  (wire 3, 6, 9, or INDIVID in the name), else null. */
function driveVariantOf(raw) {
    const v = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (typeof v === 'number') return v === 2 || v === 5 || v === 8 ? 'plus' : v === 3 || v === 6 || v === 9 ? 'individual' : null;
    if (typeof v !== 'string') return null;
    return /PLUS|EXPERT/i.test(v) ? 'plus' : /INDIVID/i.test(v) ? 'individual' : null;
}

/** The M theme's setup rows: what each part is set to in a drive mode (they follow the mode buttons). */
const SETUP = {
    eco:       { engine: 'EFFICIENT', chassis: 'COMFORT', steering: 'COMFORT', gearbox: 'EFFICIENT' },
    comfort:   { engine: 'COMFORT', chassis: 'COMFORT', steering: 'COMFORT', gearbox: 'COMFORT' },
    sport:     { engine: 'SPORT', chassis: 'SPORT', steering: 'SPORT', gearbox: 'SPORT' },
    sportplus: { engine: 'SPORT PLUS', chassis: 'SPORT', steering: 'SPORT', gearbox: 'SPORT PLUS' },
    // the car reports only that an Individual setup is on, not what each part is set to (no signal found yet)
    individual: { engine: 'INDIVIDUAL', chassis: 'INDIVIDUAL', steering: 'INDIVIDUAL', gearbox: 'INDIVIDUAL' },
};
const SETUP_LEVEL = { EFFICIENT: 1, COMFORT: 1, SPORT: 2, 'SPORT PLUS': 3, INDIVIDUAL: 0 };

function driveModeOf(raw) {
    let v = raw;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim());
    if (typeof v === 'number') {
        if (v >= 1 && v <= 3) return 'sport';
        if (v >= 7 && v <= 9) return 'eco';
        if ((v >= 4 && v <= 6) || v === 10) return 'comfort';
        return null;
    }
    if (typeof v !== 'string') return null;
    const u = v.trim().toUpperCase();
    if (u.indexOf('SPORT') === 0) return 'sport';
    if (u.indexOf('ECO') === 0 || u.indexOf('EFFICIEN') === 0) return 'eco';
    if (u.indexOf('COMFORT') === 0 || u.indexOf('ADAPTIVE') === 0) return 'comfort';
    return null;
}

// ---- package E: one raw speed-limit value (app.json config.limit, _setupVehicleData) as a sign state ----------------
// { state: 'none' | 'limit' | 'end' | 'unknown', kmh }. 'none': nothing to show (Speed Limit Info off or not sending: no
// sign); 'end': the end-of-limit sign (the derestriction sign: "end" values, or a "map" entry "end"); 'limit': kmh within
// min..max. car3 I: 'unknown': BMW's empty sign "---" (Speed Limit Info on, but no limit known): "unknown" values, a
// "map" entry "unknown", or a separate state member (statePath + stateMap: { "<raw>": "unknown" | "none" | "end" |
// "limit" }; "limit" or no entry: the value decides). Never throws.
function limitOf(lim, raw, unitRaw, stateRaw) {
    const none = { state: 'none', kmh: null };
    const list = (a) => (Array.isArray(a) ? a : []);
    if (!lim) return none;
    if (lim.stateMap && typeof lim.stateMap === 'object' && stateRaw !== undefined && stateRaw !== null) {   // car3 I
        const s = lim.stateMap[String(stateRaw)];
        if (s === 'unknown' || s === 'none' || s === 'end') return { state: s, kmh: null };
    }
    if (raw === undefined || raw === null) return none;
    if (lim.map && typeof lim.map === 'object' && Object.prototype.hasOwnProperty.call(lim.map, String(raw))) {
        const m = lim.map[String(raw)];
        if (m === 'end' || m === 'unknown') return { state: m, kmh: null };
        if (typeof m !== 'number' || !isFinite(m)) return none;
        raw = m;                                    // a mapped value is km/h already
        lim = { min: lim.min, max: lim.max };
    } else {
        if (list(lim.end).indexOf(raw) >= 0) return { state: 'end', kmh: null };
        if (list(lim.unknown).indexOf(raw) >= 0) return { state: 'unknown', kmh: null };   // car3 I: "---"
        if (list(lim.invalid).indexOf(raw) >= 0) return none;
    }
    if (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw)) raw = Number(raw);
    if (typeof raw !== 'number' || !isFinite(raw)) return none;
    const mph = lim.unit === 'mph' || (lim.unitPath && list(lim.mph).indexOf(unitRaw) >= 0);
    const kmh = raw * (typeof lim.factor === 'number' && isFinite(lim.factor) ? lim.factor : 1) * (mph ? 1.609344 : 1);
    const lo = typeof lim.min === 'number' ? lim.min : 5, hi = typeof lim.max === 'number' ? lim.max : 250;
    return kmh >= lo && kmh <= hi ? { state: 'limit', kmh } : none;
}
// ---- end package E --------------------------------------------------------------------------------------------------

// ---- car3 I: auto start/stop, the car's time zone, a check-control message (docs/CAR3-I-REPORT.md) -------------------
// Each reads one raw value of a field app.json config names (scripts/car_signals.sh lists the candidates) and never throws.
const MSA_STATES = { active: 1, off: 2, stopped: 3, unavailable: 4 };
// audit/features: BMW's own vehicle condition (VehicleCondition statusConditionVehicle, the kit's "condition" group)
// that means "the car is ready to drive": FAHRBEREITSCHAFT_HERSTELLEN (8) and FAHREN (10). A rev needle rests at READY
// in those, and at OFF in the others (PARKEN 1 / 2, WOHNEN 5, ...), as the stock F30 6WB tacho does.
const COND_READY = [8, 10];
// CDS statusEngineStatus statusEngineRunDrive: MOTOR_AUS 0, MOTOR_STARTET 1, MOTOR_LAEUFT 2, SIGNAL_UNGUELTIG 3
const ENGINE_RUN = { 0: 'off', 1: 'starting', 2: 'running', MOTOR_AUS: 'off', MOTOR_STARTET: 'starting', MOTOR_LAEUFT: 'running' };
/** config.msa { map: { "<raw>": "active" | "off" | "stopped" | "unavailable" | null } } -> one of those, or null (hidden). */
function msaOf(cfg, raw) {
    if (!cfg || raw === undefined || raw === null) return null;
    const m = cfg.map && typeof cfg.map === 'object' ? cfg.map[String(raw)] : undefined;
    return typeof m === 'string' && MSA_STATES[m] ? m : null;
}
/** fix/colour-daynight: config.dayNight { map: { "<raw>": "day" | "night" | "keep" | null } } -> one of those; anything
 *  unmapped (a value the catalogue does not list, a missing member) is null: invalid, the sun decides. */
function dayNightOf(cfg, raw) {
    if (!cfg || raw === undefined || raw === null) return null;
    const m = cfg.map && typeof cfg.map === 'object' && cfg.map.hasOwnProperty(String(raw)) ? cfg.map[String(raw)] : null;
    return m === 'day' || m === 'night' || m === 'keep' ? m : null;
}
/** config.clock ->the car's offset from UTC in minutes, or null. kind "offset": the value at `path` times `factor` (1:
 *  minutes; 60: hours; 1/60: seconds), plus `dstMinutes` (60) while the value at `dstPath` is truthy (not 0 / false /
 *  "OFF"); `invalid`: raw values that mean none. kind "local": the car's local hour and minute (hourPath, minutePath)
 *  against the unit's UTC clock, rounded to 15 minutes. */
function tzOf(cfg, v, nowMs) {
    const dig = (x, p) => { let r = x; (Array.isArray(p) ? p : []).forEach((k) => { r = r === null || r === undefined ? r : r[k]; }); return r; };
    const num = (x) => (typeof x === 'number' && isFinite(x) ? x : typeof x === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(x) ? Number(x) : null);
    if (!cfg || v === undefined || v === null) return null;
    if (cfg.kind === 'local') {
        const h = num(dig(v, cfg.hourPath)), m = num(dig(v, cfg.minutePath));
        if (h === null || m === null || h < 0 || h > 23 || m < 0 || m > 59) return null;
        const u = new Date(nowMs), utc = u.getUTCHours() * 60 + u.getUTCMinutes();
        let off = h * 60 + m - utc;
        if (off > 14 * 60) off -= 1440;
        if (off < -12 * 60) off += 1440;
        return Math.round(off / 15) * 15;
    }
    const raw = dig(v, cfg.path);
    if (Array.isArray(cfg.invalid) && cfg.invalid.indexOf(raw) >= 0) return null;
    const n = num(raw);
    if (n === null) return null;
    // "offsetBy": subtracted from the raw before scaling (a car that counts its steps from UTC-12, say)
    let off = (n - (typeof cfg.offsetBy === 'number' && isFinite(cfg.offsetBy) ? cfg.offsetBy : 0)) *
        (typeof cfg.factor === 'number' && isFinite(cfg.factor) ? cfg.factor : 1);
    if (cfg.dstPath) {
        const d = dig(v, cfg.dstPath);
        if (d && d !== 'OFF' && d !== '0') off += typeof cfg.dstMinutes === 'number' ? cfg.dstMinutes : 60;
    }
    return off >= -12 * 60 && off <= 14 * 60 ? Math.round(off) : null;
}
/** config.ccm -> true while a check-control message shows, false while none, null unknown. kind "list": a non-empty
 *  array at `path`; kind "flag": the value at `path` is in `on` (or, with no `on`, not in `off`, default [0, false]). */
function ccOf(cfg, v) {
    let r = v;
    (Array.isArray(cfg && cfg.path) ? cfg.path : []).forEach((k) => { r = r === null || r === undefined ? r : r[k]; });
    if (!cfg || r === undefined || r === null) return null;
    if (cfg.kind === 'list') return Array.isArray(r) ? r.length > 0 : null;
    if (Array.isArray(cfg.on) && cfg.on.length) return cfg.on.indexOf(r) >= 0;
    return (Array.isArray(cfg.off) ? cfg.off : [0, false]).indexOf(r) < 0;
}
// ---- end car3 I -----------------------------------------------------------------------------------------------------

// ---- bottom row (docs/BOTTOM-ROW-PACKAGE.md): the car's own speed-limit struct, its check-control message and its
// road label, each read from ONE field app.json config names (config.sign / config.ccm kind "message" / config.road).
// Pure functions, never throw, and they never log: the caller logs SHAPES only (the message text, the street and the
// position are personal data).
/** The value at `path` inside `v` ([] or none: `v` itself); undefined when any step is missing. */
function pick(v, path) {
    let r = v;
    (Array.isArray(path) ? path : []).forEach((k) => { r = r === null || r === undefined ? r : r[k]; });
    return r;
}
const inList = (a, x) => Array.isArray(a) && a.indexOf(x) >= 0;
/** A raw enum through a { "<raw>": value } map; `dflt` when there is no path, no value or no entry. */
function mapRaw(v, path, map, dflt) {
    if (!path) return dflt;
    const raw = pick(v, path);
    if (raw === undefined || raw === null) return dflt;
    const m = map && typeof map === 'object' ? map[String(raw)] : undefined;
    return m === undefined ? dflt : m;
}
// What our sign knows, with nothing read yet. state: 'none' (no sign at all), 'limit' (kmh), 'end' (the
// derestriction sign), 'unknown' (BMW's empty sign "---"). warn 0 none / 1 level 1 / 2 level 2; supp the
// supplemental sign ('rain', 'snow', 'fog', 'time', 'zone', 'school', 'work', 'trailer', 'exitL', 'exitR',
// 'dist1', 'dist2', 'restriction', 'snowRain'); style 'ece' | 'us' | 'china' | 'japan' | 'korea' (+ 'sure': the
// car is sure of the country); np 'none' | 'car' | 'trailer' | 'truck' | 'other' | 'left' | an 'end*' value.
const SIGN_NONE = { state: 'none', kmh: null, shown: null, unit: null, warn: 0, supp: null, style: null, sure: null, np: 'none', npM: null };
// the no-passing values that mean a sign is in force (the rest are "none" or an end-of-restriction sign)
const NP_ON = ['car', 'trailer', 'truck', 'other', 'left'];
/**
 * config.sign -> SIGN_NONE's shape. The shape names every member of the car's struct:
 *   { iface, field, invalidPath + invalidOn ([1, true]), valuePath, factor (1), min (5), max (250),
 *     unitPath + mph: [raw unit values meaning mph] + noUnit: [raw values meaning "not available"],
 *     none: [raw speed values meaning no sign], end: [...], unknown: [...],
 *     warnPath + warnMap { "<raw>": 0 | 1 | 2 }, suppPath + suppMap, stylePath + styleMap, surePath + sureOn,
 *     npPath + npMap, npDistPath (metres left of a no-passing restriction) }
 * Anything not named is simply not read, so a car that fills only part of the struct still gives a sign.
 */
function signOf(cfg, v) {
    const out = Object.assign({}, SIGN_NONE);
    if (!cfg || v === undefined || v === null) return out;
    if (cfg.invalidPath && inList(cfg.invalidOn || [1, true], pick(v, cfg.invalidPath))) return out;
    const warn = Number(mapRaw(v, cfg.warnPath, cfg.warnMap, 0));
    out.warn = warn === 1 || warn === 2 ? warn : 0;
    out.supp = mapRaw(v, cfg.suppPath, cfg.suppMap, null) || null;
    out.style = mapRaw(v, cfg.stylePath, cfg.styleMap, null) || null;
    out.sure = cfg.surePath ? inList(cfg.sureOn || [1, true], pick(v, cfg.surePath)) : null;
    out.np = mapRaw(v, cfg.npPath, cfg.npMap, 'none') || 'none';
    const d = cfg.npDistPath ? pick(v, cfg.npDistPath) : null;
    out.npM = typeof d === 'number' && isFinite(d) && d > 0 && d < 65535 ? d : null;
    const unitRaw = cfg.unitPath ? pick(v, cfg.unitPath) : undefined;
    const noUnit = inList(cfg.noUnit, unitRaw), mph = inList(cfg.mph, unitRaw);
    out.unit = noUnit ? null : mph ? 'mph' : 'kmh';
    let raw = cfg.valuePath ? pick(v, cfg.valuePath) : undefined;
    if (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw)) raw = Number(raw);
    if (inList(cfg.end, raw)) { out.state = 'end'; return out; }
    if (inList(cfg.unknown, raw) || noUnit) { out.state = 'unknown'; return out; }
    if (inList(cfg.none, raw) || typeof raw !== 'number' || !isFinite(raw)) return out;
    const shown = raw * (typeof cfg.factor === 'number' && isFinite(cfg.factor) ? cfg.factor : 1);
    const kmh = mph ? shown * 1.609344 : shown;
    const lo = typeof cfg.min === 'number' ? cfg.min : 5, hi = typeof cfg.max === 'number' ? cfg.max : 250;
    if (!(kmh >= lo && kmh <= hi)) return out;
    out.state = 'limit'; out.kmh = kmh; out.shown = shown;
    return out;
}
/**
 * config.ccm with kind "message" -> { name, desc, color, symbol, id, type }. The field is a union, so `roots` lists
 * the member paths to try in order (the first one that is there wins):
 *   { kind: "message", roots: [["cCMessageStruct"], ["cCMessageWithSymbol", "cCMessage"]], namePath, descPath,
 *     colorPath + colorMap { "<raw>": "red" | "yellow" | "green" | "orange" | "white" | "default" },
 *     symbolPath, idPath, typePath, clearIds: [ids that mean "no message"] }
 * The text is the car's own, already localised. It is NEVER logged.
 */
function ccMsgOf(cfg, v) {
    const out = { name: '', desc: '', color: null, symbol: null, id: null, type: null };
    if (!cfg || v === undefined || v === null) return out;
    const roots = Array.isArray(cfg.roots) && cfg.roots.length ? cfg.roots : [[]];
    let m = null;
    for (let i = 0; i < roots.length && m === null; i++) {
        const r = pick(v, roots[i]);
        if (r !== undefined && r !== null && typeof r === 'object') m = r;
    }
    if (m === null) return out;
    const str = (p) => { const s = p ? pick(m, p) : undefined; return typeof s === 'string' ? s : ''; };
    out.name = str(cfg.namePath).slice(0, 300);
    out.desc = str(cfg.descPath).slice(0, 1536);
    out.color = mapRaw(m, cfg.colorPath, cfg.colorMap, null) || null;
    const sy = cfg.symbolPath ? pick(m, cfg.symbolPath) : undefined;
    out.symbol = typeof sy === 'number' ? sy : null;
    const id = cfg.idPath ? pick(m, cfg.idPath) : undefined;
    out.id = typeof id === 'number' ? id : null;
    const ty = cfg.typePath ? pick(m, cfg.typePath) : undefined;
    out.type = ty === undefined || ty === null ? null : String(ty);
    if (inList(cfg.clearIds, out.id)) { out.name = ''; out.desc = ''; }
    return out;
}
/**
 * config.road -> one line of text, '' when there is none. The car's field is an array of elements, each either a
 * text, a spacer or an icon with its own text (its picture is a resource handle we cannot resolve, so only its text
 * is used):
 *   { iface, field, instance, path (["elements"]), textKey, spacerKey, iconKey, iconTextKey,
 *     spacerMap { "<raw>": the characters it stands for }, maxLen (48) }
 * The text is the car's own road name. It is NEVER logged.
 */
function roadOf(cfg, v) {
    if (!cfg) return '';
    const arr = pick(v, cfg.path);
    if (typeof arr === 'string') return arr.slice(0, cfg.maxLen || 48);
    if (!Array.isArray(arr)) return '';
    const sp = cfg.spacerMap && typeof cfg.spacerMap === 'object' ? cfg.spacerMap : {};
    let out = '';
    for (let i = 0; i < arr.length && out.length < 160; i++) {
        const e = arr[i];
        if (e === null || e === undefined) continue;
        if (typeof e === 'string') { out += e; continue; }
        const t = e[cfg.textKey || 'text'];
        if (typeof t === 'string' && t) { out += t; continue; }
        const sk = e[cfg.spacerKey || 'spacer'];
        if (sk !== undefined && sk !== null && typeof sk !== 'object') { out += sp[String(sk)] === undefined ? ' ' : sp[String(sk)]; continue; }
        const ic = e[cfg.iconKey || 'icon'];
        if (ic && typeof ic === 'object') {
            const it = ic[cfg.iconTextKey || 'text'];
            if (typeof it === 'string' && it) out += it;
        }
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, cfg.maxLen || 48);
}
/** The shape of a road label for the log: how many elements of each kind and how long the line is. No content. */
function roadShape(cfg, v) {
    const arr = pick(v, cfg && cfg.path);
    if (!Array.isArray(arr)) return typeof arr === 'string' ? '1 text' : 'no array';
    let t = 0, s = 0, ic = 0;
    arr.forEach((e) => {
        if (!e || typeof e !== 'object') { t++; return; }
        if (typeof e[(cfg && cfg.textKey) || 'text'] === 'string') t++;
        else if (e[(cfg && cfg.iconKey) || 'icon']) ic++;
        else s++;
    });
    return arr.length + ' elements (' + t + ' text, ' + s + ' spacer, ' + ic + ' icon)';
}
// ---- end bottom row -------------------------------------------------------------------------------------------------

function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }

/**
 * The one rectangle around what differs between two RGBA images of the same size, with its pixels, or null
 * when they are the same (after idrive7-EVAHUD's eva_canvas.js, MIT). The link is what is short, not the CPU:
 * comparing a widget costs about a tenth of painting it.
 */
function changes(was, now, w, h) {
    const row = w * 4;
    const sameRow = (y) => now.compare(was, y * row, (y + 1) * row, y * row, (y + 1) * row) === 0;
    const samePx = (o) => now[o] === was[o] && now[o + 1] === was[o + 1] && now[o + 2] === was[o + 2] && now[o + 3] === was[o + 3];
    let top = 0;
    while (top < h && sameRow(top)) top++;
    if (top === h) return null;
    let bottom = h - 1;
    while (sameRow(bottom)) bottom--;
    let left = w, right = -1;
    for (let y = top; y <= bottom; y++) {
        if (sameRow(y)) continue;
        const o = y * row;
        for (let x = 0; x < left; x++) if (!samePx(o + x * 4)) { left = x; break; }
        for (let x = w - 1; x > right; x--) if (!samePx(o + x * 4)) { right = x; break; }
    }
    const rect = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    const px = Buffer.allocUnsafe(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) now.copy(px, y * rect.w * 4, (top + y) * row + left * 4, (top + y) * row + (right + 1) * 4);
    return { rect, px };
}
function rgba(c) { return [c[0] / 255, c[1] / 255, c[2] / 255, (c[3] === undefined ? 255 : c[3]) / 255]; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

// ---- probes (0.7.18 diagnostics: READ ONLY, LOG ONLY; the HudApp methods _probe* below) --------------------------------
// One short photo session on the owner's car has to answer three questions from the log alone:
//   1. the vehicle condition: is 5 BMW's standby row, and 7 "P, engine off"? ("probe: vehicle condition N")
//   2. the stored check-control list: which signal says BMW draws its warning / "i" marker right of its panel?
//      (config.ccMarker stays null until one is confirmed) KombiInterface_2 ccList / ccListRiskClass and
//      CheckControlMaster basicList, each logged once per change as NUMBERS and enum names only, never text
//   3. the cluster's default check-control symbols: requestDefaultSymbols(CC_LIST_SYMBOL), called ONCE; only the count
//      and each symbol's id, format and byte length are logged. The bitmaps are BMW's artwork: never logged, written,
//      kept or baked - the reply is dropped as soon as it is counted.
// Nothing here writes to the car, draws anything or changes what is drawn, and every path is caught: a failure only
// logs a warning (an uncaught exception ends the app on the car, and two crashes uninstall it).
const PROBE_KI2 = 'de.bmw.infotainment.KombiInterface_2';
const PROBE_CCM = 'de.bmw.infotainment.checkcontrol.CheckControlMaster';
const PROBE_SYM_AFTER_MS = 8000;       // 3: a few seconds after start ...
const PROBE_SYM_WAIT_MS = 20000;       //    ... and at most this much longer for the provider, then called anyway
const PROBE_SYM_CALL_MS = 5000;        //    the binding's own timeout
const PROBE_SYM_GUARD_MS = 8000;       //    ours on top of it, in case the binding never settles
const PROBE_LINES = 40;                // 2: lines per field at most (a flapping list cannot flood the log)
const PROBE_ENTRIES = 24;              // 2: entries per line, then "+N more"
/** A number, or "-" for none: an id can never carry text through here. */
const probeNum = (x) => (isNum(x) ? String(x) : x === undefined || x === null ? '-' : '?');
/** An enum: its wire number or its NAME (an upper-case identifier), else "?". Only ever read from enum members. */
const probeEnum = (x) => (isNum(x) ? String(x) : typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(x) ? x
    : x === undefined || x === null ? '-' : '?');
/** How many bytes a symbol's data holds (Buffer, typed array or array), without looking at one of them. */
const probeLen = (d) => (d && typeof d === 'object' && isNum(d.length) ? d.length + ' bytes'
    : typeof d === 'string' ? 'a string of ' + d.length + ' chars' : d === undefined || d === null ? 'no data' : '? bytes');
/** One line for a list field: "<n> entries: [id 101 colour YELLOW ...] ...". `member`: the union member holding each
 *  entry (absent: the entry itself); cols: [[label, member name, probeNum | probeEnum], ...]. Never any other member. */
function probeListLine(v, member, cols) {
    if (!Array.isArray(v)) return 'not a list (' + (v === null ? 'null' : typeof v) + ')';
    const one = (el) => {
        const e = el && typeof el === 'object' && member && el[member] && typeof el[member] === 'object' ? el[member] : el;
        if (!e || typeof e !== 'object') return '[?]';
        return '[' + cols.map((c) => c[0] + ' ' + c[2](e[c[1]])).join(' ') + ']';
    };
    const shown = v.slice(0, PROBE_ENTRIES).map(one).join(' ');
    return v.length + (v.length === 1 ? ' entry' : ' entries') + (v.length ? ': ' + shown : '') +
        (v.length > PROBE_ENTRIES ? ' +' + (v.length - PROBE_ENTRIES) + ' more' : '');
}
// ---- end probes (module part) -------------------------------------------------------------------------------------

class HudApp {
    constructor(ctx) {
        this.ctx = ctx;
        this.log = ctx.log;
        this._migrateComfortMap();
        this.config = (ctx.spec && ctx.spec.config) || {};
        this.location = this.config.location || DEFAULT_LOCATION;
        // HUD_CLUSTER_SOCKET: the Mac bench's fake cluster-render; never set on the car
        this.socketPath = process.env.HUD_CLUSTER_SOCKET || this.config.socketPath || DEFAULT_PATH;
        this.clients = [];               // the connections to cluster-render: [0] the app's own, more for "conn" widgets
        this.started = false;
        this.layerStates = new Map();    // "<conn>:<ref>" -> { state, reason } from cluster-render
        this.client = this._clientAt(0);
        this.target = TARGET_SIZES[this.config.target] ? this.config.target : 'hud';
        this.size = TARGET_SIZES[this.target];
        this.label = this.config.statusName || 'HUD';
        this.layoutTheme = null;         // the active layout's own theme, if it has one
        this.layouts = new Layouts(ctx.dataDir, this.log, this.size);
        this.widgets = new Map();        // widget.id -> { w, ref, sheet | null, last, lastPaint }
        this.sheets = [];                // the packed image layers: { ref, klass, z, x, y, w, h, members, buf }
        this.boostFes = null; this.boostFesAt = 0;    // bar, from the sport display signal
        this.boostDme = null; this.boostDmeAt = 0;    // bar, from the engine unit (fallback)
        this.needsBoost = false;         // a shown widget uses boost (the engine unit is only asked then)
        this.intakeDme = null; this.intakeDmeAt = 0;  // C, intake air from the engine unit (config.dme.intake)
        this.needsIntake = false;        // a shown widget uses the intake temperature
        this.hvSoc = null; this.hvSocAt = 0;  // %, a plug-in hybrid's battery charge (HV_SOC)
        this.needsHv = false;            // a shown widget uses it
        this.fuelObd = null; this.fuelObdAt = 0;  // %, the fuel level from the engine unit (FUEL_OBD)
        this.needsFuel = false;          // a shown widget uses the fuel level
        this.boostPeak = null;           // bar, the highest boost since the last 0-60 run started ({{boostPeak}})
        this.runs = new Runs(ctx.dataDir, this.log);   // the 0-60 timer (runs.js)
        this.runs.onStart = () => { this.boostPeak = null; };
        this.tripKm = 0;                 // this drive (since the app started with the car): km driven and
        this.tripMs = 0;                 // ms moving, for {{avgSpeed}}
        this.tripT = 0;
        this.driveMode = null;           // 'comfort' | 'sport' | 'eco', once the car has said
        this.driveRaw = null;            // a drive mode value the car sent that we don't know (shown in the status)
        this.driveVariant = null;        // 'plus' (Sport+ / Comfort+ / Eco Pro+), 'individual', or null
        this.carUnits = { press: null, temp: null, psiSeen: false };   // the car's display units, for the TPMS values
        this.program = null;             // 'S' / 'M' from the MDrive gearbox display, else null (D)
        this.fuelL = null; this.rangeKm = null; this.ambient = null;   // KombiIF tank / range, outside temperature
        this.engineRun = null;           // 'off' | 'starting' | 'running' from CDS statusEngineStatus (_restFrac)
        this.tyres = { p: {}, t: {} };                                  // TPMS pressure (bar) and temperature (C) per corner FL FR RL RR
        this.activeName = null;          // the layout shown now ('off' = nothing)
        this.pixelBytes = 0;             // what the layout's image layers and glyph atlases cost of cluster-render's pixel memory
        this.atlases = new Map();        // "<conn>:<font>" -> { ref, c, ci, cols, rows, cellW, cellH, chars, bytes }: R8 assets, kept across rebuilds
        this.targetState = null;         // { state, holder, reason } of our target
        this.rpmF = null; this.rpmShown = null; this.lastTickT = 0;
        this._d = null;                  // 0.7.14: the car's data copied once for the tick / needle timer running now (_data)
        this.needleT = null;             // 0.7.14: the needles' own timer while "needleSmooth" is on (_needleApply)
        this.needleOver = null;          // { rpm, speed } the needles read inside that timer (_raw)
        this.needleHalt = false;         // stop() turned the needle timer off for good
        this.themeName = null;
        this.seeThru = {};               // layout name -> whether BMW's own bottom row shows through it (_seeThrough)
        this.flash = false;
        this.problem = null;             // why nothing shows (a bad layout), for the status line
        // 0.7.13: the KOMBI guard (KOMBI_* above): { layout, at } while tripped, read back after a restart
        this.kombiFile = path.join(ctx.dataDir || '.', KOMBI_FILE);
        this.kombiTrip = null;
        try { const t = JSON.parse(fs.readFileSync(this.kombiFile, 'utf8')); if (t && t.layout) this.kombiTrip = t; } catch (e) { /* none */ }
        this.kombiStrikes = [];
        this.kombiShownAt = 0;
        this.kombiPrev = null;
        this.statusListeners = [];
        this.lastStatus = null;

        this.slotsFile = path.join(ctx.dataDir || '.', 'slots.json');
        this.slotPicks = {};             // { layout: { slot id: sensor id } }: the readout slots' picks (page.js Readouts)
        try { this.slotPicks = JSON.parse(fs.readFileSync(this.slotsFile, 'utf8')) || {}; } catch (e) { /* none yet */ }
        this.layoutSlots = [];           // the active layout's "slots"
        this.placed = [];                // every layer made for the layout: { c, ref, x, y, w, h } (where the layout puts it)
        this.mapLayout = false;          // the active layout has a map window (a widget with holeWhen "mapUp")
        // the Waze map inside the theme (Cluster Themes, config.waze; waze.js): "mapUp" is on while it shows
        this.waze = this.config.waze ? new Waze(Object.assign({ dataDir: ctx.dataDir }, this.config.waze), this.log, () => this._guard('waze', () => {
            if (this.mapLayout && this.setting('mapUp') !== this.mapShown) this._rebuild(); else this._status();
        })) : null;
        this.mapShown = false;           // "mapUp" when the layout was built
        // the screen shared with the other app (screen.js): stepping aside while the driver gave it to the other one
        this.screen = new Screen(this.target === 'panel' ? 'cluster' : 'hud', ctx.dataDir, this.log,
            () => !!(this.started && this.activeName && this.activeName !== 'off'), () => this._guard('screen', () => this._rebuild()));
        this.testAt = null;              // the shift-light test's start (Date.now()), while it runs
        this.nightOn = false;            // the layout was built with the night colours (nightDim)
        this.look = null;                // 2026-11-14: the night look on now (a NIGHT_LOOKS entry), null: none
        this.lookName = null;
        this.baseTheme = null;           // the layout's theme before the night colours (the 6WB shaders take it with a look)
        this.wbLayout = false;           // the layout draws with WBDIAL / WBBACK (night looks apply)

        this._setupVehicleData();
        this.layouts.onChange(() => { this.seeThru = {}; this._rebuild(); });
        ctx.settings.onChange((key) => {
            if (LOOK_KEYS.indexOf(key) >= 0) this._kombiClear();      // 0.7.13: a theme picked: the guard lets it try again
            // a theme or layout picked anywhere (the page asks first, the kit's All settings list doesn't): no longer stepping aside
            if (LOOK_KEYS.indexOf(key) >= 0 && this.screen.yielded) this.screen.release();
            if (PLACE_KEYS.indexOf(key) >= 0) this._guard('place', () => this._place());
            else if (LIVE_KEYS.indexOf(key) >= 0 || ROW_KEYS.indexOf(key) >= 0) this.widgets.forEach((x) => { x.last = null; });
            else if (WB_LIVE_KEYS.indexOf(key) >= 0 && this._wbLive()) { /* package F: the uniforms are sent, no rebuild */ }
            else if (NIGHT_KEYS.indexOf(key) >= 0 && this._nightLive()) { /* 2026-11-14: the night colours changed in place */ }
            else if (key === 'needleSmooth') this._guard('needles', () => this._needleApply());   // 0.7.14: no rebuild
            else if (key !== 'demo') this._rebuild(); else this._status();
        });
    }

    /* ---------------- readout slots ---------------- */

    /** The sensor (sensors.js) slot `id` of `layout` shows: the pick, else the layout's default. */
    slotSensor(layout, id, slots) {
        const pick = (this.slotPicks[layout] || {})[id];
        if (pick && sensors.get(pick)) return sensors.get(pick);
        const def = (slots || []).find((x) => x.id === id);
        return def ? sensors.get(def.default) : null;
    }
    /** The slots of `layout` ([{ id, where, default }]), [] when it has none or can't be read. */
    slotsOf(layout) {
        if (layout === this.activeName) return this.layoutSlots;
        try { return this.layouts.load(layout).slots || []; } catch (e) { return []; }
    }
    /** Show `sensorId` in slot `id` of `layout` (null: back to its default); saved in <data>/slots.json, shown at once. */
    setSlot(layout, id, sensorId) {
        const m = this.slotPicks[layout] || (this.slotPicks[layout] = {});
        if (sensorId) m[id] = sensorId; else delete m[id];
        if (!Object.keys(m).length) delete this.slotPicks[layout];
        try { fs.writeFileSync(this.slotsFile, JSON.stringify(this.slotPicks, null, 1)); } catch (e) { this.log.warn('slots: cannot save ' + this.slotsFile + ' (' + e.message + ')'); }
        this.widgets.forEach((x) => { x.last = null; });       // the slot texts paint again on the next tick
        if (layout === this.activeName && this.shownW) this._setNeeds(this.shownW);
    }
    /** needsBoost / needsIntake from the widgets shown: their own text and the sensors their readout slots show
     *  (before Nov 8 2026 only the text counted, so a slot picked to intake never asked the engine unit). */
    _setNeeds(shown) {
        this.shownW = shown;
        const ids = [];
        shown.forEach((w) => [w].concat(Array.isArray(w.tiles) ? w.tiles : []).forEach((b) => {
            const sn = b && b.slot ? this.slotSensor(this.activeName, b.slot, this.layoutSlots) : null;
            if (sn) ids.push(sn.id);
        }));
        const j = JSON.stringify(shown) + ' ' + ids.join(' ');
        this.needsBoost = /boost/.test(j);
        this.needsIntake = /intake/.test(j);
        this.needsHv = /hvSoc/.test(j);
        this.needsFuel = /fuel/i.test(j);
    }
    /** A sensor's value now, as its slot shows it ('--' without one). */
    sensorValue(sn) { return sn ? this._token(sn.tok) : '--'; }
    sensorUnit(sn) {
        if (!sn) return '';
        const us = this.setting('units') === 'us';
        return sn.unit ? sn.unit(us) : this._token('ampm');
    }

    /* ---------------- the HUD's place ---------------- */

    /**
     * Move (hudX, hudY px) and scale (hudScale %) every layer of the layout, kept on the target: the move is cut
     * so the layout's box stays inside it. The scale is cluster-render's layer sx / sy about the layout's centre.
     */
    _place() {
        const off = this._offset(), sc = this._scale();
        if (!this.placed.length) return;
        const b = this._placedBox(), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        this.placed.forEach((l) => {
            const o = { x: l.x + off.x, y: l.y + off.y };
            if (sc !== 1 || l.scaled) { o.sx = sc; o.sy = sc; o.px = cx - l.x; o.py = cy - l.y; l.scaled = sc !== 1; }
            l.c.set(l.ref, o);
        });
    }
    _placedBox() {
        const ls = this.placed;
        if (!ls.length) return { x: 0, y: 0, w: 0, h: 0 };
        const x0 = Math.min.apply(null, ls.map((l) => l.x)), y0 = Math.min.apply(null, ls.map((l) => l.y));
        const x1 = Math.max.apply(null, ls.map((l) => l.x + l.w)), y1 = Math.max.apply(null, ls.map((l) => l.y + l.h));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    _scale() {
        if (!this.ctx.settings.item('hudScale')) return 1;
        const v = this.setting('hudScale');
        return isNum(v) && v >= 50 && v <= 150 ? v / 100 : 1;
    }
    /** The move asked for, cut so the layout (at its scale) stays on the target. */
    _offset() {
        if (!this.ctx.settings.item('hudX')) return { x: 0, y: 0 };
        const want = { x: this.setting('hudX') || 0, y: this.setting('hudY') || 0 };
        if (!this.placed.length) return want;
        const b = this._placedBox(), sc = this._scale();
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, hw = b.w * sc / 2, hh = b.h * sc / 2;
        const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
        return {
            x: Math.round(clamp(want.x, hw - cx, this.size[0] - hw - cx)),
            y: Math.round(clamp(want.y, hh - cy, this.size[1] - hh - cy)),
        };
    }
    /** Where the HUD sits now, for the page: { x, y, scale, box } (box: the layout's own, unmoved). */
    placeInfo() { return { x: this._offset().x, y: this._offset().y, scale: this._scale(), box: this._placedBox() }; }

    /** A setting's value, or its default when the saved value isn't one the schema allows. */
    setting(key) {
        // "mapUp": not saved, the Waze map is showing inside the theme now (the setting on, waze.js says so)
        if (key === 'mapUp') return !!(this.waze && this.waze.up && this.ctx.settings.get('mapInTheme') === true);
        const s = this.ctx.settings.item(key);
        const v = this.ctx.settings.get(key);
        if (!s) return v;
        const ok = s.type === 'bool' ? typeof v === 'boolean'
            : s.type === 'choice' ? (s.options || []).some((o) => o[0] === v)
                : s.type === 'number' ? isNum(v) && (!s.steps || s.steps.indexOf(v) >= 0) : true;
        return ok ? v : s.default;
    }

    _setupVehicleData() {
        const extra = {
            // fuel and range (cauliflowermossgrape's live_data, MIT): litres (255 = none) and km (4095 = none)
            'de.bmw.infotainment.KombiIF': {
                statusRangeTankStatus: (v) => {
                    const f = v && v.fluidLevelFuelTank, r = v && v.range;
                    this.fuelL = isNum(f) && f >= 0 && f < 255 ? f : null;
                    this.rangeKm = isNum(r) && r >= 0 && r < 4095 ? r : null;
                },
            },
            // audit/features: is the engine turning? CDS statusEngineStatus (rs, so the current value arrives at
            // subscribe). With the vehicle condition it decides where a rev needle rests while no rpm is on the
            // scale: READY (the car is drive-ready, auto start/stop has stopped the engine) or OFF. _restFrac.
            'de.bmw.infotainment.vehicle.CDS': {
                statusEngineStatus: (v) => {
                    const s = ENGINE_RUN[v && v.statusEngineRunDrive] || null;
                    if (s === this.engineRun) return;
                    this.engineRun = s;
                    this.log.info('engine: ' + (s || 'not known') + ' (' + JSON.stringify(v && v.statusEngineRunDrive) + ')');
                },
            },
            // 2026-11-15, the owner ("TPMS - забираємо і все"), from docs/FEATURE-AUDIT.md: the tyre watches are GONE.
            // The car never notifies TPMS (BMW's own x_call only ever reads it), so it had to be POLLED - four getter
            // round-trips every 10 s - and no widget in any layout of any app here shows a tyre value. The car's
            // display units (vehicle.Vehicle statusNewCurrentUnitsStatusExt) went with them: in this engine they only
            // ever fed _tyreBar / _tyreC, and {{u:temp}} / {{u:boost}} follow the "units" SETTING, not the car.
            // Putting them back is this block plus the two interfaces in the app's "signals" (see git history):
            //   'de.bmw.infotainment.vehicle.TPMS': { $pollMs: 10000, statusTyrePressure, statusTyreTemperature }
            //   'de.bmw.infotainment.vehicle.Vehicle': { statusNewCurrentUnitsStatusExt }
            // _tyreBar / _tyreC / carUnits / this.tyres and the {{tyreP:*}} / {{tyreT:*}} tokens are LEFT IN PLACE, so
            // a layout that wants tyres still reads "no value" instead of throwing, and one block brings it back.
            // S / M next to the gear: the gearbox status carries no programme on some cars, the M drive display does
            'de.bmw.infotainment.misc.MDrive': {
                dataDisplayGearbox: (v) => { this.program = PROGRAMS[v && v.displayProgramGearbox] || null; },
            },
            // outside temperature: raw * 0.5 - 40 deg C, 255 = none (car_vitals, MIT)
            'de.bmw.infrastructure.EnvironmentalInformation': {
                ExteriorTemperature: (v) => {
                    const t = v && v.temperatureExterior;
                    this.ambient = isNum(t) && t !== 255 ? t * 0.5 - 40 : null;
                },
            },
            'de.bmw.infotainment.drivingexcitement.FES': {
                statusSwitchDriveDynamicSport2: (v) => {
                    const raw = v && v.displayBoostPressure;
                    if (typeof raw !== 'number' || raw === BOOST_SCALE.invalid) return;
                    this.boostFes = raw * BOOST_SCALE.factor + BOOST_SCALE.offset;
                    this.boostFesAt = Date.now();
                },
                // the HMI's sport display: power and torque in % of the car's maximum (car_vitals, MIT); 255 = none
                statusVehicleDynamicEngine: (v) => {
                    const p = v && v.displaySportEnginePower, t = v && v.displaySportEngineTorque;
                    this.sportPower = isNum(p) && p >= 0 && p <= 150 ? p : null;
                    this.sportTorque = isNum(t) && t >= 0 && t <= 150 ? t : null;
                    this.sportAt = Date.now();
                },
                statusFESVehicleDynamicSwitchHMI: (v) => {
                    const raw = v && v.actualValueModeDrivingExperience;
                    const m = driveModeOf(raw), variant = m ? driveVariantOf(raw) : null;
                    if (!m) {
                        // a value we don't know (M cars: Efficient / Sport / Sport+, issue #8): logged and shown on the
                        // Settings tab's status line, so a driver can tell us what the car sends
                        const t = String(JSON.stringify(raw)).slice(0, 60);
                        if (t !== this.driveRaw) { this.driveRaw = t; this.log.info('drive mode not recognised: ' + t); this._status(); }
                        return;
                    }
                    this.driveRaw = null;
                    if (m === this.driveMode && variant === this.driveVariant) return;
                    this.log.info('drive mode ' + MODE_NAME[m] + (variant ? ' ' + variant : '') + ' (' + raw + ')');
                    this.driveMode = m; this.driveVariant = variant;
                    if (this._layoutName() !== this.activeName) this._rebuild(); else this._status();
                },
            },
        };
        // ---- package E: the speed-limit and no-overtaking signals (docs/POLISH-E-REPORT.md) ----------------------------
        // The speed limit the car knows (its sign camera / map data), for {{limit}} and the 6WB themes' sign. Which
        // field carries it isn't known yet (no public MGU app reads one; scripts/find_limit_signal.sh lists the car's
        // candidates), so app.json config.limit names it once the car's catalogue (someip-interfaces.json) has been
        // looked at: { iface, field, path: ["a", "b"] (into the field's value; [] or none: the value itself), factor (1),
        // unit: "kmh" | "mph", unitPath: [..] + mph: [raw unit values that mean mph] (when the field carries its own
        // unit), invalid: [raw values that mean "no limit known"], end: [raw values that mean "end of limit" /
        // unlimited], map: { "<raw>": km/h | "end" | null } (an enum field: wins over the rest), min (5), max (250) }.
        // The interface must also be listed in app.json "signals" (flag "s", or "rs" when it has a getter).
        // Without config.limit nothing is subscribed and the sign stays hidden on the car.
        // The state: limitState 'none' (nothing known: no sign), 'limit' (limitKmh), 'end' (the end-of-limit sign).
        const lim = this.config.limit;
        this.limitKmh = null; this.limitState = 'none'; this.limitRaw = undefined;
        const dig = (v, path) => { let r = v; (path || []).forEach((k) => { r = r === null || r === undefined ? r : r[k]; }); return r; };
        if (lim && lim.iface && lim.field) {
            extra[lim.iface] = Object.assign(extra[lim.iface] || {}, {
                [lim.field]: (v) => {
                    const raw = dig(v, lim.path), unitRaw = lim.unitPath ? dig(v, lim.unitPath) : undefined;
                    const stRaw = lim.statePath ? dig(v, lim.statePath) : undefined;      // car3 I: a separate state member
                    const t = String(JSON.stringify(raw)).slice(0, 80) + (lim.unitPath ? ' unit ' + String(JSON.stringify(unitRaw)).slice(0, 30) : '') +
                        (lim.statePath ? ' state ' + String(JSON.stringify(stRaw)).slice(0, 30) : '');
                    const s = limitOf(lim, raw, unitRaw, stRaw);
                    this.limitState = s.state; this.limitKmh = s.kmh;
                    if (t !== this.limitRaw) {      // to calibrate on the car: every new raw value once, with what it became
                        this.limitRaw = t;
                        this.log.info('speed limit raw: ' + t + ' -> ' + (s.state === 'limit' ? Math.round(s.kmh) + ' km/h' : s.state));
                    }
                },
            });
        }
        // No-overtaking sign (the 6WB themes' second sign), the same way: app.json config.nopass names the field once the car's
        // catalogue has been looked at: { iface, field, path: [..], on: [raw values that mean "no passing"] (default [1, true]) }.
        // Any other value (the end-of-no-overtaking sign included) hides it. None: hidden on the car.
        const np = this.config.nopass;
        this.nopassOn = false; this.nopassRaw = undefined;
        if (np && np.iface && np.field) {
            extra[np.iface] = Object.assign(extra[np.iface] || {}, {
                [np.field]: (v) => {
                    const raw = dig(v, np.path);
                    const t = String(JSON.stringify(raw)).slice(0, 80);
                    this.nopassOn = (Array.isArray(np.on) ? np.on : [1, true]).indexOf(raw) >= 0;
                    if (t !== this.nopassRaw) { this.nopassRaw = t; this.log.info('no-passing raw: ' + t + ' -> ' + (this.nopassOn ? 'on' : 'off')); }
                },
            });
        }
        // ---- end package E ------------------------------------------------------------------------------------------
        // ---- car3 I: auto start/stop (config.msa), the car's time zone (config.clock), a check-control message showing
        // (config.ccm). Each names its field once the car's catalogue has been read (scripts/car_signals.sh; the shapes
        // are at msaOf / tzOf / ccOf and in docs/CAR3-I-REPORT.md); its interface must also be under app.json "signals".
        // None named: nothing is subscribed (the MSA sign stays hidden, the clock keeps the "timeZone" setting). Every
        // new raw value is logged once with what it became ("msa raw", "clock raw", "check-control raw"), to calibrate.
        const watchRaw = (cfg, key, name, conv, after) => {
            if (!cfg || !cfg.iface || !cfg.field) return;
            extra[cfg.iface] = Object.assign(extra[cfg.iface] || {}, {
                [cfg.field]: (v) => {
                    const raw = cfg.path ? dig(v, cfg.path) : v;
                    const out = conv(v, raw), prev = this[key];
                    this[key] = out; this[key + 'At'] = Date.now();
                    if (after && out !== prev) after(prev, out);
                    // fix/cclist (0.7.19): "logOn" - [member names]: the WHOLE struct is logged, uncut, once per change
                    // of those members only (the car's clock sends its seconds every 10 s and the log rotates);
                    // "out": once per change of what it became. Without it: as before, the first 100 characters.
                    if (Array.isArray(cfg.logOn) || cfg.logOn === 'out') {
                        const k = cfg.logOn === 'out' ? JSON.stringify(out) : JSON.stringify(cfg.logOn.map((m) => (v && typeof v === 'object' ? v[m] : undefined)));
                        if (k !== this[key + 'Raw']) { this[key + 'Raw'] = k; this.log.info(name + ' raw: ' + String(JSON.stringify(v)).slice(0, 2000) + ' -> ' + JSON.stringify(out)); }
                        return;
                    }
                    const t = String(JSON.stringify(cfg.kind === 'local' || cfg.dstPath ? v : raw)).slice(0, 100);
                    if (t !== this[key + 'Raw']) { this[key + 'Raw'] = t; this.log.info(name + ' raw: ' + t + ' -> ' + JSON.stringify(out)); }
                },
            });
        };
        this.msaState = null; this.tzCar = null; this.ccShown = null;
        // fix/cclist (0.7.19): "a message shows" has two sources, merged by _ccMerge: config.ccm (newCCMessage, never
        // heard on the owner's car) and config.ccList (the list the car really sends). Whichever says one shows wins.
        this.ccmShown = null; this.ccmUnread = false; this.ccListShown = null; this.ccListUnread = false; this.ccListAny = false;
        this.tzLocal = null;
        watchRaw(this.config.msa, 'msaState', 'msa', (v, raw) => msaOf(this.config.msa, raw));
        // ---- fix/colour-daynight: the car's own day/night (config.dayNight, Vehicle.statusDayNightChangeOver), the
        // night colours' first source; _isNight falls back to the sun while it is missing or invalid. this.dnCar:
        // 'day' | 'night' | null. Each change of the car's value is logged once, as its number only.
        this.dnCar = null; this.dnCode = undefined; this.dnSource = null;
        const dn = this.config.dayNight;
        if (dn && dn.iface && dn.field) {
            extra[dn.iface] = Object.assign(extra[dn.iface] || {}, {
                [dn.field]: (v) => {
                    const raw = dig(v, dn.path);
                    const out = dayNightOf(dn, raw), was = this.dnCar;
                    if (out !== 'keep') this.dnCar = out;          // 'keep' (no change): the last day/night holds
                    const code = isNum(raw) ? raw : dn.codes && dn.codes.hasOwnProperty(raw) ? dn.codes[raw] : '?';
                    if (code !== this.dnCode) {
                        this.dnCode = code;
                        this.log.info('day/night: the car says ' + code + ' -> ' + (out || 'invalid'));
                    }
                    if (this.dnCar !== was && this.started) this._guard('day/night', () => this._dayNightCheck());
                },
            });
        }
        // ---- end fix/colour-daynight
        // the first time zone from the car (or its loss) can flip 6WB Dials' clock "auto" between BMW's and ours: rebuild then
        // 2026-11-15 (the owner): the car's own clock, so our clock needs no manual time zone. The encoding of the
        // car's offset is a guess until the car says otherwise, so while config.clock.confirm is not true the value
        // is only parsed and LOGGED and our clock keeps using the "timeZone" setting: a wrong guess cannot put a
        // wrong time on the cluster.
        watchRaw(this.config.clock, 'tzCar', 'clock', (v) => {
            const c = this.config.clock, off = tzOf(c, v, Date.now());
            if (c && c.confirm !== true) {
                if (off !== this.tzCandidate) {
                    this.tzCandidate = off;
                    this.log.info('clock: the car\'s offset would be ' + off + ' minutes (app.json config.clock.confirm is not true, so our clock still follows the "timeZone" setting)');
                }
                return null;
            }
            // package X: only a whole number of quarter hours within +-14 h is a time zone; anything else says the
            // encoding guess (config.clock.factor / offsetBy) is wrong, so it is unknown and the next source is used
            if (off !== null && !tzOk(off)) {
                if (off !== this.tzRejected) {
                    this.tzRejected = off;
                    this.log.warn('clock: the car\'s offset decodes to ' + off + ' minutes, not a whole number of quarter hours within +-14 h: ignored (check app.json config.clock factor / offsetBy)');
                }
                return null;
            }
            return off;
        }, (prev, out) => { if (isNum(prev) !== isNum(out) && this.client && this.client.ready) this._rebuild(); });
        // ---- fix/cclist (0.7.19): the car's time zone from the time the CLUSTER SHOWS, the fallback after config.clock.
        // On the owner's car timeDateUTC's statusClockTimeDateUTC reads UHRZEIT_UEBER_UTC_VERFUEGBAR_..._OFFSETS_NICHT_
        // VERFUEGBAR ("UTC available, offsets NOT available") and its offset gives none. config.clockLocal names a
        // field with the local hour and minute (KombiIF statusShowTimeDate: displayHour / displayMinute), and tzOf
        // kind "local" takes the difference to the unit's UTC clock, rounded to 15 minutes. Used only while
        // config.clock gives no zone (_tzSource). Logged once per change of the offset it gives (logOn "out").
        watchRaw(this.config.clockLocal, 'tzLocal', 'clock (local)', (v) => {
            const off = tzOf(this.config.clockLocal, v, Date.now());
            return off !== null && tzOk(off) ? off : null;
        }, (prev, out) => {
            if (!tzOk(this.tzCar) && isNum(prev) !== isNum(out) && this.client && this.client.ready) this._rebuild();
        });
        // ---- end fix/cclist (clock) ----
        watchRaw(this.config.ccm, 'ccmShown', 'check-control', (v) => ccOf(this.config.ccm, v), () => this._ccMerge());
        // strip integration, decision 7: BMW's marker right of its panel opens only while a CONFIRMED field says BMW
        // draws it (config.ccMarker, null today: _markShown). "shownWhen" lists the raw values meaning "shown"; without
        // it a truthy value does. The lane (and the tacho's box window) follow at once (_ccPush).
        this.ccMarkerOn = null;
        watchRaw(this.config.ccMarker, 'ccMarkerOn', 'marker', (v, raw) => {
            const c = this.config.ccMarker;
            return Array.isArray(c.shownWhen) ? c.shownWhen.map(String).indexOf(String(raw)) >= 0 : !!raw;
        }, () => { this._ccPush(); });
        // The drive mode from another field (config.drive { iface, field, path, map: { "<raw>": "COMFORT" | "SPORT_PLUS" |
        // "ECO_PRO" | 4 ... } }), when FES statusFESVehicleDynamicSwitchHMI gives nothing on a car (the owner's, photos 33
        // and 41). Its value goes through the very same handler (driveModeOf / driveVariantOf, the layout by drive mode), so
        // nothing about how a layout is chosen changes. Unset: only the FES field, as before.
        const dc = this.config.drive, fes = extra['de.bmw.infotainment.drivingexcitement.FES'].statusFESVehicleDynamicSwitchHMI;
        if (dc && dc.iface && dc.field) {
            extra[dc.iface] = Object.assign(extra[dc.iface] || {}, {
                [dc.field]: (v) => {
                    let raw = dc.path ? dig(v, dc.path) : v;
                    if (dc.map && typeof dc.map === 'object' && Object.prototype.hasOwnProperty.call(dc.map, String(raw))) raw = dc.map[String(raw)];
                    fes({ actualValueModeDrivingExperience: raw });
                },
            });
        }
        // ---- end car3 I ---------------------------------------------------------------------------------------------
        // ---- bottom row (docs/BOTTOM-ROW-PACKAGE.md): the car's own speed-limit struct, check-control message, road
        // label and guidance. Each is OPTIONAL and configurable (config.sign / config.ccm kind "message" / config.road /
        // config.onRoad / config.nav); with none of them named nothing is subscribed and everything behaves as before.
        // What is drawn is decided by the one "bottomRow" setting, not by what the car sends: the default ("allG20")
        // leaves our windows open, as today, and only logs the shapes so they can be calibrated on the car.
        // PRIVACY: the message text, the road name and the position are personal data and are never logged. Only shapes
        // (kinds, lengths, enum values) go to the log, each once.
        this.sign = Object.assign({}, SIGN_NONE); this.signShape = undefined; this.signLogs = 0;
        this.ccMsg = { name: '', desc: '', color: null, symbol: null, id: null, type: null };
        this.ccMsgAt = 0; this.ccShape = undefined; this.ccLogs = 0; this.ccAny = false;
        this.road = ''; this.roadAt = 0; this.roadShapeSeen = undefined;
        this.onRoad = null; this.navState = null; this.navDist = ''; this.navUnit = null; this.navEta = null; this.navMins = null;
        this.navShape = undefined; this.posShape = undefined;
        const watchOne = (cfg, fn) => {
            if (!cfg || !cfg.iface || !cfg.field) return false;
            const e = extra[cfg.iface] = extra[cfg.iface] || {};
            if (cfg.instance) e.$instance = cfg.instance;       // Guidance is Main_Instance (128), not 1
            e[cfg.field] = (v) => fn(v);
            return true;
        };
        // The speed-limit sign: one struct with the value, its unit, the warning level, the supplemental sign, the
        // symbol style and the no-passing restriction (shape: signOf). It also feeds limitState / limitKmh / nopassOn,
        // so {{limit}}, the WBSIGN layer and the over-limit arc work as they did from config.limit.
        const sg = this.config.sign;
        watchOne(sg, (v) => {
            const s = signOf(sg, v);
            this.sign = s; this.signAt = Date.now();
            this.limitState = s.state; this.limitKmh = s.kmh;
            this.nopassOn = NP_ON.indexOf(s.np) >= 0;
            // a road sign is not personal data, but the log still says the SHAPE: each new combination once, at most 24
            const key = s.state + '|' + (s.state === 'limit' ? Math.round(s.kmh) : '-') + '|' + s.unit + '|' + s.warn +
                '|' + s.supp + '|' + s.style + '|' + s.sure + '|' + s.np + '|' + (s.npM === null ? '-' : 'dist');
            if (key !== this.signShape && this.signLogs < 24) {
                this.signShape = key; this.signLogs++;
                this.log.info('sign: ' + key.split('|').join(' ') + ' (state value unit warn supplemental style sure no-passing distance)');
            }
        });
        // The check-control message (a union of two structs; shape: ccMsgOf). It also feeds ccShown, so "cc:shown" /
        // "cc:none" and the message window work whether config.ccm names this shape or the older flag / list one.
        const cm = this.config.ccm;
        if (cm && cm.kind === 'message') {
            watchOne(cm, (v) => {
                const m = ccMsgOf(cm, v);
                this.ccMsg = m; this.ccMsgAt = Date.now();
                // package X, the safety rule: a message we cannot READ still counts as a message showing. Unreadable:
                // no name and no description, but a symbol or an id says one is there; or, once a struct has fit, a
                // notification none of config.ccm's roots fits. Then BMW's panel opens (_ccOpen) and, since our text
                // can never stand in for it, the row goes back to BMW's (the latch says why, once).
                const readable = !!(m.name || m.desc);
                const marked = (isNum(m.symbol) && m.symbol !== 0) || (isNum(m.id) && m.id !== 0 && !inList(cm.clearIds, m.id));
                const fits = readable || m.symbol !== null || m.id !== null || m.type !== null;
                this.ccmUnread = !readable && (marked || (this.ccAny === true && !fits));
                this.ccmShown = readable || this.ccmUnread;
                this._ccMerge();
                if (this.ccmUnread) {
                    this._rowFail('info', 'a check-control message arrived that app.json config.ccm cannot read (' +
                        (fits ? 'symbol ' + m.symbol + ', id ' + m.id + ', no name or description' : 'no root of the union fits') + ')');
                }
                // 2026-11-16: did our paths find ANYTHING in the car's struct? A struct that fits carries its id and
                // its type even with no message on; one that does not gives all five back empty, and then the info
                // field is not ours and BMW's panel stays open (_ccWired). Sticky, and no text ever leaves here.
                // The first one that does makes the info field ours, so the layout is rebuilt then - our own text
                // widgets are only built at a rebuild, the way the car's first time zone brings our clock in.
                if (!this.ccAny && (m.name || m.desc || m.symbol !== null || m.id !== null || m.type !== null)) {
                    const was = this._ccWired();     // fix/cclist: ccList may have wired the field already
                    this.ccAny = true;
                    if (!was && this.client && this.client.ready) this._rebuild();
                }
                const key = (m.name ? 'name ' + m.name.length + ' chars' : 'no name') + ', ' +
                    (m.desc ? 'description ' + m.desc.length + ' chars' : 'no description') +
                    ', colour ' + m.color + ', symbol ' + m.symbol + ', id ' + m.id + ', type ' + m.type;   // package X: + the id (not personal)
                if (key !== this.ccShape && this.ccLogs < 24) {    // lengths and enums only: never the text
                    this.ccShape = key; this.ccLogs++;
                    this.log.info('check-control message: ' + key);
                }
                this._ccPush();         // package X: BMW's panel opens in THIS event, not at the next tick
            });
        }
        // Several messages at once: the car cycles through its check-control list, so we do the same (the owner,
        // 2026-11-15). config.ccList names the list field; each element gives a short name and a colour.
        // THE SEAM: docs/G20-DESIGN-SPEC.md is measuring the stock order and timing; CC_CYCLE_MS / config.ccm.cycleMs
        // is the one number to change.
        // ---- fix/cclist (0.7.19, the owner's car, 2026-11-17): newCCMessage never sends anything on that car, but
        // ccList is live and carries the message on show. Resting: one entry, id 0 GREEN symbol 6; driver's door open:
        // one entry, id 15 WHITE symbol 2, its name 16 characters; door shut: id 0 again. So ccList is now the PRIMARY
        // source of "a message shows" (an entry whose id is not in config.ccList.ignoreIds, default [0]) and of our
        // message's headline (cCShortName), colour (cCColor, and from it the severity) and symbol id (cCListSymbolID).
        // An entry we must show but cannot read (no name) still counts as showing and latches the row (ccListUnread),
        // as an unreadable newCCMessage does. Any notification that is a list whose entries fit config.ccList.root
        // makes the field READ (ccListAny, _ccWired): from then on the blind case is over. Lengths, ids and colours
        // only go to the log, never the text.
        // ---- fix/active-cc (0.7.20, the owner's car 2026-11-17): ccList lists the ACTIVE AND THE STORED messages, not
        // what is on the screen - a ready-to-drive message (id 987) stayed in it after BMW had hidden it (~20 s, the
        // manual), and our area stayed open / drawn with nothing of BMW's there. So the handler below only RECORDS the
        // list (ccListAll); which of its entries shows is decided by _ccListEval: by the cluster's own "message shown
        // now" (config.ccActive, KombiIF statusActiveCCMessage) once that has spoken, else by a time-limited fallback.
        const cl = this.config.ccList;
        this.ccItems = []; this.ccListShape = undefined; this.ccListLogs = 0;
        this.ccListAll = null; this.ccListSeen = {}; this.ccNoMatch = null;
        if (cl && cl.iface && cl.field) {
            const ignore = Array.isArray(cl.ignoreIds) ? cl.ignoreIds : [0];
            watchOne(cl, (v) => {
                const arr = pick(v, cl.path);
                const all = [], ids = [];
                let fits = Array.isArray(arr);
                (Array.isArray(arr) ? arr : []).forEach((e, i) => {
                    const m = cl.root ? pick(e, cl.root) : e;
                    if (!m || typeof m !== 'object') { fits = false; return; }
                    const idRaw = cl.idPath ? pick(m, cl.idPath) : undefined, id = isNum(idRaw) ? idRaw : null;
                    const n = pick(m, cl.namePath);
                    const sy = cl.symbolPath ? pick(m, cl.symbolPath) : undefined;
                    const color = mapRaw(m, cl.colorPath, cl.colorMap, null) || null;
                    const ignored = id !== null && inList(ignore, id);      // the car's resting entry: no message
                    if (!ignored) ids.push(id === null ? '-' : String(id) + ' ' + (color || '?'));
                    all.push({ key: id === null ? 'at ' + i : 'id ' + id, ignored: ignored, id: id, color: color,
                        name: typeof n === 'string' && n.trim() ? n.slice(0, 300) : null, symbol: isNum(sy) ? sy : null });
                });
                const now = Date.now();
                if (fits) {
                    // fix/active-cc: when each entry was FIRST listed (the fallback's clock); an entry that leaves the
                    // list and comes back starts again
                    const seen = {};
                    all.forEach((e) => { if (!e.ignored) seen[e.key] = this.ccListSeen[e.key] || now; });
                    this.ccListSeen = seen;
                    this.ccListAll = all.slice(0, 32);
                }
                if (fits && !this.ccListAny) {
                    const was = this._ccWired();
                    this.ccListAny = true;
                    if (!was && this.client && this.client.ready) this._rebuild();
                }
                this._ccListEval(now, false);
                // lengths, ids and colours only: never the text ("N messages" counts the readable ones listed)
                const named = all.filter((e) => !e.ignored && e.name), unread = all.filter((e) => !e.ignored && !e.name).length;
                const key = named.length + ' messages, name lengths ' + named.map((o) => o.name.length).join('/') +
                    (fits ? '' : ' (not a list config.ccList fits)') + '; listed ' + (ids.length ? ids.join(', ') : 'none') +
                    (Array.isArray(arr) ? ' of ' + arr.length + ' entries' : '') + (unread ? ', ' + unread + ' with no name' : '');
                if (key !== this.ccListShape && this.ccListLogs < 40) {
                    this.ccListShape = key; this.ccListLogs++;
                    this.log.info('check-control list: ' + key);
                }
                this._ccPush();         // package X: another message on show opens BMW's panel at once
            });
        }
        // ---- fix/active-cc: the cluster's own "message shown now" (config.ccActive: KombiIF statusActiveCCMessage,
        // struct ActiveCCMessageWrapper; getter 1, notifier 32769). Every change is logged once, numbers only. Once it
        // has notified with a number ("wired", ccActAny) it alone says whether a message shows: one does while its
        // number is not in config.ccActive.noneValues (default [0]); text, colour and severity then come from the
        // ccList entry whose id is that number (_ccListEval). Whether the numbering is ccList's is UNCONFIRMED.
        const ca = this.config.ccActive;
        this.ccAct = null; this.ccActAny = false; this.ccActLogged = undefined; this.ccNoMatchLogged = {};
        if (ca && ca.iface && ca.field) {
            watchOne(ca, (v) => {
                const num = (p) => { const r = p ? pick(v, p) : undefined; return isNum(r) ? r : null; };
                const a = { number: num(ca.numberPath), control: num(ca.controlPath), frameNumber: num(ca.frameNumberPath),
                    frame: num(ca.framePath), utility: num(ca.utilityPath) };
                const line = 'number ' + a.number + ' control ' + a.control + ' frame ' + a.frameNumber + '/' + a.frame + ' utility ' + a.utility;
                if (line !== this.ccActLogged) { this.ccActLogged = line; this.log.info('active cc: ' + line); }
                if (a.number === null) return;      // not a struct our paths fit: it decides nothing
                this.ccAct = a;
                if (!this.ccActAny) {
                    const was = this._ccWired();
                    this.ccActAny = true;
                    this.log.info('active cc: wired - from now on it alone says whether a message shows');
                    if (!was && this.client && this.client.ready) this._rebuild();
                }
                this._ccListEval(Date.now(), false);
                this._ccPush();
            });
        }
        // ---- end fix/active-cc (handler) ----
        // ---- end fix/cclist (handler) ----
        // Which frame of how many the stock cluster is showing (docs/G20-DESIGN-SPEC.md: it cycles numbered frames,
        // it does not stack or side-scroll). KombiIF statusMenuCCMessage carries the frame number, the count and up
        // to three message ids, so ours can follow the car's own frame instead of guessing a period.
        const cf = this.config.ccFrames;
        this.ccFrame = { n: null, of: null, ids: [] }; this.ccFrameShape = undefined;
        if (cf && cf.iface && cf.field) {
            watchOne(cf, (v) => {
                const n = pick(v, cf.numPath), of = pick(v, cf.countPath);
                const ids = (Array.isArray(cf.idPaths) ? cf.idPaths : []).map((p) => pick(v, p)).filter(isNum);
                this.ccFrame = { n: isNum(n) ? n : null, of: isNum(of) ? of : null, ids: ids };
                const key = 'frame ' + this.ccFrame.n + ' of ' + this.ccFrame.of + ', ' + ids.length + ' ids';
                if (key !== this.ccFrameShape) { this.ccFrameShape = key; this.log.info('check-control frames: ' + key); }
                this._ccPush();         // package X: the car's next frame opens BMW's panel at once
            });
        }
        // The driver's own speed-limit settings (config.sla), SUBSCRIBE ONLY: app.json declares these fields "s", not
        // "rws", so our generated interface config has no setter and the app cannot write one. The "r" is gone because
        // the car's getters for all six carry {"id": 0} and the installer reads a zero id as no getter at all (it
        // refused 0.7.16 outright); the notifiers are real, so watchOne below still gets every value. They say whether the
        // driver asked for the excess-speed warning at all, and with what tolerance; the arc on our speed scale
        // follows the car's own verdict (displaySpeedLimitWarning) rather than a comparison of our own.
        const sl = this.config.sla;
        this.sla = {}; this.slaShape = undefined;
        if (sl && sl.iface && Array.isArray(sl.parts)) {
            sl.parts.forEach((p) => {
                if (!p || !p.field) return;
                watchOne({ iface: sl.iface, field: p.field, instance: sl.instance }, (v) => {
                    const raw = pick(v, p.valuePath);
                    this.sla[p.key] = p.number ? (isNum(raw) ? raw : null) : mapRaw(v, p.valuePath, sl.onMap, null);
                    this.sla[p.key + 'Avail'] = mapRaw(v, p.availPath, sl.availMap, null);
                    const key = Object.keys(this.sla).sort().map((k) => k + ' ' + this.sla[k]).join(', ');
                    if (key !== this.slaShape) { this.slaShape = key; this.log.info('speed-limit settings: ' + key); }
                });
            });
        }
        // The road label (an array of text / spacer / icon elements; shape: roadOf). Its text is never logged.
        const rd = this.config.road;
        watchOne(rd, (v) => {
            this.road = roadOf(rd, v); this.roadAt = Date.now();
            const key = roadShape(rd, v) + ', ' + this.road.length + ' chars';
            if (key !== this.roadShapeSeen) { this.roadShapeSeen = key; this.log.info('road label: ' + key); }
        });
        watchOne(this.config.onRoad, (v) => {
            const r = this.config.onRoad.path ? dig(v, this.config.onRoad.path) : v;
            this.onRoad = r === true || r === 1 ? true : r === false || r === 0 ? false : null;
        });
        // Guidance and position (NavigationStatus). The position is personal data: only the NAMES of the address
        // members that arrived are logged, never their values, and the coordinates are not read at all.
        const nv = this.config.nav;
        if (nv && nv.iface) {
            const one = (part, fn) => { if (part && part.field) watchOne({ iface: nv.iface, field: part.field, instance: nv.instance }, fn); };
            one(nv.state, (v) => {
                const s = mapRaw(v, nv.state.path, nv.state.map, null);
                if (s !== this.navState) { this.navState = s; this.log.info('navigation: guiding ' + s); }
            });
            one(nv.next, (v) => {
                const p = nv.next;
                const d = pick(v, p.distPath), u = p.unitPath ? pick(v, p.unitPath) : null;
                this.navDist = typeof d === 'string' ? d.slice(0, 12) : typeof d === 'number' && isFinite(d) ? String(Math.round(d)) : '';
                this.navUnit = mapRaw(v, p.unitPath, p.unitMap, u === null || u === undefined ? null : String(u));
                const eta = p.etaPath ? pick(v, p.etaPath) : null;
                const okEta = eta && typeof eta === 'object' && !eta[p.etaInvalidKey || 'invalid'] &&
                    typeof eta[p.etaHourKey || 'hour'] === 'number' && typeof eta[p.etaMinuteKey || 'minute'] === 'number';
                this.navEta = okEta ? { h: eta[p.etaHourKey || 'hour'], m: eta[p.etaMinuteKey || 'minute'] } : null;
                const t = p.timePath ? pick(v, p.timePath) : null;
                this.navMins = typeof t === 'number' && isFinite(t) && t > 0 && t < 86400 * 7 ? Math.round(t / 60) : null;
                const key = 'distance ' + this.navDist.length + ' chars, unit ' + this.navUnit + ', eta ' + (this.navEta ? 'valid' : 'none') +
                    ', travel time ' + (this.navMins === null ? 'none' : 'valid');
                if (key !== this.navShape) { this.navShape = key; this.log.info('navigation: ' + key); }
            });
            one(nv.here, (v) => {
                const p = nv.here;
                this.posValid = pick(v, p.validPath) === true;
                const txt = (q) => { const s = pick(v, q); return typeof s === 'string' ? s : ''; };
                this.posStreet = txt(p.streetPath); this.posCity = txt(p.cityPath);
                // the coordinates: for sunrise and sunset only (_location), never logged, never sent anywhere
                const la = pick(v, p.latPath), lo = pick(v, p.lonPath);
                if (this.posValid && isNum(la) && isNum(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la || lo)) {
                    const moved = !isNum(this.posLat) || Math.abs(la - this.posLat) > 0.5 || Math.abs(lo - this.posLon) > 0.5;
                    this.posLat = la; this.posLon = lo; this.posAt = Date.now();
                    // a big move can change sunset: let the night colours follow (they are re-checked every minute)
                    if (moved && !this.posMoved) { this.posMoved = true; this.log.info('position: coordinates in use for sunrise and sunset (never logged)'); }
                }
                // the NAMES of the members that carry something, never their values (personal data)
                const key = (this.posValid ? 'valid' : 'not valid') + ', ' +
                    [['street', this.posStreet], ['city', this.posCity], ['coordinates', isNum(this.posLat) ? 1 : '']]
                        .filter((a) => a[1]).map((a) => a[0]).join(' + ');
                if (key !== this.posShape) { this.posShape = key; this.log.info('position: ' + key + ' (contents are never logged)'); }
            });
        }
        // ---- end bottom row -------------------------------------------------------------------------------------------
        // Instant fuel consumption (the 6WB Comfort theme's EfficientDynamics arc and {{cons}}), the same way: app.json
        // config.cons names the field once the car's catalogue has been looked at: { iface, field, path: [..], factor (1),
        // unit: "l100" | "lh" (litres per hour: divided by the speed), invalid: [..] }. None: "--" on the car.
        const cs = this.config.cons;
        this.consL = null; this.consAt = 0; this.consRaw = undefined;
        if (cs && cs.iface && cs.field) {
            extra[cs.iface] = Object.assign(extra[cs.iface] || {}, {
                [cs.field]: (v) => {
                    let raw = v;
                    (cs.path || []).forEach((k) => { raw = raw === null || raw === undefined ? raw : raw[k]; });
                    const t = String(JSON.stringify(raw)).slice(0, 80);
                    if (t !== this.consRaw) { this.consRaw = t; this.log.info('consumption raw: ' + t); }
                    if (typeof raw !== 'number' || !isFinite(raw) || (cs.invalid || []).indexOf(raw) >= 0) { this.consL = null; return; }
                    let l = raw * (isNum(cs.factor) ? cs.factor : 1);
                    if (cs.unit === 'lh') { const sp = this.car && this.car.data().speed; l = isNum(sp) && sp > 3 ? l / sp * 100 : null; }
                    this.consL = isNum(l) && l >= 0 && l < 100 ? l : null;
                    this.consAt = Date.now();
                },
            });
        }
        // ---- probes, item 2 (0.7.18, READ ONLY / LOG ONLY; see "probes" above HudApp): the stored check-control
        // lists, chained IN FRONT of any handler already on the field (config.ccList's), which still runs as before
        this._probeWire(extra);
        // ---- end probes ----
        // "condition": BMW's own vehicle state (VehicleCondition), data().condition, 10 = FAHREN (drive-ready). Used
        // by _restFrac to tell READY from OFF on a rev dial. audit/features.
        this.car = new Car(this.ctx, ['rpm', 'speed', 'temps', 'accel', 'gear', 'torque', 'condition'], extra);
        this.car.setRedline(this._redline());
        this.gBuf = [];                  // [t, lat, long] of the last G_AVG_MS
        this.gSm = null;                 // { lat, long, at }: their average
        this.car.onSample((d, t) => this._gSample(d, t), () => { this.gBuf = []; this.gSm = null; this.resetG(); });
        this.resetG();
        // 0.7.14, the smooth needles: every rpm / speed sample with its time (kept whether or not the setting is on)
        this._needleReset();
        this.car.onSample((d, t) => this._needleSample(d, t), () => this._needleReset());
        this.score = new ShiftScore(this.car, () => ({
            redline: this._redline(), shiftBefore: this._shiftBefore(), coldGuard: this.setting('coldGuard'),
        }), this.log);
    }

    /**
     * Connection i to cluster-render, made on first use: 0 is the app's own (named after the app); a widget's
     * "conn" asks for 1..3, named <app id>_2 .. _4, each with its own 8 layers. Layers made before a connection
     * is up are replayed by the client when it connects.
     */
    _clientAt(i) {
        while (this.clients.length <= i) {
            const ci = this.clients.length;
            const c = new ClusterRender(ci ? this.ctx.spec.id + '_' + (ci + 1) : this.ctx.spec.id, this.socketPath);
            this.clients.push(c);
            this._wireClientEvents(c, ci);
            if (this.started) { this.log.info('connection ' + (ci + 1) + ' to cluster-render'); c.connect(); }
        }
        return this.clients[i];
    }

    _wireClientEvents(c, ci) {
        const tag = ci ? ' [connection ' + (ci + 1) + ']' : '';
        c.on('ready', () => { this.log.info('cluster-render ready' + tag + ' (backend=' + c.backend + ')'); if (ci === 0) this._rebuild(); else this._status(); });
        c.on('disconnected', () => { this.log.warn('cluster-render disconnected' + tag + ', client will retry'); this._status(); });
        c.on('layer', (ref, state, reason) => {
            const key = ci + ':' + ref;
            const old = this.layerStates.get(key);
            this.layerStates.set(key, { state, reason });
            if (state === 'error' || ((state === 'waiting' || state === 'stalled') && (!old || old.state !== state))) {
                const w = this._widgetOf(ci, ref);
                this.log.warn('layer ' + ref + tag + (w ? ' (' + w + ')' : '') + ' ' + state + (reason ? ': ' + reason : ''));
            }
            this._statusSoon();
        });
        c.on('target', (name, state, holder, reason) => {
            if (name !== this.target) return;
            this.targetState = { state, holder, reason };
            this.log.info('target ' + name + tag + ' ' + state + (holder ? ' (holder ' + holder + ')' : '') + (reason ? ': ' + reason : ''));
            if (!ci) this._guard('kombi guard', () => this._kombiWatch(state, holder, reason));
            this._statusSoon();
        });
        c.on('refused', (op, ref, reason) => {
            const w = this._widgetOf(ci, ref);
            this.log.warn('refused ' + op + ' on ' + ref + tag + (w ? ' (' + w + ')' : '') + ': ' + reason);
            if (!this.refused) this.refused = (w || op) + ': ' + reason;   // the first one, until the next rebuild
            this._statusSoon();
        });
        c.on('budget', (capKb, maxKb, reason) => this.log.info('budget' + tag + ' ' + capKb + '/' + maxKb + ' kb/s (' + reason + ')'));
        c.on('status', (text) => this.log.info('cluster-render status: ' + text));
    }

    start() {
        this.log.info('connecting to cluster-render at ' + this.socketPath);
        this.started = true;
        this.clients.forEach((c) => c.connect());
        this.tickTimer = setInterval(() => this._guard('tick', () => this._tick()), TICK_MS);
        this.needleHalt = false;
        this._needleApply();    // 0.7.14: the needles' own timer while "needleSmooth" is on
        // Auto theme: check for sunrise / sunset once a minute; the status line too
        this.themeTimer = setInterval(() => this._guard('theme check', () => {
            if (this._themeName() !== this.themeName) this._rebuild();
            else if (this._nightDim() !== this.nightOn && !this._nightLive()) this._rebuild();     // 2026-11-14: in place if it can
            this._status();
        }), 60000);
        this.statusTimer = setInterval(() => this._guard('status', () => this._status()), 5000);
        this._status();
        this._startDme();
        if (this.waze) { this.waze.start(); this._wazeWant(); }
        this.screen.start();
        this._perfStart();      // package P: off unless <data>/perf.json asks (see PERF below)
        this._guard('probes', () => this._probeSymbolsLater());     // probes, item 3: the symbol list, once (0.7.18)
    }

    /** Waze's map on the panel only while the setting is on and the theme shown has a map window. */
    _wazeWant() {
        if (this.waze) this.waze.want(this.started && this.setting('mapInTheme') === true && this.mapLayout);
    }

    /** Boost from the engine unit when the sport display's value isn't there (config.dme, read-only UDS). */
    _startDme() {
        const dme = this.config.dme;
        const hasBoost = !!(dme && Array.isArray(dme.boost) && dme.boost.length);
        const hasIntake = !!(dme && Array.isArray(dme.intake) && dme.intake.length);
        let rd = null, busy = false, baro = 101.3, baroAt = 0, intakeAsk = 0, hvAsk = 0, hvMiss = 0, fuelAsk = 0, fuelMiss = 0;
        try {
            const { Diag } = require('./kit/diag');
            const { DidReader } = require('./kit/dids');
            const link = new Diag(this.ctx.signals, this.log);
            link.quiet = true;
            Promise.resolve().then(() => link.init()).catch((e) => this.log.info('engine unit link not available: ' + (e && e.message || e)));
            rd = new DidReader(link, { ecu: (dme && dme.ecu) || 18 });
        } catch (e) { this.log.info('engine unit boost off: ' + (e && e.message || e)); return; }
        this.dmeTimer = setInterval(() => this._guard('engine unit boost', () => {
            const now = Date.now();
            const wantBoost = hasBoost && this.needsBoost && now - this.boostFesAt >= FRESH_MS;
            const wantIntake = hasIntake && this.needsIntake && now - intakeAsk >= 2000;   // a temperature: every 2 s is plenty
            const wantHv = this.needsHv && now - hvAsk >= (hvMiss >= 3 ? HV_RETRY_MS : HV_EVERY_MS);
            const wantFuel = this.needsFuel && now - fuelAsk >= (fuelMiss >= 3 ? FUEL_RETRY_MS : FUEL_EVERY_MS);
            if (busy || this._data().demo || (!wantBoost && !wantIntake && !wantHv && !wantFuel)) return;
            busy = true;
            (async () => {
                if (wantFuel) {
                    fuelAsk = now;
                    const v = await rd.read(FUEL_OBD);
                    if (isNum(v)) {
                        if (fuelMiss >= 3 || !isNum(this.fuelObd)) this.log.info('fuel level: ' + v.toFixed(0) + ' % from the engine unit (OBD 2F)');
                        this.fuelObd = v; this.fuelObdAt = Date.now(); fuelMiss = 0;
                    } else if (++fuelMiss === 3) {
                        this.log.info('fuel level: the engine unit gives no OBD 2F (' + ((rd.raws[rd.key(FUEL_OBD)] || {}).why || '?') + '); litres / tank size, asked again every 5 min');
                    }
                }
                if (wantHv) {
                    hvAsk = now;
                    const v = await rd.read(HV_SOC);
                    if (isNum(v)) {
                        if (hvMiss >= 3 || !isNum(this.hvSoc)) this.log.info('hybrid battery: ' + v.toFixed(1) + ' % from the battery unit (SME 0x07, DDBC)');
                        this.hvSoc = v; this.hvSocAt = Date.now(); hvMiss = 0;
                    } else if (++hvMiss === 3) {
                        this.log.info('hybrid battery: no answer from the battery unit (' + ((rd.raws[rd.key(HV_SOC)] || {}).why || '?') + '); asked once a minute');
                    }
                }
                if (wantIntake) {
                    intakeAsk = now;
                    const t = await rd.value('intake', dme.intake);
                    if (isNum(t)) { this.intakeDme = t; this.intakeDmeAt = Date.now(); }
                }
                if (!wantBoost) return;
                if (now - baroAt > 60000 && Array.isArray(dme.baro)) {
                    baroAt = now;
                    const b = await rd.value('baro', dme.baro);
                    if (isNum(b)) baro = b;
                }
                const m = await rd.value('boost', dme.boost);
                if (isNum(m)) { this.boostDme = (m - baro) / 100; this.boostDmeAt = Date.now(); }
            })().catch((e) => this.log.info('engine unit boost: ' + (e && e.message || e))).then(() => { busy = false; });
        }), 400);
    }

    stop() {
        clearInterval(this.tickTimer);
        clearInterval(this.themeTimer);
        clearInterval(this.statusTimer);
        clearInterval(this.dmeTimer);
        this.needleHalt = true; this._guard('needles', () => this._needleApply());     // 0.7.14: the needle timer off
        this._perfStop();       // package P
        clearTimeout(this.probeSymT); this.probeSymT = null;        // probes, item 3 (0.7.18)
        clearTimeout(this.statusAskT);
        if (this.waze) this._guard('waze stop', () => this.waze.stop());
        this._guard('screen stop', () => this.screen.stop());
        this.clients.forEach((c) => c.close());
        this.atlases.clear();
    }

    /**
     * The glyph atlas of a font on a connection: an R8 asset of the font's characters in equal cells (cols x
     * rows), made on first use and kept while the connection lives (the client re-sends it by itself after a
     * reconnect). A widget's effect layer samples it; nothing is drawn by the asset itself.
     */
    _atlas(fontName, ci) {
        const key = ci + ':' + fontName;
        if (this.atlases.has(key)) return this.atlases.get(key);
        const font = textRaster.loadFont(fontName), glyphs = font.metrics.glyphs;
        const chars = Object.keys(glyphs).filter((ch) => ch.length === 1 && ch >= ' ' && ch <= '~').sort().slice(0, 64);
        if (!chars.length) throw new Error('font "' + fontName + '" has no printable glyphs for an atlas');
        const cellW = Math.max(1, Math.ceil(Math.max.apply(null, chars.map((ch) => glyphs[ch].advance)))) + 2;
        const cellH = font.metrics.cellHeight;
        const cols = Math.max(1, Math.min(16, Math.floor(2048 / cellW))), rows = Math.ceil(chars.length / cols);
        const w = cols * cellW, h = rows * cellH;
        const buf = Buffer.alloc(w * h, 0);
        chars.forEach((ch, i) => {
            const cell = textRaster.mask(cellW, cellH, ch, { font: fontName, align: 'center' });
            const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
            for (let y = 0; y < cellH; y++) cell.copy(buf, (cy + y) * w + cx, y * cellW, (y + 1) * cellW);
        });
        const c = this._clientAt(ci);
        const ref = c.asset({ target: this.target, format: 'r8', w, h, sampling: 'bilinear' });
        if (!ref) throw new Error('font "' + fontName + '": atlas asset refused (' + w + 'x' + h + ')');
        c.pixels(ref, null, buf);
        const a = { ref, c, ci, cols, rows, cellW, cellH, chars, bytes: w * h * 2 };
        this.atlases.set(key, a);
        this.log.info('glyph atlas "' + fontName + '"' + (ci ? ' on connection ' + (ci + 1) : '') + ': ' + chars.length + ' glyphs in ' +
            cellW + 'x' + cellH + ' cells, ' + w + 'x' + h + ' R8 asset, ' + mib(a.bytes) + ' of pixel memory');
        return a;
    }

    /**
     * A baked scene texture (hud/scene/<name>.json, tools/bake_scene.py): an RGBA8 asset on a connection, made once and
     * kept like a glyph atlas. A shader samples it with bind(); nothing is drawn by the asset itself.
     */
    _scene(name, ci) {
        const key = ci + ':scene:' + name;
        if (this.sceneUsed) this.sceneUsed.add(key);
        if (this.atlases.has(key)) return this.atlases.get(key);
        const j = data.json('scene/' + name + '.json');
        const r8 = !!(j && j.format === 'r8' && j.r8), bpp = r8 ? 1 : 4;   // package M: an R8 one ("r8"), the strip mask
        if (!j || !(r8 || j.rgba)) throw new Error('scene texture "' + name + '" is missing from hud/scene');
        const buf = Buffer.from(r8 ? j.r8 : j.rgba, 'base64');
        if (buf.length !== j.w * j.h * bpp) throw new Error('scene texture "' + name + '": size does not match');
        const c = this._clientAt(ci);
        const ref = c.asset({ target: this.target, format: r8 ? 'r8' : 'rgba8', w: j.w, h: j.h, sampling: j.sampling === 'nearest' ? 'nearest' : 'bilinear' });
        if (!ref) throw new Error('scene texture "' + name + '": asset refused (' + j.w + 'x' + j.h + ')');
        c.pixels(ref, null, buf);
        const a = { ref, c, ci, w: j.w, h: j.h, bytes: j.w * j.h * bpp * 2, mask: j.mask || null };   // package M: its lane table
        this.atlases.set(key, a);
        this.log.info('scene texture "' + name + '"' + (ci ? ' on connection ' + (ci + 1) : '') + ': ' + j.w + 'x' + j.h + (r8 ? ' R8' : ' RGBA8') + ' asset, ' + mib(a.bytes) + ' of pixel memory');
        return a;
    }

    /** The scene textures (keys as in this.atlases) the widgets will sample: the same choices _create makes. */
    _sceneNeeds(widgets) {
        const out = new Set();
        widgets.forEach((w) => {
            const ci = this._connOf(w), add = (t) => { if (t && t.tex) out.add(ci + ':scene:' + t.tex); };
            if (w.type === 'atext' && w.exact) out.add(this._exactKey(w, ci));        // 0.7.14: a "gpu" text's atlas
            else if (w.type === 'dial' && w.look === 'wb') { add(w.base); add(w.fill); }
            else if (w.type === 'g20dial') { add({ tex: w.base }); add({ tex: w.lut }); add({ tex: w.fill }); }
            else if (w.type === 'wbsign' && w.tex) { add(w.tex.limit); add(w.tex.nopass); }
            else if (w.type === 'wbback') {
                if (w.collar) { add(w.collar); add(w.mask); }       // package M: "mask", the strip mask
                else if (w.tex) { const u = this._wbUses(w); if (u.window) { add(w.tex.window); add(w.tex.horizon); } if (u.line) add(w.tex.line); }
            }
        });
        return out;
    }

    /** An asset dropped as soon as the layout shown doesn't use it: a scene texture, or (0.7.14) a "gpu" text's atlas.
     *  The glyph atlases of "atext" widgets stay while the connection lives. */
    _dropsUnused(key) { return key.indexOf(':scene:') >= 0 || key.indexOf(':exact:') >= 0; }

    _atlasBytes() {
        let n = 0;
        this.atlases.forEach((a) => { n += a.bytes; });
        return n;
    }

    /** package E: true when app.json names the car's speed-limit or no-overtaking field (config.limit / config.nopass). */
    _signWired() {
        const ok = (s) => !!(s && s.iface && s.field);
        return ok(this.config.limit) || ok(this.config.nopass);
    }

    /** A 6WB dial's u_cut ("cut", WBDIAL): cut y in the layer, fade, window shape (mode), its soft edge. */
    _cutVec(w, mode) {
        const cut = w.cut;
        return cut ? [cut.y - w.y, cut.fade || 0, mode, cut.soft || 0] : [0, 0, 0, 0];
    }

    /** The glyph codes of a text in an atlas widget's cells, aligned; -1 is an empty cell. */
    _atlasCodes(x, s) {
        const a = x.atlas, n = x.cells, text = String(s).slice(0, n);
        const pad = n - text.length, w = x.w;
        const lead = w.align === 'right' ? pad : w.align === 'center' ? Math.floor(pad / 2) : 0;
        const codes = [];
        for (let i = 0; i < 32; i++) {
            const j = i - lead;
            const ch = j >= 0 && j < text.length ? text[j] : null;
            const k = ch === null ? -1 : a.chars.indexOf(ch);
            codes.push(i < n && ch !== null ? (k < 0 ? a.chars.indexOf(' ') : k) : -1);
        }
        return codes;
    }

    /* ---- 0.7.14: big text readouts on the GPU, "gpu": true on a text widget (docs/PERF-NEEDLE-REPORT.md) ----
     * The text is drawn by the atlas text shader (ATEXT, the same small shader as the "atext" widget, seen on the car in
     * the calibration layout's "ATLAS <clock> 950", photo 10) instead of as pixels: a new value is one uniform message,
     * not an image upload. Pixel for pixel the image text's: the font's figures all have one advance and their ink stays
     * inside it, the shader's cells sit on the figures' grid, and the atlas holds the very coverage hud_text.mask lays
     * out in the widget's box, cut on that grid (sampled "nearest": one atlas texel per screen pixel).
     * Centred, a text of odd and of even length sits half an advance apart: with an even advance the cells are half a
     * figure wide (each figure two cells) and one layer does; with an odd one the widget becomes two layers (atext
     * widgets "<id>" and "<id>#2", a value showing on the layer of its length). A cell the figures don't fill exactly
     * ("--", another character) is cut from the laid-out text and uploaded into a spare atlas cell once (EXACT_SPARE).
     * "maxLen": the longest value shown (default: what fits the box). Only plain readouts: one colour, no fit / glow /
     * colour rules / slot; anything else stays an image text (logged). */
    _gpuTexts(list) {
        const out = [];
        list.forEach((w) => {
            if (w.type !== 'text' || !w.gpu) { out.push(w); return; }
            let why = null, g = null;
            try { why = this._gpuTextWhy(w); if (!why) g = this._gpuGrid(w); } catch (e) { why = String(e && e.message || e); }
            if (why) { this.log.warn('widget "' + w.id + '": "gpu" ignored (' + why + '), drawn as an image'); out.push(w); return; }
            g.groups.forEach((gr, i) => {
                const a = Object.assign({}, w, { id: i ? w.id + '#' + (i + 1) : w.id, type: 'atext', x: w.x + gr.x0, w: gr.cells * g.cw, h: g.h, cells: gr.cells });
                delete a.gpu;
                a.exact = { boxX: w.x, boxW: w.w, lengths: gr.lengths, max: g.max, pitch: g.pitch, cw: g.cw, h: g.h, figs: g.figs };
                out.push(a);
            });
        });
        return out;
    }

    /** Why a "gpu" text widget can't be drawn exactly on the GPU (null: it can). */
    _gpuTextWhy(w) {
        if (w.fit || w.near || w.hotWhen || w.coldWhen || w.colorBy || w.color2 || w.glow || w.slot) return 'fit, glow, a slot or a colour rule';
        if (w.warnFlash !== false && /\{\{(oil|coolant|boost|slot:)/.test(String(w.text))) return 'a warning flash';
        if (w.align && w.align !== 'center' && w.align !== 'right' && w.align !== 'left') return 'align ' + w.align;
        const font = textRaster.loadFont(w.font), gl = font.metrics.glyphs, z = gl['0'];
        if (!z) return 'the font has no figures';
        const adv = z.advance, pitch = adv + (w.spacing || 0);
        if (!(pitch > 0) || Math.round(pitch) !== pitch) return 'the figures with their spacing are not whole pixels apart';
        for (let d = 0; d <= 9; d++) { const g = gl[String(d)]; if (!g || g.advance !== adv) return 'the figures are not all one width'; }
        return null;
    }

    /** The grid of a "gpu" text: the figure pitch, the cell width (the pitch or half of it), the layer height, the
     *  figures whose ink stays in their own advance, the longest value, and per layer { x0 (in the box), cells,
     *  lengths }: every length 1..max whose text starts on that layer's grid. */
    _gpuGrid(w) {
        const font = textRaster.loadFont(w.font), gl = font.metrics.glyphs, s = w.spacing || 0;
        const pitch = gl['0'].advance + s, h = Math.min(w.h, font.metrics.cellHeight);
        const figs = Object.keys(gl).filter((ch) => ch.length === 1 && gl[ch].advance + s === pitch).filter((ch) => {
            const m = textRaster.mask(pitch + 8, h, ch, { font: w.font, x: 4 });     // ink only inside its own advance
            for (let y = 0; y < h; y++) for (let x = 0; x < pitch + 8; x++) if (m[y * (pitch + 8) + x] && (x < 4 || x >= pitch + 4)) return false;
            return true;
        });
        const fit = Math.floor((w.w + s) / pitch), max = Math.max(1, Math.min(32, isNum(w.maxLen) ? Math.min(w.maxLen, fit) : fit));
        const starts = [];
        for (let n = 1; n <= max; n++) {
            const width = n * pitch - s;
            starts.push({ n, x: w.align === 'right' ? w.w - width : w.align === 'center' ? Math.round((w.w - width) / 2) : 0 });
        }
        const group = (cw) => {
            const by = new Map();
            starts.forEach((t) => {
                const ph = ((t.x % cw) + cw) % cw, g = by.get(ph) || { x0: Infinity, x1: -Infinity, lengths: [] };
                g.lengths.push(t.n); g.x0 = Math.min(g.x0, t.x); g.x1 = Math.max(g.x1, t.x + t.n * pitch);
                by.set(ph, g);
            });
            return Array.from(by.values()).map((g) => ({ x0: g.x0, cells: Math.round((g.x1 - g.x0) / cw), lengths: g.lengths }));
        };
        let cw = pitch, groups = group(pitch);
        if (groups.length > 1 && pitch % 2 === 0 && group(pitch / 2).length === 1 && group(pitch / 2)[0].cells <= 32) { cw = pitch / 2; groups = group(cw); }
        if (groups.some((g) => g.cells > 32)) throw new Error('more than 32 cells');
        return { pitch, cw, h, max, figs: figs.sort(), groups };
    }

    _exactKey(w, ci) { return ci + ':exact:' + w.font + ':' + w.exact.pitch + '/' + w.exact.cw + 'x' + w.exact.h + ':' + (w.spacing || 0); }

    /** The atlas of a "gpu" text on a connection: R8, each figure as mask lays it out at a pen on a cell's left edge (in
     *  pitch / cw cells), plus spare cells; sampled "nearest" (each screen pixel is one atlas texel). Shared by the
     *  widget's layers; dropped like a scene texture when the layout shown doesn't use it. */
    _exactAtlas(w, ci) {
        const key = this._exactKey(w, ci), E = w.exact;
        if (this.sceneUsed) this.sceneUsed.add(key);
        if (this.atlases.has(key)) return this.atlases.get(key);
        const P = E.pitch, cw = E.cw, k = P / cw, h = E.h, fixed = E.figs.length * k, row = Math.floor(2048 / cw);
        // the spare cells: EXACT_SPARE, or the rest of the first row when that keeps the atlas one row high
        const spare = fixed + EXACT_SPARE > row && row - fixed >= 3 ? row - fixed : EXACT_SPARE, n = fixed + spare;
        const cols = Math.max(1, Math.min(n, row)), rows = Math.ceil(n / cols);
        const W = cols * cw, H = rows * h;
        if (H > 2048) throw new Error('font "' + w.font + '": a ' + W + 'x' + H + ' atlas is too big');
        const buf = Buffer.alloc(W * H, 0);
        const a = { key, cols, rows, cellW: cw, cellH: h, bytes: W * H * 2, exact: true, byKey: new Map(), fig: {}, slots: [], use: 0 };
        E.figs.forEach((ch) => {
            const m = textRaster.mask(P, h, ch, { font: w.font });
            a.fig[ch] = [];
            for (let j = 0; j < k; j++) {
                const i = a.slots.length, sl = Buffer.alloc(cw * h, 0);
                for (let y = 0; y < h; y++) m.copy(sl, y * cw, y * P + j * cw, y * P + (j + 1) * cw);
                const cx = (i % cols) * cw, cy = Math.floor(i / cols) * h;
                for (let y = 0; y < h; y++) sl.copy(buf, (cy + y) * W + cx, y * cw, (y + 1) * cw);
                if (!a.byKey.has(this._exactHash(sl))) a.byKey.set(this._exactHash(sl), i);
                a.fig[ch].push(i);
                a.slots.push({ fixed: true });
            }
        });
        for (let i = 0; i < spare; i++) a.slots.push({ fixed: false, key: null, at: 0 });
        const c = this._clientAt(ci);
        const ref = c.asset({ target: this.target, format: 'r8', w: W, h: H, sampling: 'nearest' });
        if (!ref) throw new Error('font "' + w.font + '": atlas asset refused (' + W + 'x' + H + ')');
        c.pixels(ref, null, buf);
        a.ref = ref; a.c = c; a.ci = ci;
        this.atlases.set(key, a);
        this.log.info('gpu text atlas "' + w.font + '"' + (ci ? ' on connection ' + (ci + 1) : '') + ': ' + E.figs.length + ' figures in ' + fixed +
            ' cells and ' + spare + ' spare cells of ' + cw + 'x' + h + ', ' + W + 'x' + H + ' R8 asset, ' + mib(a.bytes) + ' of pixel memory');
        return a;
    }

    /** A cell's pixels as a map key (the bytes themselves: a few cells of a few KB, no crypto needed on the car). */
    _exactHash(buf) { return buf.toString('latin1'); }

    /** The atlas codes of a "gpu" text layer showing s: its cells' slices of the text as mask lays it out in the box. */
    _exactCodes(x, s) {
        const w = x.w, E = w.exact, a = x.atlas, P = E.pitch, cw = E.cw, k = P / cw, h = E.h, off = w.x - E.boxX;
        const codes = [];
        for (let i = 0; i < 32; i++) codes.push(-1);
        s = String(s);
        if (!s.length || E.lengths.indexOf(s.length) < 0) {
            if (s.length > E.max && !x.warnedLong) { x.warnedLong = true; this.log.warn('widget "' + w.id + '": "' + s + '" is longer than the gpu text shows (' + E.max + ')'); }
            return codes;
        }
        // the usual case, figures only: each on its own cells, no layout needed
        const width = s.length * P - (w.spacing || 0);
        const start = w.align === 'right' ? E.boxW - width : w.align === 'center' ? Math.round((E.boxW - width) / 2) : 0;
        const k0 = (start - off) / cw;
        if (k0 === Math.floor(k0) && k0 >= 0 && k0 + s.length * k <= x.cells && s.split('').every((ch) => a.fig[ch] !== undefined)) {
            for (let i = 0; i < s.length; i++) for (let j = 0; j < k; j++) codes[k0 + i * k + j] = a.fig[s.charAt(i)][j];
            return codes;
        }
        // anything else: the text laid out in the box as the image text would be, cut into the cells
        const m = textRaster.mask(E.boxW, h, s, { font: w.font, align: w.align, spacing: w.spacing });
        const inUse = new Set();
        this.widgets.forEach((o) => { if (o !== x && o.atlas === a && o.codes) o.codes.forEach((c) => inUse.add(c)); });
        for (let c = 0; c < x.cells; c++) {
            const sl = Buffer.alloc(cw * h, 0);
            let ink = false;
            for (let y = 0; y < h; y++) {
                m.copy(sl, y * cw, y * E.boxW + off + c * cw, y * E.boxW + off + (c + 1) * cw);
                if (!ink) for (let i = y * cw; i < (y + 1) * cw; i++) if (sl[i]) { ink = true; break; }
            }
            if (!ink) continue;
            const key = this._exactHash(sl);
            let slot = a.byKey.get(key);
            if (slot === undefined) slot = this._exactPut(a, key, sl, inUse);
            if (slot >= 0) { codes[c] = slot; inUse.add(slot); if (!a.slots[slot].fixed) a.slots[slot].at = ++a.use; }
        }
        return codes;
    }

    /** A cell's pixels into the spare atlas cell used longest ago (not one shown now); its index, or -1 if none is free. */
    _exactPut(a, key, sl, inUse) {
        let best = -1;
        a.slots.forEach((t, i) => { if (!t.fixed && !inUse.has(i) && (best < 0 || t.at < a.slots[best].at)) best = i; });
        if (best < 0) { this.log.warn('gpu text atlas ' + a.key + ': no spare cell free'); return -1; }
        const t = a.slots[best];
        if (t.key) a.byKey.delete(t.key);
        t.key = key;
        a.byKey.set(key, best);
        a.c.pixels(a.ref, [{ x: (best % a.cols) * a.cellW, y: Math.floor(best / a.cols) * a.cellH, w: a.cellW, h: a.cellH }], sl);
        return best;
    }

    /* ---- probes (0.7.18 diagnostics: READ ONLY, LOG ONLY; see "probes" above HudApp) ------------------------------- */

    /** Item 1: every new vehicle condition the CAR sends, once, in every layout and with or without cluster-render
     *  (package X's "bottom row: vehicle condition N" only runs in a see-through layout). The car's own value
     *  (car.live), not the demo drive's. Hypothesis to confirm: 5 = BMW's standby row, 7 = P with the engine off. */
    _probeTick() {
        const c = this.car && this.car.live ? this.car.live.condition : undefined;
        if (c === this.probeCond) return;
        this.probeCond = c;
        this.log.info('probe: vehicle condition ' + probeNum(c) + (c === COND_STANDBY ? ' (= COND_STANDBY, taken as BMW\'s standby row)' : ''));
    }

    /** Item 2: the stored check-control lists, logged once per change: ids, colours, risk classes, symbol ids,
     *  reasons and states - numbers and enum names only. cCShortName (the message text) is never read. Each handler
     *  runs IN FRONT of the one already on the field (config.ccList's), which then runs exactly as before. */
    _probeWire(extra) {
        const ID = ['id', 'cCIdentifer', probeNum], COL = ['colour', 'cCColor', probeEnum], SYM = ['symbol', 'cCListSymbolID', probeNum];
        const on = (iface, field, member, cols) => {
            const e = extra[iface] = extra[iface] || {};
            const prev = e[field], st = { last: undefined, n: 0 };
            e[field] = (v) => {
                try {
                    const line = probeListLine(v, member, cols);
                    if (line !== st.last && st.n < PROBE_LINES) {
                        st.last = line; st.n++;
                        this.log.info('probe: ' + field + ': ' + line + (st.n === PROBE_LINES ? ' (the last line for this field)' : ''));
                    }
                } catch (err) { this.log.warn('probe: ' + field + ': ' + (err && err.message || err)); }
                if (prev) prev(v);
            };
        };
        on(PROBE_KI2, 'ccList', 'cCListElement', [ID, COL, SYM]);
        on(PROBE_KI2, 'ccListRiskClass', 'cCListRiskClassElement', [ID, COL, ['risk', 'cCRiskClass', probeEnum], SYM]);
        on(PROBE_CCM, 'basicList', null, [['id', 'ccmId', probeNum], ['reason', 'reason', probeEnum], ['state', 'activeState', probeEnum]]);
    }

    /** Item 3, the schedule: PROBE_SYM_AFTER_MS after start, then up to PROBE_SYM_WAIT_MS more for KombiInterface_2's
     *  provider; then _probeSymbols, once per run of the app. Never throws. */
    _probeSymbolsLater() {
        if (this.probeSymT || this.probeSymDone) return;
        const t0 = Date.now() + PROBE_SYM_AFTER_MS;
        const step = () => {
            this.probeSymT = null;
            try {
                const sub = this.car && (this.car.subs || []).find((s) => s && s.iface === PROBE_KI2);
                if (!(sub && sub.available) && Date.now() - t0 < PROBE_SYM_WAIT_MS && this.started) { this.probeSymT = setTimeout(step, 1000); return; }
                this._probeSymbols(sub);
            } catch (e) { this.log.warn('probe: cc symbols: ' + (e && e.message || e)); }
        };
        this.probeSymT = setTimeout(step, PROBE_SYM_AFTER_MS);
    }

    /** Item 3, the call: requestDefaultSymbols(CC_LIST_SYMBOL) ONCE, through the watch's own proxy (or a proxy of its
     *  own when the watch has none), with the binding's timeout and ours on top. Logs the count and each symbol's id,
     *  format and byte length; the reply is dropped right after - not one byte of a bitmap is logged or kept.
     *  Resolves always (never rejects); any failure is one warning line. */
    _probeSymbols(sub) {
        if (this.probeSymDone) return Promise.resolve();
        this.probeSymDone = true;
        let gt = null;
        const S = this.ctx && this.ctx.signals;
        return Promise.resolve().then(async () => {
            if (!S || typeof S.call !== 'function') throw new Error('no signals.call');
            const p = sub && sub.proxy ? sub.proxy : await S.proxy(PROBE_KI2, '1');
            const guard = new Promise((res, rej) => { gt = setTimeout(() => rej(new Error('no answer in ' + PROBE_SYM_GUARD_MS + ' ms')), PROBE_SYM_GUARD_MS); });
            let r = await Promise.race([Promise.resolve().then(() => S.call(p, 'requestDefaultSymbols', { symbolType: 'CC_LIST_SYMBOL' }, PROBE_SYM_CALL_MS)), guard]);
            let list = Array.isArray(r) ? r : r && typeof r === 'object'
                ? (Array.isArray(r.defaultSymbolList) ? r.defaultSymbolList : Object.keys(r).map((k) => r[k]).find(Array.isArray)) : undefined;
            const kind = r === null ? 'null' : typeof r;
            r = null;
            if (!list) { this.log.warn('probe: cc symbols: the reply is not a list (' + kind + ')'); return; }
            const n = list.length;
            const each = list.slice(0, 32).map((s) => (s && typeof s === 'object'
                ? '[id ' + probeNum(s.symbolID) + ' ' + probeEnum(s.symbolFormat) + ' ' + probeLen(s.symbolData) + ']' : '[?]')).join(' ');
            list = null;            // BMW's artwork: dropped here, never kept
            this.log.info('probe: cc symbols: ' + n + (n === 1 ? ' symbol' : ' symbols') + (n ? ': ' + each : '') + (n > 32 ? ' +' + (n - 32) + ' more' : ''));
        }).catch((e) => {
            this.log.warn('probe: cc symbols: requestDefaultSymbols failed: ' + String(e && e.message || e).slice(0, 160));
        }).then(() => { clearTimeout(gt); }).catch(() => { /* a failing log: nothing left to do, and nothing to throw */ });
    }
    /* ---- end probes ---- */

    _guard(what, fn) {
        try { fn(); } catch (e) { this.log.error('hud ' + what + ': ' + (e && e.stack || e)); }
    }

    /* ---------------- status line (the center screen's first row) ---------------- */

    /** fn(text) whenever the status line changes. */
    onStatus(fn) { this.statusListeners.push(fn); if (this.lastStatus) fn(this.lastStatus); }

    /** 2026-11-13: "6WB Comfort + BMW map" (wb_comfort_map) is gone: it was 6WB Comfort with the map window always on,
     *  which the stockMap setting does. A saved choice of it becomes wb_comfort with stockMap on, once. */
    _migrateComfortMap() {
        const st = this.ctx.settings;
        if (!st || typeof st.get !== 'function' || typeof st.set !== 'function') return;
        let moved = false;
        ['hudLayout', 'inComfort', 'inSport', 'inEco'].forEach((k) => {
            if (st.get(k) === 'wb_comfort_map') { st.set(k, 'wb_comfort'); moved = true; }
        });
        if (moved) {
            st.set('stockMap', true);
            if (this.log) this.log.info('settings: "6WB Comfort + BMW map" is now 6WB Comfort with "BMW\'s map in the middle" on');
        }
    }

    /** 0.7.13, the KOMBI guard: a target event of the first connection. A strike when the display service goes away
     *  soon after our scene was shown; KOMBI_STRIKES of them turn the theme off (_layoutName 'off' while kombiTrip). */
    _kombiWatch(state, holder, reason) {
        const now = Date.now(), prev = this.kombiPrev;
        this.kombiPrev = state;
        if (state === 'shown' && holder === 'us') {
            if (prev !== 'shown' && prev !== 'lingering') this.kombiShownAt = now;
            return;
        }
        if (state !== 'unavailable' || !/display service/i.test(reason || '')) return;
        const since = this.kombiShownAt ? now - this.kombiShownAt : -1;
        this.kombiShownAt = 0;
        if (since < 0 || since > KOMBI_GUARD_MS || !this.activeName || this.activeName === 'off') return;
        this.kombiStrikes = this.kombiStrikes.filter((t) => now - t < KOMBI_WINDOW_MS).concat(now);
        this.log.warn('kombi guard: the cluster\'s display service went away ' + since + ' ms after "' + this.activeName +
            '" was shown (' + this.kombiStrikes.length + ' of ' + KOMBI_STRIKES + ')');
        if (this.kombiStrikes.length < KOMBI_STRIKES) return;
        this.kombiTrip = { layout: this.activeName, at: new Date(now).toISOString() };
        this.kombiStrikes = [];
        try { fs.writeFileSync(this.kombiFile, JSON.stringify(this.kombiTrip)); } catch (e) { this.log.warn('kombi guard: ' + this.kombiFile + ': ' + e.message); }
        this.log.warn('kombi guard: theme turned off ("' + this.kombiTrip.layout + '"), BMW\'s own cluster shows until a theme is picked again');
        this._rebuild();
    }

    /** A theme was picked: the guard lets the themes try again. */
    _kombiClear() {
        this.kombiStrikes = [];
        if (!this.kombiTrip) return;
        this.log.info('kombi guard: a theme was picked, themes may show again (was off since ' + this.kombiTrip.at + ')');
        this.kombiTrip = null;
        try { fs.unlinkSync(this.kombiFile); } catch (e) { /* gone already */ }
    }

    /** The see-through ("+ G20") file a theme maps to while the "g20" setting is on, else the theme itself. */
    _g20Of(name) {
        return this.setting('g20') === true && G20_OF[name] ? G20_OF[name] : name;
    }

    /** The layout name to show now: per drive mode when that's on and known, else the plain setting; the see-through
     *  file of either while the "g20" toggle is on (_g20Of). */
    _layoutName() {
        if (this.kombiTrip) return 'off';          // 0.7.13: the KOMBI guard tripped
        if (this.screen && this.screen.yielded) return 'off';
        if (this.setting('byMode') === true && this.driveMode && MODE_KEY[this.driveMode]) {
            const v = this.setting(MODE_KEY[this.driveMode]);
            if (v) return this._g20Of(v);
        }
        return this._g20Of(this.setting('hudLayout'));
    }

    /** Whether BMW's own bottom row shows through the layout called `name`: it has a wbback with a "collar" (the
     *  see-through path). There, and only there, who draws each item of the row is a choice (_own); elsewhere our own
     *  background covers BMW's row. Cached per name: _own() is called on every text paint. */
    _seeThrough(name) {
        if (!name || name === 'off') return false;
        if (!this.seeThru) this.seeThru = {};
        if (this.seeThru[name] === undefined) {
            try {
                this.seeThru[name] = this.layouts.load(name).widgets.some((w) => w.type === 'wbback' && w.collar);
            } catch (e) { this.seeThru[name] = false; }     // no such layout: the rebuild reports it
        }
        return this.seeThru[name];
    }

    /** A layout's name for the screen: a see-through file is shown as its theme plus " + G20". */
    _layoutLabel(name) {
        const theme = G20_THEME[name] || name;
        const lay = this.ctx.settings.item('hudLayout');
        const o = lay && (lay.options || []).find((x) => x[0] === theme);
        return (o ? o[1] : theme) + (G20_THEME[name] ? ' + G20' : '');
    }

    /** The first widget on that layer, for the logs; a sheet is named by its first member plus how many more it holds. */
    _widgetOf(ci, ref) {
        let id = null, n = 0;
        this.widgets.forEach((x) => { if (x.ci === ci && x.ref === ref) { if (!id) id = x.w.id; n++; } });
        return n > 1 ? id + ' +' + (n - 1) : id;
    }

    /** Every layer of the layout now (effects, sheets and own image layers), each once: { c, ci, ref, key }. */
    _layerRefs() {
        const refs = [], seen = {};
        this.widgets.forEach((x) => {
            const key = x.ci + ':' + x.ref;
            if (!seen[key]) { seen[key] = true; refs.push({ c: x.c, ci: x.ci, ref: x.ref, key }); }
        });
        return refs;
    }

    /** How many connections the layout now uses. */
    _connCount() {
        const seen = {};
        this.widgets.forEach((x) => { seen[x.ci] = true; });
        return Object.keys(seen).length;
    }

    /** The connection a widget asks for ("conn", 0..3; 0 the app's own). */
    _connOf(w) {
        const n = isNum(w.conn) ? Math.floor(w.conn) : 0;
        return Math.max(0, Math.min(MAX_CONN - 1, n));
    }

    /** Layers per connection in a plan: [n on connection 1, n on 2, ...]. */
    _connCounts(plan) {
        const counts = [];
        plan.forEach((e) => { counts[e.conn] = (counts[e.conn] || 0) + 1; });
        for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
        return counts;
    }

    _layerCount(n) { return n === 1 ? '1 layer' : n + ' layers'; }

    _statusSoon() {
        if (this._statusT) return;
        this._statusT = setTimeout(() => { this._statusT = null; this._guard('status', () => this._status()); }, 500);
    }

    /** ", 3 of 5 layers drawn (2 waiting: <reason>)" while some layers aren't shown; "" when all are. Counts layers, not widgets. */
    _drawnNote() {
        const ts = this.targetState;
        if (ts && (ts.state === 'waiting' || ts.state === 'parked') && ts.holder) {
            return ts.holder === 'foreign' ? ', waiting: another app has this display' : ', waiting: BMW is using this display';
        }
        const refused = this.refused ? ', refused ' + this.refused : '';
        const refs = this._layerRefs();
        if (!refs.length) return refused;
        let shown = 0, why = null, whyN = 0;
        refs.forEach((r) => {
            const st = this.layerStates.get(r.key);
            if (st && st.state === 'shown') shown++;
            else if (st) { whyN++; if (!why) why = st.state + (st.reason ? ': ' + st.reason : ''); }
        });
        if (shown === refs.length || (!why && !shown)) return refused;
        return ', ' + shown + ' of ' + this._layerCount(refs.length) + ' drawn' + (why ? ' (' + whyN + ' ' + why + ')' : '') + refused;
    }

    statusText() {
        if (!this.client.ready) {
            let there = false;
            try { there = fs.existsSync(this.socketPath); } catch (e) { /* treat as missing */ }
            return there ? this.label + ': connecting to cluster-render' : this.label + ' off: cluster-render is not installed or not running';
        }
        if (this.kombiTrip) return this.label + ' off: the cluster reset twice right after ' + this._layoutLabel(this.kombiTrip.layout) + ' was shown. Pick a theme to try again';
        if (this.problem) return this.label + ': ' + this.problem;
        const byMode = this.setting('byMode') === true;
        const mode = byMode ? (this.driveRaw ? ' (drive mode not recognised: the car sends ' + this.driveRaw + ')'
            : this.driveMode ? ' (' + MODE_NAME[this.driveMode] + ')' : ' (drive mode not seen yet)') : '';
        const what = this.target === 'panel' ? 'cluster' : 'HUD';
        if (this.activeName === 'off' && this.screen.yielded) return this.label + ' off: ' + this.screen.otherName + ' has the screen, pick one here to take it back';
        if (this.activeName === 'off') return this.label + ' off' + mode + ": BMW's own " + what + ' shows';
        const name = this._layoutLabel(this.activeName);
        const d = this._data();
        const demo = d.demo ? ', demo data' : '';
        const drawn = this._drawnNote();
        const conns = this._connCount();
        const layers = ', ' + this._layerCount(this._layerRefs().length) + (conns > 1 ? ' on ' + conns + ' connections' : '')
            + (this.pixelBytes ? ', ' + mib(this.pixelBytes) + ' of 16 MiB pixels' : '');
        // car3 G: in a see-through theme, which items of BMW's row are ours ("bottomRow"; a photo of the Settings tab
        // showed BMW's row where ours was expected)
        const row = this.ownRow ? '; row: ' + ['range', 'clock', 'temp'].map((i) => i + ' ' + (this._own(i) ? 'ours' : "BMW's")).join(', ') : '';
        const night = this.nightOn ? ', night colours ' + (this.lookName || 'plain') : '';     // 2026-11-14
        if (this.layoutTheme) return this.label + ' on' + mode + ': ' + name + ' theme' + night + layers + demo + drawn + row;
        const theme = THEMES[this.themeName] ? THEMES[this.themeName].name : this.themeName;
        const auto = this.setting('hudTheme') === 'auto' ? ' (Auto)' : '';
        return this.label + ' on' + mode + ': ' + name + ' layout, ' + theme + ' theme' + auto + layers + demo + drawn;
    }

    _status() {
        // the Waze map's state rides along while that setting is on (and redraws the page's Map tab when it changes)
        const s = this.statusText() + (this.waze && this.setting('mapInTheme') === true ? '; Waze: ' + this.waze.info().text : '');
        if (s === this.lastStatus) return;
        this.lastStatus = s;
        this.statusListeners.forEach((fn) => { try { fn(s); } catch (e) { this.log.warn('status listener: ' + e); } });
    }

/* ---------------- theme, units, values ---------------- */

    /** Where the car is, for sunrise and sunset (the night colours): the car's own position while it is valid and
     *  fresh (config.nav.here; the owner, 2026-11-15), else app.json config.location, else DEFAULT_LOCATION.
     *  PRIVACY: the coordinates are personal data. They are used here and nowhere else, and never logged. */
    _location() {
        if (isNum(this.posLat) && isNum(this.posLon) && Date.now() - (this.posAt || 0) < POS_STALE_MS) {
            return { lat: this.posLat, lon: this.posLon };
        }
        return this.location;
    }

    _themeName() {
        if (this.layoutTheme) return this.layoutTheme;
        const t = this.setting('hudTheme');
        if (t !== 'auto') return t;
        return this._isNight() ? 'night' : this.setting('dayTheme');      // fix/colour-daynight: the car first, then the sun
    }

    /** Night colours now: a theme of the layout's own, and Cluster Themes' "nightDim" on Auto with the sun down, or on
     *  Always (2026-11-14: to see or keep a night look by day; also how the bench shows them). */
    _nightDim() {
        if (!this.ctx.settings.item('nightDim') || !this._nightOk()) return false;     // 2026-11-16: not Sport / Eco Pro
        const v = this.setting('nightDim');
        if (v === 'always') return true;
        if (v !== 'auto') return false;
        return this._isNight();             // fix/colour-daynight: the car first, then the sun
    }

    /* --- fix/colour-daynight: day or night, the car's own verdict first --- */

    /** Night now: the car's statusDayNightChangeOver (config.dayNight; this.dnCar) while it says day or night, else the
     *  sun at _location(). Logs once which of the two is in use, and again each time that changes. */
    _isNight() {
        const src = this.dnCar === 'day' || this.dnCar === 'night' ? 'car' : 'sun';
        if (src !== this.dnSource) {
            this.dnSource = src;
            this.log.info('day/night source: ' + (src === 'car' ? 'the car (statusDayNightChangeOver)' : 'the sun (the car\'s day/night is missing or invalid)'));
        }
        return src === 'car' ? this.dnCar === 'night' : sun.isNight(Date.now(), this._location().lat, this._location().lon);
    }

    /** The car's day/night changed: what the minute timer (start) does at sunset, now rather than within the minute. */
    _dayNightCheck() {
        if (!this.activeName) return;
        if (this._themeName() !== this.themeName) this._rebuild();
        else if (this._nightDim() !== this.nightOn && !this._nightLive()) this._rebuild();
        this._status();
    }

    /* --- end fix/colour-daynight --- */

    /** 2026-11-16: the layout has night colours at all: a theme of its own, not one of DAY_ONLY_THEMES (6WB Sport,
     *  6WB Eco Pro). False: its 6WB shaders are made without the night look (shaders.js NIGHT 0) and get no u_nk. */
    _nightOk() { return !!this.layoutTheme && DAY_ONLY_THEMES.indexOf(this.layoutTheme) < 0; }

    /* --- 2026-11-14: night looks ("nightLook", NIGHT_LOOKS) --- */

    /** this.theme from this.baseTheme and the night colours now: a night look on a 6WB layout, else the plain dimmer. */
    _nightTheme() {
        this.nightOn = this._nightDim();
        const pick = this.nightOn && this.wbLayout && this.ctx.settings.item('nightLook') ? this.setting('nightLook') : null;
        this.look = NIGHT_LOOKS.hasOwnProperty(pick) ? NIGHT_LOOKS[pick] : null;
        this.lookName = this.look ? pick : null;
        this.theme = this.look ? lookTheme(this.baseTheme, this.look) : this.nightOn ? dimTheme(this.baseTheme, NIGHT_DIM) : this.baseTheme;
    }

    /** The theme the 6WB shaders' colour uniforms come from: with a night look the day theme (the shader recolours it,
     *  as it does the baked textures), else this.theme (the plain dimmer as before). */
    _wbTheme() { return this.look ? this.baseTheme : this.theme; }

    /** A wbback's baked window level (u_win): the layout's "gain", times the look's "floor" at night. */
    _wbWin(w) {
        const g = Array.isArray(w.gain) ? w.gain : [1, 0];
        return [g[0] * (this.look ? this.look.floor : 1), g[1]];
    }

    /** The colours of a 6WB layer that follow the night colours: WBDIAL's and WBBACK's theme colours, the look's transform
     *  (u_nk0..2, the identity without one; always sent: an unset vec4 would be black), WBBACK's window level and WBMSA's
     *  text colours. Nothing for the other layers. */
    _wbColours(x) {
        const w = x.w, c = x.c, ref = x.ref, tw = this._wbTheme();
        if (w.type === 'dial' && w.look === 'wb') {
            c.uniform(ref, 'u_ring', rgb(color(tw, w.ring || 'line')));
            c.uniform(ref, 'u_ring2', rgb(color(tw, w.ring2 || 'dim')));
            c.uniform(ref, 'u_tick', rgb(color(tw, w.tick || 'fg')));
            c.uniform(ref, 'u_needle', rgb(color(tw, w.needle || 'hot')));
            c.uniform(ref, 'u_red', rgb(tw.hot));
            c.uniform(ref, 'u_face', rgb(color(tw, w.face || 'bg')));
            c.uniform(ref, 'u_glow', rgb(color(tw, w.glow || 'accent')));
        } else if (w.type === 'wbback') {
            c.uniform(ref, 'u_color', rgb(color(tw, w.color || 'accent')));
            if (!w.collar && w.tex) c.uniform(ref, 'u_win', this._wbWin(w));
        } else if (w.type === 'wbmsa') {
            c.uniform(ref, 'u_fg', rgba(color(this.theme, w.color || 'fg')));
            c.uniform(ref, 'u_dim', rgba(color(this.theme, 'dim')));
            return;                                          // WBMSA has no u_nk: its colours are already the look's
        } else if (w.type === 'atext' && w.exact) {          // 0.7.14: a "gpu" text, as its image text would take it
            c.uniform(ref, 'u_color', rgba(color(this.theme, w.color || 'fg')));
            return;                                          // ...and no u_nk either, for the same reason
        } else if (w.type === 'wbsign') {
            if (!x.nightGL) return;                          // 2026-11-16: made without the night look (Sport / Eco Pro)
            const k = this.look ? this.look.sign : 1;        // dimmed only: the identity times k
            lookRows(null).forEach((v, i) => c.uniform(ref, 'u_nk' + i, v.map((e) => e * k)));
            return;
        } else return;
        if (!x.nightGL) return;                              // 2026-11-16: made without the night look: no u_nk0..2
        lookRows(this.look).forEach((v, i) => c.uniform(ref, 'u_nk' + i, v));
    }

    /** "nightDim" / "nightLook" changed, or the sun rose or set: the night colours change in place when every layer of the
     *  layout can take them (the texts paint again on the next tick, the 6WB layers get new uniforms), so a switch makes
     *  no layer again and asks for no pixel memory. False: rebuild (a layer that took its colours when it was made). */
    _nightLive() {
        try {
            if (!this.activeName || this.activeName === 'off' || !this.layoutTheme || !this.baseTheme || !this.widgets.size) return false;
            if (!this._nightOk() && !this.nightOn) return true;     // 2026-11-16: 6WB Sport / Eco Pro: nothing to change, no rebuild
            const live = (w) => w.type === 'text' || w.type === 'wbback' || w.type === 'wbsign' || w.type === 'wbmsa' || (w.type === 'dial' && w.look === 'wb') ||
                (w.type === 'atext' && !!w.exact);      // 0.7.14: a "gpu" text (u_color)
            let ok = true;
            this.widgets.forEach((x) => { if (!x.w || !x.ref || !live(x.w)) ok = false; });
            if (!ok) return false;
            const was = this.nightOn + '|' + this.lookName;
            this._nightTheme();
            if (was === this.nightOn + '|' + this.lookName) return true;
            this.widgets.forEach((x) => { x.last = null; x.lastPaint = 0; this._wbColours(x); });
            this.log.info('night colours ' + this._nightNote() + ', in place');
            this._status();
            return true;
        } catch (e) { this.log.error('hud night live: ' + (e && e.stack || e)); return false; }
    }

    /** The night colours for the log and the status line: "off", "on (plain)", "on (amber)" ... */
    _nightNote() { return this.nightOn ? 'on (' + (this.lookName || 'plain') + ')' : 'off'; }

    /* --- end night looks --- */

    /** Start the shift-light test: the rpm the lights, bars and readouts see climbs to the shift point and holds there
     *  (about 4 s). Only while the car stands (or on demo data). Returns false when it can't run now. */
    testShift() {
        const d = this._data(), sp = d.speed;
        if (isNum(sp) && sp > 3 && !d.demo) return false;
        this.testAt = Date.now();
        this.log.info('shift-light test');
        return true;
    }
    shiftTesting() { return this.testAt !== null; }

    /** The test's rpm now, or null when no test runs (it ends by itself). */
    _testRpm(now) {
        if (this.testAt === null) return null;
        const t = now - this.testAt;
        if (t > TEST_CLIMB_MS + TEST_HOLD_MS || t < 0) { this.testAt = null; return null; }
        const top = this._shiftPointRaw() + 200;
        return TEST_FROM + (top - TEST_FROM) * Math.min(1, t / TEST_CLIMB_MS);
    }
    _shiftPointRaw() { return this.score.shiftPoint(this._data().oil).rpm; }

    /** A readout over its warning limit ("warnOil" C, "warnCoolant" C, "warnBoost" bar; 0 = off): which sensor, else null. */
    _warning(w) {
        const t = String(w.text || '');
        let id = null;
        if (t.indexOf('{{slot:') >= 0 && w.slot) id = (this.slotSensor(this.activeName, w.slot, this.layoutSlots) || {}).id;
        else if (t.indexOf('{{oil}}') >= 0) id = 'oil';
        else if (t.indexOf('{{coolant}}') >= 0) id = 'coolant';
        else if (t.indexOf('{{boost}}') >= 0) id = 'boost';
        return this._overLimit(id);
    }
    /** `id` (oil / coolant / boost) if that reading is over its warning limit now, else null. */
    _overLimit(id) {
        if (!WARN[id]) return null;
        const lim = this.setting(WARN[id]), v = this._raw(id);
        return isNum(lim) && lim > 0 && isNum(v) && v > lim ? id : null;
    }

    _barMax(w) { return Math.ceil(this._redline() / 1000) * 1000 + ((w && w.over) || 0); }

    /** The shift point now ({ rpm, cold }) and whether the rpm is at or past it. */
    _shift() {
        const d = this._data();
        const sp = this.score.shiftPoint(d.oil);
        const rpm = isNum(this.rpmF) ? this.rpmF : d.rpm;
        sp.now = isNum(rpm) && rpm >= sp.rpm;
        sp.oilCold = isNum(d.oil) && d.oil < 80;
        return sp;
    }

    /** Boost in bar: the sport display's value while fresh, else the engine unit's, else null. */
    _boost() {
        const now = Date.now();
        if (isNum(this.boostFes) && now - this.boostFesAt < FRESH_MS) return this.boostFes;
        if (isNum(this.boostDme) && now - this.boostDmeAt < FRESH_MS) return this.boostDme;
        return null;
    }

    /** A tyre's pressure ('p', bar) or temperature ('t', C) at corner FL FR RL RR; steady made-up values on the demo drive. */
    /** A TPMS pressure raw (0.1 x the car's unit, 65532 and up = none) in bar: by the car's unit when known, else by the
     *  unit whose plausible tyre pressures the value falls in (bar 0.5-6, psi 7-60, kPa 60-600; psi also means F). */
    _tyreBar(raw) {
        if (!isNum(raw) || raw < 0 || raw >= 65532) return null;
        const v = raw / 10, k = PRESS_TO_BAR[this.carUnits.press];
        if (k) return v * k;
        if (v >= 0.5 && v <= 6) return v;
        if (v >= 7 && v < 60) { this.carUnits.psiSeen = true; return v / 14.5038; }
        if (v >= 60 && v <= 600) return v / 100;
        return v;
    }

    /** A TPMS temperature raw (the car's degrees + 40, 65535 = none) in C (the car sends F when set to F). */
    _tyreC(raw) {
        if (!isNum(raw) || raw < 0 || raw >= 65535) return null;
        const v = raw - 40, f = this.carUnits.temp ? this.carUnits.temp === 'F' : this.carUnits.psiSeen;
        return f ? (v - 32) * 5 / 9 : v;
    }

    /** The shifter programme letter next to the gear: S or M from the M drive display, else from the gearbox status, else D. */
    _program(d) {
        const p = this.program || d.program;
        return p === 'S' || p === 'M' ? p : 'D';
    }

    _tyre(kind, corner) {
        const v = this.tyres[kind][corner];
        if (isNum(v)) return v;
        if (!this._data().demo) return null;
        const rear = corner === 'RL' || corner === 'RR';
        return kind === 'p' ? (rear ? 2.5 : 2.3) : (rear ? 27 : 24);
    }

    /**
     * audit/features: where a rev dial's needle rests while no rpm is on the scale, as a fraction of the sweep.
     * 0 is READY (the scale's zero); a negative fraction is the OFF mark, "off" degrees before the start.
     * READY while the car is live with the engine not turning, which is what the F30's READY mark means:
     *   - auto start/stop says it stopped the engine (config.msa "stopped"), or
     *   - BMW's own vehicle condition is drive-ready (COND_READY: FAHREN / FAHRBEREITSCHAFT_HERSTELLEN), or
     *   - the engine signal says the engine runs while rpm is missing or invalid (don't drop to OFF then).
     * OFF otherwise: ignition off, parked, or nothing known yet - the stock cluster rests at OFF before the
     * engine is started (reference/6wb photos 03 and 05).
     */
    _restFrac(w) {
        const cond = this._data().condition;
        const ready = this._raw('msa') === MSA_STATES.stopped || COND_READY.indexOf(cond) >= 0 || this.engineRun === 'running';
        return ready ? 0 : -w.off / (w.sweep === undefined ? 270 : w.sweep);
    }

    /** A dial's scale: { max, ticks } in display units (speed: DIAL_SPEED by the units setting; rpm: "max", 8000). */
    _dialScale(w) {
        if (w.scale) return w.scale;                // a layout's own scale: { max, ticks } ("kmh": true: always km/h)
        if (w.measure === 'speed') return DIAL_SPEED[this.setting('units') === 'us' ? 'us' : 'metric'];
        if (w.measure === 'rpm') { const max = w.max || 8000; return { max, ticks: max / 1000 }; }
        return { max: w.max || 1, ticks: w.ticks || 8 };
    }

    /** Peak hold for a gauge: the highest value of the last `hold` ms (true: 3 s), as 0..1. */
    _peakHold(x, v, now, hold) {
        const ms = hold === true ? 3000 : hold;
        if (!isNum(x.peakV) || v >= x.peakV || now - x.peakAt > ms) { x.peakV = v; x.peakAt = now; }
        return x.peakV;
    }

    /** One car sample: the g average (G_BAD, G_AVG_MS). */
    _gSample(d, t) {
        if (!isNum(d.gLong) || Math.abs(d.gLong) > G_BAD || (isNum(d.gLat) && Math.abs(d.gLat) > G_BAD)) return;
        this.gBuf.push([t, isNum(d.gLat) ? d.gLat : 0, d.gLong]);
        while (this.gBuf.length && t - this.gBuf[0][0] > G_AVG_MS) this.gBuf.shift();
        const n = this.gBuf.length;
        this.gSm = { lat: this.gBuf.reduce((a, s) => a + s[1], 0) / n, long: this.gBuf.reduce((a, s) => a + s[2], 0) / n, at: Date.now() };
    }

    /** Forget the G-meter's envelope, trail and bests (the page's Reset button, the demo / car switch). */
    resetG() {
        this.gEnv = new Array(G_SECTORS).fill(0);    // car frame: sector n at n * 7.5 degrees, atan2(long, lat)
        this.gBest = { left: 0, right: 0, accel: 0, brake: 0, total: 0 };
        this.gTrail = [];                            // [t, lat, long], newest first
        this.gEnvAt = Date.now();                    // changes when the envelope does (widgets resend it)
    }

    /** The G-meter's range in g: the setting, else the layout's "max", else 1.2. */
    _gRange(w) {
        const v = Number(this.setting('gRange'));
        return v > 0 ? v : (w && w.max) || 1.2;
    }

    /** The g every tick (car frame, lat + = left, long + = speeding up): the envelope, bests and trail. */
    _gTick(now) {
        const lat = this._raw('gLat'), lon = this._raw('gLong');
        if (!isNum(lat) || !isNum(lon)) return;
        const r = Math.sqrt(lat * lat + lon * lon), B = this.gBest;
        if (lat > B.left) B.left = lat;
        if (-lat > B.right) B.right = -lat;
        if (lon > B.accel) B.accel = lon;
        if (-lon > B.brake) B.brake = -lon;
        if (r > B.total) B.total = r;
        if (r > 0.05) {
            const n = Math.round(Math.atan2(lon, lat) / (2 * Math.PI) * G_SECTORS);
            for (let o = -G_SPREAD; o <= G_SPREAD; o++) {
                const i = ((n + o) % G_SECTORS + G_SECTORS) % G_SECTORS;
                const v = Math.round(r * Math.cos(o * 2 * Math.PI / G_SECTORS) * 50) / 50;
                if (v > this.gEnv[i]) { this.gEnv[i] = v; this.gEnvAt = now; }
            }
        }
        const secs = Number(this.setting('gTrail')), step = secs > 0 ? secs * 1000 / (G_TRAIL - 1) : 0;
        if (!step) { this.gTrail = []; return; }
        if (!this.gTrail.length || now - this.gTrail[0][0] >= step) {
            this.gTrail.unshift([now, lat, lon]);
            if (this.gTrail.length > G_TRAIL - 1) this.gTrail.length = G_TRAIL - 1;
        }
    }

    /** Screen signs for the G-meter: [sx, sy], drawn x = sx * lat, drawn y (down) = sy * long. */
    _gSigns(w) {
        const fx = (this.setting('gFlipLat') === true) !== !!(w && w.flipX), fy = (this.setting('gFlipLong') === true) !== !!(w && w.flipY);
        return [fx ? 1 : -1, fy ? 1 : -1];
    }

    /** What the page's G-meter tab shows: the g now, the trail and envelope as drawn, the bests, the range. */
    gState() {
        const S = this._gSigns(null), lat = this._raw('gLat'), lon = this._raw('gLong');
        return {
            x: isNum(lat) ? S[0] * lat : null, y: isNum(lon) ? S[1] * lon : null,
            trail: this.gTrail.map((p) => [S[0] * p[1], S[1] * p[2]]), env: this._gEnvDrawn(S),
            best: this.gBest, max: this._gRange(null), live: isNum(lat) && isNum(lon),
        };
    }

    /** The envelope by drawn sector: sector m at m * 7.5 degrees counter-clockwise from + x, + y up. */
    _gEnvDrawn(S) {
        const out = new Array(G_SECTORS);
        for (let m = 0; m < G_SECTORS; m++) {
            const a = m * 2 * Math.PI / G_SECTORS;
            // drawn up vector u = (sx * lat, -sy * long), so the car's direction is (sx cos a, -sy sin a)
            const n = Math.round(Math.atan2(-S[1] * Math.sin(a), S[0] * Math.cos(a)) / (2 * Math.PI) * G_SECTORS);
            out[m] = this.gEnv[((n % G_SECTORS) + G_SECTORS) % G_SECTORS];
        }
        return out;
    }

    _raw(name) {
        // 0.7.14: inside the needle timer (_needleTick) the needles read rpm / speed interpolated between the car's samples
        if (this.needleOver && (name === 'rpm' || name === 'speed') && isNum(this.needleOver[name])) return this.needleOver[name];
        if (name === 'boost') return this._boost();
        if (name === 'gLat' || name === 'gLong') {
            // the 150 ms average while samples come in; else the car's last reading, unless it is a bad one
            if (this.gSm && Date.now() - this.gSm.at < 1000) return name === 'gLat' ? this.gSm.lat : this.gSm.long;
            const g = this._data()[name];
            return isNum(g) && Math.abs(g) <= G_BAD ? g : null;
        }
        if (name === 'intake') {
            if (isNum(this.intakeDme) && Date.now() - this.intakeDmeAt < 10000) return this.intakeDme;
            return this._data().demo ? 31 : null;
        }
        if (name === 'rpm' && isNum(this.rpmF)) return this.rpmF;
        if (name === 'hvSoc') return isNum(this.hvSoc) && Date.now() - this.hvSocAt < HV_STALE_MS ? this.hvSoc : this._data().demo ? 64 : null;
        // package E: the signs. limitEnd: 1 while the car shows the end of a limit (the derestriction sign)
        if (name === 'nopass') return this.nopassOn ? 1 : this._data().demo ? 1 : null;
        if (name === 'limitEnd') return this.limitState === 'end' ? 1 : null;
        // car3 I: limitUnknown 1 while BMW would show its empty sign "---"; msa 1 active, 2 off, 3 engine stopped by MSA,
        // 4 unavailable, null hidden (config.msa unset or the car's value unmapped); ccMsg 1 / 0 while config.ccm knows
        if (name === 'limitUnknown') return this.limitState === 'unknown' ? 1 : null;
        if (name === 'msa') return MSA_STATES[this.msaState] || null;
        if (name === 'ccMsg') { const cc = this._cc(); return cc === null ? null : cc ? 1 : 0; }
        if (name === 'cons') return isNum(this.consL) && Date.now() - this.consAt < 5000 ? this.consL : this._data().demo ? 7.4 : null;
        if (name === 'limit') return isNum(this.limitKmh) ? this.limitKmh : this.limitState === 'none' && this._data().demo ? 90 : null;
        if (name === 'fuel' || name === 'range' || name === 'ambient') {
            // the kit's demo drive has none of these: made-up but steady values while it runs
            const demo = this._data().demo;
            if (name === 'fuel') {
                if (isNum(this.fuelObd) && Date.now() - this.fuelObdAt < FUEL_STALE_MS) return this.fuelObd / 100;
                return isNum(this.fuelL) ? Math.min(1, this.fuelL / this._tankLitres()) : demo ? 0.62 : null;
            }
            if (name === 'range') return isNum(this.rangeKm) ? this.rangeKm : demo ? 368 : null;
            return isNum(this.ambient) ? this.ambient : demo ? 24 : null;
        }
        if (name === 'torquePct' || name === 'powerPct') {
            // the car's own sport display % while it sends one, else from the crank torque and app.json
            // config.engine's peaks (an M40i makes 500 Nm, 285 kW)
            if (Date.now() - (this.sportAt || 0) < FRESH_MS) {
                const v = name === 'powerPct' ? this.sportPower : this.sportTorque;
                if (isNum(v)) return v;
            }
            const e = this.config.engine || {}, d = this._data();
            if (!isNum(d.torque)) return null;
            if (name === 'torquePct') return Math.max(0, d.torque) / (e.torqueNm || 500) * 100;
            return isNum(d.rpm) ? Math.max(0, d.torque) * d.rpm / 9549 / (e.powerKw || 285) * 100 : null;
        }
        if (name.indexOf('setupLevel:') === 0) { const s = this._setup(); return s ? SETUP_LEVEL[s[name.slice(11)]] || 0 : 0; }
        const d = this._data();
        return Object.prototype.hasOwnProperty.call(d, name) ? d[name] : null;
    }

    /** Where the red and orange marks start on a rev scale that ends at `max` rpm, as fractions 0..1: red from the
     *  redline, but always covering at least the last 500 rpm (the M40i's scale ends right at its 7000 redline),
     *  orange over the 700 rpm before the red. */
    _redMarks(max) {
        const redFrom = Math.min(this._redline(), max - 500) / max;
        return [redFrom, redFrom - 700 / max];
    }

    /** The scale label nearest the value now: 'speed' (SPEED_SCALE index) or 'rpm' (thousands); null without data. */
    _nearMark(kind) {
        if (kind === 'rpm') { const r = this._raw('rpm'); return isNum(r) ? Math.round(r / 1000) : null; }
        const v = this._raw('speed');
        if (!isNum(v)) return null;
        const us = this.setting('units') === 'us';
        return Math.round(scaleFrac(us ? v * 0.621371 : v, SPEED_SCALE[us ? 'us' : 'metric']) * 8);
    }

    /** The setup rows for the drive mode now, or null before the car has said. */
    _setup() {
        if (!this.driveMode) return null;
        if (this.driveVariant === 'individual') return SETUP.individual;
        return SETUP[this.driveMode === 'sport' && this.driveVariant === 'plus' ? 'sportplus' : this.driveMode];
    }

    /** {{token}} -> display text. */
    _token(tok) {
        const us = this.setting('units') === 'us';
        const fix = (v, n) => (isNum(v) ? v.toFixed(n) : '--');
        if (tok.indexOf('slot') === 0 && tok.indexOf(':') > 0) {
            const kind = tok.slice(0, tok.indexOf(':')), sn = this.slotSensor(this.activeName, tok.slice(kind.length + 1), this.layoutSlots);
            if (kind === 'slot') return this.sensorValue(sn);
            if (kind === 'slotHead') return sn ? sn.head : '';
            // the heading with the unit, for a slot with no unit of its own: "FUEL %" (a temperature's ° is on its value)
            if (kind === 'slotHeadU') { const u = sn && !sn.suffix ? this.sensorUnit(sn) : ''; return sn ? sn.head + (u ? ' ' + u : '') : ''; }
            if (kind === 'slotUnit') return this.sensorUnit(sn);
            if (kind === 'slotSuffix') return sn && sn.suffix ? sn.suffix : '';
        }
        if (tok.indexOf('tyreP:') === 0) { const v = this._tyre('p', tok.slice(6)); return isNum(v) ? (us ? fix(v * 14.5038, 0) : fix(v, 1)) : '--'; }
        if (tok.indexOf('tyreT:') === 0) { const v = this._tyre('t', tok.slice(6)); return isNum(v) ? String(Math.round(us ? v * 9 / 5 + 32 : v)) : '--'; }
        if (tok.indexOf('dial:speed:') === 0) {     // a speed dial's label i ({{dial:speed:<i>}}): DIAL_SPEED's steps
            const D = DIAL_SPEED[us ? 'us' : 'metric'];
            return String(Math.round(D.max / D.ticks * Number(tok.slice(11))));
        }
        switch (tok) {
            case 'u:pressure': return us ? 'psi' : 'bar';
            case 'intake': { const v = this._raw('intake'); return fix(isNum(v) ? (us ? v * 9 / 5 + 32 : v) : v, 0); }
            case 'boostPeak': { const v = this.boostPeak; return us ? fix(isNum(v) ? v * 14.5038 : v, 1) : fix(v, 2); }
            case 'run': { const v = this.runs.shown(Date.now()); return isNum(v) ? v.toFixed(this.runs.state === 'run' ? 1 : 2) : '0.00'; }
            case 'runBest': { const v = this.runs.best[us ? 'us' : 'metric']; return v > 0 ? v.toFixed(2) : '-.--'; }
            case 'runState': return this.runs.word();
            case 'runLabel': return us ? '0-60 MPH' : '0-100 KM/H';
            case 'warm': { const o = this._raw('oil'); return isNum(o) ? (o < 80 ? 'WARMING UP' : 'ENGINE WARM') : ''; }
            case 'speed': { const v = this._raw('speed'); return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0); }
            case 'u:speed': return us ? 'MPH' : 'KM/H';
            case 'oil': case 'coolant': { const v = this._raw(tok); return fix(isNum(v) ? (us ? v * 9 / 5 + 32 : v) : v, 0); }
            case 'boost': { const v = this._raw('boost'); return us ? fix(isNum(v) ? v * 14.5038 : v, 1) : fix(v, 2); }
            case 'u:boost': return us ? 'PSI' : 'BAR';
            case 'u:temp': return us ? '°F' : '°C';
            case 'u:speedLc': return us ? 'mph' : 'km/h';
            case 'u:distLc': return us ? 'mi' : 'km';
            case 'u:dist': return us ? 'MI' : 'KM';
            case 'avgSpeed': { const v = this._avgSpeed(); return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0); }
            case 'limit': {
                // the car's own figure when it sends one (its unit is the sign's), else ours converted
                const s = this.sign;
                if (s && s.state === 'limit' && isNum(s.shown)) return String(Math.round(s.shown));
                const v = this._raw('limit');
                return isNum(v) ? String(us ? Math.round(v * 0.621371 / 5) * 5 : Math.round(v)) : '';
            }
            // ---- bottom row: the sign's extras, the message and the road label (docs/BOTTOM-ROW-PACKAGE.md) ----
            case 'limitUnit': { const s = this.sign; return s && s.unit === 'mph' ? 'mph' : s && s.unit === 'kmh' ? 'km/h' : ''; }
            case 'limitSupp': { const s = this.sign; return s && s.supp ? SUPP_TEXT[s.supp] || String(s.supp) : ''; }
            case 'limitWarn': { const s = this.sign; return s && s.warn ? String(s.warn) : ''; }
            case 'nopassDist': { const s = this.sign; return s && isNum(s.npM) ? (s.npM >= 1000 ? (s.npM / 1000).toFixed(1) + ' km' : Math.round(s.npM) + ' m') : ''; }
            case 'ccName': return this._ccText('name');
            case 'ccDesc': return this._ccText('desc');
            case 'ccHead': return this._ccText('head');      // package X: our one-line message, the headline
            case 'road': return this._roadText();
            case 'navDist': { const d = this.navDist || ''; return d ? d + (this.navUnit ? ' ' + this.navUnit : '') : ''; }
            case 'navEta': { const e = this.navEta; return e ? ('0' + e.h).slice(-2) + ':' + ('0' + e.m).slice(-2) : ''; }
            case 'navMins': return isNum(this.navMins) ? String(this.navMins) : '';
            // ---- end bottom row ----
            case 'cons': { const v = this._raw('cons'); return isNum(v) ? (us ? (v > 0.5 ? 235.215 / v : 0).toFixed(0) : v.toFixed(1)) : '--'; }
            case 'range': { const v = this._raw('range'); return fix(isNum(v) ? (us ? v * 0.621371 : v) : v, 0); }
            case 'ambient': {
                const v = this._raw('ambient');
                if (!isNum(v)) return '--';
                const n = Math.round(us ? v * 9 / 5 + 32 : v);
                return (n > 0 ? '+' : '') + n;
            }
            case 'u:torque': return us ? 'lb-ft' : 'Nm';
            case 'power': {          // kW from the crank torque and rpm; hp in US units
                const d = this._data(), rpm = this._raw('rpm');
                if (!isNum(d.torque) || !isNum(rpm)) return '--';
                const kw = Math.max(0, d.torque) * rpm / 9549;
                return String(Math.round(us ? kw * 1.341 : kw));
            }
            case 'hvSoc': { const v = this._raw('hvSoc'); return isNum(v) ? String(Math.round(v)) : '--'; }
            case 'fuelPct': { const v = this._raw('fuel'); return isNum(v) ? String(Math.round(v * 100)) : '--'; }
            case 'ambient1': {       // package F: as BMW's bottom row shows it, "+3.5" (the car sends 0.5 °C steps); °F whole
                const v = this._raw('ambient');
                if (!isNum(v)) return '--';
                if (us) { const n = Math.round(v * 9 / 5 + 32); return (n > 0 ? '+' : '') + n; }
                const h = Math.round(v * 2) / 2;
                return (h > 0 ? '+' : '') + (h === 0 ? 0 : h).toFixed(1);
            }
            case 'ambientN': { const v = this._raw('ambient'); return isNum(v) ? String(Math.round(us ? v * 9 / 5 + 32 : v)) : '--'; }
            case 'torque': { const v = this._raw('torque'); return fix(isNum(v) ? (us ? v * 0.737562 : v) : v, 0); }
            case 'torquePct': case 'powerPct': { const v = this._raw(tok); return isNum(v) ? String(Math.min(100, Math.round(v))) : '--'; }
            case 'boostHi': return us ? '20' : '1.4';
            case 'boostMid': return us ? '10' : '0.7';
            case 'ampmLc': return this._token('ampm').toLowerCase();
            case 'gLat': case 'gLong': { const v = this._raw(tok); return isNum(v) ? Math.abs(v).toFixed(2) : '--'; }
            case 'gSide': case 'gFwd': {
                // the car's left / right (gFlipLat: its sign the other way round); brake on top doesn't change the words
                const v = this._raw(tok === 'gSide' ? 'gLat' : 'gLong');
                if (!isNum(v)) return '--';
                const a = Math.abs(v).toFixed(2);
                if (a === '0.00') return a;
                if (tok === 'gFwd') return a + (v > 0 ? ' ACC' : ' BRK');
                return a + ((v > 0) !== (this.setting('gFlipLat') === true) ? ' L' : ' R');
            }
            case 'gBest': return this.gBest.total > 0 ? this.gBest.total.toFixed(2) : '--';
            case 'gMax': return this._gRange(null).toFixed(1);
            case 'rpm': case 'rpm10': return isNum(this.rpmShown) ? String(this.rpmShown) : (tok === 'rpm' ? '--' : '----');
            case 'shiftAt': return String(this._shift().rpm);
            case 'lastShift': return this.score.last ? String(this.score.last.rpm) : '--';
            case 'lastGears': { const l = this.score.last; return l && l.from !== '?' ? l.from + ' > ' + l.to : ''; }
            case 'verdict': return this.score.last ? this.score.last.verdict : '';
            case 'shiftPrompt': return this._shift().now ? 'SHIFT' : '';
            case 'coldNote': {
                const sp = this._shift();
                if (!sp.oilCold) return '';
                return sp.cold ? 'COLD · LIMIT ' + sp.rpm : 'OIL COLD · GO EASY';
            }
            case 'gearnum': {
                const d = this._data();
                if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
                return isNum(d.gear) && d.gear > 0 ? String(d.gear) : (d.gear === 0 ? 'N' : '-');
            }
            case 'stage': {          // the selector letter alone: P R N, or D / S / M by the shifter programme
                const d = this._data();
                return d.stage === 'D' || (!d.stage && isNum(d.gear) && d.gear > 0) ? this._program(d) : (d.stage || '-');
            }
            case 'gearInD': {        // the gear number while driving, else nothing (the M "2D")
                const d = this._data();
                return (d.stage === 'D' || (!d.stage && isNum(d.gear))) && isNum(d.gear) && d.gear > 0 ? String(d.gear) : '';
            }
            case 'mode': {
                if (!this.driveMode) return '';
                const base = this.driveMode === 'sport' ? 'SPORT' : this.driveMode === 'eco' ? 'ECO PRO' : 'COMFORT';
                return base + (this.driveVariant === 'plus' ? ' PLUS' : this.driveVariant === 'individual' ? ' INDIVIDUAL' : '');
            }
            // car3 J: G20 Comfort's mode label in the tacho's centre, two lines as BMW prints it ("COMFORT" / "PLUS",
            // photos 08, 09, 39); plain Comfort shows none (photo 41: no label in BMW's row while our theme ran)
            case 'g20mode1': case 'g20mode2': {
                if (!this.driveMode || (this.driveMode === 'comfort' && !this.driveVariant)) return '';
                const base = this.driveMode === 'sport' ? 'SPORT' : this.driveMode === 'eco' ? 'ECO PRO' : 'COMFORT';
                const v = this.driveVariant === 'plus' ? 'PLUS' : this.driveVariant === 'individual' ? 'INDIVIDUAL' : '';
                return tok === 'g20mode1' ? base : v;
            }
            case 'gear': {
                const d = this._data();
                if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
                const g = isNum(d.gear) && d.gear > 0 ? String(d.gear) : '';
                return d.stage === 'D' ? this._program(d) + g : g;
            }
            case 'time': case 'ampm': {
                const now = this._now();
                const h = now.getHours(), m = now.getMinutes();
                if (tok === 'ampm') return !this._clock24() ? (h < 12 ? 'AM' : 'PM') : '';
                if (this._clock24()) return pad2(h) + ':' + pad2(m);
                return ((h % 12) || 12) + ':' + pad2(m);
            }
            default:
                if (tok.indexOf('spd:') === 0) { const v = SPEED_SCALE[us ? 'us' : 'metric'][Number(tok.slice(4))]; return v === undefined ? '' : String(v); }   // speed scale labels
                if (tok.indexOf('temp:') === 0) { const c = Number(tok.slice(5)); return isNum(c) ? String(us ? Math.round((c * 9 / 5 + 32) / 10) * 10 : Math.round(c)) : '--'; }   // gauge labels: °F to the 10
                if (tok.indexOf('setup:') === 0) { const s = this._setup(); return s ? s[tok.slice(6)] || '' : '--'; }
                if (tok.indexOf('signal:') === 0) { const v = this._raw(tok.slice(7)); return isNum(v) ? (Math.round(v * 10) / 10).toString() : '--'; }
                return '{{' + tok + '}}';
        }
    }

    /* 2026-11-15, the owner: the settings "redline", "shiftBefore", "clock" and "units" were retired from the screen
     * (app.json config._retiredSettings). Each of these three still PREFERS a setting when the app declares one, so
     * putting any of them back in app.json's "settings" restores the control with no other change; with none, the
     * value comes from config. "units" needed no accessor: its drop-down had the single option "metric", so the
     * `setting('units') === 'us'` tests throughout simply stay false. */
    /** The redline in rpm: the setting if there still is one, else config.redline, else 7000. */
    _redline() {
        const s = this.ctx.settings.item('redline') ? this.setting('redline') : null;
        if (isNum(s) && s > 0) return s;
        return isNum(this.config.redline) && this.config.redline > 0 ? this.config.redline : 7000;
    }
    /** How far before the redline the shift mark lights, in rpm. */
    _shiftBefore() {
        const s = this.ctx.settings.item('shiftBefore') ? this.setting('shiftBefore') : null;
        if (isNum(s) && s >= 0) return s;
        return isNum(this.config.shiftBefore) && this.config.shiftBefore >= 0 ? this.config.shiftBefore : 300;
    }
    /** 24-hour clock? The setting if there still is one, else config.clock24, else yes. */
    _clock24() {
        const s = this.ctx.settings.item('clock') ? this.setting('clock') : null;
        if (s === '12h' || s === '24h') return s === '24h';
        return this.config.clock24 !== false;
    }

    /** The fuel tank's size in litres: the "tankLitres" setting, else config.tankLitres (the car sends litres only). */
    _tankLitres() {
        const s = this.ctx.settings.item('tankLitres') ? this.setting('tankLitres') : null;
        return isNum(s) && s > 0 ? s : (this.config.tankLitres || 65);
    }

    /**
     * Local time. The head unit's clock runs on UTC (issues #6, #8: the clock 5 to 7 hours ahead), so the "timeZone"
     * setting (minutes from UTC; TZ_AUTO = the unit's own) wins, then the car's own (config.clock; car3 I), then
     * config.utcOffsetMinutes.
     */
    _now() {
        const off = this._tzMinutes();
        if (!isNum(off)) return new Date();
        const d = new Date(Date.now() + off * 60000);
        return { getHours: () => d.getUTCHours(), getMinutes: () => d.getUTCMinutes() };
    }
    /** car3 I: minutes from UTC for our clock, or null (none known: the unit's own clock, UTC on the car).
     *  Package X (the owner, 2026-11-16: "the clock is always ours in all6WB, from the car's signals"): the car's own
     *  time zone FIRST (config.clock), then the "timeZone" setting unless Automatic (retired on 2026-11-15, read if a
     *  build still has it), then config.utcOffsetMinutes; each only if it is a whole number of quarter hours within
     *  +-14 h (tzOk). */
    _tzMinutes() {
        const s = this._tzSource();
        return s ? s.min : null;
    }
    /** package X: { min, from } of the time zone in use, or null. `from`: what the log line names. */
    _tzSource() {
        if (tzOk(this.tzCar)) return { min: this.tzCar, from: 'the car (app.json config.clock)' };
        if (tzOk(this.tzLocal)) return { min: this.tzLocal, from: 'the car\'s shown clock (app.json config.clockLocal)' };
        const tz = this.ctx.settings.item('timeZone') ? this.setting('timeZone') : TZ_AUTO;
        if (tz !== TZ_AUTO && tzOk(tz)) return { min: tz, from: 'the "timeZone" setting' };
        if (tzOk(this.config.utcOffsetMinutes)) return { min: this.config.utcOffsetMinutes, from: 'app.json config.utcOffsetMinutes' };
        return null;
    }
    /** package X: ONE line the owner can check against the car at a glance, logged whenever the source or the offset
     *  changes: what our clock shows now, the offset and where it came from. */
    _clockNote() {
        const s = this._tzSource(), key = s ? s.from + '|' + s.min : 'none';
        if (key === this.clockNoteKey) return;
        this.clockNoteKey = key;
        if (!s) {
            this.log.info('clock: no time zone known (not from the car, the "timeZone" setting or app.json config.utcOffsetMinutes): in "all6WB" the bottom row stays BMW\'s until one is');
            return;
        }
        const d = this._now(), pad = (n) => (n < 10 ? '0' : '') + n, a = Math.abs(s.min);
        this.log.info('clock: ours shows ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ', UTC' + (s.min < 0 ? '-' : '+') +
            pad(Math.floor(a / 60)) + ':' + pad(a % 60) + ' from ' + s.from + ' - it must read what the head unit\'s own clock reads');
    }

    _resolve(template) { return String(template).replace(/\{\{([a-zA-Z0-9:]+)\}\}/g, (_, t) => this._token(t)); }

    /* ---------------- layers ---------------- */

    _rebuild() {
        this._guard('rebuild', () => this._rebuildInner());
        this._status();
    }

    _rebuildInner() {
        if (!this.client.ready) return; // the 'ready' handler calls us again
        this._rowCheck();               // bottom row: an element with no signal behind it goes back to BMW's
        // package X: who draws the row in the layout being built (_rowSync rebuilds when that changes), and nothing of
        // our message is on the screen until its new layer has been painted
        this.rowBuiltOurs = this._rowWhy() === null;
        this.ccDrawn = null;
        this._layerRefs().forEach((r) => r.c.drop(r.ref));
        this.placed = [];
        this.widgets.clear();
        this.sheets = [];
        this.pixelBytes = 0;
        this.sceneUsed = new Set();      // the scene textures this layout samples; the others are dropped once it is built
        this.layerStates.clear();
        this.refused = null;
        clearTimeout(this.statusAskT); this.statusAskT = null;
        this.car.setRedline(this._redline());
        const name = this._layoutName();
        this.activeName = name;
        this.mapLayout = false;
        this.mapShown = this.setting('mapUp');
        if (name === 'off') {
            this._wazeWant();
            this.problem = null; this.layoutTheme = null; this.needsBoost = false; this.needsIntake = false; this.needsHv = false; this.needsFuel = false;
            this.log.info('off: nothing drawn, BMW\'s own ' + (this.target === 'panel' ? 'cluster' : 'HUD') + ' shows');
            return;
        }
        let layout;
        try { layout = this.layouts.load(name); } catch (e) {
            this.problem = e.message;
            this.log.warn('layout "' + name + '" unusable (' + e.message + '); showing nothing');
            this._wazeWant();
            return;
        }
        this.problem = null;
        this.mapLayout = layout.widgets.some((w) => w.holeWhen === 'mapUp');
        this._wazeWant();
        this.layoutSlots = layout.slots || [];
        this.layoutTheme = layout.theme && THEMES[layout.theme] ? layout.theme : null;
        this.themeName = this._themeName();
        this.baseTheme = THEMES[this.themeName] || THEMES.classic;
        this.wbLayout = layout.widgets.some((w) => w.type === 'wbback' || (w.type === 'dial' && w.look === 'wb'));
        this._nightTheme();             // 2026-11-14: this.theme, with the night colours (a night look or the plain dimmer)
        this.log.info('layout "' + layout.name + '", theme ' + this.theme.name + (this.layoutTheme ? '' : ' (' + this.setting('hudTheme') + ')') +
            (this.nightOn ? ', night colours ' + this._nightNote() : ''));
        // 0.7.14: a text widget with "gpu": true becomes its atlas text layers here (_gpuTexts)
        // fix/row-cc: _builtOn - a text's "cc:" toggle parts are read live (_ccHidden), not here
        const shown = this._gpuTexts(layout.widgets.filter((w) => this._builtOn(w) &&!(w.themes && w.themes.indexOf(this.themeName) < 0)));
        this._setNeeds(shown);
        // plan the layers first (a sheet's size is only known once every member is placed), then make them
        // in that order: within a class and z, cluster-render puts the newer layer on top. Small sheets
        // first; a bigger limit only when the layer budget needs it (see the header).
        const area = this.size[0] * this.size[1];
        const over = (p) => this._connCounts(p).some((k) => k > LAYER_BUDGET);
        // a layout's "packWaste" (the Nov 7 2026 themes): a widget joins a sheet only while the sheet's box stays within
        // that many times its members' own area, so far-apart readouts don't share one mostly empty sheet (pixel
        // memory); relaxed along with the size limit when the layer budget needs it. Without it: the size limit only.
        let waste = isNum(layout.packWaste) ? layout.packWaste : Infinity;
        let maxPx = Math.floor(area / SHEET_AREA_FRAC), plan = this._plan(shown, maxPx, waste);
        while (over(plan) && (maxPx !== Infinity || waste !== Infinity)) {
            maxPx = maxPx * 2 >= area ? Infinity : maxPx * 2;
            waste = waste * 2 > 64 ? Infinity : waste * 2;
            plan = this._plan(shown, maxPx, waste);
        }
        // the scene textures this layout does not use go before its own are made: the old and the new set together can
        // pass the service's 16 MiB ("the service's pixel memory is full", seen on the car when switching to baked)
        const needs = this._sceneNeeds(shown);
        this.atlases.forEach((a, key) => {
            if (!this._dropsUnused(key) || needs.has(key)) return;
            this._guard('drop ' + key, () => a.c.drop(a.ref));
            this.atlases.delete(key);
        });
        let effects = 0, own = 0, sheets = 0, bytes = 0, px = 0;
        plan.forEach((e) => {
            if (e.kind === 'sheet') { sheets++; bytes += e.w * e.h * 4; px += e.w * e.h * 8; this._guard('sheet ' + e.members[0].id, () => this._createSheet(e)); }
            else {
                if (IMAGE_TYPES[e.w.type]) { own++; px += e.w.w * e.w.h * 8; } else effects++;
                this._guard('widget ' + e.w.id, () => this._create(e.w, null));
            }
        });
        if (this._offset().x || this._offset().y || this._scale() !== 1) this._place();
        this.atlases.forEach((a, key) => {        // another mode's scene textures: give their pixel memory back
            if (!this._dropsUnused(key) || this.sceneUsed.has(key)) return;
            this._guard('drop ' + key, () => a.c.drop(a.ref));
            this.atlases.delete(key);
        });
        const atlasBytes = this._atlasBytes();
        px += atlasBytes;
        this.pixelBytes = px;
        const n = this._layerRefs().length, counts = this._connCounts(plan);
        this.log.info('layout "' + layout.name + '": ' + shown.length + ' widgets, ' + this._layerCount(n) + ' (' + effects + ' effects, ' +
            sheets + ' image sheets' + (own ? ', ' + own + ' own image layers' : '') + ')' +
            (counts.length > 1 ? ' on ' + counts.length + ' connections (' + counts.join(' + ') + ')' : '') + ', sheet limit ' +
            (maxPx === Infinity ? 'unlimited' : maxPx + ' px') + ', whole-sheet writes ' + bytes + ' bytes, pixel memory ' + mib(px) + ' of 16 MiB' +
            (atlasBytes ? ' (' + this.atlases.size + ' glyph atlas' + (this.atlases.size > 1 ? 'es' : '') + ' ' + mib(atlasBytes) + ')' : ''));
        // car3 G: a see-through theme's own bottom row, and why (on the car BMW's row showed where ours was expected)
        this.ownRow = shown.some((w) => w.type === 'wbback' && w.collar && w.mask);     // package M: the strip mask
        if (this.ownRow) this.log.info('layout "' + layout.name + '": ' + this._ownNote());
        counts.forEach((k, ci) => {
            if (k > LAYER_BUDGET) this.log.warn('layout "' + layout.name + '" needs ' + k + ' layers on connection ' + (ci + 1) + ', cluster-render draws at most ' + LAYER_BUDGET + ' per connection');
        });
        if (px > PIXEL_BYTES) this.log.warn('layout "' + layout.name + '" needs ' + mib(px) + ' of pixel memory; cluster-render has 16 MiB for every app together (each image counts twice)');
        this.statusAskT = setTimeout(() => { this.statusAskT = null; this._guard('status request', () => this.client.status()); }, STATUS_ASK_MS);
    }

    /**
     * The layers of a layout, in the order to make them: { kind: 'layer', w } for an effect or an "own"
     * image widget, { kind: 'sheet', klass, z, x, y, w, h, members } for a packed image layer. Widgets are
     * taken in file order; an image widget joins the first sheet of its (class, z) group that was opened
     * after every earlier entry of that group its rect intersects (so what overlaps it stays under it, as
     * file order says) and whose union box with it stays within maxPx pixels, else a new sheet is opened
     * at the end.
     */
    _plan(widgets, maxPx, waste) {
        if (!isNum(waste)) waste = Infinity;
        const plan = [];
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const union = (s, w) => {
            const x = Math.min(s.x, w.x), y = Math.min(s.y, w.y);
            return { x, y, w: Math.max(s.x + s.w, w.x + w.w) - x, h: Math.max(s.y + s.h, w.y + w.h) - y };
        };
        widgets.forEach((w) => {
            const klass = w.class || 'content', z = w.z || 0, conn = this._connOf(w);
            if (!IMAGE_TYPES[w.type] || w.own === true) { plan.push({ kind: 'layer', w, klass, z, conn }); return; }
            let after = -1;
            plan.forEach((e, i) => {
                if (e.klass !== klass || e.z !== z || e.conn !== conn) return;
                if (e.kind === 'layer' ? hit(e.w, w) : e.members.some((m) => hit(m, w))) after = i;
            });
            let sheet = null, box = null;
            for (let i = after + 1; i < plan.length && !sheet; i++) {
                const s = plan[i];
                if (s.kind !== 'sheet' || s.klass !== klass || s.z !== z || s.conn !== conn) continue;
                const u = union(s, w);
                const own = s.members.reduce((a, m) => a + m.w * m.h, 0) + w.w * w.h;
                if (u.w * u.h <= maxPx && u.w * u.h <= waste * own) { sheet = s; box = u; }
            }
            if (!sheet) { sheet = { kind: 'sheet', klass, z, conn, x: w.x, y: w.y, w: w.w, h: w.h, members: [], ref: 0, c: null, ci: conn, buf: null }; plan.push(sheet); }
            else { sheet.x = box.x; sheet.y = box.y; sheet.w = box.w; sheet.h = box.h; }
            sheet.members.push(w);
        });
        return plan;
    }

    /** One image layer for a sheet: every member painted into a local buffer, then sent whole once. */
    _createSheet(s) {
        const c = this._clientAt(s.conn);
        const ref = c.image({ target: this.target, klass: s.klass, z: s.z, x: s.x, y: s.y, w: s.w, h: s.h, iw: s.w, ih: s.h });
        if (!ref) { this.log.warn('sheet ' + s.klass + '/' + s.z + ' at ' + s.x + ',' + s.y + ' ' + s.w + 'x' + s.h + ': layer refused'); return; }
        s.ref = ref; s.c = c; s.ci = s.conn;
        this.placed.push({ c, ref, x: s.x, y: s.y, w: s.w, h: s.h });
        s.buf = Buffer.alloc(s.w * s.h * 4, 0);
        this.sheets.push(s);
        s.members.forEach((w) => this._guard('widget ' + w.id, () => this._create(w, s)));
        const buf = s.buf;
        s.buf = null;                    // from here on _blit sends dirty rects
        c.pixels(ref, null, buf);
    }

    /**
     * Every pixel painter goes through here: the widget's pixels (rects in the widget's own px, or null for
     * the whole widget) to its own layer, or into its sheet: the local buffer while the sheet is being
     * filled on create, else dirty rects translated by the sheet's offset.
     */
    _blit(x, rects, buf) {
        const w = x.w, s = x.sheet;
        if (!s) { x.c.pixels(x.ref, rects, buf); return; }
        const rs = rects && rects.length ? rects : [{ x: 0, y: 0, w: w.w, h: w.h }];
        const dx = w.x - s.x, dy = w.y - s.y;
        const moved = rs.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
        if (!s.buf) { s.c.pixels(s.ref, moved, buf); return; }
        let off = 0;
        moved.forEach((r) => {
            for (let y = 0; y < r.h; y++) {
                buf.copy(s.buf, ((r.y + y) * s.w + r.x) * 4, off, off + r.w * 4);
                off += r.w * 4;
            }
        });
    }

    /**
     * A whole repaint of an image widget: the first time (or while its sheet is being filled) the whole widget
     * goes up; after that only the one rectangle around the pixels that changed, or nothing at all.
     */
    _blitDiff(x, buf) {
        const w = x.w, was = x.px;
        x.px = buf;
        if (!was || (x.sheet && x.sheet.buf)) { this._blit(x, null, buf); return; }
        const c = changes(was, buf, w.w, w.h);
        if (c) this._blit(x, [c.rect], c.px);
    }

    /** "key" is on while that bool setting is on; "!key" while it is off. */
    _toggleOn(t) {
        // car3 H: "a&b" is on while every part is (6WB Comfort's row: "own:clock&!cc:shown")
        if (t.indexOf('&') > 0) return t.split('&').every((p) => this._toggleOn(p));
        const not = t.charAt(0) === '!';
        const k = not ? t.slice(1) : t, eq = k.indexOf('=');
        // package F: "own:<item>" is on while that item of BMW's bottom row is ours (_own: the "bottomRow" setting)
        if (k.indexOf('own:') === 0) return not ? !this._own(k.slice(4)) : this._own(k.slice(4));
        // car3 G: "cc:none" is on only while the car says no check-control message shows (this.ccShown === false);
        // while that is not known (no signal wired yet: package I) it is off
        // 2026-11-13: "cc:shown" is on only while the car says a message shows (unknown: off, so ours stays drawn)
        // 2026-11-16: "cc:open" is on while BMW's own message panel must be left see-through (_ccOpen), which is
        // "cc:shown" plus the car whose messages we cannot read at all
        if (k.indexOf('cc:') === 0) {
            const cc = this._cc();
            const on = (k === 'cc:none' && cc === false) || (k === 'cc:shown' && cc === true) || (k === 'cc:open' && this._ccOpen());
            return not ? !on : on;
        }
        const on = eq > 0 ? String(this.setting(k.slice(0, eq))) === k.slice(eq + 1) : this.setting(k) !== false;
        return not ? !on : on;
    }

    /** A widget: on its own layer (sheet null: an effect, or an image widget with "own": true), or a member of a sheet. */
    _create(w, sheet) {
        let ref, c, fs = null;
        if (sheet) { ref = sheet.ref; c = sheet.c; }
        else {
            c = this._clientAt(this._connOf(w));
            const base = { target: this.target, klass: w.class || 'content', z: w.z || 0, x: w.x, y: w.y, w: w.w, h: w.h };
            if (IMAGE_TYPES[w.type]) ref = c.image(Object.assign({ iw: w.w, ih: w.h }, base));
            else if (w.type === 'swatch') fs = calibration.SWATCH;
            // 0.7.13: a 6WB dial or backdrop gets only its own look's code (shaders.js styled): the KOMBI compiles every branch
            // 2026-11-16: in 6WB Sport / Eco Pro (_nightOk false) without the night look (shaders.js NIGHT 0)
            else if (w.type === 'dial' && w.look === 'wb') fs = shaders.wbdialFor(WB_STYLE[w.style] || 0, this._nightOk());
            else if (w.type === 'wbback') fs = shaders.wbbackFor(WB_STYLE[w.style] || 0, this._nightOk());
            else if (w.type === 'wbsign') fs = shaders.wbsignFor(this._nightOk());
            else fs = shaders[w.type];
            if (fs) ref = c.effect(Object.assign({ fs }, base));
            if (!ref) { this.log.warn('widget "' + w.id + '": layer refused'); return; }
            this.placed.push({ c, ref, x: w.x, y: w.y, w: w.w, h: w.h });
        }
        const x = { w, ref, c, ci: sheet ? sheet.ci : this._connOf(w), sheet: sheet || null, last: null, lastPaint: 0, px: null };
        x.nightGL = this._nightOk();    // 2026-11-16: its 6WB shader has the night look (u_nk0..2); false in Sport / Eco Pro
        this.widgets.set(w.id, x);
        const t = this.theme;
        if (w.type === 'atext') {
            const a = w.exact ? this._exactAtlas(w, x.ci) : this._atlas(w.font, x.ci);     // 0.7.14: a "gpu" text's
            x.atlas = a;
            x.cells = Math.max(1, Math.min(32, isNum(w.cells) ? Math.floor(w.cells) : Math.floor(w.w / a.cellW)));
            c.bind(ref, 'u_font', a.ref);
            c.uniform(ref, 'u_cells', [x.cells]);
            c.uniform(ref, 'u_grid', [a.cols, a.rows]);
            c.uniform(ref, 'u_color', rgba(color(t, w.color || 'fg')));
            c.uniform(ref, 'u_text', this._atlasCodes(x, ''), { type: 'vec4' });
            if (w.w !== x.cells * a.cellW || w.h !== a.cellH) {
                this.log.info('widget "' + w.id + '": ' + x.cells + ' cells of ' + (w.w / x.cells).toFixed(1) + 'x' + w.h +
                    ' px; the glyphs keep their shape at w ' + x.cells * a.cellW + ', h ' + a.cellH);
            }
        } else if (w.type === 'gridlabels') this._paintGridLabels(x);
        else if (w.type === 'icon') this._blit(x, null, paintIcon(w.icon, w.w, w.h, color(t, w.color || 'fg')));
        else if (w.type === 'sdash') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_geo', w.geo);
            c.uniform(ref, 'u_k', w.k);
            c.uniform(ref, 'u_w', [w.band]);
            c.uniform(ref, 'u_inner', [w.inner || w.band + 18]);
            c.uniform(ref, 'u_scale', w.scale || [w.geo[2], w.geo[0]]);
            c.uniform(ref, 'u_ticks', w.ticks);
            const [redFrom, orange] = this._redMarks(w.rpmMax || 8000);
            c.uniform(ref, 'u_redFrom', [redFrom]);
            c.uniform(ref, 'u_orange', [orange]);
            c.uniform(ref, 'u_fuelSeg', w.fuelSeg);
            c.uniform(ref, 'u_oilSeg', w.oilSeg);
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_strip', w.strip);
            c.uniform(ref, 'u_topEnd', [w.topEnd]);
        } else if (w.type === 'mdash') {
            const ty = w.tyres || [0, 0, 0], L = w.gaugeL || {}, R = w.gaugeR || {}, b = w.blade || {};
            const bars = Array.isArray(w.segbars) ? w.segbars.slice(0, 4) : [];
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_card', w.card || [0, 0, 0, 0]);
            c.uniform(ref, 'u_cardTop', w.cardTop || [0, 0, -99999]);
            c.uniform(ref, 'u_cardCutR', w.cardCutR || [0, 0, 0]);
            c.uniform(ref, 'u_cardFill', [isNum(w.cardFill) ? w.cardFill : 0]);
            c.uniform(ref, 'u_blade', [isNum(b.xm) ? b.xm - w.x : 99999, (b.ym || 0) - w.y, b.kTop || 0, b.kBot || 0]);
            c.uniform(ref, 'u_bladeB', [b.round || 40, isNum(w.bladeGap) ? w.bladeGap : 14]);
            c.uniform(ref, 'u_line', w.line || [0, -99, 0, 1]);
            c.uniform(ref, 'u_tyre', [ty[0] - w.x, ty[1] - w.y, ty[2] || 0]);
            c.uniform(ref, 'u_mark', w.mark || [0, 0, 0]);
            c.uniform(ref, 'u_red', rgb(t.hot));
            [0, 1, 2, 3].forEach((i) => {
                const s = bars[i];
                c.uniform(ref, 'u_seg' + i, s ? [s.x - w.x, s.y - w.y, s.w, s.h] : [0, 0, 0, 0]);
            });
            c.uniform(ref, 'u_segMax', [0, 1, 2, 3].map((i) => (bars[i] && bars[i].max) || 1));
            c.uniform(ref, 'u_segSlant', [isNum(w.segSlant) ? w.segSlant : 9]);
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            x.gauges = [['u_gaugeL', L], ['u_gaugeR', R]];
            x.bars = bars;
        } else if (w.type === 'mtach') {
            const max = w.max || 8000, [redFrom, orange] = this._redMarks(max);
            const right = w.side === 'right';
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_side', [right ? 1 : -1]);
            c.uniform(ref, 'u_geoA', [w.y0 - w.y, w.y8 - w.y, w.ym - w.y, right ? w.x + w.w - w.xm : w.xm - w.x]);
            c.uniform(ref, 'u_geoB', [w.kTop, w.kBot, w.round || 40]);
            c.uniform(ref, 'u_wid', [w.wBot, w.wTop, w.wBend || 0]);
            c.uniform(ref, 'u_ticks', [max / 1000]);
            c.uniform(ref, 'u_orange', [orange]);
            c.uniform(ref, 'u_redFrom', [redFrom]);
            c.uniform(ref, 'u_red', rgb(t.hot));
        }
        else if (w.type === 'grid') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_step', [w.step || 50]);
            c.uniform(ref, 'u_major', [w.major || 2]);
            // --- strip package D: a layout may name the grid's colours ("minorColor", "majorColor": [r, g, b, a]), so
            // the diagnostic mattes (design/gen_matte.py) get a ruler that shows on magenta, green and black; without
            // them the calibration grid's own, as before ---
            const okC = (a) => Array.isArray(a) && a.length >= 3 && a.every(isNum);
            c.uniform(ref, 'u_minor', rgba(okC(w.minorColor) ? w.minorColor : [255, 255, 255, 90]));
            c.uniform(ref, 'u_majorC', rgba(okC(w.majorColor) ? w.majorColor : [0, 255, 140, 255]));
            // --- end strip package D ---
        } else if (w.type === 'stripe') this._paintStripe(x);
        else if (w.type === 'scale') this._paintScale(x);
        else if (w.type === 'shiftbar') {
            const max = this._barMax(), red = this._redline();
            const midAt = t.bar.midAt === 'shift' ? (red - 1500) / max : t.bar.midAt;
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_segs', [w.segments || 40]);
            c.uniform(ref, 'u_low', rgb(t.bar.low));
            c.uniform(ref, 'u_mid', rgb(t.bar.mid));
            c.uniform(ref, 'u_high', rgb(t.bar.high));
            c.uniform(ref, 'u_midAt', [midAt]);
            c.uniform(ref, 'u_highAt', [(red - 500) / max]);
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_flash', [0]);
        } else if (w.type === 'dial' && w.look === 'wb') {
            // the 6WB-style dials (shaders.js wbdial): "style" comfort | sport | eco | mini | eff. Packed in vec4s: a
            // cluster-render layer holds up to 32 uniforms (_wbDyn sends the live ones, u_dyn and u_fill)
            const D = this._dialScale(w), r = Math.PI / 180;
            c.uniform(ref, 'u_geo', [w.w, w.h, w.ringW || 14, w.flip ? 1 : 0]);
            c.uniform(ref, 'u_scale', [(w.start === undefined ? 225 : w.start) * r, (w.sweep === undefined ? 270 : w.sweep) * r, D.ticks, w.minor || 4]);
            c.uniform(ref, 'u_zone', [w.measure === 'rpm' ? this._redMarks(D.max)[0] : (isNum(w.redFrom) ? w.redFrom : 2),
                isNum(w.redTo) ? w.redTo : -1, isNum(w.coldTo) ? w.coldTo : -1, (w.off || 0) * r]);     // "off": degrees before the start where the needle parks (OFF)
            c.uniform(ref, 'u_mode', [WB_STYLE[w.style] || 0, isNum(w.hub) ? w.hub : 0.42, isNum(w.glowK) ? w.glowK : 1, w.box ? 1 : 0]);
            this._wbColours(x);         // 2026-11-14: u_ring .. u_glow and the night look (u_nk0..2)
            x.wbKind = 0;
            if (w.base) {               // a baked base texture: "base": { tex, x, y, w, h (its box in the layer's px), kind 1 | 2 | 3 }
                c.bind(ref, 'u_base', this._scene(w.base.tex, x.ci).ref);
                c.uniform(ref, 'u_baseR', [w.base.x, w.base.y, w.base.w, w.base.h]);
                x.wbKind = w.base.kind || 1;
            }
            c.uniform(ref, 'u_decoR', [0, 0, 0, 0]);
            if (w.fill) {               // the bottom arc's live fill: "fill": { tex (segment coverage), x, y, w, h,
                const f = w.fill;       //   from, to (degrees cw from 12 at 0 and at max), of ('fuel' | 'cons'), max, color }
                c.bind(ref, 'u_deco', this._scene(f.tex, x.ci).ref);
                c.uniform(ref, 'u_decoR', [f.x, f.y, f.w, f.h]);
                c.uniform(ref, 'u_fillC', f.color.map((v) => v / 255));
            }
            // "cut": { y, fade (panel px), round: [cx, cy, r] | box: [x0, y0, x1, y1] (panel px), soft (px), cover }: the
            // dial's open bottom and a soft window, so BMW's own bottom row, sign or lamp shows (6WB Dials + G20);
            // "cover": "limit": the round window closes over BMW's sign while our own sign shows (_update; package E:
            // always closed once app.json config.limit / config.nopass is wired)
            const cut = w.cut, cw = cut && (cut.round || cut.box);
            x.cutMode = -1;
            // (strip integration: a box with "boxWhen": "ccMarker" - BMW's marker in the tacho's rim - is shut until
            // config.ccMarker says BMW draws the marker; _update opens it)
            c.uniform(ref, 'u_cut', this._cutVec(w, cut && cut.round ? 1 : cut && cut.box && (cut.boxWhen !== 'ccMarker' || this._markShown()) ? 2 : 0));
            c.uniform(ref, 'u_cutW', !cw ? [0, 0, 0, 0] : cut.round ? [cw[0] - w.x, cw[1] - w.y, cw[2], 0]
                : [cw[0] - w.x, cw[1] - w.y, cw[2] - w.x, cw[3] - w.y]);
            x.wbDyn = [0, -1, -1, 0];
            x.wbFill = [0, 0, x.wbKind, 0];
            c.uniform(ref, 'u_dyn', x.wbDyn);
            c.uniform(ref, 'u_fill', x.wbFill);
        } else if (w.type === 'dial') {
            const D = this._dialScale(w);
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_start', [(w.start === undefined ? 225 : w.start) * Math.PI / 180]);
            c.uniform(ref, 'u_sweep', [(w.sweep === undefined ? 270 : w.sweep) * Math.PI / 180]);
            c.uniform(ref, 'u_ticks', [D.ticks]);
            c.uniform(ref, 'u_minor', [w.minor || 4]);
            c.uniform(ref, 'u_redFrom', [w.measure === 'rpm' ? this._redMarks(D.max)[0] : (isNum(w.redFrom) ? w.redFrom : 2)]);
            c.uniform(ref, 'u_ringW', [w.ringW || 14]);
            c.uniform(ref, 'u_ring', rgb(color(t, w.ring || 'line')));
            c.uniform(ref, 'u_ring2', rgb(color(t, w.ring2 || 'dim')));
            c.uniform(ref, 'u_tick', rgb(color(t, w.tick || 'fg')));
            c.uniform(ref, 'u_needle', rgb(color(t, w.needle || 'hot')));
            c.uniform(ref, 'u_red', rgb(t.hot));
            c.uniform(ref, 'u_face', rgb(color(t, w.face || 'bg')));
            c.uniform(ref, 'u_hot', [0]);
        } else if (w.type === 'g20dial') {
            // a G20-style gauge (design/gen_g20.py, tools/bake_g20.py): the baked static gauge, the pointer from a LUT
            const rgb255 = (a) => a.map((v) => v / 255);
            c.uniform(ref, 'u_box', [w.x, w.y, w.w, w.h]);
            c.bind(ref, 'u_base', this._scene(w.base, x.ci).ref);
            c.bind(ref, 'u_lut', this._scene(w.lut, x.ci).ref);
            if (w.fill) c.bind(ref, 'u_fill', this._scene(w.fill, x.ci).ref);     // minis: the level's fill and the area
            c.uniform(ref, 'u_g', [w.rows[0], w.rows[1], w.mini ? 1 : 0, w.band ? 1 : 0]);
            c.uniform(ref, 'u_val', [0, 0, 0, 0]);
            c.uniform(ref, 'u_C', w.centre || [0, 0]);
            c.uniform(ref, 'u_bar', w.bar);
            c.uniform(ref, 'u_barC', rgb255(w.barC));
            c.uniform(ref, 'u_tipC', rgb255(w.tipC || w.barC));
            c.uniform(ref, 'u_rim', w.rim ? rgb255(w.rim.slice(0, 3)).concat([w.rim[3]]) : [0, 0, 0, 0]);
            c.uniform(ref, 'u_rimHi', [w.rimHi || 0]);
            c.uniform(ref, 'u_sh', w.shadow || [0, 1, 1, 1]);     // alpha, d0, lambda, dmax (px)
            c.uniform(ref, 'u_glow', w.glow ? rgb255(w.glow.slice(0, 3)).concat([w.glow[3]]) : [0, 0, 0, 0]);
            c.uniform(ref, 'u_glow2', w.glow2 || [1, 0, 1, -10]); // car3 J: sigma low side (deg), depth q0, q1, outer start (px)
            c.uniform(ref, 'u_nl', w.numLight || [0, 1, 0, 0]);   // car3 J: the numerals' light: gain, sigma (deg), depth band
            c.uniform(ref, 'u_bl', w.bandLight || [1, 1, 0, 0]);  // car3 J: the band line's light: sigma hi, lo (deg), strength
            c.uniform(ref, 'u_band', w.band ? [w.band[0], w.band[1], w.band[2], 0] : [0, 1, 0, 0]);
            c.uniform(ref, 'u_bandC', rgb255(w.bandC || [0, 0, 0]));
        } else if (w.type === 'wbsign') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_show', [0, 0]);       // shown by _update: the limit sign while a limit is known, the no-passing sign while it applies
            c.uniform(ref, 'u_tex', [0]);
            this._wbColours(x);                     // 2026-11-14: u_nk0..2, the night looks' dimming
            if (w.tex) {                            // baked signs: "tex": { limit, nopass: { tex, x, y, w, h } }
                [['limit', 'u_s0', 'u_r0'], ['nopass', 'u_s1', 'u_r1']].forEach(([k, smp, rect]) => {
                    const t = w.tex[k];
                    c.bind(ref, smp, this._scene(t.tex, x.ci).ref);
                    c.uniform(ref, rect, [t.x, t.y, t.w, t.h]);
                });
                c.uniform(ref, 'u_tex', [1]);
            }
        } else if (w.type === 'wbmsa') {
            // car3 I: the auto start/stop sign (WBMSA). Shown by _update from config.msa: hidden until that field is wired
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_msa', [0, 0, 0, 0]);
            c.uniform(ref, 'u_fg', rgba(color(t, w.color || 'fg')));
            c.uniform(ref, 'u_dim', rgba(color(t, 'dim')));
            c.uniform(ref, 'u_on', [0.16, 0.78, 0.30, 1]);      // BMW's green for "on", as its own lamps (not dimmed at night)
            this._wbColours(x);         // 2026-11-14: u_fg / u_dim again: the same, but the night colours resend them
        } else if (w.type === 'wbback') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_color', rgb(color(t, w.color || 'accent')));
            c.uniform(ref, 'u_dl', w.dl);
            c.uniform(ref, 'u_dr', w.dr);
            x.ccKey = null;
            this._wbCcSend(x);              // the check-control window (closed until the car says a message shows)
            // u_style: none (0.7.13: the look is compiled in, shaders.wbbackFor)
            c.uniform(ref, 'u_sign', [0, 0, 0]);       // "sign": [x, y, r]: the speed limit sign's disc, shown by _update while a limit is known
            c.uniform(ref, 'u_hole', this._hole(w));     // "hole" / "holeWhen": BMW's map window left see-through
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_hasTex', [0]);
            if (w.collar) {                 // "collar": { tex, x, y, w, h }: black only there, see-through elsewhere (not a baked look: always on)
                c.bind(ref, 'u_t0', this._scene(w.collar.tex, x.ci).ref);
                c.uniform(ref, 'u_r0', [w.collar.x, w.collar.y, w.collar.w, w.collar.h]);
                c.uniform(ref, 'u_hasTex', [2]);
                // package F: "shade": { y: [y0, y1], ko: [x0, y0, x1, y1] } the shade at our dials' inner edges
                // ("dialShade"). (Its "cover" and "patches" are gone: package M's strip mask draws that black now.)
                c.uniform(ref, 'u_shade', this._wbShade(w));
                const ko = w.shade && Array.isArray(w.shade.ko) ? w.shade.ko : [0, 0, 0, 0];
                c.uniform(ref, 'u_shadeKo', [ko[0] - w.x, ko[1] - w.y, ko[2] - w.x, ko[3] - w.y]);
                this._wbMaskSend(x, true);      // package M: the strip mask's atlas and lanes ("mask"; none: zeros)
            } else if (w.tex) {                     // baked textures: "tex": { window, horizon, line: { tex, x, y, w, h } }, "gain": [window level, y above which it applies]
                const u = this._wbUses(w);       // only what is drawn: the window while the map is off, the line for "glass"
                [['window', 'u_t0', 'u_r0'], ['horizon', 'u_t1', 'u_r1'], ['line', 'u_t2', 'u_r2']].forEach(([k, smp, rect]) => {
                    const t = w.tex[k];
                    if (!(k === 'line' ? u.line : u.window)) return;     // _bindBlanks gives the sampler a blank
                    c.bind(ref, smp, this._scene(t.tex, x.ci).ref);
                    c.uniform(ref, rect, [t.x, t.y, t.w, t.h]);
                });
                c.uniform(ref, 'u_hasTex', [1]);     // u_win (the window's level): _wbColours below
            }
            // the soft window (package A): "window" [x, y, w, h], "fade" [top, sides, bottom, rims] px, "foot" glass |
            // hair | chrome | none at "footLine" [y, x0, x1]; without "window", the old hard hole
            const wb = this._wbUses(w);
            // car3 H: while BMW's map shows (wb.window false), "mapWindow" / "mapFade" when given: BMW's map as the car
            // draws it with a theme on, smaller than the stock one (docs/CAR3-H-REPORT.md)
            const mapOn = wb.box && !wb.window, ok4 = (a) => Array.isArray(a) && a.length === 4;
            const win = mapOn && ok4(w.mapWindow) ? w.mapWindow : w.window;
            const fade = mapOn && ok4(w.mapFade) ? w.mapFade : w.fade;
            c.uniform(ref, 'u_wbox', wb.box ? win.map((v, i) => v - (i === 0 ? w.x : i === 1 ? w.y : 0)) : [0, 0, 0, 0]);
            c.uniform(ref, 'u_fade', ok4(fade) ? fade : [110, 40, 36, 44]);
            // --- end car3 H ---
            const fl = Array.isArray(w.footLine) ? w.footLine : [0, 0, 1];
            c.uniform(ref, 'u_foot', [wb.foot, fl[0] - w.y, fl[1] - w.x, fl[2] - w.x]);
            x.wbFootNow = wb.foot;          // package F: the foot drawn now ("wbFoot" changes it live, _wbLive)
            this._wbColours(x);             // 2026-11-14: u_color again, u_win and the night look (u_nk0..2)
        } else if (w.type === 'gmeter') {
            const L = color(t, w.line || 'dim');
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_line', rgba([L[0], L[1], L[2], isNum(w.lineAlpha) ? w.lineAlpha : 150]));
            c.uniform(ref, 'u_c1', rgb(color(t, w.dot || 'fg')));
            c.uniform(ref, 'u_c2', rgb(G_AMBER));
            c.uniform(ref, 'u_c3', rgb(t.hot));
            c.uniform(ref, 'u_at', [0.5, 0.8]);
            c.uniform(ref, 'u_envC', rgb(color(t, w.envColor || 'fg')));
            c.uniform(ref, 'u_envOn', [w.envelope === false ? 0 : 1]);
            c.uniform(ref, 'u_g', [0, 0]);
            c.uniform(ref, 'u_trailN', [0]);
            c.uniform(ref, 'u_trail', new Array(32).fill(0), { type: 'vec4' });
            c.uniform(ref, 'u_env', new Array(G_SECTORS).fill(0), { type: 'vec4' });
        } else if (w.type === 'revarc') {
            const max = this._barMax(), red = this._redline();
            const midAt = t.bar.midAt === 'shift' ? (red - 1500) / max : t.bar.midAt;
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_center', w.center);
            c.uniform(ref, 'u_r', [w.r]);
            c.uniform(ref, 'u_w', [w.band || 40]);
            c.uniform(ref, 'u_start', [w.start * Math.PI / 180]);
            c.uniform(ref, 'u_sweep', [w.sweep * Math.PI / 180]);
            c.uniform(ref, 'u_segs', [w.segments || 30]);
            c.uniform(ref, 'u_low', rgb(t.bar.low));
            c.uniform(ref, 'u_mid', rgb(t.bar.mid));
            c.uniform(ref, 'u_high', rgb(t.bar.high));
            c.uniform(ref, 'u_midAt', [midAt]);
            c.uniform(ref, 'u_highAt', [(red - 500) / max]);
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_flash', [0]);
            c.uniform(ref, 'u_value', [0]);
        } else if (w.type === 'meter') {
            const cs = w.colors || ['fg', 'fg', 'hot'];
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_segs', [w.segments || 20]);
            c.uniform(ref, 'u_gap', [isNum(w.gap) ? w.gap : 4]);
            c.uniform(ref, 'u_vertical', [w.vertical ? 1 : 0]);
            c.uniform(ref, 'u_c1', rgb(color(t, cs[0])));
            c.uniform(ref, 'u_c2', rgb(color(t, cs[1] || cs[0])));
            c.uniform(ref, 'u_c3', rgb(color(t, cs[2] || cs[1] || cs[0])));
            c.uniform(ref, 'u_at', w.at || [1, 1]);
            c.uniform(ref, 'u_track', rgba(color(t, w.trackColor || 'track')));
            c.uniform(ref, 'u_peak', [-1]);
            c.uniform(ref, 'u_peakC', rgb(color(t, w.peakColor || 'fg')));
        } else if (w.type === 'arc') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_peak', [-1]);
            c.uniform(ref, 'u_peakC', rgb(color(t, w.peakColor || 'fg')));
            c.uniform(ref, 'u_color', rgb(color(t, w.color || 'arc')));
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_width', [w.width || 7]);
            c.uniform(ref, 'u_start', [(w.start === undefined ? 225 : w.start) * Math.PI / 180]);
            c.uniform(ref, 'u_sweep', [(w.sweep === undefined ? 270 : w.sweep) * Math.PI / 180]);
        } else if (w.type === 'segbar') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_segs', [w.max]);
            c.uniform(ref, 'u_on', rgba(color(t, w.color || 'hot')));
            c.uniform(ref, 'u_offC', rgba(color(t, 'track')));
            c.uniform(ref, 'u_slant', [w.slant || 0]);
        } else if (w.type === 'revbar') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_top', [w.top || 8]);
            c.uniform(ref, 'u_barH', [w.barH]);
            c.uniform(ref, 'u_slant', [w.slant || 12]);
            c.uniform(ref, 'u_max', [this._barMax(w)]);
            c.uniform(ref, 'u_red', [this._redline()]);
            c.uniform(ref, 'u_from', rgb(t.rev.from));
            c.uniform(ref, 'u_to', rgb(t.rev.to));
            c.uniform(ref, 'u_hot', rgb(t.hot));
            c.uniform(ref, 'u_track', rgba(t.track));
            c.uniform(ref, 'u_tick', rgba(t.dim));
            c.uniform(ref, 'u_fg', rgba(t.fg));
        } else if (w.type === 'lights') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_n', [w.count || 12]);
            c.uniform(ref, 'u_tail', [w.tail || 0]);
            c.uniform(ref, 'u_round', [w.round ? 1 : 0]);
            c.uniform(ref, 'u_green', rgb(LIGHTS.green));
            c.uniform(ref, 'u_yellow', rgb(LIGHTS.yellow));
            c.uniform(ref, 'u_red', rgb(LIGHTS.red));
            c.uniform(ref, 'u_blue', rgb(LIGHTS.blue));
            c.uniform(ref, 'u_off', [w.off === undefined ? 0.14 : w.off]);
        } else if (w.type === 'fill') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_color', rgba(color(t, w.color || 'bg')));
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
        } else if (w.type === 'box') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_fill', rgba(color(t, w.fill || 'panel')));
            c.uniform(ref, 'u_line', rgba(color(t, w.line || 'line')));
            c.uniform(ref, 'u_head', rgba(color(t, w.headColor || 'head')));
            c.uniform(ref, 'u_headH', [w.head || 0]);
            c.uniform(ref, 'u_border', [w.border === undefined ? 2 : w.border]);
            c.uniform(ref, 'u_radius', [w.radius || 0]);
        } else if (w.type === 'swatch') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_n', [w.steps || 11]);
        } else if (w.type === 'swatchimg') this._blit(x, null, calibration.swatchImage(w.w, w.h, w.steps || 11));
        else if (w.type === 'boxes') {
            // the box list goes up as two vec4 arrays (x, y, w, h and headH, border, radius, headKind), 12 slots
            const list = (Array.isArray(w.boxes) ? w.boxes : []).filter((b) => b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h)
                && !(b.toggle && !this._toggleOn(b.toggle))).slice(0, 12);
            const rects = [], styles = [];
            for (let i = 0; i < 12; i++) {
                const b = list[i];
                rects.push(b ? b.x - w.x : 0, b ? b.y - w.y : 0, b ? b.w : 0, b ? b.h : 0);
                styles.push(b ? b.head || 0 : 0, b ? (b.border === undefined ? 2 : b.border) : 0, b ? b.radius || 0 : 0, b && b.headColor === 'accent' ? 1 : 0);
            }
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_bg', rgba(color(t, w.color || 'bg')));
            c.uniform(ref, 'u_hole', this._hole(w));
            c.uniform(ref, 'u_holeR', [this._holeRadius(w)]);
            c.uniform(ref, 'u_n', [list.length]);
            c.uniform(ref, 'u_box', rects, { type: 'vec4' });
            c.uniform(ref, 'u_boxStyle', styles, { type: 'vec4' });
            c.uniform(ref, 'u_fill', rgba(color(t, w.fill || 'panel')));
            c.uniform(ref, 'u_line', rgba(color(t, w.line || 'line')));
            c.uniform(ref, 'u_head', rgba(color(t, w.head || 'head')));
            c.uniform(ref, 'u_accent', rgba(color(t, w.accent || 'accent')));
        } else if (w.type === 'tiles') {
            const list = this._tiles(w), rects = [];
            for (let i = 0; i < TILE_MAX; i++) {
                const b = list[i];
                rects.push(b ? b.x - w.x : 0, b ? b.y - w.y : 0, b ? b.w : 0, b ? b.h : 0);
            }
            const zc = w.colors || ['bar1', 'bar2', 'hot'];
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_bg', rgba(color(t, w.color || 'bg')));
            c.uniform(ref, 'u_n', [list.length]);
            c.uniform(ref, 'u_tile', rects, { type: 'vec4' });
            c.uniform(ref, 'u_geo', [isNum(w.radius) ? w.radius : 8, isNum(w.border) ? w.border : 1.5, isNum(w.strip) ? w.strip : 3, w.barH || 6]);
            c.uniform(ref, 'u_fill', rgba(color(t, w.fill || 'panel')));
            c.uniform(ref, 'u_warn', rgba(color(t, w.warn || 'warn')));
            c.uniform(ref, 'u_line', rgba(color(t, w.line || 'line')));
            c.uniform(ref, 'u_track', rgba(color(t, w.trackColor || 'track')));
            c.uniform(ref, 'u_accent', rgb(color(t, w.accent || 'accent')));
            c.uniform(ref, 'u_c1', rgb(color(t, zc[0])));
            c.uniform(ref, 'u_c2', rgb(color(t, zc[1] || zc[0])));
            c.uniform(ref, 'u_c3', rgb(color(t, zc[2] || zc[1] || zc[0])));
            c.uniform(ref, 'u_at', w.at || [0.6, 0.85]);
        }
        if (fs) this._bindBlanks(x, fs);
        this._update(x, Date.now(), true);
    }

    /**
     * Every sampler2D the shader declares gets an asset: the car's renderer (RAMSES) does not draw a mesh whose
     * appearance has a texture input left unset, so a sampler this widget does not use (a dial with no base, a mini with no arc
     * fill) samples a 1x1 transparent asset instead. The bench draws such a layer only with every sampler bound too.
     */
    _bindBlanks(x, fs) {
        const re = /uniform\s+sampler2D\s+(\w+)\s*;/g, l = x.c.layers && x.c.layers.get(x.ref);
        let m;
        while ((m = re.exec(fs))) {
            if (l && l.binds && l.binds['0:' + m[1]]) continue;
            x.c.bind(x.ref, m[1], this._blank(x.ci).ref);
        }
    }

    /** A 1x1 transparent RGBA8 asset on a connection, for samplers with nothing to sample (_bindBlanks). */
    _blank(ci) {
        const key = ci + ':blank';
        if (this.atlases.has(key)) return this.atlases.get(key);
        const c = this._clientAt(ci);
        const ref = c.asset({ target: this.target, format: 'rgba8', w: 1, h: 1, sampling: 'nearest' });
        if (!ref) throw new Error('blank asset refused');
        c.pixels(ref, null, Buffer.alloc(4, 0));
        const a = { ref, c, ci, w: 1, h: 1, bytes: 8 };
        this.atlases.set(key, a);
        return a;
    }

    /** A tiles widget's tiles in use: [{ x, y, w, h, slot, bar }], the ones with a valid rect, toggles on, TILE_MAX at most. */
    _tiles(w) {
        return (Array.isArray(w.tiles) ? w.tiles : []).filter((b) => b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h)
            && !(b.toggle && !this._toggleOn(b.toggle))).slice(0, TILE_MAX);
    }

    /** A widget's map hole in layer px, inset by "holeInset" (6) a side, while "holeWhen" is on; else no hole. */
    _hole(w) {
        // "holeWhen": true (always), a bool setting's key, or - bottom row - any toggle expression ("cc:shown",
        // "a&b", "!a"), which is read live (_update resends u_hole on a fill when it changes)
        const live = typeof w.holeWhen === 'string' && /[:&!]/.test(w.holeWhen);
        const on = w.holeWhen === true || (live ? this._toggleOn(w.holeWhen) : (w.holeWhen && this.setting(w.holeWhen) === true));
        const h = w.hole && on ? w.hole : null;
        if (!h) return [0, 0, 0, 0];
        const inset = isNum(w.holeInset) ? w.holeInset : 6;
        return [h[0] + inset - w.x, h[1] + inset - w.y, Math.max(0, h[2] - 2 * inset), Math.max(0, h[3] - 2 * inset)];
    }

    _holeRadius(w) { return isNum(w.holeRadius) ? w.holeRadius : 28; }

    /** A wbback's soft window and foot line (package A): which baked textures it samples, its foot style (WB_FOOT) and
     *  whether it has a "window" box. While the map shows through a soft window, the window and horizon are not drawn. */
    _wbUses(w) {
        const box = Array.isArray(w.window) && w.window.length === 4;
        let foot = WB_FOOT.hasOwnProperty(this._wbFoot(w)) ? WB_FOOT[this._wbFoot(w)] : 0;
        if (w.collar && foot === 0) foot = WB_FOOT.hair;     // 6WB Dials + G20 has no baked glass line: the hairline
        return { box, foot, window: !(box && this._hole(w)[2] > 0), line: foot === 0 };
    }

    /* --- package F (docs/POLISH-F-REPORT.md): the 6WB layouts' settings --- */

    /** The foot line style of a wbback with a soft window: the "wbFoot" setting, else the layout's own "foot". */
    _wbFoot(w) {
        if (!(Array.isArray(w.window) && w.window.length === 4)) return w.foot;
        const v = this.ctx.settings.item('wbFoot') ? this.setting('wbFoot') : null;
        return WB_FOOT.hasOwnProperty(v) ? v : w.foot;
    }

    /** "dialShade" as WBBACK's u_shade: strength, falloff px, and the y span it fades out over (the layout's "shade.y"). */
    _wbShade(w) {
        const s = WB_SHADE[this.ctx.settings.item('dialShade') ? this.setting('dialShade') : 'normal'] || WB_SHADE.normal;
        const y = w.shade && Array.isArray(w.shade.y) ? w.shade.y : [0, 1];
        return [w.shade ? s[0] : 0, s[1], y[0] - w.y, y[1] - w.y];
    }

    /** Whether an item of BMW's bottom row ("range", "clock", "temp", and the bottom-row package's "nav", "sign",
     *  "info") is drawn by us. ONE setting for the whole row, "bottomRow" ("all6WB" ours, "allG20" BMW's), and it is
     *  asked only while a see-through layout shows: in the opaque themes our own background covers BMW's row, so the
     *  row is ours there whatever the setting says (and menu.js hides the row then).
     *  The clock is ours only once a time zone is known (the "timeZone" setting, the car's own zone or
     *  config.utcOffsetMinutes), since the head unit runs on UTC and only BMW's own clock is right without one - the
     *  rule the retired "ownClock" had as its "auto". A build whose app.json has no such setting reads as BMW's in a
     *  see-through layout (the safe side: nothing of BMW's row is covered).
     *  The info field is ours only once the car's check-control message can be read (_ccWired), by the same rule:
     *  while it cannot, our text would be empty and BMW's own message is the only one there is. */
    _own(item) {
        if (OWN_ITEMS.indexOf(item) < 0) return false;
        // package X (the owner, 2026-11-16, "fallback is all-or-nothing"): in a see-through layout the WHOLE row is
        // ours or the whole row is BMW's - _rowWhy() says which and why. Per-item hand-back is gone: it stacked three
        // texts on each other (ours, BMW's message, BMW's road label).
        if (this._seeThrough(this._layoutName())) return this._rowWhy() === null;
        // the opaque themes (unchanged): our backdrop covers BMW's row, the latch is per item, the switch is not asked
        if (this.rowFail && this.rowFail[item]) return false;
        if (item === 'clock') return isNum(this._tzMinutes());   // car3 I: the setting, the car's zone (config.clock) or config
        if (item === 'info') return this._ccWired();             // 2026-11-16: only once the car's message can be read
        return true;
    }

    /** package X: why the bottom row of a see-through layout is BMW's now, or null while the whole row is ours.
     *  In this order: the switch; the latch (something could not be drawn: until the app restarts); standby (vehicle
     *  condition COND_STANDBY, not "P with the engine off": always BMW's standby row, in both modes); waiting for a
     *  time zone (the clock is always ours, and
     *  without a zone it would show the head unit's UTC); waiting for the car's check-control message to be read
     *  once (until then we are blind to BMW's panel and must not cover it). The two waits are not latches: the row
     *  comes in by itself once the zone or the message arrives (_rowSync rebuilds). */
    _rowWhy() {
        if (this.setting(ROW_KEY) !== ROW_OURS) return 'the switch says ' + JSON.stringify(this.setting(ROW_KEY));
        const f = this.rowFail ? Object.keys(this.rowFail) : [];
        if (f.length) return 'latched until the app restarts (' + f[0] + ': ' + ((this.rowFailWhy || {})[f[0]] || '?') + ')';
        if (this.rowStandby) return 'standby (vehicle condition ' + COND_STANDBY + '): BMW\'s standby row';
        if (!isNum(this._tzMinutes())) return 'waiting for a time zone for the clock';
        if (!this._ccWired()) return 'waiting for the car\'s check-control message to be read once';
        return null;
    }

    /** package X: BMW is showing its standby screen now: its vehicle condition is COND_STANDBY (WOHNEN). Raw, not
     *  debounced (the sign window follows it at once; the row through _rowSync's debounce). */
    _standbyNow() {
        return this._data().condition === COND_STANDBY;
    }

    /** package X: once a tick, before the widgets: standby (debounced), the clock's log line, and a rebuild when the
     *  row's owner changed since the layout was built (a zone or the first message arrived, standby came or went, a
     *  latch fell), so every way in or out of "ours" takes the same path. Only in a see-through layout. */
    _rowSync(now) {
        const name = this._layoutName();
        if (!this._seeThrough(name)) return;
        const cond = this._data().condition, sb = this._standbyNow();
        if (cond !== this.condLogged) {
            this.condLogged = cond;
            this.log.info('bottom row: vehicle condition ' + JSON.stringify(cond === undefined ? null : cond) +
                (sb ? ' = standby (COND_STANDBY ' + COND_STANDBY + '): BMW\'s standby row' : ''));
        }
        if (sb === !!this.rowStandby) this.rowStandbyAt = 0;
        else if (!this.rowStandbyAt) this.rowStandbyAt = now;
        else if (now - this.rowStandbyAt >= STANDBY_MS) {
            this.rowStandby = sb; this.rowStandbyAt = 0;
            this.log.info('bottom row: ' + (sb ? 'standby: BMW\'s standby row' : 'out of standby'));
        }
        if (this.setting(ROW_KEY) === ROW_OURS) this._clockNote();
        const why = this._rowWhy();
        if (why !== this.rowWhyLogged) {
            this.rowWhyLogged = why;
            this.log.info('bottom row: ' + (why === null ? 'all ours' : 'all BMW\'s - ' + why));
        }
        if ((why === null) !== this.rowBuiltOurs && this.activeName === name) this._rebuild();
    }

    /** `s` cut to fit the widget's box, with "..." when it had to be cut. Never throws. A GUESS: no photo shows how
     *  the stock cluster truncates a long road name or message (docs/G20-DESIGN-SPEC.md §8). */
    _fitText(s, w) {
        try {
            if (textRaster.measure(s, w.font, w.spacing) <= w.w) return s;
            let t = String(s);
            while (t.length > 1 && textRaster.measure(t + '...', w.font, w.spacing) > w.w) t = t.slice(0, -1);
            return t.replace(/[\s,.;:/-]+$/, '') + '...';
        } catch (e) { return s; }
    }

    /** How many characters of `s` the font has no glyph for ("3 characters"), '' when it can draw all of them.
     *  Spaces never count. Never throws: an unreadable font counts as "can draw nothing". */
    _missingGlyphs(s, font) {
        let g = null;
        try { g = textRaster.loadFont(font).metrics.glyphs; } catch (e) { return 'every character (the font would not load)'; }
        let n = 0;
        String(s).split('').forEach((ch) => { if (ch !== ' ' && !g[ch]) n++; });
        return n ? n + ' character' + (n > 1 ? 's' : '') : '';
    }

    /** Give one element of the bottom row back to the car: its window opens, ours is not drawn, and the reason is
     *  logged once and put on the status line. Used when the signal the element needs is not configured or has
     *  never arrived, and when drawing it throws. */
    _rowFail(item, why) {
        if (!this.rowFail) this.rowFail = {};
        if (this.rowFail[item]) return;
        // package X: in a see-through layout one failure takes the WHOLE row back (_rowWhy), and that is logged ONCE,
        // with the first reason; a later failure is only recorded (the probe and the status line show it)
        const first = !Object.keys(this.rowFail).length;
        this.rowFail[item] = true;
        (this.rowFailWhy = this.rowFailWhy || {})[item] = why;
        if (first) {
            this.log.warn(this._seeThrough(this._layoutName())
                ? 'bottom row: the whole row is BMW\'s again until the app restarts - ' + item + ': ' + why
                : 'bottom row: ' + item + ' is BMW\'s again (' + why + ')');
        }
        this._guard('row fallback', () => { this._status(); if (this.client && this.client.ready) this._rebuild(); });
    }

    /** Which of the three elements of the row have no signal behind them at all. Checked once the app has had time to
     *  hear from the car, so a slow provider is not mistaken for a missing one. Asked through _own(), not off the
     *  setting, so only an element the layout showing really asks us to draw can latch: in an opaque theme the three
     *  are not drawn at all (nothing in those layouts reads them), so nothing latches there. */
    _rowCheck() {
        // package X: asked off the switch, not _own() (which is false while the row waits for a zone or a message):
        // a build with a field missing can never draw the row, so it latches - the whole row - and says why once
        if (!this._seeThrough(this._layoutName()) || this.setting(ROW_KEY) !== ROW_OURS) return;
        const named = (s) => !!(s && s.iface && s.field);
        if (!named(this.config.sign) && !this._signWired()) this._rowFail('sign', 'no speed-limit field in app.json config.sign');
        if (!this._ccNamed() && !this._ccListNamed()) this._rowFail('info', 'app.json names no message field (config.ccm, config.ccList)');
        if (!named(this.config.road) && !(this.config.nav && this.config.nav.iface)) this._rowFail('nav', 'app.json config.road names no field');
    }


    /** A check-control message showing: true / false as the car says (config.ccm; on the bench its stand-in
     *  bench.CheckControl, fed from manual {ccMsg: 1 | 0}), null while unknown. */
    _cc() {
        return this.ccShown === true || this.ccShown === false ? this.ccShown : null;
    }

    /** Whether app.json even names the car's check-control message field (config.ccm kind "message"). */
    _ccNamed() {
        const c = this.config.ccm;
        return !!(c && c.iface && c.field && c.kind === 'message');
    }

    /** fix/cclist: whether app.json names the car's check-control LIST (config.ccList), the primary source since 0.7.19. */
    _ccListNamed() {
        const c = this.config.ccList;
        return !!(c && c.iface && c.field);
    }

    /** fix/cclist: ccShown / ccUnread from both sources. A message shows when EITHER says one does (ccList on the
     *  owner's car, newCCMessage on a car that sends it); none shows when one says none and neither says one does;
     *  unknown (null) while neither has said anything. */
    _ccMerge() {
        const a = this.ccListShown, b = this.ccmShown;
        this.ccShown = a === true || b === true ? true : a === false || b === false ? false : null;
        this.ccUnread = (a === true && this.ccListUnread === true) || (b === true && this.ccmUnread === true);
    }

    /** fix/active-cc (0.7.20): the list source's verdict - ccListShown, ccItems (what our line may show),
     *  ccListUnread and ccNoMatch - from the recorded list (ccListAll) and the cluster's "message shown now" (ccAct).
     *   wired (config.ccActive has notified a number): a message shows iff that number is not in noneValues (default
     *     [0]); our text is the ccList entry with that id. No such entry: it still shows, our line stays empty
     *     (ccNoMatch) so BMW's panel stays open, and "active cc: no ccList entry for number N" is logged once per N;
     *   not wired, the FALLBACK (a heuristic: BMW hides a temporary message after ~20 s and keeps it stored): an
     *     entry counts as showing for config.ccActive.fallback.hideAfterMs (null: config.ccm.autoHideMs, 20000)
     *     after it was first listed, except an entry whose colour is in fallback.keepColors (default ["red"]), which
     *     shows while listed. fallback.on false: every listed entry shows while listed (0.7.19).
     *  From the signal handlers and, while the fallback has an entry still to expire, from the tick. Returns whether
     *  the verdict changed; `push` sends BMW's panel state at once when it did. */
    _ccListEval(now, push) {
        const ca = this.config.ccActive || {}, all = this.ccListAll;
        const before = this.ccListShown + '|' + this.ccListUnread + '|' + this.ccNoMatch + '|' + (this.ccItems || []).map((e) => e.key).join(',');
        let shown = this.ccListShown, items = this.ccItems || [], unread = 0, noMatch = null;
        this.ccFallbackLive = false;
        if (this.ccActAny && this.ccAct) {
            const n = this.ccAct.number, none = Array.isArray(ca.noneValues) ? ca.noneValues : [0];
            items = [];
            if (inList(none, n)) shown = false;
            else {
                shown = true;
                const e = (all || []).find((x) => x.id === n);
                if (!e) {
                    noMatch = n;
                    if (!this.ccNoMatchLogged[n]) {
                        this.ccNoMatchLogged[n] = true;
                        this.log.info('active cc: no ccList entry for number ' + n + ' - shown, BMW\'s panel stays open');
                    }
                } else if (e.name) items = [e];
                else unread = 1;
            }
        } else if (all) {
            const fb = ca.fallback || {};
            const on = !!ca.iface && fb.on !== false;
            const ms = isNum(fb.hideAfterMs) ? fb.hideAfterMs : isNum(this.config.ccm && this.config.ccm.autoHideMs) ? this.config.ccm.autoHideMs : 20000;
            const keep = Array.isArray(fb.keepColors) ? fb.keepColors : ['red'];
            const live = all.filter((e) => {
                if (e.ignored) return false;
                if (!on || inList(keep, e.color)) return true;
                const left = (this.ccListSeen[e.key] || now) + ms - now;
                if (left > 0) this.ccFallbackLive = true;
                return left > 0;
            });
            items = live.filter((e) => e.name).slice(0, 16);
            unread = live.length - live.filter((e) => e.name).length;
            shown = live.length > 0;
        }
        this.ccItems = items; this.ccListShown = shown; this.ccListUnread = unread > 0; this.ccNoMatch = noMatch;
        this._ccMerge();
        if (this.ccListUnread) {
            this._rowFail('info', 'a check-control message arrived in ccList that app.json config.ccList cannot read (' + unread + ' entr' + (unread === 1 ? 'y' : 'ies') + ' with no name)');
        }
        const changed = before !== this.ccListShown + '|' + this.ccListUnread + '|' + this.ccNoMatch + '|' + items.map((e) => e.key).join(',');
        if (changed && push) this._ccPush();
        return changed;
    }

    /** Whether the car's own check-control message can be READ: one notification from config.ccm has carried
     *  something our paths found - a name, a description, a symbol, an id or a type. A struct whose paths fit the
     *  car carries its id and its type even with no message on, so this says "config.ccm fits this car", never "a
     *  message is showing" (that is _cc). Sticky: once read, read.
     *  2026-11-16, the owner's car: while this is false we are BLIND - we never learn when the cluster writes in
     *  BMW's message panel - so the info field stays BMW's (_own) and that panel is left see-through (_ccOpen)
     *  instead of being half covered by our own black, which sliced BMW's message across the middle. */
    _ccWired() {
        // fix/cclist: or ccList has spoken once (a list config.ccList fits), which the owner's car does at once
        // fix/active-cc: or the cluster's "message shown now" has given a number once
        return (this._ccNamed() && this.ccAny === true) || (this._ccListNamed() && this.ccListAny === true) || this.ccActAny === true;
    }

    /** Whether BMW's own check-control panel must be left see-through now ("cc:open"): the car says a message shows,
     *  or - in a see-through layout, where BMW's own panel is what the driver would otherwise read - we cannot read
     *  its messages at all and so must not cover a panel the cluster may be writing in. fix/opaque-cc: the opaque
     *  themes too - their background covers BMW's cluster whole, so while we are blind it would hide BMW's warnings. */
    _ccOpen() {
        // package X, THE SAFETY RULE (the owner, 2026-11-16: "a BMW warning is never hidden unless our own text for it
        // is on the screen in the same frame"). While the row is OURS, BMW's panel is covered only once our text for
        // the very message the car says is showing has been sent, CC_SETTLE_MS ago, in an earlier tick (_ccOnScreen).
        // Every other case - the message just arrived, it changed, it cannot be read (ccUnread), our text has a
        // character the font lacks, drawing it threw - leaves BMW's panel open: the last three latch the row too.
        if (this._seeThrough(this._layoutName()) && this._rowWhy() === null) return this._cc() === true && !this._ccOnScreen();
        if (this._cc() === true) return true;
        // ---- fix/opaque-cc (2026-11-16): the blind case in the OPAQUE themes too. Our background covers BMW's whole
        // cluster there, and on the owner's car no message has ever been read, so BMW's warnings were hidden. While
        // config.ccm has never been read (_ccWired; also when app.json names no message field at all) BMW's panel
        // is left open - the hole cut to BMW's own outline (WBBACK u_ccS / u_ccE) - and our row steps aside ("!cc:open")
        if (!this._seeThrough(this._layoutName())) return !this._ccWired();
        // ---- end fix/opaque-cc ----
        return (this._ccNamed() || this._ccListNamed()) && !this._ccWired() && this._seeThrough(this._layoutName());
    }

    /** package X: our own text for the message the car says is showing has been on its way to the screen for at least
     *  CC_SETTLE_MS (sent in an earlier tick: _ccPainted). Keyed on the headline itself, so a new message, or the same
     *  slot with other words, opens BMW's panel again until ours has caught up. */
    _ccOnScreen() {
        const d = this.ccDrawn, want = this._ccText('head');
        return !!(d && want && d.key === want && Date.now() - d.at >= CC_SETTLE_MS);
    }

    /** package X: BMW's panel state sent NOW, from the signal handler, not at the next tick: a message that arrives
     *  between two ticks would otherwise stay under our black for up to TICK_MS with nothing of ours over it (the
     *  bench's audit caught exactly that). Opening is what matters here; covering still waits for _ccOnScreen. */
    _ccPush() {
        if (!this.client || !this.client.ready || !this.widgets) return;
        // ---- fix/row-cc (2026-11-16): our "cc:"-toggled texts step aside BEFORE BMW's panel opens (_ccLiveSync) ----
        this._guard('message panel texts', () => this._ccLiveSync(true));
        // ---- end fix/row-cc ----
        this._guard('message panel', () => this.widgets.forEach((x) => {
            if (!x.w || !x.ref) return;
            // strip integration: in a layout with the strip mask BMW's panel opens through the mask's "msg" hole lane
            // (_maskLanes, the same _ccOpen), pushed from here exactly as u_cc was; u_cc is the opaque themes' only
            if (x.w.type === 'wbback') { if (x.w.collar && x.w.mask) this._wbMaskSend(x); else this._wbCcSend(x); }
            else if (x.w.type === 'fill' && typeof x.w.holeWhen === 'string' && x.w.holeWhen.indexOf('cc:') >= 0) {
                const h = this._hole(x.w), key = h.join(',');
                if (key !== x.last) { x.last = key; x.c.uniform(x.ref, 'u_hole', h); }
            }
        }));
        // ---- fix/row-cc: and come back only AFTER BMW's panel has shut again ----
        this._guard('message panel texts', () => this._ccLiveSync(false));
        // ---- end fix/row-cc ----
    }

    /* ---- fix/row-cc (2026-11-16, the state gallery bake/work/shots/20261116-2107): LIVE "cc:" toggles ----
     * The opaque 6WB themes' own clock / temperature row carries "!cc:shown" (design/gen_6wb.py), but a widget's
     * toggle was read only at _rebuild, and a check-control message never rebuilds (it only pushes u_cc, _ccPush).
     * So a message that arrived after the build opened BMW's panel (u_cc) with our row still drawn on top of BMW's
     * text (defect 1, against the safety rule), and a layout built while a message showed had no row at all, which
     * stayed missing after the message cleared until something else rebuilt (defect 2: Sport and Eco).
     * Now a TEXT widget's "cc:" parts are not asked at the build (_builtOn counts them as on); the widget is always
     * built, and is painted empty for as long as its whole toggle is off (_ccHidden, read live in _updateOne). The
     * signal handler's _ccPush applies it in the same event: texts are blanked before the panel opens, and drawn
     * again only after it has shut. Other widget types keep the build-time reading (no layout gives them "cc:"). */

    /** Whether a widget's toggle has a "cc:" part that is read live rather than at the build. */
    _ccLive(w) {
        return !!(w && w.type === 'text' && typeof w.toggle === 'string' && w.toggle.indexOf('cc:') >= 0);
    }

    /** _rebuild's question, "is this widget built?": its toggle, with a live widget's "cc:" parts counted as on. */
    _builtOn(w) {
        if (!w.toggle) return true;
        if (!this._ccLive(w)) return this._toggleOn(w.toggle);
        const rest = w.toggle.split('&').filter((p) => p.replace(/^!/, '').indexOf('cc:') !== 0);
        return !rest.length || this._toggleOn(rest.join('&'));
    }

    /** A live widget whose whole toggle is off now: built, but painted empty. */
    _ccHidden(w) {
        return this._ccLive(w) && !this._toggleOn(w.toggle);
    }

    /** Repaint at once every live widget that must go (hide true) or may come back (hide false). */
    _ccLiveSync(hide) {
        const now = Date.now();
        this.widgets.forEach((x) => {
            if (!x.w || !x.ref || !this._ccLive(x.w) || this._ccHidden(x.w) !== hide) return;
            if (hide ? x.ccHid : !x.ccHid) return;              // already as wanted: nothing to send
            this._update(x, now, true);
        });
    }
    /* ---- end fix/row-cc ---- */

    /** package X: called right after our message line's pixels were handed to the connection. '' clears. */
    _ccPainted(s) {
        if (!s) { this.ccDrawn = null; return; }
        if (!this.ccDrawn || this.ccDrawn.key !== s) this.ccDrawn = { key: s, at: Date.now() };
    }

    /* ---- bottom row (docs/BOTTOM-ROW-PACKAGE.md) ---- */

    /** Whether the red arc over the limit is drawn now. "limitArc":
     *   "auto" (the default) follows the CAR's own verdict: the arc is on while the car says the driver is over
     *          (displaySpeedLimitWarning level 1 or 2) and the driver has that warning switched on in the car's own
     *          menu (config.sla "warn"); a car that says nothing about the setting counts as on, and the second
     *          level follows "warn2" the same way. So the driver's own tolerance (settingOffsetSpeed) is honoured
     *          without us knowing what it is: the car applies it;
     *   "on"   ignores the car's menu and draws whenever our own speed is past the sign (what 0.7.14 did);
     *   "off"  never.
     *  The owner, 2026-11-15: the stock cluster has an "Excess speed display" of its own, and these are its
     *  signals, so the verdict should be the car's and not ours. */
    _arcOn() {
        const v = this.ctx.settings.item('limitArc') ? this.setting('limitArc') : 'auto';
        if (v === 'off' || v === false) return false;
        if (v === 'on' || v === true) {
            const lim = this._raw('limit'), speed = this._raw('speed');
            return isNum(lim) && isNum(speed) && speed > lim + 1;
        }
        const warn = (this.sign || {}).warn || 0;
        if (warn < 1) return false;
        const want = warn >= 2 ? this.sla.warn2 : this.sla.warn;
        return want !== 'off';            // null (the car said nothing) counts as on
    }

    /** What the sign layer shows now (WBSIGN u_show): [a, b]. a: 1 a limit, 2 the end-of-limit sign, 3 BMW's empty
     *  sign "---", 0 nothing; b: the no-overtaking sign.
     *  The stock cluster animates the derestriction and then shows the new limit, and a sign is essentially always
     *  there (the owner, 2026-11-15), so there is no "hide it" state: the end state is shown as a state until the
     *  animation lands. THE SEAM: docs/G20-DESIGN-SPEC.md is measuring that animation, and this method plus
     *  config.sign.holdMs (how long the last sign stays while the car says nothing) is all it needs to change. */
    _signShow() {
        let a = isNum(this._raw('limit')) ? 1 : this._raw('limitEnd') ? 2 : this._raw('limitUnknown') ? 3 : 0;
        const b = this._raw('nopass') ? 1 : 0;
        const hold = isNum(this.config.sign && this.config.sign.holdMs) ? this.config.sign.holdMs : 0;
        if (a === 0) {
            if (hold > 0 && this.signLast && Date.now() - (this.signLastAt || 0) < hold) a = this.signLast;
        } else { this.signLast = a; this.signLastAt = Date.now(); }
        return [a, b];
    }

    /** Which check-control message is on show now. The car cycles through its list when several are on at once, so
     *  ours steps through it on the same clock (the owner, 2026-11-15). One message (or no list): that one.
     *  THE SEAM: the stock order and timing come from docs/G20-DESIGN-SPEC.md; only this method and CC_CYCLE_MS
     *  decide them. */
    _ccNow() {
        const list = this.ccItems || [], m = this.ccMsg || {};
        // fix/active-cc: the cluster shows a number no ccList entry carries: no text of ours for it (BMW's panel stays
        // open), unless newCCMessage itself reports a message
        if (this.ccNoMatch !== null && this.ccNoMatch !== undefined && !(this.ccmShown === true && (m.name || m.desc))) {
            return { name: '', desc: '', color: null, symbol: null, id: null };
        }
        if (!list.length) return m;
        // fix/cclist: newCCMessage's message, when it reports one, is the richer (it has a description); else the
        // list's entry is the message - on the owner's car the list is all there is
        const mOn = this.ccmShown === true && !!(m.name || m.desc);
        const asMsg = (one) => ({ name: one.name, desc: mOn && one.name === m.name ? m.desc : '', color: one.color || (mOn ? m.color : null),
            symbol: one.symbol === undefined ? null : one.symbol, id: one.id });
        // The car cycles numbered frames and says which one it is on, so ours follows that counter and never runs a
        // timer of its own (the owner, 2026-11-15; docs/G20-DESIGN-SPEC.md). Without the counter the newest message
        // is shown and nothing cycles: a wrong guess at the car's rhythm would look worse than not cycling.
        const f = this.ccFrame || {};
        if (list.length >= 2 && isNum(f.n) && isNum(f.of) && f.of >= 1 && f.n >= 1 && f.n <= f.of) {
            const id = f.ids[f.n - 1];
            const byId = isNum(id) ? list.map((x) => x.id).indexOf(id) : -1;
            // the list carries a short name and a colour; the description belongs to the message the car last sent
            return asMsg(list[byId >= 0 ? byId : (f.n - 1) % list.length]);
        }
        return mOn ? m : asMsg(list[0]);
    }

    /** The check-control message's name or description, '' while none shows or the info field is BMW's. The text is
     *  the car's own, already localised; it is never logged. */
    _ccText(part) {
        if (!this._own('info') || this._cc() !== true) return '';
        const m = this._ccNow();
        // package X: "head", our one line - the headline (the name; the description only when there is no name)
        if (part === 'head') return String(m.name || m.desc || '').replace(/\s+/g, ' ').trim();
        return String((part === 'desc' ? m.desc : m.name) || '');
    }

    /** The colour the car asked for the message, as a theme role or an RGBA (config.ccm colorMap). A sign's or a
     *  message's own colours are kept at night and only dimmed, never recoloured (the owner, 2026-11-15), the way
     *  the 6WB shaders treat WBSIGN.
     *  NOT IN USE: white only for now (the owner, 2026-11-15). cCColor is read and recorded, every message is drawn
     *  in the theme's foreground. THE SEAM is one line: put "colorBy": "cc" back on the cc_name text in
     *  design/gen_6wb.py cc_row() and this method is what colours it. */
    _ccRole() {
        const c = this._ccNow().color, role = CC_ROLE[c] || null;
        if (!Array.isArray(role) || !this.nightOn) return role;
        return [Math.round(role[0] * NIGHT_DIM), Math.round(role[1] * NIGHT_DIM), Math.round(role[2] * NIGHT_DIM), role[3]];
    }

    /* ---- package X (docs/strip/X-REPORT.md): our message, one line in the road label's slot ---- */

    /** "ccStyle": "A" (a severity marker, then the headline; the default) or "B" (a hairline above the headline and a
     *  segment in the severity's colour under it, no marker). The owner picks on the bench. */
    _ccStyle() {
        const v = this.ctx.settings.item(CC_STYLE_KEY) ? this.setting(CC_STYLE_KEY) : 'A';
        return v === 'B' ? 'B' : 'A';
    }

    /** The message's severity: "warn" (cCColor red, yellow or orange: a warning triangle) or "info" (white, green,
     *  default or none: an "i"), and its colour (CC_ROLE, only dimmed at night, never recoloured). A GUESS how BMW
     *  maps its colours to its own marker: no stock photo pairs a known cCColor with the marker it showed. */
    _ccSeverity() {
        const c = this._ccNow().color;
        // strip integration (the owner's decision 6): three classes - "warn" (red, yellow, orange: package P's outline
        // triangle cc_warn), "info" (white, green: cc_info) and "neutral" (default, or no colour from the car: NO
        // marker, not a dot). Which cCColor BMW itself shows as which marker is still a guess (no stock photo pairs them)
        const name = c === 'red' || c === 'yellow' || c === 'orange' ? 'warn' : c === 'white' || c === 'green' ? 'info' : 'neutral';
        return { name, rgba: color(this.theme, this._ccRole() || 'fg') };
    }

    /** Our message line as straight RGBA, w.w x w.h: the headline in w.font (white: the owner, 2026-11-15), its cell
     *  top at w.textY in the box, centred on the box together with what style puts beside it, and cut with "..." to
     *  what is left of the box. Never logs the text. Shapes are distance functions, anti-aliased over one px. */
    _ccLinePaint(w, s, style, sev) {
        const W = w.w, H = w.h, fm = textRaster.loadFont(w.font).metrics;
        const top = isNum(w.textY) ? w.textY : 0, base = top + fm.baseline;
        const capH = Math.round(fm.size * 0.716), capTop = base - capH;         // Arimo's cap height, 0.716 em
        // strip integration (decision 6): the marker is package P's pictogram (shared/strip_icons.js, painted by
        // icons.js paintIcon) in an mH square - cc_warn's triangle spans 0.78 of it, so it stands a capital high -
        // and the neutral case has none at all
        const icon = style === 'A' ? (sev.name === 'warn' ? 'cc_warn' : sev.name === 'info' ? 'cc_info' : null) : null;
        const mH = icon ? Math.round(capH * 1.3) : 0;                            // the marker's square
        const mW = mH;
        const gap = mH ? Math.round(capH * 0.5) : 0, pad = 8;
        let t = String(s);
        const fits = (v) => textRaster.measure(v, w.font, w.spacing) <= W - 2 * pad - mW - gap;
        if (!fits(t)) {
            while (t.length > 1 && !fits(t + '...')) t = t.slice(0, -1);
            t = t.replace(/[\s,.;:/-]+$/, '') + '...';
        }
        const tw = textRaster.measure(t, w.font, w.spacing);
        this.ccFit = { chars: t.length, cut: t !== String(s), width: tw, marker: icon };   // lengths and the marker only (the bench's probe)
        const x0 = Math.round((W - (mW + gap + tw)) / 2), tx = x0 + mW + gap;
        const fg = color(this.theme, w.color || 'fg');
        const out = t ? textRaster.drawText(W, H, t, { font: w.font, offsetY: top, color: fg, align: 'left', x: tx, spacing: w.spacing })
            : Buffer.alloc(W * H * 4, 0);
        // straight-alpha "over" of one colour with coverage k at (x, y)
        const put = (x, y, rgba, k) => {
            if (x < 0 || y < 0 || x >= W || y >= H || k <= 0) return;
            const o = (y * W + x) * 4, sa = Math.min(1, k) * rgba[3] / 255, da = out[o + 3] / 255, a = sa + da * (1 - sa);
            if (a <= 0) return;
            for (let j = 0; j < 3; j++) out[o + j] = Math.round((rgba[j] * sa + out[o + j] * da * (1 - sa)) / a);
            out[o + 3] = Math.round(a * 255);
        };
        if (icon) {
            // package P's drawing, its box centred on the capitals; each of its pixels laid over in the severity's colour
            const ix = x0, iy = Math.round(capTop + capH / 2 - mH / 2);
            const px = paintIcon(icon, mH, mH, [255, 255, 255, 255]);
            for (let y = 0; y < mH; y++) for (let x = 0; x < mH; x++) put(ix + x, iy + y, sev.rgba, px[(y * mH + x) * 4 + 3] / 255);
        }
        if (style === 'B' && t) {
            // a hairline above, past the headline's ends by 48 px and fading out over its last 32, in a dim foreground;
            // under the headline a 3 px segment in the severity's colour, as long as the headline
            const hy = Math.round(capTop - capH * 0.6), x1 = Math.max(0, tx - 48), x2 = Math.min(W, tx + tw + 48);
            for (let x = x1; x < x2; x++) put(x, hy, fg, 0.55 * Math.min(1, (x - x1 + 0.5) / 32, (x2 - x - 0.5) / 32));
            const sy = base + Math.max(4, Math.round(capH * 0.3));
            for (let y = sy; y < sy + 3; y++) for (let x = tx; x < tx + tw; x++) put(x, y, sev.rgba, 1);
        }
        return out;
    }
    /* ---- end package X ---- */

    /** The road label: the car's own road description, else the street of its position (config.nav.here), else ''.
     *  Never logged. The demo drive shows a made-up street so the bench can be looked at. */
    _roadText() {
        // BMW shows the road name on the bottom line only while no check-control message is on it; ours does the same
        if (!this._own('nav') || this._cc() === true) return '';
        if (this.road) return this.road;
        if (this.posStreet) return String(this.posStreet).slice(0, 48);
        return this._data().demo ? 'Demo Road' : '';
    }

    /** u_cc: the bg widget's "cc" box [x0, y0, x1, y1] (panel px; BMW's check-control message panel) see-through
     *  while BMW's own message is the one on show (_ccOpen: the car says a message shows, or we cannot read its
     *  messages at all), else none; sent when it changes.
     *  Package X: "ccSym" (BMW's symbol column beside our text) is gone; "ccMark" (BMW's marker) takes the box while
     *  the panel is shut. */
    _wbCcSend(x) {
        const w = x.w, four = (a) => Array.isArray(a) && a.length === 4;
        // strip integration: a layout with the strip mask has no u_cc (package M); its panel opens through the mask
        if (w.collar && w.mask) return;
        // package X: no symbol column any more ("ccSym"; the owner, 2026-11-16: our message is our own design, for now
        // without a window for BMW's symbol): BMW's whole panel opens (_ccOpen), or nothing of it does.
        // (Strip integration, the owner's decision 7: no "ccMark" window - BMW's marker is covered by default.)
        const b = four(w.cc) && this._ccOpen() ? w.cc : null;
        const v = b ? [b[0] - w.x, b[1] - w.y, b[2] - w.x, b[3] - w.y] : [0, 0, 0, 0], key = v.join(',');
        if (key === x.ccKey) return;
        x.ccKey = key;
        // ---- fix/opaque-cc: BMW's panel outline ("ccArc", "ccSide": design/gen_6wb.py CC_PANEL), sent before u_cc
        // opens, so no frame shows the bounding box. Layer px.
        if (b && four(w.ccArc) && four(w.ccSide)) {
            x.c.uniform(x.ref, 'u_ccS', [w.ccArc[0] - w.x, w.ccArc[1] - w.x, w.ccArc[2] - w.y, w.ccArc[3]]);
            x.c.uniform(x.ref, 'u_ccE', [w.ccSide[0] - w.x, w.ccSide[1] - w.y, w.ccSide[2] - w.x, w.ccSide[3] - w.y]);
        }
        // ---- end fix/opaque-cc ----
        x.c.uniform(x.ref, 'u_cc', v);
    }

    /* ---- package M (docs/strip/M-REPORT.md): the STRIP mask ----
     * A see-through layout's bg (a "wbback" with a collar) carries "mask": { tex } (design/gen_6wb.py strip_mask()).
     * hud/scene/<tex>.json (tools/strip/bake_mask.py) is an R8 atlas of our coverage over BMW's bottom strip, one byte
     * a px, one lane per state of the row (docs/strip/M-REPORT.md 3), and its own lane table, "mask": { atlas: [w,
     * h], cover: [x0, y0, x1, y1], hole: [x0, y0, x1, y1] (panel px), lanes: { <lane>: [ax, ay] } }, so a new bake needs
     * no new layout. The cover lanes "ours", "bmw" and "standby" share the box "cover" (inside it the lane IS our black,
     * outside it the collar); the hole lane "msg" has the box "hole" (a multiplier: BMW's message panel, its symbol and
     * its marker). Each lane's tile starts at [ax, ay] in the atlas. (The rects it replaced - package F's cover and
     * four patches, and u_cc in this layout - are gone.) */

    /** The lanes for now: { cover, hole } (lane names; hole null), null without a lane table. The cover lane follows
     *  the row: every item ours, "ours"; otherwise BMW's row - "standby" while BMW shows its standby row, else "bmw"
     *  (a row half ours falls back whole: the owner, 2026-11-16). The hole lane opens BMW's message panel whenever
     *  _ccOpen says it must be seen, and BMW's marker only while config.ccMarker says BMW draws it (_markShown).
     *  m: the texture's lane table.
     *  Strip integration (2026-11-16, docs/strip):
     *   - standby is package X's: VehicleCondition COND_STANDBY held STANDBY_MS (this.rowStandby, _rowSync), never "P
     *     with the engine off" - photos 62 and 63 are P with the engine off and BMW draws its NORMAL row there;
     *   - THE SAFETY RULE: "msg" follows _ccOpen alone, with the row ours too. In the gap between a message arriving and
     *     our first draw of it (_ccOnScreen), after a missing glyph, a throw or an unreadable struct, BMW's panel is open
     *     through this lane - the job u_cc and the road bar's hole did before the mask (package X's _ccPush). */
    _maskLanes(m) {
        if (!m || !m.lanes || !Array.isArray(m.cover)) return null;
        const all = OWN_ITEMS.every((k) => this._own(k));
        const cover = all ? 'ours' : this.rowStandby && m.lanes.standby ? 'standby' : 'bmw';
        const msg = Array.isArray(m.hole) && !!m.lanes.msg && this._ccOpen(), mark = this._markShown();
        // a marker lane only exists in a bake made with it (tools/strip/bake_mask.py --marker); the panel always wins
        const hole = msg ? (mark && m.lanes.msgMark ? 'msgMark' : 'msg') : mark && m.lanes.mark ? 'mark' : null;
        return m.lanes[cover] ? { cover, hole } : null;
    }

    /** Strip integration, the owner's decision 7 (2026-11-16): BMW's marker right of its panel (none / warning
     *  triangle / "i") is COVERED by default, in every lane and both modes. It opens only while a CONFIRMED signal says
     *  BMW is drawing it: app.json config.ccMarker { iface, field, path?, shownWhen?: [raw values] } (null: never).
     *  None is confirmed today, so config.ccMarker is null and this is false. */
    _markShown() {
        return !!(this.config.ccMarker && this.ccMarkerOn === true);
    }

    /** u_mk, u_mh, u_mo when the lanes change. Every frame between two of these messages must be a whole picture (the
     *  service may draw between them): a lane goes off before the origins move and comes on after them, and the cover
     *  lanes share one box, so going from one to another is a single u_mo. */
    _wbMaskSend(x, init) {
        const w = x.w, c = x.c, ref = x.ref, none = [0, 0, 0, 0];
        if (init) {
            x.mask = { k: null, h: null };
            x.maskT = null;
            c.uniform(ref, 'u_mk', none); c.uniform(ref, 'u_mh', none); c.uniform(ref, 'u_mo', none);
            if (!(w.mask && w.mask.tex)) return;
            const a = this._scene(w.mask.tex, x.ci), t = a.mask;
            if (!t || !Array.isArray(t.atlas) || t.atlas[0] !== a.w || t.atlas[1] !== a.h) {
                this.log.warn('strip mask "' + w.mask.tex + '": no lane table that fits it, only the collar draws (BMW\'s row shows)');
                return;
            }
            x.maskT = t;
            c.bind(ref, 'u_t2', a.ref);
            c.uniform(ref, 'u_r2', [0, 0, a.w, a.h]);
        }
        const m = x.maskT;
        if (!m) return;
        const L = this._maskLanes(m), k = L ? L.cover : null, h = L ? L.hole : null, prev = x.mask;
        if (prev.k === k && prev.h === h) return;
        const org = (n) => (n && m.lanes[n]) || [0, 0];
        const lp = (b) => [b[0] - w.x, b[1] - w.y, b[2] - w.x, b[3] - w.y];
        // (strip integration: every hole lane - "msg", and with the marker "mark", "msgMark" - shares the box m.hole, so
        // going from one to another is a single u_mo, with no frame in between where BMW's panel is shut)
        if (prev.h && !h) c.uniform(ref, 'u_mh', none);
        if (prev.k && !k) c.uniform(ref, 'u_mk', none);
        c.uniform(ref, 'u_mo', org(k).concat(org(h)));
        if (k && !prev.k) c.uniform(ref, 'u_mk', lp(m.cover));
        if (h && !prev.h) c.uniform(ref, 'u_mh', lp(m.hole));
        x.mask = { k, h };
    }
    /* ---- end package M ---- */

    /** car3 G: what the bottom row draws now and why, for the log and the status line (docs/CAR3-G-REPORT.md: on the
     *  car BMW's row showed although "ours" was the default). One setting now, so one reason per item. */
    _ownNote() {
        const raw = (k) => { const v = this.ctx.settings.get(k); return v === undefined ? 'unset' : JSON.stringify(v); };
        const seen = this._seeThrough(this._layoutName());
        // package X: in a see-through layout the row is one thing, so the note says that and why
        if (seen) {
            const why = this._rowWhy();
            return 'bottom row: ' + (why === null ? 'all ours' : 'all BMW\'s - ' + why) + ' (' + ROW_KEY + ' ' + raw(ROW_KEY) +
                ', message look ' + this._ccStyle() + '); mode label ' + (this.setting('modeLabel') === false ? 'off' : this.driveMode ? 'on' : 'on, empty: no drive mode from the car') +
                ' (modeLabel ' + raw('modeLabel') + ')';
        }
        const one = (item) => item + ' ' + (this._own(item) ? 'ours' : "BMW's") +
            (this.rowFail && this.rowFail[item] ? ' (gave itself back)'
                : item === 'clock' && !isNum(this._tzMinutes()) ? ' (no time zone)'
                : item === 'info' && !this._ccWired() ? ' (the car\'s check-control message has not been read)' : '');
        return 'bottom row: ' + OWN_ITEMS.map(one).join(', ') +
            ' (' + ROW_KEY + ' ' + raw(ROW_KEY) + (seen ? '' : ', opaque theme: the row is ours') + ')' +
            '; mode label ' + (this.setting('modeLabel') === false ? 'off' : this.driveMode ? 'on' : 'on, empty: no drive mode from the car') +
            ' (modeLabel ' + raw('modeLabel') + ')';
    }

    /** "dialShade" and "wbFoot" while a layout shows: only the uniforms change. False when a rebuild is needed (the foot
     *  line goes to or from "glass", which samples a texture; or no wbback is up). */
    _wbLive() {
        try {
            let done = false, need = false;
            this.widgets.forEach((x) => {
                if (need || !x.w || x.w.type !== 'wbback' || !x.ref) return;
                const w = x.w;
                const foot = this._wbUses(w).foot, fl = Array.isArray(w.footLine) ? w.footLine : [0, 0, 1];
                if (w.collar) {
                    x.c.uniform(x.ref, 'u_shade', this._wbShade(w));
                    x.c.uniform(x.ref, 'u_foot', [foot, fl[0] - w.y, fl[1] - w.x, fl[2] - w.x]);    // never "glass" here
                    x.wbFootNow = foot; done = true; return;
                }
                if ((foot === 0) !== (x.wbFootNow === 0)) { need = true; return; }
                x.c.uniform(x.ref, 'u_foot', [foot, fl[0] - w.y, fl[1] - w.x, fl[2] - w.x]);
                x.wbFootNow = foot; done = true;
            });
            return done && !need;
        } catch (e) { this.log.error('hud wb live: ' + (e && e.stack || e)); return false; }
    }
    /* --- end package F --- */

    _tick() {
        const now = Date.now();
        this._d = this.car.data();      // 0.7.14: one copy of the car's data for the whole tick (_data)
        try {
            this._smoothRpm(now);
            // the 0-60 timer only on the car's own data (the demo drive would set a best time)
            if (!this._d.demo) this.runs.update(this._d.speed, now, this.setting('units') === 'us' ? 'us' : 'metric');
            this._trip(now);
            this._gTick(now);
            const b = this._boost();
            if (isNum(b) && (!isNum(this.boostPeak) || b > this.boostPeak)) this.boostPeak = b;
            this._guard('probes', () => this._probeTick());     // probes, item 1: the vehicle condition (0.7.18)
            // fix/active-cc: the fallback's entries expire with time, not with a notification
            if (this.ccFallbackLive) this._guard('check-control', () => this._ccListEval(now, true));
            if (!this.client.ready) return;
            this._guard('bottom row', () => this._rowSync(now));     // package X: standby, the clock line, the row's owner
            // shift light: blink the whole bar at 8 Hz once the rpm reaches the redline
            const rpm = this._raw('rpm');
            const flashing = isNum(rpm) && rpm >= this._redline() - 150;
            this.flash = flashing ? Math.floor(now / 62.5) % 2 === 0 : false;
            const smooth = !!this.needleT;
            const socks = this._cork();     // 0.7.14: the tick's messages go out as one write per connection
            try {
                this.widgets.forEach((x) => {
                    if (smooth && this._isNeedle(x)) return;     // the needle timer draws it ("needleSmooth")
                    this._guard('widget ' + x.w.id, () => this._update(x, now, false));
                });
            } finally { this._uncork(socks); }
        } finally { this._d = null; }
    }

    /** 0.7.14: the car's data (car.data(), a fresh copy each call). Inside the tick and the needle timer it is the
     *  one copy taken when they began: nothing changes the car's data while they run (it arrives in events), so
     *  every value is the same, without 150 to 350 copies a second. */
    _data() { return this._d || this.car.data(); }

    /** 0.7.14: cork every connected socket to cluster-render; the writes until _uncork leave as one write each (one
     *  wake of the service, one scene flush) instead of one per message. Returns the sockets corked. */
    _cork() {
        const out = [];
        this.clients.forEach((c) => {
            const s = c.sock;
            if (s && c.connected && !s.destroyed && typeof s.cork === 'function' && typeof s.uncork === 'function') { s.cork(); out.push(s); }
        });
        return out;
    }
    _uncork(socks) {
        socks.forEach((s) => { try { s.uncork(); } catch (e) { this.log.warn('uncork: ' + e); } });
    }

    /* ---------------- the needles (0.7.14, docs/PERF-NEEDLE-REPORT.md) ----------------
     * "needleSmooth" (Settings, on by default): the speed and rev needles (dial and g20dial widgets with "measure"
     * speed or rpm) leave the 50 ms tick for their own NEEDLE_MS timer (30 a second, cluster-render's frame rate) and
     * show the value interpolated between the car's samples, one sample period behind, so a needle moves at the
     * car's own pace between samples instead of jumping 20 times a second on a clock that beats against the car's.
     * The rev needle keeps the tick's 120 ms filter, and the shift-light test (_testRpm) drives it as before. The
     * sample period is learnt from the gaps between changes (20 to 150 ms). A value that sat still is held until
     * one period before its next change. Off: the needles move on the tick exactly as before 0.7.14.
     * From package P's opt-in prototype (docs/PERF-AUDIT.md 3, 7 item 2 and 9), measured on the bench only. */
    _isNeedle(x) {
        const w = x.w;
        return (w.type === 'dial' || w.type === 'g20dial') && (w.measure === 'rpm' || w.measure === 'speed');
    }

    /** The needle timer on or off, as the setting says (and only while the app runs). */
    _needleApply() {
        const on = !!(this.started && !this.needleHalt && this.setting('needleSmooth') !== false);
        if (on && !this.needleT) {
            this.needleAt = 0; this.needleRpm = null;
            this.needleT = setInterval(() => this._guard('needles', () => this._needleTick()), NEEDLE_MS);
            this.log.info('needles: smooth (interpolated, ' + Math.round(1000 / NEEDLE_MS) + ' a second)');
        } else if (!on && this.needleT) {
            clearInterval(this.needleT);
            this.needleT = null; this.needleOver = null;
            this.widgets.forEach((x) => { if (this._isNeedle(x)) x.last = null; });   // the tick takes them back
            this.log.info('needles: on the ' + TICK_MS + ' ms tick');
        }
    }

    _needleReset() {
        this.ndl = { rpm: [], speed: [], last: {}, period: { rpm: 50, speed: 50 } };
    }

    /** A car sample: rpm / speed when they change, with their arrival time (ms), and the sample period learnt. */
    _needleSample(d, t) {
        const S = this.ndl;
        ['rpm', 'speed'].forEach((k) => {
            const v = d[k];
            if (!isNum(v) || v === S.last[k]) return;
            const prevT = S.last[k + 'T'];
            S.last[k] = v; S.last[k + 'T'] = t;
            const h = S[k];
            if (isNum(prevT)) {
                const gap = t - prevT;
                if (gap < 300) S.period[k] += (Math.min(150, Math.max(20, gap)) - S.period[k]) * 0.1;
                // a value that sat still for a while: hold it until one period before the change, so the ramp
                // runs over one period, not over the whole quiet stretch
                else if (h.length) h.push([t - S.period[k], h[h.length - 1][1]]);
            }
            h.push([t, v]);
            if (h.length > 64) h.splice(0, h.length - 64);
        });
    }

    /** The value of rpm / speed at time t (ms), linear between the samples around it; the newest one past the end. */
    _needleAt(k, t) {
        const h = this.ndl && this.ndl[k];
        if (!h || !h.length) return null;
        if (t >= h[h.length - 1][0]) return h[h.length - 1][1];
        for (let i = h.length - 1; i > 0; i--) {
            const a = h[i - 1], b = h[i];
            if (t >= a[0]) return a[1] + (b[1] - a[1]) * (t - a[0]) / Math.max(1, b[0] - a[0]);
        }
        return h[0][1];
    }

    /** The needle timer: every needle widget with rpm / speed interpolated one sample period back, corked. */
    _needleTick() {
        if (!this.client.ready) return;
        const S = this.ndl, now = Date.now();
        this._d = this.car.data();
        const socks = this._cork();
        try {
            // the demo's samples carry the sim's own clock (simT), the car's Date.now(): both are wall ms
            const sp = this._needleAt('speed', now - S.period.speed), rpmIn = this._needleAt('rpm', now - S.period.rpm);
            const test = this._testRpm(now);
            const raw = isNum(test) ? test : rpmIn;
            const dt = this.needleAt ? Math.min(500, now - this.needleAt) : 0;
            this.needleAt = now;
            // the tick's filter (_smoothRpm, 120 ms) on the interpolated rpm
            this.needleRpm = !isNum(raw) ? null : isNum(this.needleRpm) ? this.needleRpm + (raw - this.needleRpm) * (1 - Math.exp(-dt / 120)) : raw;
            this.needleOver = { rpm: this.needleRpm, speed: sp };
            this.widgets.forEach((x) => { if (this._isNeedle(x)) this._guard('widget ' + x.w.id, () => this._update(x, now, false)); });
        } finally {
            this.needleOver = null;
            this._d = null;
            this._uncork(socks);
        }
    }
    /* ---------------- end the needles ---------------- */

    // ---- PERF (package P, docs/PERF-AUDIT.md, 2026-11-14): the opt-in perf log ----------------------------------------
    // OFF unless the app's data folder holds perf.json with "log": true, e.g. { "log": true } (read at start and every
    // PERF_LOG_MS; deleting the file turns it off again). Without the file only that check runs (one failed open
    // every 10 s). Hooks outside this block: start() and stop(), one line each, marked "package P".
    //  "log": one "perf:" line every 10 s: car samples (rpm / speed changes a second and their gaps), the 50 ms tick's
    //         real period, the event loop's lag, JS time in the tick and in the needle timer, bytes written per
    //         connection, process CPU and memory. Read by scripts/perf_probe.sh from the app log.
    // 0.7.14: the needle prototype ("needle": "smooth", "rpmTau") left this block for the engine (the needles above,
    // the setting "needleSmooth"); perf.json's "needle" and "rpmTau" are ignored now.
    _perfStart() {
        this.perfFile = path.join(this.ctx.dataDir || '.', 'perf.json');
        this.perfCfg = null;
        const read = () => {
            let cfg = null;
            try { cfg = JSON.parse(fs.readFileSync(this.perfFile, 'utf8')); } catch (e) { cfg = null; }
            const key = JSON.stringify(cfg);
            if (key === this.perfKey) return;
            this.perfKey = key;
            this.perfCfg = cfg && typeof cfg === 'object' ? cfg : null;
            if (this.perfCfg) this.log.info('perf: ' + this.perfFile + ' ' + key);
            if (this.perfCfg && this.perfCfg.needle !== undefined) this.log.info('perf: "needle" is ignored since 0.7.14: the setting "Smooth needles" (needleSmooth) is it');
            this._perfApply();
        };
        read();
        this.perfReadT = setInterval(() => this._guard('perf', read), PERF_LOG_MS);
    }

    _perfStop() {
        clearInterval(this.perfReadT);
        this.perfCfg = null;
        this._guard('perf', () => this._perfApply());
    }

    _perfApply() {
        const cfg = this.perfCfg || {};
        // the samples (car.onSample: every rpm / speed / gLong notification, demo 20 Hz)
        if (cfg.log && !this.perfS) {
            this.perfS = { gaps: { rpm: [], speed: [] }, last: {}, n: { rpm: 0, speed: 0, emit: 0 } };
            if (!this.perfListen) {          // once: the listener stays, idle while perfS is null
                this.perfListen = true;
                this.car.onSample((d, t) => { if (this.perfS) this._perfSample(d, t); }, () => { if (this.perfS) this.perfS.last = {}; });
            }
        }
        if (!cfg.log) this.perfS = null;
        if (cfg.log && !this.perfLogT) {
            this.perfL = this._perfFresh();
            let due = Date.now() + 20;
            this.perfLagT = setInterval(() => { const t = Date.now(); this.perfL.lag.push(t - due); due = t + 20; }, 20);
            const tick = this._tick, needle = this._needleTick;
            this._tick = function () {
                const t0 = Date.now(), L = this.perfL;
                if (L && L.tickAt) L.tick.push(t0 - L.tickAt);
                if (L) L.tickAt = t0;
                const r = tick.apply(this, arguments);
                if (L) L.tickMs.push(Date.now() - t0);
                return r;
            };
            this._needleTick = function () {
                const t0 = Date.now(), L = this.perfL;
                const r = needle.apply(this, arguments);
                if (L) L.needleMs.push(Date.now() - t0);
                return r;
            };
            this.perfLogT = setInterval(() => this._guard('perf log', () => this._perfLog()), PERF_LOG_MS);
        } else if (!cfg.log && this.perfLogT) {
            clearInterval(this.perfLogT); clearInterval(this.perfLagT);
            this.perfLogT = null; this.perfLagT = null; this.perfL = null;
            delete this._tick;               // back to the prototype's
            delete this._needleTick;
        }
    }

    _perfFresh() {
        return { t0: Date.now(), lag: [], tick: [], tickMs: [], needleMs: [], tickAt: 0, cpu: process.cpuUsage(),
            bytes: this.clients.map((c) => (c.sock && c.sock.bytesWritten) || 0) };
    }

    /** A car sample, for the log: rpm / speed changes and the gap to the last change. */
    _perfSample(d, t) {
        const S = this.perfS;
        S.n.emit++;
        ['rpm', 'speed'].forEach((k) => {
            const v = d[k];
            if (!isNum(v) || v === S.last[k]) return;
            const prevT = S.last[k + 'T'];
            S.last[k] = v; S.last[k + 'T'] = t;
            S.n[k]++;
            if (isNum(prevT) && S.gaps[k].length < 2000) S.gaps[k].push(t - prevT);
        });
    }

    _perfLog() {
        const L = this.perfL, S = this.perfS;
        if (!L) return;
        const now = Date.now(), secs = (now - L.t0) / 1000;
        const st = (a) => {
            if (!a.length) return '-';
            const s = a.slice().sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
            return 'p50 ' + q(0.5) + ' p90 ' + q(0.9) + ' p99 ' + q(0.99) + ' max ' + s[s.length - 1];
        };
        const cpu = process.cpuUsage(L.cpu), mem = process.memoryUsage();
        const bytes = this.clients.map((c, i) => Math.round((((c.sock && c.sock.bytesWritten) || 0) - (L.bytes[i] || 0)) / secs));
        const sig = (k) => (S ? (S.n[k] / secs).toFixed(1) + '/s (gap ms ' + st(S.gaps[k]) + ')' : '-');
        this.log.info('perf: ' + secs.toFixed(1) + ' s, layout ' + this.activeName + (this.needleT ? ', needles smooth' : ', needles on the tick') +
            '; car samples ' + (S ? (S.n.emit / secs).toFixed(1) : '-') + '/s, rpm changes ' + sig('rpm') + ', speed changes ' + sig('speed') +
            '; tick ms ' + st(L.tick) + ', JS in tick ms ' + st(L.tickMs) + ', JS in needle timer ms ' + st(L.needleMs) +
            '; loop lag ms ' + st(L.lag) + ' (>50: ' + L.lag.filter((x) => x > 50).length + ')' +
            '; bytes/s per connection ' + bytes.join(' ') + '; cpu ' + ((cpu.user + cpu.system) / (secs * 1e4)).toFixed(1) + ' %' +
            ', rss ' + (mem.rss / 1048576).toFixed(0) + ' MB, heap ' + (mem.heapUsed / 1048576).toFixed(0) + ' MB');
        if (S) { S.n = { rpm: 0, speed: 0, emit: 0 }; S.gaps = { rpm: [], speed: [] }; }
        this.perfL = this._perfFresh();
    }
    // ---- end PERF ----------------------------------------------------------------------------------------------------

    /** This drive's distance and moving time (the car's own data only; standing still doesn't count). */
    _trip(now) {
        const d = this._data(), dt = this.tripT ? Math.min(1000, now - this.tripT) : 0;
        this.tripT = now;
        if (d.demo || !isNum(d.speed) || d.speed < 2) return;
        this.tripKm += d.speed * dt / 3600000;
        this.tripMs += dt;
    }

    /** km/h: the average moving speed this drive, from the first minute on (null before it, 54 on the demo). */
    _avgSpeed() {
        if (this._data().demo) return 54;
        return this.tripMs >= 60000 ? this.tripKm / (this.tripMs / 3600000) : null;
    }

    /** BMW-like tach: a 120 ms filter, and a readout that moves in 50 rpm steps, only by 40 rpm or more. */
    _smoothRpm(now) {
        const test = this._testRpm(now);
        const raw = isNum(test) ? test : this._data().rpm;
        const dt = this.lastTickT ? Math.min(500, now - this.lastTickT) : 0;
        this.lastTickT = now;
        if (!isNum(raw)) { this.rpmF = null; this.rpmShown = null; return; }
        this.rpmF = isNum(this.rpmF) ? this.rpmF + (raw - this.rpmF) * (1 - Math.exp(-dt / 120)) : raw;
        if (!isNum(this.rpmShown) || Math.abs(this.rpmF - this.rpmShown) >= 40) this.rpmShown = Math.max(0, Math.round(this.rpmF / 50) * 50);
    }

    _update(x, now, force) {
        const w = x.w;
        // the automatic way back to the stock cluster (the owner, 2026-11-15): if drawing one of the three new
        // elements throws, that element goes back to BMW's instead of taking the tick (and the app) down with it
        const row = this._rowOf(w);
        if (row) {
            try { return this._updateOne(x, now, force); } catch (e) { this._rowFail(row, 'drawing threw: ' + (e && e.message || e)); return; }
        }
        return this._updateOne(x, now, force);
    }

    /** Which of the three new bottom-row elements a widget belongs to ("own:nav" / "own:sign" / "own:info" in its
     *  toggle or its hole condition), else null. */
    _rowOf(w) {
        const t = (w.toggle || '') + '|' + (typeof w.holeWhen === 'string' ? w.holeWhen : '');
        return t.indexOf('own:nav') >= 0 ? 'nav' : t.indexOf('own:sign') >= 0 ? 'sign' : t.indexOf('own:info') >= 0 ? 'info' : null;
    }

    _updateOne(x, now, force) {
        const w = x.w;
        if (w.type === 'atext') {
            if (!force && now - x.lastPaint < (w.rate || TEXT_MS)) return;
            const s = this._resolve(w.text);
            if (!force && s === x.last) return;
            x.last = s; x.lastPaint = now;
            if (w.exact) {          // 0.7.14: a "gpu" text's layer; the other one of the pair often stays empty: no message
                const codes = this._exactCodes(x, s), key = codes.join(',');
                x.codes = codes;
                if (!force && key === x.lastCodes) return;
                x.lastCodes = key;
                x.c.uniform(x.ref, 'u_text', codes, { type: 'vec4' });
                return;
            }
            x.c.uniform(x.ref, 'u_text', this._atlasCodes(x, s), { type: 'vec4' });
        } else if (w.type === 'text') {
            if (!force && now - x.lastPaint < (w.rate || TEXT_MS)) return;
            let s = this._resolve(w.text);
            // ---- fix/row-cc: a live "cc:" toggle that is off paints the widget empty (BMW's panel is open) ----
            x.ccHid = this._ccHidden(w);
            if (x.ccHid) s = '';
            // ---- end fix/row-cc ----
            // Bottom row: the car's own words. They are drawn in wb_road (the road label) and wb_msg (our message line),
            // which carry Ukrainian, Russian and Belarusian and the Latin accents of European street names (strip
            // packages F and the integration: tools/bake_fonts.py CAR_TEXT). A character still outside that set (Greek,
            // say) would come out as a hole; rather than draw that, the row gives itself back to the car, whole (the
            // owner's "way back", 2026-11-15; package X's all-or-nothing). Never a replacement glyph.
            const rowOf = this._rowOf(w);
            if (rowOf && s) {
                const miss = this._missingGlyphs(s, w.font);
                if (miss) { this._rowFail(rowOf, 'the font "' + w.font + '" has no glyph for ' + miss + ' of the car\'s text'); return; }
            }
            // package X: our message line - the marker or the hairline and segment AND the headline in ONE raster, so
            // "our text is on the screen" is one paint; only after it may BMW's panel be covered (_ccPainted, _ccOpen)
            if (w.ccLine) {
                const style = this._ccStyle(), sev = this._ccSeverity();
                const key = s + '|' + style + '|' + sev.name + '|' + sev.rgba.join(',');
                if (!force && key === x.last) return;
                x.last = key; x.lastPaint = now;
                this._blitDiff(x, this._ccLinePaint(w, s, style, sev));
                this._ccPainted(s);
                return;
            }
            // a road name or a message longer than its box is cut with "..." rather than clipped mid-letter.
            // A GUESS: no photo in docs/G20-DESIGN-SPEC.md shows the stock cluster truncating (§8), so how BMW
            // does it is unknown - this is the plainest thing that stays readable.
            if (rowOf && s) s = this._fitText(s, w);
            let role = w.color || 'fg';
            if (w.colorBy === 'verdict' && this.score.last) role = VERDICT[this.score.last.verdict] || role;
            // bottom row: a check-control text takes the colour the car asked for (cCColor), else its own role
            if (w.colorBy === 'cc') role = this._ccRole() || role;
            if (w.near && this._nearMark(w.near[0]) === w.near[1]) role = w.nearColor || 'fg';
            // a readout slot goes red / blue at the shift point only while it shows engine speed or the shift point
            const shiftish = !w.slot || ['rpm', 'shiftAt'].indexOf((this.slotSensor(this.activeName, w.slot, this.layoutSlots) || {}).id) >= 0;
            if ((w.hotWhen || w.coldWhen) && shiftish) {
                const sp = this._shift();
                if (w.coldWhen && sp[w.coldWhen]) role = VERDICT.COLD;
                if (w.hotWhen && sp[w.hotWhen]) role = 'hot';
            }
            // over its warning limit: the value flashes in the shift red
            // ("warnFlash": false: not on a tile that turns red itself, the Dyno theme's)
            if (w.warnFlash !== false && this._warning(w) && Math.floor(now / WARN_FLASH_MS) % 2 === 0) role = 'hot';
            const key = s + '|' + role;
            if (!force && key === x.last) return;
            x.last = key; x.lastPaint = now;
            // "fit": smaller fonts to fall back on when the text is wider than the box (a readout slot showing a
            // longer value than its default) or has a character the font lacks (Retro's seven-segment digits have no
            // letters, + or °), on the same baseline
            let font = w.font, offsetY = 0;
            const has = (n) => { const g = textRaster.loadFont(n).metrics.glyphs; return s.split('').every((ch) => ch === ' ' || g[ch]); };
            if (w.fit && (textRaster.measure(s, font, w.spacing) > w.w || !has(font))) {
                const f = w.fit.find((n) => has(n) && textRaster.measure(s, n, w.spacing) <= w.w) || w.fit[w.fit.length - 1];
                offsetY = textRaster.loadFont(w.font).metrics.baseline - textRaster.loadFont(f).metrics.baseline;
                font = f;
            }
            const buf = textRaster.drawText(w.w, w.h, s, {
                font, offsetY, color: color(this.theme, role), align: w.align, spacing: w.spacing,
                color2: w.color2 && role !== 'hot' ? color(this.theme, w.color2) : null,
                glow: w.glow ? this.theme.glow : 0,
            });
            this._blitDiff(x, buf);
        } else if (w.type === 'tiles') {
            // per tile: its bar (the slot's sensor, TILE_BAR) and whether that reading is over its warning limit
            const list = this._tiles(w), vals = [];
            let key = '';
            for (let i = 0; i < TILE_MAX; i++) {
                const b = list[i];
                let v = -1, warn = 0, z = 0;
                if (b) {
                    const sn = b.slot ? this.slotSensor(this.activeName, b.slot, this.layoutSlots) : null;
                    const bar = sn && b.bar !== false ? TILE_BAR[sn.id] : null;
                    if (bar) {
                        let raw = this._raw(bar.raw);
                        if (bar.abs && isNum(raw)) raw = Math.abs(raw);
                        const max = bar.max === 'rpm' ? this._barMax() : bar.max;
                        v = isNum(raw) ? Math.round(Math.min(1, Math.max(0, (raw - bar.min) / (max - bar.min))) * 200) / 200 : 0;
                        z = bar.z ? 1 : 0;
                    }
                    warn = sn && this._overLimit(sn.id) ? 1 : 0;
                }
                vals.push(v, warn, z, 0);
                key += v + ',' + warn + ',' + z + ';';
            }
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_tileV', vals, { type: 'vec4' });
        } else if (w.type === 'gmeter') {
            // the car's lateral g is + turning left, longitudinal + speeding up (G-Force's labels). Drawn as G-Force
            // draws it: the dot moves the way the car accelerates, into the turn and up when speeding up (the shader
            // draws + x right, + y down). The settings "gFlipLat" / "gFlipLong" swap left / right and accel / brake;
            // a layout's "flipX" / "flipY" swap again on top
            // range and envelope go only when they change; the trail with every move of the dot (its first point)
            const S = this._gSigns(w), gx = this._raw('gLat'), gy = this._raw('gLong');
            const q = (v) => Math.round(v * 50) / 50;
            const qx = isNum(gx) ? q(S[0] * gx) : 0, qy = isNum(gy) ? q(S[1] * gy) : 0;
            const max = this._gRange(w), step = max > 1.2 ? 0.5 : 0.25;
            const envKey = this.gEnvAt + '|' + S.join(',');
            const tr = this.gTrail, trKey = tr.length ? qx + ',' + qy + '|' + tr[0][0] + '|' + tr.length + '|' + S.join(',') : 'none';
            const key = qx + '|' + qy + '|' + max + '|' + envKey + '|' + trKey;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_g', [qx, qy]);
            if (force || x.gMax !== max) { x.gMax = max; x.c.uniform(x.ref, 'u_max', [max]); x.c.uniform(x.ref, 'u_step', [step]); }
            if (force || x.gEnvKey !== envKey) {
                x.gEnvKey = envKey;
                x.c.uniform(x.ref, 'u_env', this._gEnvDrawn(S), { type: 'vec4' });
            }
            if (force || x.gTrKey !== trKey) {
                // point 0 is the dot itself, so the trail joins it; then the samples, newest first
                x.gTrKey = trKey;
                const pts = [qx, qy];
                tr.forEach((p) => pts.push(q(S[0] * p[1]), q(S[1] * p[2])));
                const n = tr.length ? pts.length / 2 : 0;
                while (pts.length < 32) pts.push(0);
                x.c.uniform(x.ref, 'u_trail', pts, { type: 'vec4' });
                x.c.uniform(x.ref, 'u_trailN', [n]);
            }
        } else if (w.type === 'shiftbar' || w.type === 'revarc') {
            const rpm = this._raw('rpm');
            const segs = w.segments || (w.type === 'revarc' ? 30 : 40);
            const v = isNum(rpm) ? Math.min(1, Math.max(0, rpm / this._barMax())) : 0;
            const q = Math.round(v * segs * 2) / (segs * 2);        // only resend on half-segment steps
            const key = q + (this.flash ? 'f' : '');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            x.c.uniform(x.ref, 'u_flash', [this.flash ? 1 : 0]);
        } else if (w.type === 'arc' || w.type === 'meter') {
            // a meter with a "slot" (Dyno) shows the bar of whatever sensor that readout slot shows (TILE_BAR)
            let sig = w.signal, mn = w.min, mx = w.max, ab = false;
            if (w.slot) {
                const sn = this.slotSensor(this.activeName, w.slot, this.layoutSlots);
                const bar = sn ? TILE_BAR[sn.id] : null;
                sig = bar ? bar.raw : null; mn = bar ? bar.min : 0; mx = bar ? (bar.max === 'rpm' ? this._barMax() : bar.max) : 1; ab = !!(bar && bar.abs);
            }
            let raw = sig ? this._raw(sig) : null;
            if (ab && isNum(raw)) raw = Math.abs(raw);
            const v = isNum(raw) && mx !== mn ? Math.min(1, Math.max(0, (raw - mn) / (mx - mn))) : 0;
            const q = Math.round(v * 200) / 200;
            const pk = w.peak ? this._peakHold(x, q, now, w.peak) : -1;
            const key = q + '|' + pk;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [q]);
            if (w.peak) x.c.uniform(x.ref, 'u_peak', [pk > q ? pk : -1]);
        } else if (w.type === 'fill' && typeof w.holeWhen === 'string' && /[:&!]/.test(w.holeWhen)) {
            // bottom row: a fill whose hole follows a live toggle (the road label's black bar opens for BMW's own
            // check-control text while the info field is BMW's)
            const h = this._hole(w), key = h.join(',');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_hole', h);
        } else if (w.type === 'wbsign') {
            const ab = this._signShow(), a = ab[0], b = ab[1];
            const key = a + '|' + b;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_show', [a, b]);
        } else if (w.type === 'wbmsa') {
            const m = this._raw('msa') || 0;        // car3 I: 0 hidden, 1 active (hidden too), 2 off, 3 stopped by MSA, 4 unavailable
            if (!force && m === x.last) return;
            x.last = m;
            x.c.uniform(x.ref, 'u_msa', [m, 0, 0, 0]);
        } else if (w.type === 'wbback') {
            if (w.collar) this._wbMaskSend(x);                                     // package M: the strip mask's lanes
            this._wbCcSend(x);                                                     // and the message window
            const on = w.sign && (isNum(this._raw('limit')) || this._raw('limitEnd') || this._raw('limitUnknown')) ? 1 : 0;   // package E: the end sign too; car3 I: "---"
            if (!force && on === x.last) return;
            x.last = on;
            x.c.uniform(x.ref, 'u_sign', on ? w.sign : [0, 0, 0]);
        } else if (w.type === 'g20dial') {
            const raw = this._raw(w.measure === 'rpm' ? 'rpm' : w.measure === 'speed' ? 'speed' : w.signal);
            const mn = isNum(w.min) ? w.min : 0, mx = isNum(w.max) ? w.max : 1;
            const q = isNum(raw) ? Math.round(Math.min(1, Math.max(0, (raw - mn) / (mx - mn))) * 2000) / 2000 : 0;
            if (!force && q === x.last) return;
            x.last = q;
            x.c.uniform(x.ref, 'u_val', [q, 0, 0, 0]);
        } else if (w.type === 'dial') {
            const D = this._dialScale(w), us = this.setting('units') === 'us';
            let raw = this._raw(w.measure === 'rpm' ? 'rpm' : w.measure === 'speed' ? 'speed' : w.signal);
            if (w.measure === 'speed' && isNum(raw) && us && !w.kmh) raw *= 0.621371;
            const mn = isNum(w.min) ? w.min : 0;
            let v = isNum(raw) ? Math.min(1, Math.max(0, (raw - mn) / (D.max - mn))) : 0;
            // a rev dial with an OFF mark ("off" degrees before 0): the needle parks at READY or at OFF while the
            // engine stands (car3 I; audit/features: _restFrac decides which, not only config.msa)
            if (w.off && w.measure === 'rpm' && !(isNum(raw) && raw >= 150)) v = this._restFrac(w);
            const q = Math.round(v * 1000) / 1000;
            const hot = w.measure === 'rpm' && this._shift().now ? 1 : 0;
            // The red over-speed marking on the speed scale: from the limit TO THE NEEDLE (u_dyn.yz is the band
            // WBDIAL draws, so .z is the needle's own fraction `q`). MEASURED on the F30, 2026-11-15
            // (reference/6wb/12, docs/F30-FONT-SPEC.md 9.2): with a 60 limit and the needle at 80.19, the marking's
            // leading edge is at 59.3 and its trailing edge at 77.4 - the needle is drawn over the end. The bottom-row
            // package had sent .z = 1 (the scale's end) instead, which painted a horseshoe from the limit to 260.
            // When it is drawn at all is _arcOn() - the CAR's own excess-speed verdict, not ours.
            let over = [-1, -1];
            if (w.look === 'wb' && w.measure === 'speed' && this._arcOn()) {
                let lim = this._raw('limit');
                if (isNum(lim)) {
                    if (us && !w.kmh) lim *= 0.621371;
                    over = [Math.round(Math.min(1, Math.max(0, (lim - mn) / (D.max - mn))) * 1000) / 1000, q];
                }
            }
            let fillA = null;
            if (w.fill && w.look === 'wb') {
                const f = w.fill, fv = this._raw(f.of);
                const k = isNum(fv) ? Math.max(0, Math.min(1, fv / (f.max || 1))) : 0;
                const fk = Math.round(k * 200);
                if (force || fk !== x.lastFill) {
                    x.lastFill = fk;
                    const r = Math.PI / 180;
                    fillA = k > 0 ? [f.from * r, (f.from + (f.to - f.from) * k) * r] : [0, 0];
                }
            }
            if (w.look === 'wb' && x.wbFill && fillA) {
                x.wbFill = [fillA[0], fillA[1], x.wbKind, 0];
                x.c.uniform(x.ref, 'u_fill', x.wbFill);
            }
            if (w.look === 'wb' && w.cut && w.cut.round && w.cut.cover === 'limit') {
                // The round window over BMW's own sign. Bottom row package: the "bottomRow" setting decides, not what
                // the car sends. "all6WB" closes it (3): our sign is the only one, and while the car has sent nothing
                // the spot stays black. "allG20" (the default) leaves it open (1), exactly as before this package, so
                // BMW draws the sign and our WBSIGN layer is not even built (the layout's "own:sign" toggle).
                // 2026-11-14: closed too while the car stands in P with the engine off (taken then for BMW's standby
                // screen, which draws no sign: the window showed a bar of its bottom line (y ~645) that the sign
                // otherwise covers). That was WRONG: in P with the engine off BMW draws its normal row and its sign
                // (photos 62, 63); only its real standby draws none. An auto start/stop stop is in D, so BMW's sign
                // still shows at the lights.
                // package X (package P's photos 63, 64: P with the engine off and BMW still draws its sign): closed in
                // BMW's STANDBY only (vehicle condition COND_STANDBY), not in every "P, engine off"
                const parked = this._standbyNow();
                const m = this._own('sign') || parked ? 3 : 1;
                if (force || m !== x.cutMode) { x.cutMode = m; x.c.uniform(x.ref, 'u_cut', this._cutVec(w, m)); }
            }
            if (w.look === 'wb' && w.cut && w.cut.box && w.cut.boxWhen === 'ccMarker') {
                // strip integration, decision 7: the tacho's box window over BMW's marker, only while it is confirmed shown
                const m = this._markShown() ? 2 : 0;
                if (force || m !== x.cutMode) { x.cutMode = m; x.c.uniform(x.ref, 'u_cut', this._cutVec(w, m)); }
            }
            const key = q + '|' + hot + '|' + over.join(',');
            if (!force && key === x.last) return;
            x.last = key;
            if (w.look === 'wb') {
                x.wbDyn = [q, over[0], over[1], hot];
                x.c.uniform(x.ref, 'u_dyn', x.wbDyn);
            } else {
                x.c.uniform(x.ref, 'u_value', [q]);
                x.c.uniform(x.ref, 'u_hot', [hot]);
            }
        } else if (w.type === 'sdash') {
            const us = this.setting('units') === 'us';
            const sp = this._raw('speed'), rpm = this._raw('rpm'), fuel = this._raw('fuel'), oil = this._raw('oil');
            const q = (v) => Math.round(Math.min(1, Math.max(0, v)) * 500) / 500;
            const vals = [
                q(isNum(sp) ? scaleFrac(us ? sp * 0.621371 : sp, SPEED_SCALE[us ? 'us' : 'metric']) : 0),
                q(isNum(rpm) ? rpm / (w.rpmMax || 8000) : 0),
                q(isNum(fuel) ? fuel : 0),
                q(isNum(oil) ? (oil - 50) / 100 : 0),
            ];
            const key = vals.join('|');
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_speed', [vals[0]]);
            x.c.uniform(x.ref, 'u_rpm', [vals[1]]);
            x.c.uniform(x.ref, 'u_fuel', [vals[2]]);
            x.c.uniform(x.ref, 'u_oil', [vals[3]]);
        } else if (w.type === 'mdash') {
            const vals = x.gauges.map(([u, G]) => {
                const v = G.signal ? this._raw(G.signal) : null;
                return [u, G, isNum(v) ? Math.round(Math.min(1, Math.max(0, (v - G.min) / (G.max - G.min))) * 200) / 200 : 0];
            });
            // the setup level bars: the segment at round(signal) is lit (1-based; 0 = none)
            const lit = [0, 1, 2, 3].map((i) => {
                const s = x.bars[i], v = s && s.signal ? this._raw(s.signal) : null;
                return s && isNum(v) ? Math.max(0, Math.min(s.max || 1, Math.round(v))) : 0;
            });
            const key = vals.map((v) => v[2]).join('|') + '|' + lit.join('|');
            if (!force && key === x.last) return;
            x.last = key;
            vals.forEach(([u, G, v]) => x.c.uniform(x.ref, u, [G.cx || 0, G.cy || 0, G.r || 0, v]));
            x.c.uniform(x.ref, 'u_segLit', lit);
        } else if (w.type === 'mtach') {
            const rpm = this._raw('rpm'), sp = this._shift();
            const v = isNum(rpm) ? Math.min(1, Math.max(0, rpm / (w.max || 8000))) : 0;
            const key = Math.round(v * 600) + '|' + sp.now;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [v]);
            x.c.uniform(x.ref, 'u_shiftNow', [sp.now ? 1 : 0]);
        } else if (w.type === 'segbar') {
            const v = this._raw(w.signal);
            const lit = isNum(v) ? Math.max(0, Math.min(w.max, Math.round(v))) : 0;
            if (!force && lit === x.last) return;
            x.last = lit;
            x.c.uniform(x.ref, 'u_lit', [lit]);
        } else if (w.type === 'revbar') {
            const rpm = this._raw('rpm'), sp = this._shift();
            const v = isNum(rpm) ? Math.round(Math.max(0, rpm) / 10) * 10 : 0;
            const peak = Math.round(this.score.peak / 10) * 10;
            const key = v + '|' + sp.rpm + '|' + peak + '|' + sp.now;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_value', [v]);
            x.c.uniform(x.ref, 'u_shift', [sp.rpm]);
            x.c.uniform(x.ref, 'u_peak', [peak]);
            x.c.uniform(x.ref, 'u_shiftNow', [sp.now ? 1 : 0]);
        } else if (w.type === 'lights') {
            const rpm = this._raw('rpm'), sp = this._shift(), n = w.count || 12;
            // the lights fill from "from" rpm (3000) up to the shift point; a "from" at or past it means the last 500 rpm
            const from = Math.min(isNum(w.from) ? w.from : 3000, sp.rpm - 500);
            const lit = isNum(rpm) ? Math.floor(Math.min(1, Math.max(0, (rpm - from) / (sp.rpm - from))) * n) : 0;
            const key = lit + '|' + sp.now;
            if (!force && key === x.last) return;
            x.last = key;
            x.c.uniform(x.ref, 'u_lit', [lit]);
            x.c.uniform(x.ref, 'u_strobe', [sp.now ? 1 : 0]);
        }
    }

    /** "x/y" at every step, uploaded as small rects (not the whole, mostly empty, image). */
    _paintGridLabels(x) {
        const w = x.w, W = w.w, H = w.h, step = w.step || 100, font = w.font;
        const cell = textRaster.loadFont(font).metrics.cellHeight;
        const rects = [], parts = [];
        for (let gy = 0; gy < H; gy += step) {
            for (let gx = 0; gx < W; gx += step) {
                const label = (w.x + gx) + '/' + (w.y + gy);
                const lw = Math.min(W - gx - 2, textRaster.measure(label, font, 0) + 2);
                const lh = Math.min(H - gy - 2, cell);
                if (lw <= 0 || lh <= 0) continue;
                const buf = textRaster.drawText(lw, lh, label, { font, color: [255, 230, 0, 255] });
                rects.push({ x: gx + 2, y: gy + 2, w: lw, h: lh });
                parts.push(buf);
            }
        }
        this._blit(x, rects, Buffer.concat(parts));
    }

    _paintStripe(x) {
        const w = x.w, buf = Buffer.alloc(w.w * w.h * 4, 0);
        for (let px = 0; px < w.w; px++) {
            const c = M_STRIPE[Math.min(2, Math.floor(px * 3 / w.w))];
            for (let py = 0; py < w.h; py++) c.forEach((v, i) => { buf[(py * w.w + px) * 4 + i] = v; });
        }
        this._blit(x, null, buf);
    }

    _paintScale(x) {
        const w = x.w, n = this._barMax(w) / 1000 + 1, red = this._redline();
        const m = Buffer.alloc(w.w * w.h, 0), hot = Buffer.alloc(w.w * w.h, 0);
        for (let i = 0; i < n; i++) {
            const label = String(i);
            const lw = textRaster.measure(label, w.font, 0);
            const cx = i / (n - 1) * w.w;
            const left = Math.round(Math.max(0, Math.min(w.w - lw, cx - lw / 2)));
            const one = textRaster.mask(w.w, w.h, label, { font: w.font, x: left });
            const into = w.redFrom && i * 1000 >= red ? hot : m;
            for (let k = 0; k < m.length; k++) if (one[k] > into[k]) into[k] = one[k];
        }
        const buf = textRaster.tint(m, w.w, w.h, { color: color(this.theme, w.color || 'dim'), font: w.font });
        if (w.redFrom) {
            const hb = textRaster.tint(hot, w.w, w.h, { color: this.theme.hot, font: w.font });
            for (let k = 0; k < hot.length; k++) if (hot[k]) hb.copy(buf, k * 4, k * 4, k * 4 + 4);
        }
        this._blit(x, null, buf);
    }
}

/** A theme with its whites and greys (any colour with little tint) at k brightness; colours keep theirs. */
function dimTheme(theme, k) {
    const out = {};
    Object.keys(theme).forEach((key) => {
        const c = theme[key];
        const grey = Array.isArray(c) && c.length >= 3 && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 40;
        out[key] = grey ? [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)].concat(c.length > 3 ? [c[3]] : []) : c;
    });
    out.name = theme.name;
    return out;
}

/** 2026-11-14: a night look's transform as WBDIAL's / WBBACK's u_nk0..2 (rows: red's, green's, blue's image, then the
 *  grey's); null: the identity. */
function lookRows(L) {
    if (!L) return [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]];
    return [0, 1, 2].map((i) => [L.r[i], L.g[i], L.b[i], L.w[i]]);
}

/** A 0..255 colour through a night look: what shaders.js nightLook does to it on the GPU. Alpha kept. */
function lookColour(c, L) {
    const g = Math.min(c[0], c[1], c[2]), v = [c[0] - g, c[1] - g, c[2] - g];
    const out = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(v[0] * L.r[i] + v[1] * L.g[i] + v[2] * L.b[i] + g * L.w[i]))));
    return c.length > 3 ? out.concat(c.slice(3)) : out;
}

/** A theme through a night look: every colour, the ones in its nested groups (bar, rev) too. */
function lookTheme(theme, L) {
    const isColour = (c) => Array.isArray(c) && c.length >= 3 && c.length <= 4 && c.every((v) => typeof v === 'number');
    const map = (o) => {
        const out = {};
        Object.keys(o).forEach((k) => {
            const c = o[k];
            out[k] = isColour(c) ? lookColour(c, L) : c && typeof c === 'object' && !Array.isArray(c) ? map(c) : c;
        });
        return out;
    };
    return map(theme);
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }
function mib(bytes) { return (bytes / 1048576).toFixed(1) + ' MiB'; }

// ---- car3 K: how a switch treats the panel's slot (docs/CAR3-K-REPORT.md) -------------------------------------------
// OFF unless <data dir>/car3k.json says { "slot": "keep" } or { "slot": "reseat" } (read at every rebuild, so it can be
// set and cleared on the car without a reinstall; delete the file to go back). Without the file nothing here runs and
// the app behaves exactly as before.
// Why: BMW's black box over the tacho hub (overlay.black_box) was absent when the theme was already on at start-up and
// present later in the same drive. cluster-render puts every layer of every client into one scene in slot 0x203 and asks
// the KOMBI for that slot while any layer wants it, releasing it panel_linger_ms (3 s) after none does. A rebuild drops
// all our layers and makes the new ones a few ms later (the bench: 0-25 ms), so a switch normally keeps the slot; what
// the KOMBI does with a fresh mapping is not known. The two modes are the two car tests:
//   keep    a tiny transparent effect layer on its own connection (index KEEP_CONN), made before the first drop and
//           kept across rebuilds, so our app never lets cluster-render release and re-ask the slot during a switch
//           (dropped while the layout is "off" or unusable, so BMW's own cluster and the HUD get the slot as today).
//   reseat  a switch to another layout (picked, or by drive mode) is built the way start-up builds it: every layer is
//           dropped, the slot is left to be released (target idle, at least RESEAT_MIN_MS, at most RESEAT_MAX_MS), and
//           only then is the new layout made, so the KOMBI maps our scene afresh. BMW's own cluster shows meanwhile.
const CAR3K_FILE = 'car3k.json';
const CAR3K_KEEP_CONN = 3;                 // the fourth connection (<app id>_4): no layout uses it, so the keeper takes no layout's slot
const CAR3K_RESEAT_MIN_MS = 3800;          // cluster-render's panel_linger_ms (3000) plus a margin
const CAR3K_RESEAT_MAX_MS = 7000;          // give up waiting for 'idle' (a target event may not reach a client with no layer)
const CAR3K_KEEP_FS = 'precision mediump float;\nvarying vec2 v_uv;\nvoid main() { gl_FragColor = vec4(0.0) * v_uv.x; }\n';
{
    const inner = HudApp.prototype._rebuildInner;
    const modeOf = (app) => {
        let m = null;
        try { m = JSON.parse(fs.readFileSync(path.join(app.ctx.dataDir || '.', CAR3K_FILE), 'utf8')).slot; } catch (e) { /* no file: off */ }
        m = m === 'keep' || m === 'reseat' ? m : null;
        if (m !== app.car3kMode) { app.car3kMode = m; app.log.info('car3 K: slot mode ' + (m || 'off (as before)')); }
        return m;
    };
    const keep = (app, on) => {
        const k = app.car3kKeeper;
        if (!on) {
            if (k) { app._guard('car3 K keeper drop', () => k.c.drop(k.ref)); app.car3kKeeper = null; app.log.info('car3 K: keeper dropped'); }
            return;
        }
        if (k) return;
        const c = app._clientAt(CAR3K_KEEP_CONN);
        const ref = c.effect({ target: app.target, klass: 'ambient', z: -1000, x: 0, y: 0, w: 1, h: 1, prewarm: 1, fs: CAR3K_KEEP_FS });
        if (!ref) { app.log.warn('car3 K: keeper layer refused'); return; }
        app.car3kKeeper = { c, ref };
        app.log.info('car3 K: keeper layer made on connection ' + (CAR3K_KEEP_CONN + 1) + ' (keeps the panel wanted across rebuilds)');
    };
    HudApp.prototype._rebuildInner = function () {
        const mode = modeOf(this), fresh = this.car3kFresh === true;
        this.car3kFresh = false;
        if (!this.client.ready) return inner.call(this);
        const next = this._layoutName(), drawn = (n) => !!n && n !== 'off';
        if (mode !== 'keep' && this.car3kKeeper) keep(this, false);
        if (this.car3kReseatT) {                  // waiting for the slot's release: the timer builds what is asked for then
            if (mode === 'reseat') return undefined;
            clearTimeout(this.car3kReseatT); this.car3kReseatT = null;
        }
        if (mode === 'keep') {
            let usable = drawn(next);
            if (usable) { try { this.layouts.load(next); } catch (e) { usable = false; } }
            if (usable) keep(this, true);
            const r = inner.call(this);
            if (!usable) keep(this, false);
            return r;
        }
        const ts = this.targetState;
        if (mode === 'reseat' && !fresh && drawn(this.activeName) && drawn(next) && next !== this.activeName &&
            (!ts || ts.state === 'shown' || ts.state === 'lingering')) {      // !ts: no target event yet (the bench sends none)
            const from = this.activeName, t0 = Date.now();
            this._layerRefs().forEach((r) => this._guard('car3 K drop', () => r.c.drop(r.ref)));
            this.placed = []; this.widgets.clear(); this.sheets = []; this.layerStates.clear();
            this.log.info('car3 K: reseat "' + from + '" -> "' + next + '": all layers dropped, waiting for the slot to be released');
            const wait = () => {
                const s = this.targetState && this.targetState.state, dt = Date.now() - t0;
                if (dt < CAR3K_RESEAT_MIN_MS || (dt < CAR3K_RESEAT_MAX_MS && s !== 'idle')) { this.car3kReseatT = setTimeout(wait, 250); return; }
                this.car3kReseatT = null;
                this.log.info('car3 K: reseat: building after ' + dt + ' ms (target ' + (s || 'unknown') + ')');
                this.car3kFresh = true;          // this one builds, whatever the (possibly stale) target state says
                this._rebuild();
            };
            this.car3kReseatT = setTimeout(wait, 250);
            return undefined;
        }
        return inner.call(this);
    };
}
// ---- end car3 K ----------------------------------------------------------------------------------------------------

// "+ G20" as a toggle (docs/ONE-SWITCH-DONE.md): the maps and the keys menu.js, gallery.js and the app's own
// migration need, so there is one source of truth for them.
HudApp.G20_OF = G20_OF;
HudApp.G20_THEME = G20_THEME;
/** A layout file as the driver's theme: a see-through file -> the theme it belongs to, anything else unchanged. */
HudApp.themeOf = (name) => G20_THEME[name] || name;
HudApp.ROW_KEY = ROW_KEY;
HudApp.ROW_OURS = ROW_OURS;
HudApp.ROW_BMW = ROW_BMW;

module.exports = HudApp;
