'use strict';
/**
 * sport.js - HUD Lyrics' Sport HUD: in Sport, Sport+ and Sport Individual, Redline's "Ramp" tach (after the G80/G82
 * M3 and M4's head-up display) replaces the lyrics on the HUD; in every other mode it goes and the lyrics come back.
 *
 * The drawing is Redline's own (hud-draw.js, hud-m.js, hud-theme.js, copied unchanged, MIT): drawHud() with style
 * 'ramp'. This file is the little Redline's hud.js did around it that the Ramp needs, cut down:
 *   - the car: rpm, gear and selector, the gearbox program (D / S / M), oil and water (kit car.js), the drive mode
 *     (FES statusFESVehicleDynamicSwitchHMI: 1-3 Sport, 4-6 Comfort, 7-9 Eco Pro, 10 Adaptive);
 *   - the lights as Redline's plain rev bar (its "rev" light mode): they count in from SHIFT - SPAN and flash at the
 *     shift point; the redline flashes as the limiter. Nothing learned, no shift grades, no logs;
 *   - one 400 x 130 image layer on cluster-render's 'hud' target where Redline puts it at 100 % (x 200, y 140 of the
 *     800 x 480 scene); dark is see-through on the glass; only the changed boxes are sent, at most FPS a second.
 *
 * Redline's canvas has fill() and stroke() (the rail in one piece); this kit's Canvas gets them here, from Redline's
 * kit, if it lacks them, so the copied files draw as they do in Redline. Node 8. Never throws out of a timer.
 */
const { Canvas, rgba } = require('./kit/canvas');
const { loadClient } = require('./kit/cluster_render');
const Car = require('./kit/car');
// 0.6.0: the gearbox oil temperature, Redline's own reader (EGS over read-only UDS, else BasicDataSet)
const GearboxTemp = require('./gearbox');

/* ---------- Redline's kit canvas: fill() / fillPolys() / stroke(), for the Ramp's rail and band ---------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
if (!Canvas.prototype.fill) {
    // from cauliflowermossgrape/idrive7-apps kit/runtime/canvas.js (MIT), unchanged
    Canvas.prototype.fill = function (pts, c) { return this.fillPolys([pts], c); };
    Canvas.prototype.fillPolys = function (polys, c) {
        polys = (polys || []).filter((q) => q && q.length >= 3);
        if (!polys.length) return this;
        c = rgba(c);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        polys.forEach((q) => q.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
        const X0 = Math.max(0, Math.floor(x0)), X1 = Math.min(this.w, Math.ceil(x1)), Y0 = Math.max(0, Math.floor(y0)), Y1 = Math.min(this.h, Math.ceil(y1));
        if (X1 <= X0 || Y1 <= Y0) return this;
        const S = 4, acc = new Float32Array(X1 - X0), xs = [];
        const span = (l, r) => {
            l = Math.max(l, X0); r = Math.min(r, X1);
            for (let px = Math.floor(l); px < r; px++) acc[px - X0] += Math.min(r, px + 1) - Math.max(l, px);
        };
        for (let py = Y0; py < Y1; py++) {
            acc.fill(0);
            for (let k = 0; k < S; k++) {
                const sy = py + (k + 0.5) / S;
                xs.length = 0;
                for (const pts of polys) {
                    const n = pts.length;
                    for (let i = 0; i < n; i++) {
                        const a = pts[i], b = pts[(i + 1) % n];
                        if ((a[1] <= sy) !== (b[1] <= sy)) xs.push(a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
                    }
                }
                xs.sort((p, q) => p - q);
                for (let j = 0; j + 1 < xs.length; j += 2) span(xs[j], xs[j + 1]);
            }
            for (let px = X0; px < X1; px++) { const cov = acc[px - X0] / S; if (cov > 0.002) this._blend(px, py, c, Math.min(1, cov)); }
        }
        return this;
    };
    Canvas.prototype.stroke = function (pts, width, c) {
        if (!pts || pts.length < 2) return this;
        c = rgba(c);
        const hw = width / 2;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
        x0 = Math.max(0, Math.floor(x0 - hw - 1)); x1 = Math.min(this.w, Math.ceil(x1 + hw + 1));
        y0 = Math.max(0, Math.floor(y0 - hw - 1)); y1 = Math.min(this.h, Math.ceil(y1 + hw + 1));
        for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
                let d2 = Infinity;
                for (let i = 1; i < pts.length; i++) {
                    const xa = pts[i - 1][0], ya = pts[i - 1][1], vx = pts[i][0] - xa, vy = pts[i][1] - ya;
                    const qx = px + 0.5 - xa, qy = py + 0.5 - ya, t = clamp01((qx * vx + qy * vy) / (vx * vx + vy * vy || 1));
                    const ex = qx - vx * t, ey = qy - vy * t;
                    d2 = Math.min(d2, ex * ex + ey * ey);
                }
                const cov = clamp01(hw - Math.sqrt(d2) + 0.5);
                if (cov > 0) this._blend(px, py, c, cov);
            }
        }
        return this;
    };
}
// required after the canvas has fill(): hud-draw makes its cached background with this Canvas
const Draw = require('./hud-draw');

const IW = Draw.IW, IH = Draw.IH;                 // 400 x 130
const PLACE = { x: 200, y: 140 };                 // Redline's tach at 100 % and Position 0 in the ID7 HUD scene (800 x 480)
const SCENE_W = 800, SCENE_H = 480;
const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);
/**
 * 0.6.1: where the tach shows, from Settings "Sport HUD: size / left-right / up-down" - Redline's placeOf() (size 40-140 %,
 * x -120..280, y -120..220 from x 200, y 140). The defaults, x -40 and y +50, put it in the middle of the part of the glass
 * the driver sees (x 120..605, y 100..378; the drawing itself sits 32..394 of its 400 px, so Redline's 0 reads right of
 * centre) and low, just above BMW's limit sign and speed (y 320 on, x 116..352).
 */
