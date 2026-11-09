'use strict';
/**
 * Battery & Electrical - a 12 V battery monitor drawn in the HMI's style. Reading only.
 *
 * Voltage (F442, the OBD "control module voltage" = terminal 30), current, state of
 * charge, state of health and temperature come from the intelligent battery sensor (IBS)
 * via the engine unit, read with UDS 0x22 over the head unit's diagnostic link - the same
 * identifiers Live Data and eDrive use. The DIDs and scalings are in app.json (config).
 * It never writes to any unit. With no car present it shows a synthetic battery.
 *
 * The IBS current is negative when discharging. health.js turns the readings into a
 * charge estimate, a charging/resting/discharging state and a good/aging/weak verdict.
 */
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./kit/dids');
const { assess } = require('./health');
const Demo = require('./demo');

const W = 1600, H = 520;
const GO = '#2fd27a';

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const cfg = ctx.spec.config || {};
        const pollMs = cfg.pollMs || 4000;

        /* ---------- diagnostic link (one request at a time) ---------- */
        const diag = new Diag(ctx.signals, log);
        diag.quiet = true;
        diag.init();
        const reader = new DidReader(diag, { ecu: cfg.ecu });
        const queue = [];
        let pumping = false;
        async function pump() {
            if (pumping) return;
            pumping = true;
            while (queue.length) {
                const j = queue.shift();
                try { j.res(await j.fn()); } catch (e) { j.rej(e); }
            }
            pumping = false;
        }
        const exclusive = (fn) => new Promise((res, rej) => { queue.push({ fn: fn, res: res, rej: rej }); pump(); });
        const readValue = (key) => exclusive(() => reader.value(key, cfg[key]));

        /* ---------- live data ---------- */
        const live = { voltage: null, current: null, soc: null, soh: null, temp: null, at: 0 };
        const demo = new Demo(), t0 = Date.now();
        let feedDemo = false, polling = false;
        const usingDemo = () => settings.get('demo') === 'on'
            || (settings.get('demo') === 'auto' && !diag.available && Date.now() - t0 > 4000);

        async function poll() {
            if (polling || feedDemo || !diag.available) return;
            polling = true;
            try {
                const v = await readValue('v12'); if (v !== null) live.voltage = v;
                const i = await readValue('i12'); if (i !== null) live.current = i;
                const soc = await readValue('soc12'); if (soc !== null) live.soc = soc;
                const soh = await readValue('soh12'); if (soh !== null) live.soh = soh;
                const t = await readValue('t12'); if (t !== null) live.temp = t;
                if (v !== null || i !== null) live.at = Date.now();
            } catch (e) { log.warn('poll: ' + e); }
            polling = false;
        }
        setInterval(poll, pollMs);
        diag.on('available', (a) => { if (a) poll(); });

        /** The values to show: synthetic in demo, otherwise the last poll. */
        function current() {
            feedDemo = usingDemo();
            if (feedDemo) { const d = demo.reading(Date.now()); d.at = Date.now(); d.demo = true; return d; }
            return live;
        }

        /* ---------- drawing ---------- */
        const V = (x, d) => (G.isNum(x) ? x.toFixed(d) : '--');
        const ago = (at) => { const s = Math.round((Date.now() - at) / 1000); return s < 2 ? 'just now' : s + ' s ago'; };

        function bar(cv, t, x, y, w, pct, col) {
            cv.roundRect(x, y, w, 16, 8, withAlpha('#ffffff', 0.12));
            if (G.isNum(pct)) cv.roundRect(x, y, Math.max(16, w * Math.max(0, Math.min(100, pct)) / 100), 16, 8, col);
        }

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            const r = current();
            const a = assess(r);

            // --- 12 V battery ---
            G.panel(cv, t, 24, 44, 728, 468, '12 V battery');
            const vCol = a.state === 'charging' ? GO
                : r.voltage == null ? t.dim
                : r.voltage < 11.9 ? t.crit : r.voltage > 15.0 ? (t.warn || '#ffb020') : t.text;
            cv.text(V(r.voltage, 2), 420, 250, 150, vCol, { align: 'right', font: 'num' });
            cv.text('V', 436, 250, 40, t.dim);
            // state
            const stWord = a.state === 'charging' ? 'CHARGING' : a.state === 'discharging' ? 'DISCHARGING'
                : a.state === 'resting' ? 'AT REST' : 'NO DATA';
            const stCol = a.state === 'charging' ? GO : a.state === 'discharging' ? (t.warn || '#ffb020') : t.dim;
            cv.roundRect(48, 300, 656, 48, 8, withAlpha(stCol, 0.16));
            cv.text(stWord, 376, 332, 26, stCol, { align: 'center', font: 'bold', spacing: 3 });
            // current
            const amps = r.current;
            const cTxt = !G.isNum(amps) ? 'Current --'
                : (amps >= 0 ? 'Charging ' : 'Drawing ') + Math.abs(amps).toFixed(1) + ' A';
            cv.text(cTxt, 48, 404, 26, t.text, { font: 'bold' });
            cv.text('Temperature ' + V(r.temp, 0) + ' °C', 704, 404, 22, t.dim, { align: 'right', font: 'label' });
            cv.text('Reading only · no writes to any control unit', 48, 480, 20, t.dim, { font: 'label' });

            // --- charge & health ---
            G.panel(cv, t, 776, 44, 372, 468, 'Charge & health');
            cv.text('Charge', 800, 128, 22, t.dim, { font: 'bold', spacing: 1 });
            cv.text(G.isNum(a.charge) ? a.charge + '%' : '--', 1124, 128, 28, t.text, { align: 'right', font: 'num' });
            bar(cv, t, 800, 144, 324, a.charge, a.charge != null && a.charge < 50 ? (t.warn || '#ffb020') : t.accent2 || '#81c4ff');
            if (a.restCharge != null && (r.soc == null)) cv.text('from resting voltage', 800, 192, 18, t.dim, { font: 'label' });

            cv.text('State of health', 800, 250, 22, t.dim, { font: 'bold', spacing: 1 });
            cv.text(G.isNum(r.soh) ? Math.round(r.soh) + '%' : '--', 1124, 250, 28, t.text, { align: 'right', font: 'num' });
            const sohCol = a.sohClass === 'good' ? GO : a.sohClass === 'fair' ? (t.warn || '#ffb020') : a.sohClass === 'poor' ? t.crit : t.dim;
            bar(cv, t, 800, 266, 324, r.soh, sohCol);
            cv.text(a.sohClass === 'unknown' ? 'health not reported' : a.sohClass, 800, 314, 18, sohCol, { font: 'label' });

            cv.text('A charge estimate from resting voltage; SOC and SOH come from the IBS.', 800, 492, 17, t.dim, { font: 'label' });

            // --- status ---
            G.panel(cv, t, 1172, 44, 404, 468, 'Status');
            const vWord = a.verdict === 'good' ? 'GOOD' : a.verdict === 'aging' ? 'AGING' : 'WEAK';
            const vcol = a.verdict === 'good' ? GO : a.verdict === 'aging' ? (t.warn || '#ffb020') : t.crit;
            cv.text(vWord, 1374, 176, 72, vcol, { align: 'center', font: 'bold', spacing: 2 });
            const warns = a.warnings.length ? a.warnings : ['No warnings'];
            warns.slice(0, 4).forEach((wn, i) => {
                const y = 250 + i * 48;
                cv.circle(1200, y - 6, 5, a.warnings.length ? (t.warn || '#ffb020') : GO);
                cv.text(wn, 1218, y, 19, a.warnings.length ? t.text : t.dim, { font: 'label' });
            });
            const src = r.demo ? 'DEMO data' : (G.isNum(r.voltage) ? 'updated ' + ago(r.at) : diag.available ? 'reading…' : 'waiting for the diagnostic link');
            cv.text(src, 1196, 492, 18, t.dim, { font: 'label' });

            return ui.image('MAIN_GFX', cv);
        }

        ctx.loop('MAIN', 6, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
