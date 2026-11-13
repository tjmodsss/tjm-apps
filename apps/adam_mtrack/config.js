'use strict';
/* ===================== EDIT HERE =====================
 * Every tunable of M Track Cluster. app.json settings only pick between the choices drawn from here;
 * test/adam_mtrack/manifest.test.js checks app.json's defaults against this file.
 * Geometry is in the panel's own pixels (1920 x 720, axis x 960) and comes from the approved mockup
 * (iDrive-Apps docs/mockups/mtrack-cluster.html, commits e6b1072 / aedb0f6); geom.js holds the traced paths.
 * [U] = unproven until the car. Node 8: plain ES2017 only.
 */
module.exports = Object.freeze({
    // the bar tachs: 0 to 7 (x1000 rpm), the B58's limit is 7000 (Adam: "my BMW doesn't go up to 8")
    tach: {
        max: 7000,              // the top of the scale: 0.1.7, Codex's spine's top anchor (its old 8,000) is 7,000 rpm
        tickEvery: 500,         // a tick every 500 rpm: majors at the 1000s, minors between
        redFrom: 6500,          // red zone from here to max (static; the cold limit shows on the slats)
    },
    engine: {
        limitWarm: 7000,        // the engine's allowed maximum, warm (rpm)
        limitCold: 4500,        // the allowed maximum with the oil fully cold (rpm) [U]
        oilCold: 30,            // at or below this oil temperature (C) the limit is limitCold
        oilWarm: 80,            // at or above this (C) the limit is limitWarm; linear in between
        shiftBelowLimit: 150,   // a shift point never sits closer than this to the current limit (rpm)
        limiterBand: 100,       // all slats flash from this far under the limit (rpm)
        hysteresisRpm: 50,      // a slat, red or flash goes off only this far under where it came on
    },
    modes: {                    // slats per drive mode: first light at start, all red at shift (as Shift Lights)
        comfort: { start: 4000, shift: 5000 },
        sport: { start: 6000, shift: 6800 },
        sportplus: { start: 6000, shift: 6800 },
    },
    flashHz: 4,                 // limiter flash rate [U]
    // our shift-light slats above the gear (Shift Lights' "large" M slats, mockup CONFIG.row; 0.1.7 cy 190)
    row: { palette: 'aaaaaaaacc', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15.6, pitch: 18.6, inner: 36,
        centre: 0, h: 83, shear: 29.88, cx: 960, cy: 190, glow: 30, dim: 0.2 },
    colors: { a: '#ffa800', c: '#ff1a22' },
    safety: {
        errorLimit: 5,          // errors within errorWindowMs stop the cover (Shift Lights' rule)
        errorWindowMs: 10000,
        killFile: 'DISABLE',    // this file in the app's data folder turns the cover off (path logged at start)
        killPollMs: 250,        // the cover loop looks for it this often (and on every tick)
        speedStaleMs: 1000,     // no valid speed for longer than this: the cover drops (it covers the speedometer);
                                // the default of Safety > Speed timeout and what a bad saved value falls back to
        speedStaleMinMs: 500,   // the Speed timeout setting stays within these (app.json steps); outside: speedStaleMs
        speedStaleMaxMs: 3000,
        signalWaitMs: 10000,    // a signal not answered this long after start counts as missing (BMW popups waits for it)
        showHoldMs: 1000,       // every condition must hold this long before the cover shows (again)
        tickMs: 100,            // the cover loop's period: a drop happens within one tick of its cause
        // dead-man switch, G's Dash's recipe (failsafe.js, car-proven on Adam's G01, 2026-11-05): u_alive's own value is 1
        // while shown (0.1.1 had 0, so a KOMBI that does not play the renderer animation drew nothing); a NEW animation
        // holding it at 1 is started every aliveRearmMs, then the previous one stopped. A hung app fades by itself
        // 0.24 s after the last re-arm if the KOMBI plays the animation [U]; a crash closes the socket either way
        aliveRearmMs: 60,
        aliveKeys: '0:1 200:1 240:0',
        alivePumpMs: 33,        // the re-arm pump (only while something of ours is shown)
    },
    // speed (and rpm) are only notified on change: a parked car goes quiet, so the getter is polled
    speedPoll: { pollMs: 250, pollIdleMs: 500, pollTimeoutMs: 400, pollMaxBackoffMs: 2000 },
    rpmPoll: { pollMs: 40, pollIdleMs: 500, pollTimeoutMs: 200, pollMaxBackoffMs: 2000 },   // 0.1.6: 40 ms, Shift Lights' value
    // 0.1.6: the bar and the slats a moment ahead of the car's slow rpm updates (Shift Lights' makeLead, logic.js). leadMs is
    // the "Tach lead" default (app.json steps LEAD_STEPS), chosen by test/adam_mtrack/lead_sim.js (iDrive-Apps
    // docs/emulator/mtrack-0.1.6/lead-sim.md): no step met its rule (blips overshoot the peak by the full maxAddRpm), so the
    // default is 0 = Off and the lead is Adam's car-day A/B; the lead never adds more than maxAddRpm [U]
    rpmLead: { leadMs: 0, slopeWindowMs: 150, slopeMinSpanMs: 60, minSlope: 1, maxSlope: 20, maxAddRpm: 300 },
    LEAD_STEPS: [0, 20, 40, 60, 80],
    speedFactor: 1.0,           // shown speed = true speed x this; calibrate against the OEM reading on car day [U]
    tankLitres: 65,             // G01 tank for the fuel gauge (no signal for it) [U]
    nightDim: 0.35,             // "Night dim" on: brightness x this [U] (no lights-on signal is read)
    // the cover's share of cluster-render's pixel memory (every app's assets together, each counted twice: 16 MiB), at
    // most (output.js memoryOf, asserted by tools/mtrack-art/make-art.mjs and the tests). 0.1.2 took 8.2 MiB
    memoryBudgetBytes: 3 * 1048576,
    renderer: {                 // cluster-render's own behaviour (idrive-apps cluster-render.conf, README "Arbitration")
        lingerMs: 3000,         // panel_linger_ms: a panel no layer wants is released (unmapped) this long after
        verifyMs: 6000,         // a drop or close whose panel is not idle again by now is logged "release NOT confirmed"
        heldBackoffMs: 10000,   // after BMW's content took the panel, the cover asks again only this much later (no map /
                                // unmap churn on slot 0x203 while BMW keeps it)
        pixelBytes: 16 * 1048576,   // CompositorLimits pixel_bytes: every app's assets, each counted twice
        marginBytes: 1048576,   // kept free of it before sending a stage's assets (image / video layers are not sized in
                                // the status; G's Dash's MARGIN)
    },
    build: {                    // the cover's staged build (output.js): each stage confirmed by cluster-render's status
        handoverMs: 3500,       // after another app's HUD or panel let go of the shared scene id, wait this long before
                                // asking for the panel (past the 3 s linger; G's Dash HANDOVER_MS)
        askMs: 100,             // the status is asked this often while a stage waits for the renderer
        stuckMs: 10000,         // a stage not confirmed and written by then stops the build (an error, retried)
        klass: 'content',       // the layers' class and z (G's Dash: content z 90, never exclusive, never contending)
        z: 90,
    },
    test: {                     // the test pattern on the Safety page (ladder.js)
        stepMs: 10000,          // each step removes itself after this long
        statusAfterMs: 2500,    // the renderer's status is asked for this long into a step (shown on the page)
        parkedKmh: 3,           // a step runs only below this speed (or in P), and stops when the car goes faster
        connectMs: 5000,        // a step whose client gets no answer from cluster-render this long is given up
        oldAliveKeys: '0:1 1000:1 1200:0',  // step 2's blue bar: exactly 0.1.1's dead-man (value 0, the same animation
        oldAliveResendMs: 250,              // number sent again every 250 ms), to see whether the KOMBI plays it
    },
    diagLogKb: 256,             // mtrack-diag.log (what was sent to cluster-render and what came back), then .1
    zBase: 90,                  // the test steps' first layer z (content class); the cover's layers: build.z and up
    panelHz: 2,                 // side panels and corners redraw at most this often
    statsLogMs: 30000,          // the speed alive / poll log line
    // the car's raw values (BMW scalings, as Engine Vitals): value = raw x factor + offset; invalid = no value
    scaling: {
        temp: { factor: 1, offset: -48, invalid: 255 },
        ambient: { factor: 0.5, offset: -40, invalid: 255 },
        boost: { factor: 0.01, offset: 0, invalid: 255 },
        tyrePress: { factor: 0.1, offset: 0, invalidFrom: 65532 },
        tyreTemp: { factor: 1, offset: -40, invalid: 65535 },
        speedRaw: { factor: 0.015625, offset: 0, invalid: 65535 },
        rpmRaw: { factor: 0.25, offset: 0, invalid: 65535 },
    },
});
