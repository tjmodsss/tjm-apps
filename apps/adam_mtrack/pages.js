'use strict';
/**
 * pages.js - what each settings page shows (pure: no drawing, no I/O; Node 8). ui.js draws it. The look and the
 * control model are Shift Lights 0.4.0's (apps/adam_shiftlights/pages.js): header tabs, rows with a label, a
 * one-line description and a toggle, pills or a stepper. Option ids come from app.json (m.schema).
 *
 * m = { get, schema, cfg, carMode, reason (logic.decide's), avail(widget id) -> bool, version, sig (main.js sigNow:
 *       every signal's and guard's state; missing fields read as unknown) }
 * A control: { key ('<page>:<setting>[:<option>|:-|:+]'), text, on, end, writes: [[setting, value], ...] }
 * A row: { id, kind: 'toggle' | 'pills' | 'stepper', label, desc, tone ('warn' | 'crit': the desc's colour), value, enabled, controls }
 * whyOf(m) -> { text: 'Why the cover is off right now: ...', short, tone }: the blocking guard and its signal's status.
 */
const L = require('./logic');
const C = require('./catalogue');
const { STEPS, buildWord } = require('./ladder');

const PAGES = ['Home', 'Panels', 'Look', 'Safety', 'About'];
const IDS = ['home', 'panels', 'look', 'safety', 'about'];
const MODE_NAME = { comfort: 'Comfort', sport: 'Sport', sportplus: 'Sport+' };
const SHORT = {
    whenToShow: { sportplus: 'Sport+ only', sport: 'Sport and above', always: 'Always' },
    units: { us: 'US', metric: 'Metric', car: 'Follow car' },
    popupGuard: { auto: 'Use if sent', require: 'Require', ignore: 'Ignore' },
};
const POPUP_DESC = {
    auto: 'Protects BMW warnings: a popup drops the cover. No popup signal from the car: no block',
    require: 'Protects BMW warnings, strict: no popup signal from the car keeps the cover off',
    ignore: 'RISKY, the guard is off: popups never drop the cover, so a BMW warning can hide under it',
};
const MODE_MISSING_DESC = 'Protects: no cover while the drive mode is unknown. Off: Always shows without one';
/** A signal interface's state (main.js ifaceState) in words. */
const IFACE_WORD = { present: 'present', waiting: 'waiting for the car', missing: 'missing (no answer)', unoffered: 'missing (not offered on this unit)' };
const secs = (ms) => (typeof ms === 'number' && isFinite(ms) ? ms / 1000 + ' s' : '?');
const WHEN_DESC = {
    sportplus: 'Shows only in Sport+. Leaving Sport+ drops it at once',
    sport: 'Shows in Sport and Sport+ (Sport individual counts as Sport)',
    always: 'Shows in every drive mode, Comfort too',
};
const UNITS_DESC = { us: 'mph, psi, F, lb-ft, hp, mi, mpg', metric: 'km/h, bar, C, Nm, kW, km, l/100km', car: 'The car\'s own display units (US where it says nothing)' };

const safe = (get) => (k) => { try { return get(k); } catch (e) { return undefined; } };
const itemOf = (m, key) => (m.schema || []).filter((s) => s.key === key)[0] || { key, options: [], steps: [] };
const writeOf = (m, key, v) => (safe(m.get)(key) === v ? [] : [[key, v]]);
const toggle = (page, key, on) => [{ key: page + ':' + key, on, writes: [[key, !on]] }];
const row = (id, kind, label, desc, controls, more) => Object.assign({ id, kind, label, desc, enabled: true, controls }, more);

