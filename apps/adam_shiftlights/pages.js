'use strict';
/**
 * pages.js - what each settings page shows (pure: no drawing, no I/O; Node 8). ui.js draws it.
 * Option ids and steps come from app.json (m.schema) at runtime; only the short pill names and the one-line
 * descriptions live here. Values shown are the ones the app really uses (logic.js readers): a bad saved value
 * shows its fallback, and a step starts from there.
 *
 * m = { get, schema (app.json settings), cfg (checked config), carMode, offReason, version, night, proof, heal, now }
 *   night = { night (the car's day / night after its hold: true / false / null), raw (its last value), sub: 'waiting' |
 *   'present' | 'missing' (this unit has no such signal) } from main.js; none: nothing seen.
 *   proof = output.status().proof, heal = hudcheck.healStep's state, now = Date.now() (0.4.4: "Showing" and the Check tab
 *   come from the renderer's read-back through hudcheck.verdict, never from the settings alone).
 * A control: { key (stable focus key '<page>:<setting>[:<option>|:-|:+]'), text, on, end, writes [, confirm, busy, cmd] }
 *   cmd: a command main.js runs instead of a setting (the Check tab: 'hudReset', 'refresh')
 *   writes = [[setting, value], ...] what pressing it saves; [] = nothing to change (a stepper at its end). confirm: the first
 *   press only asks (ui.js); busy: drawn dimmed, nothing to press.
 * A row: { id, kind: 'toggle' | 'pills' | 'stepper', label, desc, value, enabled, controls }
 */
const L = require('./logic');
const G = require('./geom');
const HC = require('./hudcheck');

const PAGES = ['Home', 'HUD', 'Cluster', 'Behavior', 'About', 'Check'];
const IDS = ['home', 'hud', 'cluster', 'behavior', 'about', 'check'];
const MODE_NAME = { comfort: 'Comfort', sport: 'Sport', sportplus: 'Sport+' };
const SHORT = {
    bothMode: { hud: 'HUD', cluster: 'Cluster', map: 'Both' },
    hudStyle: { large: 'Large', classic: 'Small', bar: 'Bar only', bracket: 'Bracket' },
    clusterStyle: { large: 'Large', classic: 'Small', row: 'Centre row', stock: 'Stock' },
    driveMode: MODE_NAME,
    layout: { full: 'Full screen', standard: 'Standard' },
    renderer: { auto: 'GPU', software: 'Software' },
    demo: { auto: 'Auto', on: 'Always', off: 'Never' },
    hudNightMode: { auto: 'Auto', on: 'On', off: 'Off' },
    clusterNightMode: { auto: 'Auto', on: 'On', off: 'Off' },
    flashMode: { app: 'App', renderer: 'Renderer' },
};
const RESET_KEYS = ['hudSize', 'hudX', 'hudY', 'hudBarX'];   // what "Reset HUD to defaults" sets back (app.json defaults)
const STYLE_DESC = {
    hudStyle: { large: 'Shift bar + rev bracket, large', classic: 'Smaller shift bar + rev bracket', bar: 'Shift bar only', bracket: 'Rev bracket + gear only' },
    clusterStyle: { large: 'M slats, large', classic: 'M slats, small', row: 'Centre row, 12 lights', stock: 'Stock look, one block per dial' },
};
const DISPLAY = {
    hud: { name: 'HUD', other: 'cluster', size: 'Bigger grows upward', x: 'Line it up over the speed', y: 'Fine-tune where it sits over the speed' },
    cluster: { name: 'Cluster', other: 'HUD', size: 'Grows from its centre', x: 'Keep it clear of the dial numbers', y: 'Fine-tune where it sits under the M logo' },
};

const num = (v) => typeof v === 'number' && isFinite(v);
const fmtRpm = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const toF = (c) => Math.round(c * 1.8 + 32);
const safe = (get) => (k) => { try { return get(k); } catch (e) { return undefined; } };
const itemOf = (m, key) => (m.schema || []).filter((s) => s.key === key)[0] || { key, options: [], steps: [] };

/**
 * The next step from value in dir (-1 / +1), clamped to the ends. A value that is not a step goes to the nearest
 * step that way (or the end); a non-number to the first step. pos(step): where a step sits (default: itself),
 * for steps listed in that order (a shift point's 0 = "Default" sits at its default rpm).
 */
