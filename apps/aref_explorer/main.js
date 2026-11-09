'use strict';
/**
 * Car Explorer: finds the head unit's services behind a car feature (ambient light, route guidance and
 * ETA, GPS position, now playing, climate, lights, doors, fuel) in its SOME/IP interface catalog, and
 * shows what each offers: fields, methods and broadcasts. A report of everything it finds goes to
 * explorer-report.txt in its data folder, which is what a new app for a feature is designed from.
 *
 * Read-only: it reads two files the platform keeps (the catalog and oap-mainapp's interface folder). It
 * subscribes to nothing, calls nothing and sends nothing to the car.
 *
 * Node 8 only (the car's version). Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const CAT = require('./catalog');

const VERSION = '0.2.1';
const W = 1600, H = 520;
const ROWS = 9;
// MGU_EXPLORER_ROOT: a folder standing in for / (tools/screens.js on a PC)
const ROOT = process.env.MGU_EXPLORER_ROOT || '/';
const CATALOG = path.join(ROOT, 'etc/oap/someip/someip-interfaces.json');
const SRC_GEN = path.join(ROOT, 'usr/lib/oap-mainapp/src-gen');

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            const REPORT = path.join(ctx.dataDir, 'explorer-report.txt');
            let db = null, error = '', total = 0, srcGen = [];
            try {
                db = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
                total = Object.keys((db && db.interfaces) || db || {}).length;
            } catch (e) { error = 'catalog not read: ' + (e.code || e.message); }
            try { srcGen = fs.readdirSync(SRC_GEN).filter((n) => /\.json$/.test(n)); } catch (e) { /* not on this unit */ }
            log.info('catalog: ' + (error || total + ' interfaces') + '; oap-mainapp interface files: ' + srcGen.length);

            let topic = 0, page = 0, toast = null, cache = {};
            let detail = -1, dpage = 0;          // Details: which match (-1: the list), and its page
            const say = (text, ms) => { toast = { text: text, until: Date.now() + (ms || 4000) }; };
            const hits = () => {
                const k = CAT.ORDER[topic];
                if (!cache[k]) cache[k] = db ? CAT.search(db, CAT.TOPICS[k], 40) : [];
                return cache[k];
            };
            const save = () => {
                const head = ['Car Explorer ' + VERSION + ', ' + new Date().toISOString(), 'Catalog: ' + (error || total + ' interfaces'),
                    'oap-mainapp interface files (' + srcGen.length + '): ' + srcGen.join(', ')];
                fs.writeFileSync(REPORT, head.join('\n') + '\n' + (db ? CAT.report(db, total) : '') + '\n');
            };
            // the report is written once at start (the catalog doesn't change while the car runs)
            try { save(); log.info('report: ' + REPORT); } catch (e) { log.warn('report: ' + e.message); }

            ui.onClick('BTN_TOPIC', guard('topic', () => { topic = (topic + 1) % CAT.ORDER.length; page = 0; detail = -1; ui.text('BTN_DETAIL', 'Details'); }));
            ui.onClick('BTN_MORE', guard('more', () => { if (detail >= 0) dpage++; else page++; }));
            // Details steps through the matches one by one, then back to the list
            ui.onClick('BTN_DETAIL', guard('detail', () => {
                const n = hits().length;
                detail = n ? (detail + 1 < Math.min(n, 40) ? detail + 1 : -1) : -1;
                dpage = 0;
                ui.text('BTN_DETAIL', detail >= 0 ? 'Next match' : 'Details');
            }));
            ui.onClick('BTN_SAVE', guard('save', () => { save(); say('Saved to ' + REPORT); }));

            const fit = (cv, s, size, w, opt) => {
                s = String(s || '');
                if (cv.textWidth(s, size, opt) <= w) return s;
                while (s.length > 1 && cv.textWidth(s + '...', size, opt) > w) s = s.slice(0, -1);
                return s + '...';
            };
            function drawDetail(cv, t, L, h) {
                const ms = CAT.membersOf(h.def), PER = 16;
                cv.text(fit(cv, h.iface.replace('de.bmw.infotainment.', '').replace('com.harman.infotainment.', ''), 24, W - 420, { font: 'bold', literal: true }), 40, 50, 24, t.text, { font: 'bold', literal: true });
                cv.text('Match ' + (detail + 1) + ' of ' + hits().length + '   \u00b7   ' + ms.length + ' members', W - 40, 50, 18, t.dim, { align: 'right', literal: true });
                const pages = Math.max(1, Math.ceil(ms.length / PER)), pg = dpage % pages;
                ms.slice(pg * PER, pg * PER + PER).forEach((m, i) => {
                    const y = 92 + i * 25, hit = CAT.TOPICS[CAT.ORDER[topic]].member.test(m[0]);
                    let d = '';
                    try { d = m[2] ? JSON.stringify(m[2]) : ''; } catch (e) { d = ''; }
                    cv.text(m[1].toUpperCase(), 40, y + 16, 13, t.dim, { font: 'bold', literal: true });
                    cv.text(fit(cv, m[0], 18, 520, L), 150, y + 16, 18, hit ? (t.accent2 || t.text) : t.text, hit ? { font: 'bold', literal: true } : L);
                    if (d) cv.text(fit(cv, d, 15, W - 740, L), 700, y + 16, 15, t.dim, L);
                });
                if (pages > 1) cv.text('Page ' + (pg + 1) + ' of ' + pages + ' (More)', W - 40, H - 14, 16, t.dim, { align: 'right', literal: true });
            }
            ctx.loop('MAIN', 2, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg), L = { literal: true };
                const T = CAT.TOPICS[CAT.ORDER[topic]], list = hits();
                if (detail >= 0 && list[detail]) {
                    drawDetail(cv, t, L, list[detail]);
                    if (toast && Date.now() < toast.until) cv.text(toast.text, 40, H - 14, 16, t.accent2 || t.text, L);
                    await ui.image('MAIN_GFX', cv);
                    return;
                }
                cv.text(T.name, 40, 50, 30, t.text, { font: 'bold', literal: true });
                cv.text((error || total + ' interfaces in the catalog') + '   ·   ' + list.length + ' match', W - 40, 50, 18, t.dim, { align: 'right', literal: true });
                if (!list.length) cv.text(error ? 'The catalog could not be read: ' + error : 'Nothing in the catalog matches this topic.', 40, 100, 22, t.dim, L);
                const pages = Math.max(1, Math.ceil(list.length / ROWS)), pg = page % pages;
                list.slice(pg * ROWS, pg * ROWS + ROWS).forEach((h, i) => {
                    const y = 86 + i * 46;
                    cv.text(fit(cv, h.iface.replace('de.bmw.infotainment.', '').replace('com.harman.infotainment.', ''), 20, 760, { font: 'bold', literal: true }), 40, y + 18, 20, t.text, { font: 'bold', literal: true });
                    const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
                    cv.text(pl(h.fields, 'field') + ', ' + pl(h.methods, 'method') + ', ' + pl(h.broadcasts, 'broadcast'), 40, y + 38, 14, t.dim, L);
                    cv.text(fit(cv, h.names.map((n) => n[0]).join(', ') || '(matched by its name)', 17, W - 860, L), 820, y + 24, 17, t.accent2 || t.dim, L);
                });
                if (pages > 1) cv.text('Page ' + (pg + 1) + ' of ' + pages + ' (More)', W - 40, H - 14, 16, t.dim, { align: 'right', literal: true });
                if (toast && Date.now() < toast.until) cv.text(toast.text, 40, H - 14, 16, t.accent2 || t.text, L);
                await ui.image('MAIN_GFX', cv);
            }));
            log.info('started ' + VERSION);
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