/** The next of steps from value in dir (-1 / +1), clamped; a value not in steps starts from the first (or last). */
function stepOf(steps, value, dir) {
    if (!steps || !steps.length) return value;
    const i = steps.indexOf(value);
    if (i < 0) return dir > 0 ? steps[0] : steps[steps.length - 1];
    return steps[Math.max(0, Math.min(steps.length - 1, i + dir))];
}
function stepper(m, page, key, eff, steps) {
    return [-1, 1].map((d) => {
        const v = stepOf(steps, eff, d);
        return { key: page + ':' + key + ':' + (d < 0 ? '-' : '+'), text: d < 0 ? '-' : '+', end: v === eff, writes: v === eff ? [] : writeOf(m, key, v) };
    });
}
function pills(m, page, key, eff) {
    const short = SHORT[key] || {};
    return (itemOf(m, key).options || []).map((o) => ({ key: page + ':' + key + ':' + o[0], text: short[o[0]] || o[1], on: o[0] === eff, writes: writeOf(m, key, o[0]) }));
}
const settingsOf = (m) => L.readSettings(m.get, m.schema).values;

/** The cover's build under way or stopped, as one sentence (Home and the Safety page's top line). */
const buildPhrase = (b) => (b.state === 'stopped' ? 'Cover build ' : 'Building the cover: ') + buildWord(b);
/** Home's status line for a decision reason. */
function statusOf(m) {
    const r = m.reason || 'off', v = settingsOf(m), b = sigOf(m).build;
    if (r === 'showing' && b && b.state !== 'shown' && b.state !== 'idle') return { text: buildPhrase(b), tone: b.state === 'stopped' ? 'warn' : 'on' };
    if (r === 'mode') {
        const now = MODE_NAME[m.carMode] || 'no drive mode from the car';
        return { text: (v.whenToShow === 'sport' ? 'Waiting for Sport or Sport+' : 'Waiting for Sport+') + ' (now ' + now + ')', tone: 'warn' };
    }
    if (r === 'showing') return { text: 'Showing on the cluster', tone: 'on' };
    if (r === 'hold') return { text: L.REASONS.hold, tone: 'on' };
    if (r === 'off') return { text: 'Off: BMW\'s own cluster, untouched', tone: 'off' };
    return { text: L.REASONS[r] || r, tone: r === 'tripped' || r === 'nocc' || r === 'noart' ? 'crit' : 'warn' };
}

/* ---------- the signals and the "why" (Home and Safety) ---------- */

const sigOf = (m) => m.sig || {};
function speedWord(s, v, cfg) {
    if (s.speed === 'missing') return 'missing (none received yet)';
    if (s.speed === 'stale') return 'stale (none for ' + secs(L.staleMsOf(v.speedStaleMs, cfg)) + ')';
    return s.speed === 'present' ? 'present' : 'unknown';
}
function modeWord(s, m) {
    const mode = s.mode !== undefined ? s.mode : m.carMode;
    if (MODE_NAME[mode]) return MODE_NAME[mode] + ' (present)';
    if (s.modeRaw !== undefined) return 'missing (the car sends ' + s.modeRaw + ', no mode)';
    if (s.fes === 'present') return 'missing (no mode sent yet)';
    return IFACE_WORD[s.fes] || 'missing';
}
const ccWord = (s) => (s.cc === 'present' ? 'present, ' + (s.ccUp > 0 ? s.ccUp + ' up' : 'none up') : IFACE_WORD[s.cc] || 'unknown');
const IFACE_SHORT = { present: 'present', waiting: 'waiting', missing: 'missing', unoffered: 'not offered' };
const clip = (x, n) => (x.length > n ? x.slice(0, n - 3) + '...' : x);
/** Another app holds the cluster scene: which one, from the renderer's status when it named one. */
const busyWord = (s) => 'another app is using the cluster (' + (s.others && s.others.length ? s.others.join(', ') : s.busy) + ')';
/** What cluster-render says: the panel (state, holder, rendering), the HUD, the last error event. */
function rendererWord(s, v) {
    if (s.art === false) return 'not connected: the art file is missing';
    if (s.link === 'connecting') return 'connecting';
    if (s.link !== 'ready') return v.coverOn === true ? 'not connected' : 'off (connects when the cover is on)';
    if (s.busy) return clip(busyWord(s), 64);
    if (s.target === 'waiting' || s.target === 'parked') return 'BMW holds the panel' + (s.reason ? ' (' + clip(s.reason, 36) + ')' : s.holder && s.holder !== 'none' ? ' (' + s.holder + ')' : '');
    const panel = s.target && s.target !== 'idle' ? 'panel ' + s.target + (s.rendering && s.rendering !== 'none' ? ' (' + s.rendering + ')' : '') : 'panel free';
    return 'connected, ' + panel + (s.hud && s.hud !== 'idle' ? ', HUD ' + s.hud : '') + (s.lastError ? '; error: ' + clip(String(s.lastError.reason), 28) : '');
}
/** One line of the signals the guards read (Home, and the log once the car's watches settle). */
function sigSummary(m) {
    const s = sigOf(m), v = settingsOf(m);
    return 'Signals: speed ' + speedWord(s, v, m.cfg) + ', drive mode ' + modeWord(s, m) + ', BMW popups ' + ccWord(s);
}