function stepOf(steps, value, dir, pos) {
    if (!steps || !steps.length) return value;
    const at = pos || ((x) => x);
    const i = steps.indexOf(value);
    if (i >= 0) return steps[Math.max(0, Math.min(steps.length - 1, i + dir))];
    if (!num(value)) return steps[0];
    const up = steps.filter((s) => at(s) > value), down = steps.filter((s) => at(s) < value);
    if (dir > 0) return up.length ? up[0] : steps[steps.length - 1];
    return down.length ? down[down.length - 1] : steps[0];
}

/** A write unless the saved value is that already. */
const writeOf = (m, key, v) => (safe(m.get)(key) === v ? [] : [[key, v]]);

function pills(m, page, key, eff) {
    const it = itemOf(m, key), short = SHORT[key] || {};
    return (it.options || []).map((o) => ({ key: page + ':' + key + ':' + o[0], text: short[o[0]] || o[1], on: o[0] === eff, writes: writeOf(m, key, o[0]) }));
}
function stepper(m, page, key, eff, pos) {
    const steps = itemOf(m, key).steps || [];
    return [-1, 1].map((d) => {
        const v = stepOf(steps, eff, d, pos);
        return { key: page + ':' + key + ':' + (d < 0 ? '-' : '+'), text: d < 0 ? '-' : '+', end: v === eff, writes: v === eff ? [] : writeOf(m, key, v) };
    });
}
const toggle = (page, key, on) => [{ key: page + ':' + key, on, writes: [[key, !on]] }];
const row = (id, kind, label, desc, controls, more) => Object.assign({ id, kind, label, desc, enabled: true, controls }, more);
/** A saved choice, or the app.json default when it is not one of the options. */
function choice(m, key) {
    const it = itemOf(m, key), v = safe(m.get)(key);
    return (it.options || []).some((o) => o[0] === v) ? v : it.default;
}
const stepLabel = (m, key, v) => { const l = itemOf(m, key).labels; return l && l[String(v)] !== undefined ? l[String(v)] : String(v); };
/** ". Default 110%" / ". Default 80 px left" for a stepper's description; '' when its default step already reads "Default". */
function defaultText(m, key) {
    const it = itemOf(m, key), d = stepLabel(m, key, it.default);
    if (it.default === undefined || /^default$/i.test(d)) return '';
    return '. Default ' + (it.unit === '%' ? d + '%' : /^[A-Z][a-z]/.test(d) ? d[0].toLowerCase() + d.slice(1) : d);
}

/** The Night dim row's line: what it uses now and the car's last day / night value (or that none came). */
function nightLine(m, s) {
    const n = m.night || {}, dim = Math.round(m.cfg.nightDim * 100) + '%';
    const word = n.raw === undefined || n.raw === null ? '' : L.dayNightOf({ dayNightChangeOver: n.raw }) || 'no day / night word';
    const car = word ? 'car says ' + word + ' (' + String(n.raw) + ')' : n.sub === 'missing' ? 'this car sends no day / night signal' : 'no day / night signal from the car yet';
    if (s.nightMode === 'on') return 'On: dimmed to ' + dim + ' (' + car + ')';
    if (s.nightMode === 'off') return 'Off: full brightness (' + car + ')';
    return 'Auto, ' + car + ': ' + (s.night ? 'dimmed to ' + dim : 'full brightness');
}

/** The drive mode in use, in words: "Sport+, from the car" / "Sport, the fallback (the car sends none)". */
function modeLine(m) {
    const e = L.effectiveMode(m.carMode, m.get, m.cfg);
    return MODE_NAME[e.mode] + (e.source === 'car' ? ', from the car' : ', the fallback (the car sends none)');
}

/** hudcheck.verdict for one display from the page model (the renderer's read-back in m.proof). */
function verdictOf(m, which) {
    const ds = L.readDisplays(m.get), s = L.readStyle(m.cfg, m.get, which, m.night ? m.night.night : null);
    return HC.verdict({ which, on: ds[which], shown: ds.display === which || ds.display === 'both', offReason: m.offReason, proof: m.proof, level: L.levelOf(m.cfg, s), night: s.night, heal: m.heal });
}