function placeOf(settings) {
    const num = (k, d) => { const v = Number(settings.get(k)); return isFinite(v) && settings.get(k) !== undefined && settings.get(k) !== null ? v : d; };
    const k = clampN(num('sportSize', 100), 40, 140) / 100;
    const w = Math.round(IW * k), h = Math.round(IH * k);
    const x = Math.round((SCENE_W - IW) / 2) + Math.round((IW - w) / 2) + clampN(num('sportX', -40), -200, 280);
    const y = PLACE.y + clampN(num('sportY', 50), -120, 220);
    return { x: clampN(x, 0, SCENE_W - w), y: clampN(y, 0, SCENE_H - h), w: w, h: h };
}
const FPS = 20, BLINK_MS = 100, RECONNECT_MS = 8000, LOAD_RETRY_MS = 30000, MODE_HOLD_MS = 600;
const SPAN = 1500;                                // the lights count in over this many rpm before the shift point
const isNum = (x) => typeof x === 'number' && isFinite(x);
// as Redline's readoutsFor: the bands in deg C; oil under "Oil warm at" reads warm (yellow)
const TEMPS = [['OIL', 'oil', 'sportOil', { cold: 60, hot: 130, warmOil: true }], ['GEARBOX', 'gearbox', 'sportGearbox', { cold: 50, hot: 120 }],
    ['WATER', 'coolant', 'sportWater', { cold: 60, hot: 112 }]];
const COLD_LIMIT = 4500;                          // Redline's petrol cold limit: the shift point with the oil at 30 deg C
const asBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.length);

/** The drive mode's wire number (name, number or number as text) -> 'sport' | 'other' | null (unknown, initialising). */
const MODE_NUM = { SPORT_DYNAMIC: 1, SPORT_EXPERT: 2, SPORT_INDIVIDUAL: 3, COMFORT: 4, COMFORT_PLUS: 5, COMFORT_INDIVIDUAL: 6,
    ECO_PRO_EFFICIENT: 7, ECO_PRO_PLUS: 8, ECO_PRO_INDIVIDUAL: 9, ADAPTIVE: 10 };
function modeOf(v) {
    const raw = v && typeof v === 'object' ? v.actualValueModeDrivingExperience : v;
    let n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : MODE_NUM[String(raw || '').toUpperCase()];
    if (!isNum(n)) return null;
    return n >= 1 && n <= 3 ? 'sport' : n >= 4 && n <= 10 ? 'other' : null;
}

