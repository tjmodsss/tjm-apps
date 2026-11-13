'use strict';
/**
 * hudcheck.js - what "Showing" means since 0.4.4, and the bounded self-heal. Pure, Node 8.
 * 0.4.3 said "Showing" from the settings alone (pages.js stateOf never read the renderer). Now the words come from what
 * the cluster-render service said back: its link, the target and layer events, and its status text (crstatus.js).
 * "Rendered" is the best proof the app can see that the renderer took our scene; it is not a photo of the HUD.
 *
 *   verdict(s) -> { code, text, detail, tone }
 *     s = { which: 'hud' | 'cluster', on, shown, offReason, proof (output.status().proof), level (0..1), night, heal }
 *     A status counts when it came after the link's ready (proof.linkAt); the self-heal only acts on one newer than our layers.
 *     codes, first match wins: off, paused, demo, nolink, notshown (no layer), disabled, otherapp, waiting, parked, notshown,
 *     unconfirmed, dim, ok. disabled (0.4.5): cluster-render's mapping guard turned our target off (status 'guard: hud ...:
 *     disabled, N strikes'); it stays idle until cluster-render's version changes or `cluster-render guard-reset`.
 *     text: short (the Home card), detail: one more line (the Check tab).
 *   healStep(st, inp, now, cfg.hudCheck) -> { st, action: 'none' | 'rebuild', why }
 *     inp = { wake, manual, code, madeAt (our layers made, Date.now ms, or null), statusAt, kind (rendering), others,
 *             disabled (the guard turned our target off), dcsmUp (true / false / null: unknown), relinked (the service restarted) }
 *     A rebuild drops our layers, closes the socket, waits gapMs and makes them again (output.rebuild). Whether that clears
 *     a scene the renderer reports mapped and never draws is a guess (cluster-render README, unverified list).
 *     Triggers: wake (the status is from before the sleep), handover (another app left the shared scene and ours is not
 *     rendered), stuck (verifyMs after our layers were made, a newer status is not shown + rendered; "subscription not
 *     observable" never counts: a rebuild cannot change it), manual (the Reset HUD drawing button).
 *     Bounds: maxAuto automatic rebuilds a window (a fresh start or a wake opens one), none while another app has layers
 *     on the shared scene, none within gapMs of the last, manual only manualCooldownMs after the last; an automatic one
 *     after the first in a window only backoffMs after the last (0.4.5). Never one, manual included, while the guard has our
 *     target disabled (a rebuild cannot ask for a disabled mapping), and no automatic one while Dcsm2 is down. A service
 *     restart (relinked: a guard-reset or a Store update does one) opens a new window like a wake, without a rebuild of its
 *     own. A clock set back restarts every wait from now. Nothing to do returns the same st object.
 */
const APP_NAME = { adam_mtrack: 'M Track Cluster', adam_vitals: 'Engine Vitals' };
const SHARED = ['panel', 'hud'];        // one scene id: never up at once (cluster-render README)
const HANDOVER_MS = 30000;
const STUCK = ['waiting', 'notshown', 'unconfirmed'];

const appName = (s) => { const id = String(s).split(' on ')[0]; return APP_NAME[id] || id; };
const pct = (v) => Math.round(v * 100) + ' %';