/** "Showing: the renderer drew it", "Off", "On, not showing: the HUD wins", "Sent, not confirmed drawn", ... for one display. */
function stateOf(m, ds, which) {
    if (!ds[which]) return { text: 'Off', tone: 'off' };
    const d = ds.display;
    if (d === which || d === 'both') {
        const v = verdictOf(m, which);
        if (v.code === 'ok' && d === 'both' && which === 'cluster') return { text: 'Showing in the centre area (experimental)', tone: 'on' };
        return { text: v.text, tone: v.code === 'ok' ? 'on' : 'warn' };
    }
    return { text: 'On, not showing: the ' + (which === 'hud' ? 'cluster' : 'HUD') + ' wins', tone: 'warn' };
}

function home(m) {
    const ds = L.readDisplays(m.get);
    const card = (which, label) => ({ id: which + 'On', label, on: ds[which], state: stateOf(m, ds, which), controls: toggle('home', which + 'On', ds[which]) });
    const shows = { hud: 'HUD', cluster: 'cluster', map: 'HUD + cluster centre area (experimental)' };
    const desc = ds.hud && ds.cluster ? 'This car shows one at a time. Showing: ' + shows[ds.both] : 'Only matters when both are on';
    return {
        id: 'home',
        cards: [card('hud', 'HUD'), card('cluster', 'Instrument cluster')],
        rows: [row('bothMode', 'pills', 'When both are on', desc, pills(m, 'home', 'bothMode', ds.both), { value: SHORT.bothMode[ds.both] })],
        status: { mode: 'Drive mode: ' + modeLine(m), off: m.offReason || '' },
        alloff: { key: 'home:alloff', text: 'All off', writes: [['hudOn', false], ['clusterOn', false]] },
    };
}

function display(m, which) {
    const ds = L.readDisplays(m.get), s = L.readStyle(m.cfg, m.get, which, m.night ? m.night.night : null), D = DISPLAY[which], on = ds[which];
    const shown = ds.display === which || ds.display === 'both', page = which, k = (x) => which + x;
    const v = on && shown ? verdictOf(m, which) : null;
    let note = v && v.code === 'ok' ? 'Showing on the ' + (which === 'hud' ? 'HUD' : 'cluster') + ' now: changes show live' : v ? v.text + ' (see the Check tab)' : '';
    if (!on) note = D.name + ' is off. Turn it on here or on Home';
    else if (!shown) note = 'On, not showing: the ' + D.other + ' wins when both are on (change it on Home)';
    else if (which === 'cluster' && ds.display === 'both') note = 'Showing in the cluster centre area (experimental)';
    const barStyle = which === 'hud' && (s.style === 'large' || s.style === 'bar');
    // the shift bar (Small's too) is held inside the visible area: say so when that moved it (pure geometry, no drawing)
    const held = on && which === 'hud' && G.hudLayout(m.cfg, s).barShift.clamped;
    if (held) note = 'Shift bar held inside the visible area (it was past the edge)';
    const rows = [
        row(k('Style'), 'pills', 'Style', STYLE_DESC[k('Style')][s.style], pills(m, page, k('Style'), s.style), { value: SHORT[k('Style')][s.style] }),
        row(k('Size'), 'stepper', 'Size', D.size + defaultText(m, k('Size')), stepper(m, page, k('Size'), s.size), { value: s.size + '%' }),
        row(k('Bright'), 'stepper', 'Brightness', 'How bright the lit lights are' + defaultText(m, k('Bright')), stepper(m, page, k('Bright'), s.bright), { value: s.bright + '%' }),
        row(k('NightMode'), 'pills', 'Night dim', nightLine(m, s), pills(m, page, k('NightMode'), s.nightMode), { value: SHORT[k('NightMode')][s.nightMode] }),
        row(k('X'), 'stepper', 'Move left / right', D.x + defaultText(m, k('X')), stepper(m, page, k('X'), s.x), { value: stepLabel(m, k('X'), s.x) }),
        row(k('Y'), 'stepper', 'Move up / down', D.y + defaultText(m, k('Y')), stepper(m, page, k('Y'), s.y), { value: stepLabel(m, k('Y'), s.y) }),
    ];
    if (which === 'hud') {
        const bar = row('hudBarX', 'stepper', 'Shift bar left / right', barStyle ? 'Moves the shift bar only; kept inside the visible area' + defaultText(m, 'hudBarX') : 'Only for the Large and Bar only styles',
            stepper(m, page, 'hudBarX', s.barX), { value: stepLabel(m, 'hudBarX', s.barX) });
        bar.enabled = on && barStyle;
        rows.push(bar);
    }
    rows.forEach((r) => { if (r.id !== 'hudBarX') r.enabled = on; });
    let action = on ? null : { key: page + ':turnon', text: 'Turn ' + D.name + ' on', writes: [[k('On'), true]] };
    if (on && which === 'hud') {
        // size, move and the bar's move back to app.json's defaults; the first press asks (ui.js), dimmed when they are already
        const writes = RESET_KEYS.reduce((a, key) => a.concat(writeOf(m, key, itemOf(m, key).default)), []);
        action = { key: 'hud:reset', text: 'Reset HUD to defaults', writes, confirm: true, busy: !writes.length };
    }
    return { id: page, rows, note, noteTone: !on ? 'warn' : held || !shown || (v && v.code !== 'ok') ? 'warn' : 'dim', noteAction: action };
}

