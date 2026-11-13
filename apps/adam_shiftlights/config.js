'use strict';
/* ===================== EDIT HERE =====================
 * Every tunable of the shift lights lives in this file. Change numbers here only: app.json settings only
 * switch things on the car (a threshold setting of 0 means "the value here"), and test/config.test.js checks
 * that app.json's defaults match this file.
 * Values come from docs/mockups/shiftlights-v4-oem.html (cluster) and docs/mockups/hud-m-style.html (HUD).
 * [U] = a guess until Adam's photos / car day. Node 8: plain ES2017 only.
 *
 * Displays: "HUD" and "Instrument cluster" are two on/off settings; each shows the style picked in the in-car
 * settings ("Cluster: style", "HUD: style"), independently. A slat bar is described at its base (bottom edge): `inner` = axis to the
 * innermost slat's inner edge, then `perSide` slats of width `slat` every `pitch` px; `shear` = how far the
 * top edge moves (px): 'mirror' = toward the axis on both sides ('/' left, '\' right), 'same' = right on
 * both sides ('/'), 'none' = upright. `palette` = one side in lighting order (outer end first when the fill
 * is inward); a bar with a centre slat (`centre` = its half width) gives it the palette's last letter.
 * `reds` = how many of the palette's last fields light together at the shift point.
 */