const WHY_TONE = { off: 'off', showing: 'on', hold: 'on', kill: 'crit', tripped: 'crit', noart: 'crit', nocc: 'crit' };
/** Why the cover is off: the blocking guard by its Safety-page name and its signal's status (present / missing / stale). */
function whyOf(m) {
    const r = m.reason || 'off', v = settingsOf(m), s = sigOf(m), S = m.cfg.safety, b = s.build;
    if (r === 'showing' && b && b.state !== 'shown' && b.state !== 'idle') {
        const w = buildPhrase(b);
        return { text: w, short: w, tone: b.state === 'stopped' ? 'warn' : 'on' };
    }
    if (r === 'showing') return { text: 'Showing on the cluster: every guard holds', short: 'showing', tone: 'on' };
    if (r === 'hold') return { text: 'Showing in a moment: every guard has to hold for ' + secs(S.showHoldMs), short: 'holding for ' + secs(S.showHoldMs), tone: 'on' };
    const when = SHORT.whenToShow[v.whenToShow], mode = s.mode !== undefined ? s.mode : m.carMode;
    const SAY = {
        off: 'Cover the cluster is off',
        kill: 'Kill switch: the DISABLE file is there',
        tripped: 'Error guard: stopped after ' + S.errorLimit + ' errors. Turn Cover the cluster off and on',
        demo: 'Live data only: the car sends no data, this is demo data',
        noart: 'Art check: the art file is missing or damaged. Reinstall the app',
        renderer: 'Cluster renderer: ' + rendererWord(s, v),
        nocc: 'BMW popups (Require): the popup signal is ' + (s.cc === 'waiting' ? 'not answered yet' : IFACE_WORD[s.cc] || 'missing'),
        ccwait: 'BMW popups: waiting for the popup signal (up to ' + secs(S.signalWaitMs) + ' after start)',
        cc: 'BMW popups: ' + (s.ccUp > 0 ? 'a Check Control message is up' : 'a new Check Control message') + ' (popup signal present)',
        busy: 'Another app is using the cluster: turn off Shift Lights cluster/HUD',
        held: 'BMW panel: BMW holds the cluster panel (a popup or the speech dialog), asks again in ' + secs(m.cfg.renderer.heldBackoffMs),
        nospeed: 'Speed timeout: speed signal ' + speedWord(s, v, m.cfg),
        error: 'Error guard: an error a moment ago, back after ' + secs(S.showHoldMs),
        nomode: 'Drop if no drive mode (on): the drive-mode signal is ' + modeWord(s, m),
        mode: 'When to show (' + when + '): ' + (MODE_NAME[mode] ? 'drive mode is ' + MODE_NAME[mode] + ' (signal present)' : 'the drive-mode signal is ' + modeWord(s, m)),
    };
    const stop = b && b.stop && (r === 'error' || r === 'tripped') ? ' (last build ' + buildWord(Object.assign({}, b.stop, { state: 'stopped' })) + ')' : '';
    const short = (SAY[r] || L.REASONS[r] || r) + stop;
    return { text: 'Why the cover is off right now: ' + short, short, tone: WHY_TONE[r] || 'warn' };
}

function home(m) {
    const v = settingsOf(m), on = v.coverOn === true, st = statusOf(m), w = whyOf(m);
    return {
        id: 'home',
        card: { id: 'coverOn', label: 'Cover the cluster', on, state: on ? st : { text: 'Off: BMW\'s own cluster, untouched', tone: 'off' }, controls: toggle('home', 'coverOn', on) },
        rows: [row('whenToShow', 'pills', 'When to show', WHEN_DESC[v.whenToShow], pills(m, 'home', 'whenToShow', v.whenToShow), { value: SHORT.whenToShow[v.whenToShow] })],
        status: { line: w.text, tone: w.tone, signals: sigSummary(m) },
    };
}

