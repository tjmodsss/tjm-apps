'use strict';
/**
 * Shift Lights - RPM shift lights on the instrument cluster (under the M logo) and the HUD, drawn by the
 * cluster-render service (cluster_render_client.js). The centre screen holds the settings pages (ui.js: Home, HUD,
 * Cluster, Behavior, About, Check), drawn only when something changes: no preview, no render loop.
 * 0.4.4: "Showing" comes from the renderer's read-back (hudcheck.verdict over output.status().proof), and a bounded
 * self-heal (hudcheck.healStep) runs on the 1 s tick, on every output change and on a wake (a wall-clock gap). "HUD" and
 * "Instrument cluster" are two on/off settings; each shows its own style, live.
 * The drive mode comes from the car (FES drive experience) when it sends one, else from the setting.
 * Tunables: config.js. Pure maths: logic.js, geom.js. Every callback goes through safety.guard: nothing may throw
 * out of the main loop (the kit exits on an uncaught exception, and the car wipes then uninstalls an app
 * that crashes). Kill switches: both on/off settings off, or the kill file whose path is logged at start.
 */
const fs = require('fs');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const L = require('./logic');
const { createSafety } = require('./safety');
const { createOutput } = require('./output');
const { createRpmPoll, pct } = require('./rpmpoll');
const { ClusterRender } = require('./cluster_render_client');
const { Canvas } = require('./kit/canvas');
const { createUi } = require('./ui');
const HC = require('./hudcheck');
const P = require('./pages');