function behavior(m) {
    const g = safe(m.get), lead = L.readLead(m.cfg, m.get), sportOnly = g('onlySportPlus') === true;
    const fallback = L.effectiveMode(null, m.get, m.cfg).mode, eff = L.effectiveMode(m.carMode, m.get, m.cfg);
    const leadDef = itemOf(m, 'leadMs').default;
    const rows = [
        row('onlySportPlus', 'toggle', 'Only in Sport+', 'Lights show only while the car is in Sport+', toggle('behavior', 'onlySportPlus', sportOnly)),
        row('autoStart', 'toggle', 'Start with the car', 'Off: nothing shows until you open Shift Lights once', toggle('behavior', 'autoStart', g('autoStart') !== false)),
        row('leadMs', 'stepper', 'Light-up lead', 'Lights come on early to cover display lag', stepper(m, 'behavior', 'leadMs', lead.leadMs),
            { value: lead.leadMs === 0 ? 'Off' : lead.leadMs + ' ms' + (lead.leadMs === leadDef ? ' (default)' : '') }),
        row('rpmPoll', 'toggle', 'Fast RPM', 'Asks the car for rpm when its updates are slow', toggle('behavior', 'rpmPoll', lead.poll)),
        row('driveMode', 'pills', 'Drive mode fallback', eff.source === 'car' ? 'Not used now: the car sends ' + MODE_NAME[eff.mode] : 'Used when the car sends no drive mode',
            pills(m, 'behavior', 'driveMode', fallback), { value: MODE_NAME[fallback] }),
    ];
    const E = m.cfg.engine;
    const modes = L.MODES.map((mode) => {
        const base = m.cfg.modes[mode], enabled = !sportOnly || mode === 'sportplus';
        const cell = (part, def) => {
            const key = mode + part, n = Number(g(key)), v = part === 'Shift' ? L.shiftRpm(n) : num(n) && n > 0 ? n : 0;
            // "Default" (0) steps as its rpm: between the steps under and over it, before an equal one
            const rpm = (x) => x || def, it = itemOf(m, key);
            const order = Object.assign({}, it, { steps: (it.steps || []).slice().sort((a, b) => rpm(a) - rpm(b) || a - b) });
            const mm = Object.assign({}, m, { schema: [order] });
            return { key, value: v ? fmtRpm(v) : 'Default (' + fmtRpm(def) + ')', controls: stepper(mm, 'behavior', key, v, rpm) };
        };
        return { mode, label: MODE_NAME[mode], enabled, invalid: L.modeThresholds(m.cfg, m.get, mode).invalid, start: cell('Start', base.start), shift: cell('Shift', base.shift) };
    });
    const notes = [
        { text: 'Shift must be ' + L.MIN_SPAN + '+ rpm over first light.', tone: 'dim' },
        { text: 'Cold oil lowers the limit: ' + fmtRpm(E.limitCold) + ' rpm at ' + toF(E.oilCold) + ' F or less, full ' + fmtRpm(E.limitWarm) + ' from ' + toF(E.oilWarm) + ' F.', tone: 'dim' },
    ];
    if (sportOnly) notes.push({ text: 'Only in Sport+ is on: Comfort and Sport never light.', tone: 'dim' });
    const bad = modes.filter((x) => x.invalid).map((x) => x.label);
    if (bad.length) notes.push({ text: bad.join(', ') + ': these don\'t fit, using the defaults.', tone: 'warn' });
    return { id: 'behavior', rows, note: 'Drive mode now: ' + modeLine(m), noteTone: 'dim', modes, notes };
}