/** The widgets a picker steps through: in this app, with a signal on this car (lower halves: halves only). */
function choices(m, lower) {
    const avail = m.avail || (() => true);
    return C.CATALOGUE.filter((w) => w.inApp && (!lower || w.kind === 'half') && (w.id === 'none' || avail(w.id))).map((w) => w.id);
}
function widgetRow(m, key, label, lower, under) {
    const v = settingsOf(m), id = v[key], w = C.get(id) || C.get('none'), avail = m.avail || (() => true);
    if (lower && under) {
        return row(key, 'stepper', label, 'Used by ' + under.label + ' (it takes the whole panel)', [], { value: 'Used', enabled: false });
    }
    const has = w.id === 'none' || avail(w.id);
    return row(key, 'stepper', label, has ? w.desc : 'No signal on this car', stepper(m, 'panels', key, id, choices(m, lower)),
        { value: w.label, greyed: !has });
}
function panels(m) {
    const v = settingsOf(m), wl = C.get(v.leftPanel), wr = C.get(v.rightPanel);
    const rows = [
        widgetRow(m, 'leftPanel', 'Left panel', false),
        widgetRow(m, 'leftLower', 'Left lower half', true, wl && wl.kind === 'whole' ? wl : null),
        widgetRow(m, 'rightPanel', 'Right panel', false),
        widgetRow(m, 'rightLower', 'Right lower half', true, wr && wr.kind === 'whole' ? wr : null),
        row('swapSides', 'toggle', 'Swap sides', 'Left and right panels change places (the corner gauges stay)', toggle('panels', 'swapSides', v.swapSides === true)),
    ];
    return { id: 'panels', rows, note: v.coverOn ? 'Changes show on the cluster at once' : 'The cover is off: changes show when it is on', noteTone: 'dim' };
}

function look(m) {
    const v = settingsOf(m), steps = itemOf(m, 'bright').steps || [], dim = Math.round(m.cfg.nightDim * 100);
    return {
        id: 'look',
        rows: [
            row('units', 'pills', 'Units', UNITS_DESC[v.units], pills(m, 'look', 'units', v.units), { value: SHORT.units[v.units] }),
            row('bright', 'stepper', 'Brightness', 'The whole cover', stepper(m, 'look', 'bright', v.bright, steps), { value: v.bright + '%' }),
            row('nightDim', 'toggle', 'Night dim', 'Dims to ' + dim + '%. Manual: the car\'s light signal is not read', toggle('look', 'nightDim', v.nightDim === true)),
            row('coverSlats', 'toggle', 'Shift lights in the cover', 'Amber and red slats above the gear', toggle('look', 'coverSlats', v.coverSlats === true)),
            row('tachLead', 'stepper', 'Tach lead', 'The rev bar runs ahead to cover slow rpm updates', stepper(m, 'look', 'tachLead', v.tachLead, itemOf(m, 'tachLead').steps || []),
                { value: (v.tachLead === 0 ? 'Off' : v.tachLead + ' ms') + (v.tachLead === itemOf(m, 'tachLead').default ? ' (default)' : '') }),
        ],
        note: 'Speed shows in ' + (v.units === 'metric' ? 'km/h' : v.units === 'car' ? 'the car\'s unit' : 'mph') + '. The tachs go 0 to 7 (x1000 rpm)', noteTone: 'dim',
    };
}