function verdict(s) {
    const V = (code, text, detail, tone) => ({ code, text, detail: detail || '', tone: tone || 'warn' });
    if (!s.on || !s.shown) return V('off', 'Off', '', 'off');
    const off = s.offReason || '';
    if (off && off.indexOf('DEMO') !== 0) return V('paused', 'On, paused: see below', off);
    if (off) return V('demo', 'Demo data: nothing is sent', 'The car has not answered, so nothing goes to the ' + (s.which === 'hud' ? 'HUD' : 'cluster'));
    const p = s.proof;
    const gave = s.heal && s.heal.gaveUp ? '. Self-heal gave up after ' + s.heal.used + ': try Reset HUD drawing' : '';
    if (!p || p.holding) return V('nolink', p ? 'Redrawing: layers come back soon' : 'Not sent yet', p ? 'Rebuilding our layers (a self-heal or Reset HUD drawing)' : '');
    if (p.link !== 'ready') return V('nolink', 'Not sent: no renderer link', 'Renderer link: ' + p.link);
    const mine = (p.layers || []).filter((l) => l.which === s.which);
    if (!mine.length) return V('notshown', 'Not sent: no layer made', 'The layer was refused (see the log)' + gave);
    // a status since this connection came up counts: the rendering line is the target's (one scene), not a layer's, so a
    // style change made on the same link keeps it until the next status (asked 500 ms after the new layer's events)
    const name = mine[0].target, st = p.status && p.status.at >= (p.linkAt || 0) ? p.status : null;
    const g = st && st.guard ? st.guard[name] : null;
    if (g && g.disabled) {
        return V('disabled', 'Blocked: the renderer turned the HUD off',
            'cluster-render disabled ' + name + ' after ' + g.strikes + ' strikes. Fix: Store > Cluster renderer > Update, or guard-reset');
    }
    const others = st ? st.others : [];
    if (others.length) {
        return V('otherapp', 'Blocked: ' + appName(others[0]) + ' holds the scene',
            others.join(', ') + (/adam_mtrack/.test(others[0]) ? '. Turn M Track\'s Cover off' : '. Close that app'));
    }
    const ev = (p.targets || {})[name], sv = st && st.targets[name];
    const state = ev ? ev.state : sv ? sv.state : '', reason = (ev && ev.reason) || (sv && sv.reason) || '';
    const why = reason ? ': ' + reason : '';
    if (['waiting', 'acquiring', 'unavailable'].indexOf(state) >= 0) return V('waiting', 'Sent, the renderer says ' + state, 'Target ' + name + ' ' + state + why + gave);
    if (state === 'parked') return V('parked', 'Sent, parked behind the stock display', 'Target ' + name + ' parked' + why + gave);
    const bad = mine.filter((l) => l.state !== 'shown' && l.state !== 'sent');     // 'sent': no answer yet (a few ms)
    if (state !== 'shown' || bad.length) {
        // idle with no guard line: the renderer has not asked the cluster for the slot (it wants the Dcsm2 link up first)
        const dc = st && st.dcsm, asked = state === 'idle' && !g && dc ? '; the renderer has not asked for the slot (' +
            (dc.up ? 'Dcsm2 up' : 'Dcsm2 down') + ')' : '';
        return V('notshown', 'Sent, not shown yet', 'Target ' + name + ' ' + (state || 'no event') +
            (bad.length ? ', layer ' + bad[0].role + ' ' + bad[0].state : '') + asked + gave);
    }
    if (!st || !sv) return V('unconfirmed', 'Sent, waiting for the read-back', 'Target ' + name + ' shown; no status from the renderer since' + gave);
    const r = st.rendering && st.rendering[name] ? st.rendering[name] : { kind: '' };
    if (r.kind !== 'rendered') {
        const what = r.kind === 'unsubscribed' ? 'renderer not subscribed for ' + r.ms + ' ms'
            : r.kind === 'unobservable' ? 'the renderer cannot tell (subscription not observable)' : 'no rendering line (' + (sv.rendering || 'none') + ')';
        return V('unconfirmed', 'Sent, not confirmed drawn', 'Shown but ' + what + gave);
    }
    const drew = r.secs === null ? 'the renderer drew it' : 'the renderer drew it (subscribed ' + r.secs + ' s)';
    if (typeof s.level === 'number' && s.level < 0.5) {
        return V('dim', 'Showing at ' + pct(s.level) + (s.night ? ': night dim' : ': brightness'),
            drew[0].toUpperCase() + drew.slice(1) + (s.night ? '; night dim (the car says night)' : '; the Brightness setting'), 'warn');
    }
    return V('ok', 'Showing: the renderer drew it', 'Shown, ' + drew + ' on ' + name, 'on');
}

const KEYS = ['used', 'gaveUp', 'lastAt', 'last', 'since', 'madeAt', 'seenOthersAt'];
function healStep(st0, inp, now, cfg) {
    const st = Object.assign({ used: 0, gaveUp: false, lastAt: null, last: null, since: null, madeAt: null, seenOthersAt: null }, st0);
    // a clock set back: every wait starts again from now
    ['lastAt', 'since', 'seenOthersAt'].forEach((k) => { if (st[k] !== null && st[k] > now) st[k] = now; });
    const madeAt = typeof inp.madeAt === 'number' ? inp.madeAt : null;
    if (madeAt !== st.madeAt) { st.madeAt = madeAt; st.since = madeAt === null ? null : Math.min(madeAt, now); }
    if (inp.wake) { st.used = 0; st.gaveUp = false; }
    const same = () => st0 && KEYS.every((k) => JSON.stringify(st0[k]) === JSON.stringify(st[k]));
    const out = (action, why) => ({ st: action === 'none' && same() ? st0 : st, action, why });
    const rebuild = (why) => {
        st.lastAt = now; st.last = { why, at: now }; st.since = null; st.madeAt = null;
        return out('rebuild', why);
    };
    if (inp.relinked) { st.used = 0; st.gaveUp = false; }
    if (madeAt === null) return out('none', 'nothing on the display');
    // a disabled mapping is never asked for again, however often our layers come and go: no rebuild of any kind
    if (inp.disabled) return out('none', 'disabled by the renderer guard');
    if (inp.manual) {
        if (st.lastAt !== null && now - st.lastAt < cfg.manualCooldownMs) return out('none', 'cooldown');
        return rebuild('manual');
    }
    if (['off', 'paused', 'demo'].indexOf(inp.code) >= 0) return out('none', inp.code);
    if (inp.others) { st.seenOthersAt = now; return out('none', 'another app holds the scene'); }
    if (st.lastAt !== null && now - st.lastAt < cfg.gapMs) return out('none', 'rebuilding');
    if (inp.dcsmUp === false) return out('none', 'display service down');
    let why = '';
    const statusNew = typeof inp.statusAt === 'number' && st.since !== null && inp.statusAt >= st.since;
    if (inp.wake) why = 'wake';
    else if (inp.code === 'ok' || inp.code === 'dim') return out('none', 'confirmed');
    else if (st.seenOthersAt !== null && now - st.seenOthersAt <= HANDOVER_MS && inp.kind !== 'rendered' && statusNew) why = 'handover';
    else if (STUCK.indexOf(inp.code) >= 0 && inp.kind !== 'unobservable' && statusNew && now - st.since >= cfg.verifyMs) why = 'stuck';
    if (!why) return out('none', 'waiting');
    st.seenOthersAt = null;
    if (st.used >= cfg.maxAuto) { st.gaveUp = true; return out('none', 'gave up after ' + st.used); }
    if (st.used > 0 && st.lastAt !== null && now - st.lastAt < cfg.backoffMs) return out('none', 'backing off');
    st.used++;
    return rebuild(why);
}

module.exports = { verdict, healStep, appName, SHARED, HANDOVER_MS };