/** The changed box of a and b (w x h RGBA) per band (lights, rail, text), as Redline sends them. */
function changedBox(a, b, w, y0, h) {
    const A = new Uint32Array(a.buffer, a.byteOffset + y0 * w * 4, w * h), B = new Uint32Array(b.buffer, b.byteOffset + y0 * w * 4, w * h);
    let x0 = w, x1 = -1, t = h, bt = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let l = -1, r = -1;
        for (let x = 0; x < w; x++) if (A[row + x] !== B[row + x]) { l = x; break; }
        if (l < 0) continue;
        for (let x = w - 1; x >= l; x--) if (A[row + x] !== B[row + x]) { r = x; break; }
        if (y < t) t = y;
        bt = y;
        if (l < x0) x0 = l;
        if (r > x1) x1 = r;
    }
    return bt < 0 ? null : { x: x0, y: y0 + t, w: x1 - x0 + 1, h: bt - t + 1 };
}
const BANDS = [[0, 20], [20, 60], [60, IH]];
function packRects(d, w, rs) {
    let n = 0;
    rs.forEach((r) => { n += r.w * r.h * 4; });
    const out = Buffer.alloc(n), src = asBuffer(d);
    let off = 0;
    rs.forEach((r) => { for (let y = 0; y < r.h; y++) { src.copy(out, off, ((r.y + y) * w + r.x) * 4, ((r.y + y) * w + r.x + r.w) * 4); off += r.w * 4; } });
    return out;
}

class SportHud {
    /** o: ctx (signals, log), settings (redline, shift, enabled), app */
    constructor(o) {
        this.ctx = o.ctx; this.log = o.ctx.log; this.app = o.app; this.settings = o.settings;
        // a fault in the car signals leaves the tach without data, never the app down (two crashes uninstall an app)
        this.gearbox = null;
        try {
            this.gearbox = new GearboxTemp(o.ctx);
            const gh = this.gearbox.handlers();
            if (o.ctx.signals && o.ctx.signals.watch) Object.keys(gh).forEach((iface) => o.ctx.signals.watch(iface, '1', gh[iface], this.log).catch(() => {}));
        } catch (e) { this.gearbox = null; this.log.warn('sport hud: gearbox ' + (e && e.message)); }
        try { this.car = new Car(o.ctx, ['rpm', 'temps', 'gear', 'program'], { demo: false }); }
        catch (e) { this.car = { data: () => ({}) }; this.log.warn('sport hud: car signals ' + (e && e.message)); }
        this.mode = null; this.modeAt = 0; this.rawMode = undefined;
        this.cr = null; this.ready = false; this.ref = 0; this.err = null; this.errAt = 0; this.downAt = 0; this.tState = '';
        this.cur = new Canvas(IW, IH); this.prev = new Canvas(IW, IH); this.first = true; this.lastKey = '';
        this.cue = { from: 0, at: 0, shift: false, limiter: false };
        this.timer = null; this.sent = 0;
        this.test = 0;                                         // a demo sweep until this time (the screen's button)
        const sig = this.ctx.signals;
        if (sig && sig.watch) {
            sig.watch('de.bmw.infotainment.drivingexcitement.FES', '1', {
                statusFESVehicleDynamicSwitchHMI: (v) => {
                    try {
                        const raw = v && typeof v === 'object' ? v.actualValueModeDrivingExperience : v;
                        if (JSON.stringify(raw) !== JSON.stringify(this.rawMode)) { this.rawMode = raw; this.log.info('sport hud: drive mode raw ' + JSON.stringify(raw)); }
                        const m = modeOf(v);
                        if (m && m !== this.mode) { this.mode = m; this.modeAt = Date.now(); this.log.info('sport hud: ' + (m === 'sport' ? 'Sport - the tach' : 'not Sport - the lyrics')); }
                    } catch (e) { this.log.warn('sport hud: mode ' + e.message); }
                },
            }, this.log, { pollMs: 2000 }).then((s) => this.log.info('sport hud: drive mode ' + (s.error ? 'error: ' + s.error : 'subscribed'))).catch(() => {});
        }
    }