/** The test pattern row (ladder.js): a pill per step and STOP; its line says what runs, or what the last step got. */
function testRow(m) {
    const t = sigOf(m).test, secsStep = secs(m.cfg.test.stepMs);
    const controls = Object.keys(STEPS).map((n) => ({ key: 'safety:test:' + n, text: n + ' ' + STEPS[n].name, on: !!(t && t.running && t.n === Number(n)), writes: [], action: 'test:' + n }))
        .concat([{ key: 'safety:test:stop', text: 'STOP', on: false, writes: [], action: 'test:stop' }]);
    const warn = t && (t.state === 'refused' || t.released === false);
    return row('test', 'pills', 'Test pattern (parked)', t ? t.line : 'Parked, cover off: each step shows ' + secsStep + ', then removes itself', controls,
        { value: t && t.running ? 'Step ' + t.n : 'Off', tone: warn ? 'warn' : t && t.running ? 'on' : undefined });
}

/** The cover's build and its dead-man, one line (Safety, Always on block). */
function buildLine(s, S) {
    const b = s.build;
    if (!b || b.state === 'idle') return 'Cover: not built yet; dead-man at 1 while shown. Exit or crash: dropped';
    if (b.state === 'shown') return 'Cover: ' + b.of + ' of ' + b.of + ' stages shown; dead-man at 1, re-armed every ' + secs(S.aliveRearmMs);
    return 'Cover build: ' + buildWord(b);
}

/**
 * Safety: the three Safety settings (BMW popups, drop if no drive mode, the speed timeout) and the test pattern, why
 * the cover is off, every signal the guards read with what cluster-render says, and every always-on guard with its
 * state and why it has no switch; while a test step runs or after one, the right block is that step's result.
 */
function safety(m) {
    const v = settingsOf(m), bad = L.readSettings(m.get, m.schema).bad, s = sigOf(m), cfg = m.cfg, S = cfg.safety, r = m.reason || 'off';
    const w = whyOf(m), stale = L.staleMsOf(v.speedStaleMs, cfg), risky = stale > S.speedStaleMs;
    const isBad = (k) => bad.indexOf(k) >= 0;
    const tone = (ids, t) => (ids.indexOf(r) >= 0 ? t || 'warn' : 'dim');
    const errors = s.tripped ? 'STOPPED' : s.errorRecent ? 'one just now' : 'none';
    const rel = s.release && !s.release.pending && s.release.short ? s.release : null;
    const guards = { title: 'Always on (no switch), and why', lines: [
        { text: 'Speed timeout: on, ' + secs(stale) + '. A frozen speed over the real one is dangerous', tone: tone(['nospeed']) },
        { text: 'Kill switch (' + S.killFile + ' file): ' + (s.killed ? 'FOUND, cover off' : 'clear') + '. Works with no screen', tone: tone(['kill'], 'crit') },
        { text: 'Errors: ' + errors + '. ' + S.errorLimit + ' in ' + secs(S.errorWindowMs) + ' stop the cover until off and on', tone: tone(['error', 'tripped'], s.tripped ? 'crit' : 'warn') },
        { text: buildLine(s, S), tone: s.build && s.build.state === 'stopped' ? 'warn' : 'dim' },
        rel ? { text: 'Last release (' + rel.why + '): ' + rel.short.replace(/^Released: /, ''), tone: rel.ok || rel.unreachable ? 'dim' : 'warn' }
            : { text: 'Clock jump: guarded. Demo data, BMW taking the panel, art check: always win', tone: 'dim' },
    ] };
    const test = s.test ? { title: 'Test pattern: what cluster-render said', lines: s.test.lines.map((x, i) => ({ text: x, tone: i === 0 && s.test.running ? 'on' : i === 4 && s.test.released === false ? 'warn' : 'dim' })) } : null;
    return {
        id: 'safety',
        note: w.text, noteTone: w.tone,
        rows: [
            row('popupGuard', 'pills', 'BMW popups (Check Control)',
                isBad('popupGuard') ? 'The saved value was not valid: Require is used (the strict side)' : POPUP_DESC[v.popupGuard],
                pills(m, 'safety', 'popupGuard', v.popupGuard),
                { value: SHORT.popupGuard[v.popupGuard], tone: isBad('popupGuard') ? 'warn' : v.popupGuard === 'ignore' ? 'crit' : undefined }),
            row('modeMissingDrop', 'toggle', 'Drop the cover if the drive-mode signal is missing',
                isBad('modeMissingDrop') ? 'The saved value was not valid: On is used (the strict side)' : MODE_MISSING_DESC,
                toggle('safety', 'modeMissingDrop', v.modeMissingDrop === true), { tone: isBad('modeMissingDrop') ? 'warn' : undefined }),
            row('speedStaleMs', 'stepper', 'Speed timeout (always on)',
                isBad('speedStaleMs') ? 'The saved value was not valid: ' + secs(stale) + ' is used'
                    : risky ? 'RISKY above ' + secs(S.speedStaleMs) + ': a frozen speed can stay up for ' + secs(stale) + ' before the cover drops'
                        : 'Always on: no fresh speed for this long drops the cover. A frozen speed is dangerous',
                stepper(m, 'safety', 'speedStaleMs', v.speedStaleMs, itemOf(m, 'speedStaleMs').steps || []),
                { value: secs(v.speedStaleMs), tone: isBad('speedStaleMs') || risky ? 'warn' : undefined }),
            testRow(m),
        ],
        blocks: [
            { title: 'Signals now', lines: [
                { text: 'Speed (Vehicle2): ' + speedWord(s, v, cfg), tone: tone(['nospeed']) },
                { text: 'Drive mode (FES): ' + modeWord(s, m), tone: tone(['mode', 'nomode']) },
                { text: 'Popup list (CheckControlMaster): ' + ccWord(s) + '; new-popup event: ' + (IFACE_SHORT[s.ki2] || 'unknown'), tone: tone(['nocc', 'ccwait', 'cc']) },
                { text: 'Engine rpm (CDS): ' + (IFACE_SHORT[s.rpm] || 'unknown') + '; car data: ' + (s.demo ? 'demo, not live' : 'live'), tone: tone(['demo']) },
                { text: 'Cluster renderer: ' + rendererWord(s, v), tone: tone(['renderer', 'held', 'busy', 'noart']) },
            ] },
            test || guards,
        ],
    };
}