function about(m) {
    return {
        id: 'about',
        note: 'Shift Lights ' + (m.version || ''),
        noteTone: 'dim',
        blocks: [
            { title: 'Remove safely', lines: ['Store > Shift Lights > Remove.', 'Never kill or restart it by hand: three crashes', 'in about 30 s wipe every app.'] },
            { title: 'Kill switch', lines: ['Home > All off, or a file named ' + m.cfg.safety.killFile, 'in the app\'s data folder.'] },
        ],
        rows: ['layout', 'renderer', 'demo', 'flashMode'].map((key) => {
            const v = choice(m, key);
            const flash = v === 'renderer' ? 'Renderer: the cluster plays it (a G01 showed solid red)' : 'App: this app turns it on and off, 8 times a second';
            return row(key, 'pills', { layout: 'Screen layout', renderer: 'Renderer', demo: 'Demo data', flashMode: 'Shift flash' }[key],
                { layout: 'Standard keeps the HMI\'s own title and bar', renderer: 'Software: no GPU renderer, slower', demo: 'Auto: demo data until the car answers', flashMode: flash }[key],
                pills(m, 'about', key, v), { value: SHORT[key][v] });
        }),
        rowsNote: 'Standard or Software: these pages become one settings list (Settings button).',
    };
}

const clock = (t) => {
    if (typeof t !== 'number' || !isFinite(t)) return '-';
    const d = new Date(t), two = (n) => (n < 10 ? '0' : '') + n;
    return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
};
const RENDER_WORDS = { rendered: 'rendered', unsubscribed: 'renderer not subscribed', unobservable: 'renderer cannot tell (not observable)', published: 'scene published, not requested', '': 'no rendering line' };

/**
 * The Check tab (0.4.4): the verdict for the shown display and the proof under it, every time absolute (HH:MM:SS) so the
 * page changes only when the renderer says something new. Buttons: Reset HUD drawing (dimmed with nothing shown, within
 * the cooldown after the last rebuild, or while the renderer's guard has the target off) and Refresh (asks the renderer's
 * status now). 0.4.5: the Renderer guard and Display link rows (crstatus.js guard and dcsm).
 */