module.exports = Object.freeze({
    engine: {
        idle: 750,              // rpm at idle (unused since 0.4.0 dropped the preview; kept so configs still check)
        limitWarm: 7000,        // the engine's allowed maximum, warm (rpm)
        limitCold: 4500,        // the allowed maximum with the oil fully cold (rpm)
        oilCold: 30,            // at or below this oil temperature (C) the limit is limitCold
        oilWarm: 80,            // at or above this oil temperature (C) the limit is limitWarm; linear in between
        shiftBelowLimit: 150,   // a shift point never sits closer than this to the current limit (rpm)
        limiterBand: 100,       // the whole bar flashes red from the shift point, or from this far under the limit if lower (rpm)
        hysteresisRpm: 50,      // a light, red or flash goes off only this far under where it came on (no flicker)
    },
    modes: {                    // per drive mode: first light at `start`, all red at `shift` (rpm)
        comfort: { start: 4000, shift: 5000 },     // an earlier shift hint
        sport: { start: 6000, shift: 6800 },       // OEM guess (Sport = Sport+)
        sportplus: { start: 6000, shift: 6800 },
    },
    driveMode: 'sport',         // the drive mode when the car sends none (FES drive experience signal; app.json default too)
    styles: { cluster: 'large', hud: 'large' },   // the style settings' defaults (app.json too)
    sizeSteps: [70, 80, 90, 100, 110, 120],       // "size" setting steps (%): the cluster bar about its centre, the HUD art about (hud.centerX, hud.anchorY)
    brightSteps: [20, 40, 60, 80, 100],           // "brightness" setting steps (%)
    nightDim: 0.35,             // "night dim" on (or Auto while the car says night): brightness x this [U]
    nightHoldMs: 5000,          // Auto: the car's day / night must hold this long before the brightness follows (the first value: at once)
    flashHz: 4,                 // the shift flash (0.4.2: from the shift point on), on half / off half per cycle (4 to 20) [U];
                                // Flash mode App (0.4.3 default) never toggles faster than 4 Hz (8 sends a second)
    brightness: 1.0,            // 0..1, multiplies every lit colour on the cluster and HUD (with the settings)
    // the HUD art (hudStyles, drawn centred on scene x 400) goes centred on the stock speed block: centerX = its
    // centre, anchorY = the bottom of our art (the stock speed sits under it). A bigger size grows upward. [U]
    // visible: the widest picture the HUD shows, 680 x 300 inside the 800 x 480 scene (idrive-apps PR #41: "wider is cut
    // off at the HUD's edges"); assumed centred, as in docs/mockups/hud-m-style.html [U]. The shift bar is held inside it
    // minus barMargin (px). defaults: what a fresh install starts with (Adam's tuned values, 2026-11-04: 80 px left, 60 px
    // down, 110 %, lines up with the stock mph); 0.4.3 moves a saved old default (100 %, centre, bar +70) to these once
    // (logic.migrateSettings). barX: the "Shift bar left / right" default, the smallest step that keeps the bar's left end
    // barMargin inside the visible box at those values: 0 since 0.4.3's bar (394 x 1.1 wide, left end at 103.2 >= 68; the
    // 0.4.2 bar, 578 wide, needed +70). test/hud041.test.js recomputes it.
    hud: { centerX: 400, anchorY: 260, visible: { x0: 60, y0: 90, x1: 740, y1: 390 }, barMargin: 8,
        defaults: { size: 110, x: -80, y: 60, barX: 0 } },
    // "HUD: move left / right" and "up / down" setting steps (scene px; negative = left / up), app.json too. barX: the
    // shift bar's own move on top of the HUD move (left / right)
    nudge: { x: [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        y: [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60],
        barX: [-100, -95, -90, -85, -80, -75, -70, -65, -60, -55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0,
            5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100] },
    // "Cluster: move left / right" and "up / down" setting steps (panel px from the style's cx, cy; negative = left / up),
    // app.json too. Kept small: the dial numerals sit either side of the bar [U]
    clusterNudge: { x: [-50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
        y: [-40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40] },
    colors: {
        y: '#ffc20e', o: '#ff7a00', r: '#ff2b1f', w: '#f2f5f8',   // centre row, small HUD cells, stock blocks
        a: '#ffa800', c: '#ff1a22',                               // cluster M slats large: amber, red
        A: '#f3ab10', C: '#ee1c25',                               // cluster M slats small (and the stock blocks' red)
        Y: '#ffd000', O: '#ff7000', R: '#ff1a14',                 // HUD bar
        cream: '#ebecc8', rail: '#fbfbe8', zy: '#eef0a8', zr: '#ee6a64',   // HUD bracket: fill, rail, red-zone marks
    },
    // where the cluster style goes on the map target when both displays show (panel and hud share one scene):
    // the panel rect moved by this, y at least minY [U]
    mapOffset: { x: 416, y: 126, minY: 8 },
    // on the 1920x720 panel, axis x 960 (cy = the bar's centre y). The slat styles sit 25 px lower than the mockup
    // (0.3.1, Adam's car test 2026-11-04: "need to move down a little"); the move settings go from there
    clusterStyles: {
        large: { palette: 'aaaaaaaacc', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15.6, pitch: 18.6, inner: 36,
            centre: 0, h: 82.8, shear: 29.81, cx: 960, cy: 175, glow: 30, dim: 0.2 },        // M slats large: 438 x 83 at 741,134
        classic: { palette: 'AAAAAAAACC', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15, pitch: 18, inner: 30,
            centre: 0, h: 46, shear: 22.08, cx: 960, cy: 175, glow: 0, dim: 0.13 },           // M slats small: 414 x 46 at 753,152
        row: { palette: 'yyyoor', reds: 1, fill: 'inward', lean: 'none', perSide: 6, slat: 25, pitch: 29, inner: 2,
            centre: 0, h: 22, shear: 0, cx: 960, cy: 170, glow: 0, dim: 0 },                   // centre row: 12 fields, 344 x 22 at 788,159
        stock: { palette: 'yoC', reds: 1, fill: 'inward', lean: 'mirror', stage: true, perSide: 1, slat: 40, pitch: 40, inner: 205.3,
            centre: 0, h: 92, shear: 50.6, cx: 960, cy: 185, glow: 14, dim: 0 },               // one block a dial: yellow, orange, red [U]
    },
    hudStyles: {                // on the 800x480 HUD scene, centred on x 400 (moved to hud.centerX when drawn)
        // 0.4.3 (Adam: "i want it to look the same it looks on the IC"): the cluster's Large M slats (palette, 10 a side,
        // mirrored lean, centre gap, dim) with every length x 0.9: the largest scale that keeps the bar inside the visible
        // box at every size step with the default 60 px down (at 120 % its top is at y 91.4). Its base stays 8 px over the
        // bracket (y 144). glow stays 13 (the cluster's is 30): more would cover the bracket under it.
        // idle: the unlit slats always show at dim (an idle car shows the bar, not nothing)
        bar: { palette: 'aaaaaaaacc', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 14.04, pitch: 16.74, inner: 32.4,
            centre: 0, h: 74.52, shear: 26.829, cx: 400, cy: 106.74, glow: 13, dim: 0.2, idle: true },   // 394 x 75 at 203,69
        // shortcut: no style draws these in-bracket cells since 0.4.2 (Small was them); pad still sizes the bracket's rect
        // and FS_BRACKET keeps its cell code unused, so the GPU program the car compiled is unchanged. Drop both with
        // the next FS_BRACKET change. gap = share of a cell, pad = u past the bar
        cells: { palette: 'yyyyyoor', reds: 1, gap: 0.14, pad: 1.8 },
        smallBar: 0.7,          // the Small style (0.4.2): the Large layout with the shift bar at this share of its size
                                // (0.4 to 1), on the Large bar's base line and middle, so it sits centred over the bracket
        bracket: {              // the M tach bracket 0 to 7, in u (reference px), drawn x scale, centred on x 400, its top at y top
            path: [[0, 52], [73, 0], [331, 0]], round: 14, rail: 3.6, gapRail: 0.8, bar: 9, numH: 11, numOff: 24,
            tickMajor: 6, cellGap: 1.5, scale: 1.2, top: 152, scaleMax: 7000,      // top: under the bar, the same for every style
            redzone: { yellow: 6000, red: 6500 },
            gear: { x: 400, y: 237, h: 27.6 },     // scene px [U]; no speed or unit: the stock HUD shows the speed
        },
    },
    safety: {
        errorLimit: 5,          // this many caught errors ...
        errorWindowMs: 10000,   // ... within this window stop all cluster/HUD output (the app keeps running)
        killFile: 'DISABLE',    // a file of this name in the app's data folder turns all output off
        killPollMs: 1000,       // how often the kill file is looked for
    },
    // 0.4.4 the HUD check (hudcheck.js): the renderer's status asked every statusMs while layers show and verifyMs after a
    // connect; a self-heal rebuild (drop, close, wait gapMs, make again) at most maxAuto times a window (a start or a
    // wake: the 1 s tick sees a wall-clock gap over wakeGapMs); Reset HUD drawing again only manualCooldownMs after the last;
    // an automatic rebuild after the first in a window only backoffMs after the last (0.4.5)
    hudCheck: { statusMs: 30000, verifyMs: 5000, gapMs: 3500, maxAuto: 2, wakeGapMs: 30000, manualCooldownMs: 10000, backoffMs: 60000 },
    rpm: {
        leadMs: 60,             // "Shift lights lead" default: light up this far ahead of the rpm (ms, app.json steps 0 to 150)
        slopeWindowMs: 150,     // the rpm slope for the lead is taken over about this much history (ms)
        slopeMinSpanMs: 60,     // less history than this: no lead (ms)
        minSlope: 1,            // below 1,000 rpm/s no lead (rpm/ms; noise and a steady rpm), full lead from 2 x this
        maxSlope: 20,           // the slope never counts above this (rpm/ms): the lead adds at most maxSlope x leadMs
        pollMs: 40,             // "Fast RPM": ask the car for the rpm when no update came for this long (ms, 20 at least)
        pollTimeoutMs: 200,     // a getter answer later than this counts as a failure (ms)
        pollMaxBackoffMs: 2000, // failures double the wait up to this (ms); one answer resets it to pollMs
        pollIdleMs: 1000,       // while polling is off or the car is not there, look again this often (ms)
    },
});