function about(m) {
    const hidden = C.CATALOGUE.filter((w) => !w.inApp).map((w) => w.label);
    return {
        id: 'about',
        note: 'M Track Cluster ' + (m.version || ''), noteTone: 'dim',
        blocks: [
            { title: 'Not proven on this car yet', lines: [
                'The cover on a G01 cluster in Sport+, its pixels and brightness',
                'Shown speed vs the OEM one (speed factor ' + m.cfg.speedFactor + ')',
                'Popups above or below; the KOMBI GPU and the shaders',
                'Whether the KOMBI plays renderer animations (Test 2 BAR); the speed getter',
                'Drive mode values, boost scale, range unit, clock time zone',
                'Which signals the car sends (the Safety tab lists them)',
                'Safety > Test pattern, parked: 1 KNOWN first, then 2 to 6',
            ] },
            { title: 'Not in ' + (m.version || 'this version'), lines: [hidden.slice(0, 4).join(', '), hidden.slice(4).join(', ')] },
        ],
        right: [
            { title: 'Remove safely', lines: ['Store > M Track Cluster > Remove.', 'Never kill or restart it by hand: three crashes', 'in about 30 s wipe every app.'] },
            { title: 'Kill switch', lines: ['Home > Cover the cluster off, or a file named', m.cfg.safety.killFile + ' in the app\'s data folder (Safety tab).'] },
            { title: 'With Shift Lights', lines: ['Turn Shift Lights\' HUD and cluster off for the cover:', 'the HUD and the cluster panel share one scene; the', 'cover waits 3.5 s after the HUD lets go of it.'] },
        ],
    };
}

function view(i, m) {
    const p = IDS[i] || 'home';
    if (p === 'panels') return panels(m);
    if (p === 'look') return look(m);
    if (p === 'safety') return safety(m);
    if (p === 'about') return about(m);
    return home(m);
}

/** Every control of a page, in drawing (focus) order. */
function controlsOf(v) {
    const out = [];
    if (v.card) v.card.controls.forEach((x) => out.push(x));
    (v.rows || []).forEach((r) => { if (r.enabled) r.controls.forEach((x) => out.push(x)); });
    return out;
}

module.exports = { PAGES, IDS, view, controlsOf, stepOf, choices, statusOf, whyOf, sigSummary, SHORT };