const RATE_LOG_MS = 30000;
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const VEHICLE = 'de.bmw.infotainment.vehicle.Vehicle';     // statusDayNightChangeOver: the car's day / night (Night dim Auto)
const DN_LOG_MAX = 50;
const VERDICT_LOG_MAX = 200;    // 'hud check: <verdict>' lines at most a start (one per new verdict; car-logs.sh collects them)      // day / night log lines at most (one per new value)

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        try {
            const checked = L.validateConfig(require('./config'));
            const cfg = checked.cfg;
            checked.errors.forEach((e) => log.warn('config: ' + e));
            const safety = createSafety({ cfg, log });
            const guard = safety.guard;
            // SHIFTLIGHTS_CR_SOCKET: the emulator's fake service; unset on the car (the client's default path)
            const makeCanvas = (w, h) => new Canvas(w, h);
            // onChange: a link / target / layer / status / rebuild change redraws the pages and runs the HUD check (queued:
            // never inside output.apply); onRebuildDue: a self-heal's gap is over, make the layers again
            const output = createOutput({ ClusterRender, socketPath: process.env.SHIFTLIGHTS_CR_SOCKET || undefined, log, cfg, guard, makeCanvas,
                onChange: () => { if (viewKey() !== drawnKey) changed(); queueHeal(); }, onRebuildDue: () => refreshNow() });
            const killPath = safety.killFile(ctx.dataDir);
            log.info('kill switch file: ' + killPath);

            const get = (k) => settings.get(k);
            // 0.2.x saved "enabled" + "display": move them to the two on/off settings once; 0.4.3: a saved old HUD default
            // to today's, a manual night dim that was on to Night dim On (before any listener)
            const moves = L.migrateSettings(get, cfg);
            moves.forEach((w) => { try { settings.set(w[0], w[1]); } catch (e) { log.warn('settings migration ' + w[0] + ': ' + e); } });
            if (moves.length) log.info('settings migrated to v' + L.SETTINGS_V + ': ' + JSON.stringify(moves));

            // the settings pages: drawn on a change only (a setting, a tab, the layout, a status event), coalesced
            // into one guarded draw; never from refresh() or the rpm path. The kit resends the last frame by itself.
            const pages = createUi(() => changed());
            let drawQueued = false, drawnKey = '';
            const model = () => ({ get, schema: settings.schema || (ctx.spec && ctx.spec.settings) || [], cfg, carMode, offReason: offReason(), version: (ctx.spec && ctx.spec.version) || '',
                night: nightInfo(), proof: output.status().proof, heal: heal || {}, now: Date.now() });
            // what the shown page says: a renderer event redraws only when it changes that (not every layer event or status reply)
            const viewKey = () => { try { return JSON.stringify(P.view(pages.page(), model())); } catch (e) { return String(Date.now()); } };
            const draw = guard('draw', () => {
                drawQueued = false;
                if (!ui.isVisible('MAIN')) return;
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg), m = model();
                drawnKey = JSON.stringify(P.view(pages.page(), m));
                pages.draw(cv, t, m, act);
                return ui.image('MAIN_GFX', cv);
            });
            function changed() { if (!drawQueued) { drawQueued = true; setTimeout(draw, 0); } }
            /** What a page button does: its settings writes (settings.onChange then redraws), or a command (the Check tab). */
            const act = (writes, cmd) => guard('ui ' + (cmd || writes.map((w) => w[0]).join(' ')), () => {
                writes.forEach((w) => settings.set(w[0], w[1]));
                if (cmd === 'hudReset') { log.info('hud check: Reset HUD drawing pressed'); healCheck('manual'); }
                else if (cmd === 'refresh') output.requestStatus();
                if (cmd) changed();
            });

            // the HUD check (0.4.4): heal = hudcheck.healStep's state (a fresh start opens a window), lastTick = the 1 s tick's clock
            let heal = null, lastTick = null, healQueued = false, lastVerdict = '', verdictLogged = 0, lastRestartedAt = null;
            /** The display the check judges: the HUD unless only the cluster shows. */
            const primary = () => (L.readDisplays(get).display === 'cluster' ? 'cluster' : 'hud');
            function healCheck(trigger) {
                const p = output.status().proof, which = primary(), ds = L.readDisplays(get), s = (sel || readSel())[which];
                const v = HC.verdict({ which, on: ds[which], shown: ds.display === which || ds.display === 'both', offReason: offReason(), proof: p, level: L.levelOf(cfg, s), night: s.night, heal });
                const mine = p.layers.filter((l) => l.which === which)[0], r0 = p.status && mine ? p.status.rendering[mine.target] : null;
                // logged when the verdict or the give-up changes (not on every new count in its detail)
                const vk = which + ' ' + v.code + ' ' + v.text + ' ' + !!(heal && heal.gaveUp);
                if (vk !== lastVerdict && verdictLogged < VERDICT_LOG_MAX) { verdictLogged++; log.info('hud check: ' + which + ' ' + v.code + ': ' + v.text + (v.detail ? ' (' + v.detail + ')' : '')); }
                lastVerdict = vk;
                const before = heal;
                // the service restarted (a guard-reset, a Store update): a new window for the self-heal, once per restart
                const relinked = !!p.restartedAt && p.restartedAt !== lastRestartedAt;
                lastRestartedAt = p.restartedAt;
                if (relinked) log.info('hud check: renderer restarted: self-heal re-armed');
                const g = p.status && mine ? p.status.guard[mine.target] : null;
                const r = HC.healStep(heal, { wake: trigger === 'wake', manual: trigger === 'manual', code: v.code, madeAt: p.madeAt,
                    statusAt: p.status ? p.status.at : null, kind: r0 ? r0.kind : '', others: !!(p.status && p.status.others.length),
                    disabled: !!(g && g.disabled), dcsmUp: p.status && p.status.dcsm ? p.status.dcsm.up : null, relinked }, Date.now(), cfg.hudCheck);
                heal = r.st;
                if (r.action === 'rebuild') {
                    output.rebuild(r.why);
                    setTimeout(changed, cfg.hudCheck.manualCooldownMs + 50);     // Reset HUD drawing is pressable again: redraw it
                } else if (/^gave up/.test(r.why) && !(before && before.gaveUp)) log.warn('hud check: ' + r.why + ' automatic rebuilds: ' + v.text + ' (' + v.detail + ')');
                else if (trigger === 'manual') log.info('hud check: Reset HUD drawing not run (' + r.why + ')');
                if (heal !== before) changed();
            }
            const healNow = guard('hud check', healCheck);
            function queueHeal() { if (!healQueued) { healQueued = true; setTimeout(() => { healQueued = false; healNow('change'); }, 0); } }

            let carMode = null;     // the car's drive mode (logic.driveModeOf), null until it sends one
            // "Fast RPM": Car's own rpm handler, counted on the subscription and fed by the getter when the car's
            // updates are slow, so the polled rpm goes through Car (data(), gear guess, onSample) like any other
            const poll = createRpmPoll({ cfg: cfg.rpm, log, enabled: () => L.readLead(cfg, get).poll && !offReason() && !d.demo });
            // the car's day / night for Night dim Auto: st = logic.nightStep's state, raw = the last value seen (for the pages),
            // sub = the watch's result (an error: this unit has no such signal; the installer drops it, app.json _optional)
            const dn = { st: null, raw: undefined, sub: null, last: '', logged: 0 };
            /** A day / night word ('night' | 'day', or null from the timer) through the hold; a change refreshes at once. */
            function dayNight(seen) {
                const before = dn.st ? dn.st.night : null;
                dn.st = L.nightStep(dn.st, seen, Date.now(), cfg.nightHoldMs);
                if (dn.st.night === before) return;
                log.info('night dim auto: the car says ' + (dn.st.night ? 'night' : 'day') + ' (' + JSON.stringify(dn.raw) + ')');
                refreshNow();
                changed();
            }
            const carNight = () => (dn.st ? dn.st.night : null);
            const nightInfo = () => ({ night: carNight(), raw: dn.raw, sub: !dn.sub ? 'waiting' : dn.sub.error ? 'missing' : 'present' });
            const watched = [];
            const signals = ctx.signals && Object.assign({}, ctx.signals, {
                watch(iface, inst, handlers, lg, opts) {
                    const own = iface === CDS && handlers && typeof handlers.statusEngineSpeed2 === 'function' ? handlers.statusEngineSpeed2 : null;
                    const p = Promise.resolve(ctx.signals.watch(iface, inst, own ? Object.assign({}, handlers, { statusEngineSpeed2: poll.wrap(own) }) : handlers, lg, opts));
                    watched.push(p);
                    if (own) p.then(guard('rpm poll attach', (res) => poll.attach(res, own)), () => {});
                    if (iface === VEHICLE) p.then(guard('day night watch', (res) => { dn.sub = res || null; changed(); }), () => {});
                    return p;
                },
            });
            const car = new Car(Object.assign({}, ctx, { signals }), ['rpm', 'temps', 'speed', 'gear'], {
                [FES]: {
                    statusFESVehicleDynamicSwitchHMI: guard('drive mode', (v) => {
                        const m = L.driveModeOf(v && v.actualValueModeDrivingExperience);
                        if (m === carMode) return;
                        carMode = m;
                        log.info('car drive mode ' + JSON.stringify(v && v.actualValueModeDrivingExperience) + ' -> ' + (m || 'none: using the setting'));
                        refreshNow();
                        changed();
                    }),
                },
                [VEHICLE]: {
                    statusDayNightChangeOver: guard('day night', (v) => {
                        const raw = L.dayNightRaw(v), seen = L.dayNightOf(v), txt = JSON.stringify(v);
                        dn.raw = raw === undefined ? null : raw;
                        if (txt !== dn.last) {
                            dn.last = txt;
                            if (dn.logged < DN_LOG_MAX) { dn.logged++; log.info('car day/night ' + txt + ' -> ' + (seen || 'no day / night word')); }
                            changed();
                        }
                        dayNight(seen);
                    }),
                },
            });
            let d = {}, mt = null, th = null, states = { cluster: null, hud: null }, killed = safety.pollKill(fs, killPath);
            let samples = 0, logged = {}, lastMtKey = '', sel = null, lastStyles = { cluster: '', hud: '' };
            let lead = L.makeLead(cfg.rpm), sampleT = null, litChanges = 0, refreshMs = [];
            const OFF = { lit: 0, red: false, flashing: false, flashT0: null }, warned = Object.create(null);
            // "Start with the car" off: the platform starts the app anyway, so nothing is sent until MAIN was shown
            let opened = ui.isVisible('MAIN');
            ui.onVisible(guard('visible', (name, v) => {
                if (name !== 'MAIN' || !v) return;
                if (!opened) { opened = true; refreshNow(); }
                changed();
            }));

            /** Both displays' style settings, checked (a bad saved value falls back, logged once per value). */
            function readSel() {
                const s = { cluster: L.readStyle(cfg, get, 'cluster', carNight()), hud: L.readStyle(cfg, get, 'hud', carNight()) };
                s.cluster.warnings.concat(s.hud.warnings).forEach((w) => { if (!warned[w]) { warned[w] = true; log.warn('settings: ' + w); } });
                return s;
            }
            /** The lead setting, checked (a bad saved value falls back, logged once per value). */
            function readLead() {
                const r = L.readLead(cfg, get);
                r.warnings.forEach((w) => { if (!warned[w]) { warned[w] = true; log.warn('settings: ' + w); } });
                return r;
            }
            /**
             * A display's next state for its style's lights; a new style starts from off. p: lead(). The bracket style has
             * no lights: one stand-in light, so its fill still turns red and flashes at the shift point (0.4.2).
             */
            function next(which, now, p) {
                const lights = L.lightsOf(cfg, which, sel[which].style) || { count: 1, reds: 1 };
                const prev = sel[which].style === lastStyles[which] ? states[which] : null;
                lastStyles[which] = sel[which].style;
                return L.step(prev, p.rpm, th, lights.count, cfg, now, lights.reds, p.add);
            }

            const eff = () => L.effectiveMode(carMode, get, cfg);
            const offReason = () => {
                if (killed) return 'OFF: kill file';
                if (L.readDisplays(get).display === 'off') return 'OFF: HUD and cluster are both off';
                if (safety.tripped()) return 'STOPPED after errors: turn HUD or cluster off and on';
                if (get('autoStart') === false && !opened) return 'WAITING: open Shift Lights once (Start with the car is off)';
                const e = eff();
                if (L.holdForSportPlus(get('onlySportPlus'), e)) return 'WAITING FOR SPORT+ (now ' + e.mode.toUpperCase().replace('PLUS', '+') + ')';
                return d.demo ? 'DEMO DATA: nothing sent to the cluster' : '';
            };

            /** Thresholds, states and output from the latest sample and settings. */
            function refresh(now) {
                mt = L.modeThresholds(cfg, get, eff().mode);
                const k = JSON.stringify(mt);
                if (k !== lastMtKey) { lastMtKey = k; log.info('thresholds ' + k); if (mt.invalid) log.warn('the ' + mt.mode + ' start/shift settings do not fit (shift 200+ over start, under the limit): using config.js'); }
                th = L.thresholds(cfg, mt, d.oil);
                sel = readSel();
                const p = lead(d.rpm, sampleT !== null ? sampleT : now, readLead().leadMs);
                const before = states;
                states = { cluster: next('cluster', now, p), hud: next('hud', now, p) };
                if (!before.cluster || !before.hud || before.cluster.lit !== states.cluster.lit || before.hud.lit !== states.hud.lit) litChanges++;
                const active = !offReason();
                const display = L.readDisplays(get).display;
                output.apply({ display, active, sel, states, rpm: p.rpm, th, gear: L.gearGlyph(d.stage, d.gear), flashMode: L.readFlashMode(get) });
                const s = states.cluster, h = states.hud;
                // no lit counts here: a log line is a synchronous file write, and the lights change many times a second
                const line = { cluster: sel.cluster.style, hud: sel.hud.style, red: s.red || h.red, flash: s.flashing || h.flashing, display, active };
                if (JSON.stringify(line) !== JSON.stringify(logged)) { logged = line; log.info('state ' + JSON.stringify(line) + ' lit ' + s.lit + '/' + h.lit + ' rpm ' + (isFinite(d.rpm) ? Math.round(d.rpm) : 'n/a') + (d.demo ? ' demo' : '')); }
            }
            const refreshNow = guard('refresh', () => refresh(Date.now()));

            safety.onTrip(() => { output.apply({ display: 'off', active: false, sel, states }); changed(); });
            car.onSample(guard('sample', (data, t) => {
                d = data; samples++; sampleT = typeof t === 'number' ? t : null;
                const t0 = process.hrtime();
                refresh(Date.now());
                const dt = process.hrtime(t0);
                if (refreshMs.length < 2000) refreshMs.push(dt[0] * 1e3 + dt[1] / 1e6);
            }), guard('source', () => { states = { cluster: OFF, hud: OFF }; lead = L.makeLead(cfg.rpm); sampleT = null; changed(); }));
            const ms = (v) => (v === null ? '-' : v.toFixed(v < 10 ? 1 : 0));
            setInterval(guard('rate', () => {
                const r = poll.stats();
                // "rpm samples/s:" = every Car sample (rpm, speed and polled ticks); notified = the car's rpm notifications alone
                log.info('rpm samples/s: ' + (samples * 1000 / RATE_LOG_MS).toFixed(1) + (d.demo ? ' (demo)' : '') +
                    ', notified/s ' + r.notified.toFixed(1) + ' gap p50/p90 ' + ms(r.gapP50) + '/' + ms(r.gapP90) + ' ms' +
                    ', polled/s ' + r.polled.toFixed(1) + ' rtt p50/max ' + ms(r.rttP50) + '/' + ms(r.rttMax) + ' ms, poll failures ' + r.fails +
                    ', refresh p50/max ' + ms(pct(refreshMs, 0.5)) + '/' + ms(pct(refreshMs, 1)) + ' ms, lit changes ' + litChanges);
                samples = 0; litChanges = 0; refreshMs = [];
            }), RATE_LOG_MS);

            const was = { hudOn: get('hudOn') === true, clusterOn: get('clusterOn') === true };
            settings.onChange(guard('settings', (key, value) => {
                if (key === 'hudOn' || key === 'clusterOn') {
                    if (value === true && !was[key] && safety.tripped()) { safety.reset(); log.info('safety reset by the ' + key + ' setting'); }
                    was[key] = value === true;
                }
                refreshNow();
                changed();
            }));
            setInterval(guard('kill', () => {
                // a wake: the wall clock jumped forward past wakeGapMs between ticks (the head unit slept); back: just resync
                const now = Date.now(), woke = lastTick !== null && now - lastTick > cfg.hudCheck.wakeGapMs;
                if (woke) log.info('hud check: wake (' + Math.round((now - lastTick) / 1000) + ' s with no tick)');
                lastTick = now;
                healNow(woke ? 'wake' : 'tick');
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) { killed = k; log.warn(k ? 'kill file found: output off' : 'kill file gone: output allowed'); refreshNow(); changed(); }
                if (dn.st && dn.st.want !== null && dn.st.want !== dn.st.night) dayNight(null);    // Night dim Auto: a change that held
            }), cfg.safety.killPollMs);
            ui.onClick('BTN_HUD', guard('hud on/off', () => settings.cycle('hudOn')));
            ui.onClick('BTN_CLUSTER', guard('cluster on/off', () => settings.cycle('clusterOn')));

            // where the kit runs the screen the pages do the bar's jobs, so its buttons go; elsewhere they stay and
            // BTN_ALL opens the HMI's settings list (every setting)
            if (ctx.hideButton) ['BTN_HUD', 'BTN_CLUSTER', 'BTN_ALL'].forEach((b) => ctx.hideButton(b));
            ui.onClick('BTN_ALL', guard('settings button', () => ui.open && ui.open('SETTINGS')));
            if (ctx.onTab) ctx.onTab(guard('tab', (i) => { pages.tab(i); if (P.IDS[pages.page()] === 'check') output.requestStatus(); changed(); }));
            if (ctx.onLayout) ctx.onLayout(guard('layout', changed));
            if (ui.onFocus) ui.onFocus(guard('focus', (name, on) => { if (name === 'MAIN' && on) changed(); }));
            Promise.all(watched).then(guard('rpm poll start', () => poll.start()), (e) => log.warn('rpm poll not started: ' + e));
            refreshNow();
            changed();
            const lr = readLead();
            const s0 = sel || readSel();
            log.info('started: show ' + L.readDisplays(get).display + ', mode ' + JSON.stringify(eff()) + ', cluster ' + s0.cluster.style + ', hud ' + s0.hud.style +
                ', flash ' + L.readFlashMode(get) + ', night dim hud ' + s0.hud.nightMode + ' cluster ' + s0.cluster.nightMode +
                ', lead ' + lr.leadMs + ' ms, rpm poll ' + (lr.poll ? 'on' : 'off') +
                ', hudcheck verify ' + cfg.hudCheck.verifyMs + ' gap ' + cfg.hudCheck.gapMs + ' max ' + cfg.hudCheck.maxAuto + ' backoff ' + cfg.hudCheck.backoffMs);
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