    /** True while the tach should own the HUD (Sport, the setting on, or the screen's test sweep). */
    wants() {
        if (Date.now() < this.test) return true;
        return this.settings.get('sportHud') !== false && this.mode === 'sport';
    }
    redline() { const r = Number(this.settings.get('redlineRpm')); return r > 3000 ? r : 6500; }
    shiftAt() { const s = Number(this.settings.get('shiftRpm')); return s > 2000 ? Math.min(s, this.redline() - 100) : this.redline() - 300; }
    /** Redline's shiftPoint(): the shift point lowered while the oil is cold -> { rpm, cold }. */
    shiftPoint(oil) {
        const n = this.shiftAt(), warm = Number(this.settings.get('warmOil')) || 80;
        if (this.settings.get('coldGuard') === false || !isNum(oil) || oil >= warm) return { rpm: n, cold: false };
        const cold = Math.min(COLD_LIMIT, n), f = Math.max(0, Math.min(1, (oil - 30) / (warm - 30)));
        return { rpm: Math.round((cold + (n - cold) * f) / 50) * 50, cold: true };
    }
    /** The readouts' values now, for the centre screen: 'OIL 95°  GEARBOX 70°  WATER 90°  LIMIT 5200'. */
    readings() {
        const f = this._frameData(Date.now());
        return (f.readouts || []).map((it) => it.label + ' ' + it.value).join('   ') || 'no readings from the car yet';
    }
    max() { return Math.ceil((this.redline() + 800) / 1000) * 1000; }
    /** Redline's paused(): BMW has the HUD (its own content, or the mapping guard). */
    paused() { return this.tDisabled || this.tState === 'parked' || this.tState === 'waiting' || this.tState === 'unavailable'; }
    /** The screen's status line: { kind, text }. */
    view() {
        if (this.settings.get('sportHud') === false) return { kind: 'off', text: 'Off in Settings' };
        if (this.err) return { kind: 'error', text: this.err.text };
        const testing = Date.now() < this.test, pre = testing ? 'Test  ·  ' : '';
        if (!testing && this.mode === null) return { kind: 'wait', text: 'Waiting for the drive mode' };
        if (!testing && this.mode !== 'sport') return { kind: 'off', text: 'Ready  ·  shows in Sport' };
        // 0.5.1: what the renderer says, so a photo of the screen tells why the HUD stays dark
        if (!this.cr || !this.ready) return { kind: 'wait', text: pre + 'connecting to the Cluster renderer' };
        if (this.lState === 'error') return { kind: 'error', text: pre + 'layer ' + this.lText };
        if (this.paused() || (this.lState && this.lState !== 'shown')) return { kind: 'wait', text: pre + 'HUD ' + (this.tText || '?') + ' · layer ' + (this.lText || '?') };
        return { kind: 'on', text: pre + 'Showing  ·  ' + this.sent + ' frames  ·  HUD ' + (this.tText || 'no state yet') };
    }
    demo(ms) { this.test = Date.now() + (ms || 8000); this.testAt = Date.now(); }
    /** 0.7.0: the readouts as items ({ label, value, tone }), for the centre screen's tiles. */
    items() { return (this._frameData(Date.now()).readouts || []).slice(); }
    /** 0.7.0: the tach as the HUD draws it now (IW x IH), made opaque over black, for the centre screen's preview. */
    preview() {
        const f = this._frameData(Date.now());
        f.blink = true;
        const cv = new Canvas(IW, IH);
        Draw.drawHud(cv, f);
        const d = cv.d;
        for (let p = 0; p < d.length; p += 4) { const a = d[p + 3] / 255; d[p] = d[p] * a; d[p + 1] = d[p + 1] * a; d[p + 2] = d[p + 2] * a; d[p + 3] = 255; }
        return cv;
    }
    driveMode() { return this.mode; }