function check(m) {
    const ds = L.readDisplays(m.get), which = ds.display === 'cluster' ? 'cluster' : 'hud', v = verdictOf(m, which);
    const p = m.proof || null, heal = m.heal || {}, hc = m.cfg.hudCheck || L.DEFAULTS.hudCheck, now = num(m.now) ? m.now : Date.now();
    const mine = p ? p.layers.filter((l) => l.which === which) : [];
    const name = mine.length ? mine[0].target : which === 'hud' ? 'hud' : 'panel';
    const ev = p && p.targets[name], st = p && p.status, sv = st && st.targets[name], r = st && st.rendering[name];
    const s = L.readStyle(m.cfg, m.get, which, m.night ? m.night.night : null), n = m.night || {};
    const car = n.night === true ? 'car says night' : n.night === false ? 'car says day' : n.sub === 'missing' ? 'no day / night signal' : 'no day / night yet';
    const lastAt = mine.reduce((a, l) => Math.max(a, l.lastSentAt || 0), 0);
    const g = st && st.guard ? st.guard[name] : null, dc = st ? st.dcsm : null;
    // the HUD's strike limit is 2 (cluster-render holds.cpp hud_rules); other targets' limits are not shown
    const guardRow = !st ? '-' : !g ? 'no strikes' : g.disabled ? (name === 'hud' ? 'HUD' : name) + ' off after ' + g.strikes + ' strikes: Store > Cluster renderer > Update, or guard-reset'
        : g.strikes + ' strike' + (g.strikes === 1 ? '' : 's') + (name === 'hud' ? ' of 2' : '') + ' (a display restart soon after showing it)';
    // absolute times like every row (no relative ones: the page changes only when the renderer says something new); up
    // since about the Read-back time on every Refresh = Dcsm2 keeps coming up again (the renderer never settles)
    const linkRow = !dc ? '-' : (dc.up ? 'Dcsm2 up' : 'Dcsm2 down') + (dc.secs === null ? ' (never up yet)' : ' since ' + clock(st.at - dc.secs * 1000)) +
        (dc.up ? '; slot table ' + (dc.tableSecs === null ? 'none since it came up' : 'at ' + clock(st.at - dc.tableSecs * 1000)) : '');
    const lines = [
        ['Renderer link', p ? p.link + (p.backend ? ' (' + p.backend + ')' : '') + (p.holding ? ', rebuilding' : '') : 'none'],
        ['Target ' + name, ev ? ev.state + (ev.holder ? ', holder ' + ev.holder : '') + (ev.reason ? ': ' + ev.reason : '') + ' at ' + clock(ev.at) : 'no event yet'],
        ['Read-back', sv ? sv.line + ' at ' + clock(st.at) : st ? 'no line for ' + name + ' at ' + clock(st.at) : 'no status yet'],
        ['Rendering', r ? RENDER_WORDS[r.kind] + (r.secs !== null ? ', subscribed ' + r.secs + ' s' : '') + (r.ms !== null ? ' for ' + r.ms + ' ms' : '') : '-'],
        ['Layers', mine.length ? mine.map((l) => l.role + ' #' + l.ref + ' ' + l.state + (l.reason ? ' (' + l.reason + ')' : '')).join(', ') : 'none'],
        ['Last written', mine.length ? mine.map((l) => l.role + ' ' + l.lastSent).join('; ') + ' at ' + clock(lastAt || null) : '-'],
        ['Brightness now', Math.round(L.levelOf(m.cfg, s) * 100) + ' % (Night dim ' + SHORT[which + 'NightMode'][s.nightMode] + ', ' + car + ')'],
        ['Other apps on the scene', st ? (st.others.length ? st.others.join(', ') : 'none') : '-'],
        ['Renderer guard', guardRow],
        ['Display link', linkRow],
        ['Self-heal', (heal.used || 0) + ' of ' + hc.maxAuto + ' automatic rebuilds used' + (heal.last ? '; last: ' + heal.last.why + ' at ' + clock(heal.last.at) : '') +
            (heal.gaveUp ? '; gave up' : '')],
    ];
    const cooling = num(heal.lastAt) && now >= heal.lastAt && now - heal.lastAt < hc.manualCooldownMs;
    return {
        id: 'check', note: (which === 'hud' ? 'HUD: ' : 'Cluster: ') + v.text, noteTone: v.code === 'ok' ? 'on' : 'warn', detail: v.detail, code: v.code, lines,
        foot: 'Rendered means the renderer took our scene: the best proof the app can see, not a photo of the HUD',
        buttons: [
            { key: 'check:reset', text: 'Reset HUD drawing', cmd: 'hudReset', writes: [], busy: !mine.length || !!cooling || !!(g && g.disabled) },
            { key: 'check:refresh', text: 'Refresh', cmd: 'refresh', writes: [] },
        ],
    };
}

/** Page i's content (out of range: Home). */
function view(i, m) {
    const p = IDS[i] || 'home';
    if (p === 'hud' || p === 'cluster') return display(m, p);
    if (p === 'behavior') return behavior(m);
    if (p === 'about') return about(m);
    if (p === 'check') return check(m);
    return home(m);
}

/** Every control of a page's content, in drawing (focus) order. */
function controlsOf(v) {
    const out = [];
    (v.cards || []).forEach((c) => c.controls.forEach((x) => out.push(x)));
    if (v.noteAction && !v.noteAction.busy) out.push(v.noteAction);
    (v.rows || []).forEach((r) => { if (r.enabled) r.controls.forEach((x) => out.push(x)); });
    (v.modes || []).forEach((r) => { if (r.enabled) r.start.controls.concat(r.shift.controls).forEach((x) => out.push(x)); });
    if (v.alloff) out.push(v.alloff);
    (v.buttons || []).forEach((b) => { if (!b.busy) out.push(b); });
    return out;
}

module.exports = { PAGES, IDS, view, controlsOf, stepOf, fmtRpm, toF, SHORT };