    /** Called often by main.js: starts / stops the layer and draws. Returns wants(). */
    tick() {
        const on = this.wants();
        if (this.gearbox) { try { if (on && this.settings.get('sportGearbox') !== false) this.gearbox.start(); else this.gearbox.stop(); } catch (e) { /* the reader logs */ } }
        if (!on) { if (this.cr) this.close(); return false; }
        if (!this.cr) this._connect();
        if (!this.timer && this.cr) this.timer = setInterval(() => { try { this._frame(); } catch (e) { this.log.warn('sport hud: frame ' + (e && e.stack || e)); } }, Math.round(1000 / FPS));
        return true;
    }

    _connect() {
        const now = Date.now();
        if (this.err && now - this.errAt < LOAD_RETRY_MS) return;
        const c = loadClient({});
        if (c.error) { if (!this.err || this.err.error !== c.error) this.log.warn('sport hud: ' + c.text); this.err = c; this.errAt = now; return; }
        this.err = null;
        let cr;
        try { cr = this.cr = new c.ClusterRender(this.app + '-sport', c.sock); } catch (e) { this.err = { error: 'load', text: e.message }; this.errAt = now; this.cr = null; return; }
        cr.on('ready', () => { if (this.cr !== cr) return; this.ready = true; this.ref = 0; this.first = true; this.log.info('sport hud: connected'); });
        cr.on('disconnected', () => { if (this.cr !== cr) return; this.ready = false; this.ref = 0; this.downAt = Date.now(); });
        // 0.5.1: as Redline's hud.js - the target's state with who holds it; drawing pauses only for the states where BMW
        // has the HUD (paused()). 0.5.0 drew only once the state was 'shown', and in the car nothing ever showed.
        cr.on('target', (name, state, holder, reason, guideDisabled, disabled) => {
            if (this.cr !== cr || name !== 'hud') return;
            const t = disabled ? 'disabled (mapping guard)' : (state || '?') + (holder ? ' behind ' + holder : '') + (reason ? ' (' + reason + ')' : '');
            if (t !== this.tText) this.log.info('sport hud: hud target ' + t);
            this.tText = t; this.tState = state || ''; this.tDisabled = !!disabled;
            if (state === 'shown') this.first = true;
        });
        cr.on('layer', (ref, state, reason) => {
            if (this.cr !== cr || ref !== this.ref) return;
            const t = (state || '?') + (reason ? ' (' + reason + ')' : '');
            if (t !== this.lText) this.log.info('sport hud: layer ' + t);
            this.lText = t; this.lState = state || '';
        });
        cr.on('refused', (op, ref, reason) => { if (this.cr === cr) this.log.warn('sport hud: refused ' + op + ': ' + reason); });
        this.downAt = now;
        try { cr.connect(); } catch (e) { this.log.warn('sport hud: connect ' + e.message); }
    }

    /** What Redline's drawHud needs, from the car (or the test sweep). */
    _frameData(now) {
        const d0 = this.car.data ? this.car.data() : {};
        let d = { rpm: d0.rpm, gear: d0.gear, stage: d0.stage }, oil = d0.oil, coolant = d0.coolant;
        if (now < this.test) {
            // the test sweep: 1st to 3rd up through the lights to the flash, 4 s a gear
            const t = (now - this.testAt) / 1000, g = Math.min(3, 1 + Math.floor(t / 2.6)), k = (t % 2.6) / 2.6;
            d = { rpm: 1800 + k * (this.redline() - 1600), gear: g, stage: 'D' };
            oil = 104; coolant = 92;
        }
        const redline = this.redline(), sp = this.shiftPoint(oil), at = sp.rpm, rpm = d.rpm;
        const cue = { from: at - SPAN, at: at, shift: isNum(rpm) && rpm >= at, limiter: isNum(rpm) && rpm >= redline - 40, rate: 0, fallSince: null };
        const blink = cue.shift || cue.limiter ? Math.floor(now / BLINK_MS) % 2 === 0 : true;
        // Redline's order: the cold-engine limit first (while the oil is cold), then oil, gearbox, water. The Ramp shows the
        // first under the gear and three more on the right
        const items = [], warm = Number(this.settings.get('warmOil')) || 80;
        if (sp.cold && this.settings.get('sportLimit') !== false) items.push({ label: 'LIMIT', value: String(sp.rpm), tone: 'cold' });
        let gb = null;
        try { gb = now < this.test ? 78 : this.gearbox ? this.gearbox.value() : null; } catch (e) { gb = null; }
        const temps = { oil: oil, coolant: coolant, gearbox: gb };
        TEMPS.forEach((t) => {
            if (this.settings.get(t[2]) === false) return;
            const v = temps[t[1]];
            if (!isNum(v)) return;
            const lim = t[3];
            const tone = v < lim.cold ? 'cold' : lim.warmOil && v < warm ? 'warm' : v > lim.hot ? 'hot' : 'text';
            items.push({ label: t[0], value: Math.round(v) + '°', tone: tone });
        });
        const prog = d0.program;
        return {
            d: d, shift: at, redline: redline, max: this.max(), blink: blink, cue: cue, down: 0, peak: 0, chip: null, shake: null,
            readouts: items, mode: prog === 'M' || prog === 'S' || prog === 'D' ? prog : null,
            // Redline's Ramp as it ships: its own colours, squared gear digits, lights on, unlit ones dim
            opts: { style: 'ramp', palette: 'colour', gear: true, rpm: true, bar: true, lights: true, gt3: false, dim: true,
                lightStyle: 'bar', gearFont: 'square', clearLabels: false, mode: true },
        };
    }

    _frame() {
        if (!this.cr || !this.ready) {
            if (this.cr && Date.now() - this.downAt >= RECONNECT_MS) { this.log.info('sport hud: reconnecting'); this.close(); }
            return;
        }
        // 0.6.1: a new size or position from Settings moves the tach at once (a new layer in the new place)
        const r = placeOf(this.settings), pk = [r.x, r.y, r.w, r.h].join(',');
        if (this.ref && pk !== this.placeKey) { try { this.cr.drop(this.ref); } catch (e) { /* gone */ } this.ref = 0; }
        if (!this.ref) {
            // 0.5.1: Redline's own tach layer (hud.js makeLayer): class overlay, z 0, bilinear; drawn 400 x 130, shown w x h
            this.placeKey = pk;
            this.ref = this.cr.image({ target: 'hud', klass: 'overlay', z: 0, x: r.x, y: r.y, w: r.w, h: r.h, iw: IW, ih: IH, fps: FPS, sampling: 'bilinear' });
            this.lText = 'made'; this.lState = '';
            if (!this.ref) { this.log.warn('sport hud: layer refused by the client'); return; }
            this.first = true; this.lastKey = '';
            this.log.info('sport hud: layer ' + r.w + 'x' + r.h + ' at ' + r.x + ',' + r.y);
        }
        if (this.paused()) { this.first = true; return; }        // behind BMW's own content
        const now = Date.now(), f = this._frameData(now);
        const key = [Math.round((f.d.rpm || 0) / 25), f.d.gear, f.d.stage, f.blink, f.cue.shift, f.cue.limiter, f.mode, JSON.stringify(f.readouts)].join('|');
        if (!this.first && key === this.lastKey) return;
        this.lastKey = key;
        Draw.drawHud(this.cur, f);
        // the HUD glass: black is see-through. Redline draws on alpha 0, lit parts opaque: sent as drawn
        if (this.first) {
            if (this.cr.pixels(this.ref, null, asBuffer(this.cur.d))) this.first = false;
        } else {
            const rs = BANDS.map((b) => changedBox(this.cur.d, this.prev.d, IW, b[0], b[1] - b[0])).filter(Boolean);
            if (!rs.length) return;
            this.cr.pixels(this.ref, rs, packRects(this.cur.d, IW, rs));
        }
        this.sent++;
        const t = this.prev; this.prev = this.cur; this.cur = t;
    }

    close() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.gearbox) { try { this.gearbox.stop(); } catch (e) { /* stopping */ } }
        if (this.cr) { try { if (this.ref) this.cr.drop(this.ref); } catch (e) { /* gone */ } try { this.cr.close(); } catch (e) { /* closing */ } }
        this.cr = null; this.ready = false; this.ref = 0; this.first = true; this.tState = '';
    }
}

module.exports = { SportHud, modeOf, placeOf, IW, IH };
