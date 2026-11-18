'use strict';
/**
 * HUD (amn_hudlyrics; "HUD Lyrics" until 0.7.0): synced lyrics for the song the car plays (CarPlay), one line at a time in the
 * head-up display, and a Now Playing page on the centre screen.
 *
 * The centre screen: the song and its progress on the left, the lyrics on the right (the line sung large,
 * the one before and the one after dim), and a status row that says what each part is doing: the song,
 * the timing, the lyrics lookup and the HUD. If the HUD stays dark, that row says which part stopped.
 *
 * The HUD (Settings > Lyrics in the HUD, experimental, off by default): hud/music_cluster.js from G's Music,
 * target 'hud', through the Store's Cluster renderer. One line by default; hidden during route guidance
 * (BMW navigation, CarPlay, Android Auto) unless "Show during navigation" is on, while paused for 30 s, and
 * for a song without synced lyrics.
 *
 * Built from arefahmad's Car Lyrics (MIT): car/nowplaying.js, net/http.js and the song clock below.
 * stage/lyrics.js and hud/ are from nickgcode's G's Music (MIT). Fonts: Inter (OFL), data/fonts/.
 *
 * Read-only toward the car: it subscribes to and reads fields, never calls a method or writes a value.
 * One internet host: lrclib.net (net/http.js refuses any other). The log holds only the track's title,
 * artist and timing, the lyrics lookup's result and the HUD layer's state.
 *
 * Node 8 only (the car's version): no ?. ?? import, object spread, class fields, optional catch binding.
 * Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const fonts = require('./kit/fonts');
const pack = require('./kit/pack');
const { Canvas } = require('./kit/canvas');
const NP = require('./nowplaying');
const LyricsLib = require('./lyrics');
const http = require('./http');
const MC = require('./music_cluster');
// 0.4.0: Redline's HUD claim (kit/hud_claim.js): while Redline draws on the HUD (Sport), the lyrics step aside
const { HudClaim } = require('./kit/hud_claim');
// 0.5.0: in Sport, Redline's Ramp tach (after the G80/G82 M3 / M4) on the HUD in place of the lyrics (hud/sport.js)
const { SportHud } = require('./sport');
// 0.7.0: the screen in IPTV's design (full screen, its rail, pills and cards; kit/fullscreen.js)
const FS = require('./kit/fullscreen');
const record = require('./kit/record');
const PREVIEW_ID = 300;         // the tach preview's picture id (mgu-render: 64 pictures per app)
const G = require('./kit/gauges');

const VERSION = '0.7.2';
const W = 1600, H = 520;
const IFACES = [
    { iface: 'de.bmw.infotainment.a4a.carplay.CarPlayManager', instances: ['CarPlayManagerInst1'] },
    { iface: 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer', instances: [] },
    { iface: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', instances: [] },
    { iface: 'de.bmw.infotainment.entertainment.dynamicmediaplayer.DynamicMediaPlayer', instances: [] },
];
// route guidance, as G's Music reads it (CarPlay's comes through nowplaying.js, which already watches CarPlayManager)
const GUIDE = [
    ['de.bmw.infotainment.navigation.navigationstatus.NavigationStatus', '1', 'guidingState', 'nav'],
    ['de.bmw.infotainment.sdi.aap.androidautoprojectedmanager.AndroidAutoProjectedManager', 'AndroidAutoProjectedManagerInst1', 'projectedGuidanceActive', 'aa'],
];
const LEAD_MS = 250;              // a line shows this much before its time (reading takes a moment)
const NUDGE = 0.3;                // share of the gap to a new time from the car that the clock takes at once
const SNAP_MS = 1500;             // a gap bigger than this (a seek, a skip back) is jumped, not glided
const HOLD_MS = 4000;             // the clock runs at most this far past the car's last time
const FADE_MS = 280;              // the centre screen's line change
const CLAIM_MS = 1000;            // how often the HUD claims are read (Redline touches its claim every 2 s)

/* ---------- the look: IPTV's (black, #1c1c1e cards, pills), BMW M blue for its accent; 0.7.0 ---------- */
const C = {
    bg: '#000000', card: '#1c1c1e', pill: '#26262a', rail: '#161618',
    text: '#ffffff', dim: '#98989f', faint: '#636366',
    accent: '#2f7df6', accentDim: '#0f2340',      // BMW M blue
    mLight: '#5fb4ff', mDark: '#1c69d4', mRed: '#e2001a',
    green: '#30d158', amber: '#ff9f0a', red: '#ff453a', grey: '#636366',
};
const A = (c, a) => { const s = String(c).replace('#', '').slice(0, 6); return '#' + s + ('0' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2); };
const mix = (a, b, f) => {
    const p = (c) => [0, 2, 4].map((k) => parseInt(String(c).replace('#', '').slice(k, k + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, i) => ('0' + Math.round(v + (y[i] - v) * f).toString(16)).slice(-2)).join('');
};
const easeOut = (e) => 1 - Math.pow(1 - Math.max(0, Math.min(1, e)), 3);
const mmss = (ms) => { const s2 = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s2 / 60) + ':' + (s2 % 60 < 10 ? '0' : '') + (s2 % 60); };

/** Cut s to fit width w at size (an ellipsis when cut). */
function fit(cv, s, size, w, opt) {
    s = LyricsLib.fold(String(s || ''));
    const o = Object.assign({ literal: true }, opt || {});
    if (cv.textWidth(s, size, o) <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cv.textWidth(s.slice(0, mid) + '...', size, o) <= w) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo).replace(/\s+$/, '') + '...';
}
/** Word-wrap s to at most max lines of w px (the last cut). */
function wrap(cv, s, size, w, max, opt) {
    const o = Object.assign({ literal: true }, opt || {});
    const words = LyricsLib.fold(String(s || '')).split(/\s+/).filter(Boolean), out = [];
    let cur = '';
    words.forEach((word) => {
        const next = cur ? cur + ' ' + word : word;
        if (!cur || cv.textWidth(next, size, o) <= w) cur = next; else { out.push(cur); cur = word; }
    });
    if (cur) out.push(cur);
    if (out.length > max) { const rest = out.slice(max - 1).join(' '); out.length = max - 1; out.push(fit(cv, rest, size, w, opt)); }
    return out;
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            const net = http.client(ctx.dataDir);
            const request = (m, h, p, hd) => net.request(m, h, p, hd);
            const lyrics = new LyricsLib.Lyrics(request, log, 'HUDLyrics/' + VERSION + ' (iDrive 7 head-unit app)');
            const np = new NP.NowPlaying(ctx.signals, log, IFACES);
            // Inter (OFL), the open look-alike of Apple's SF Pro, baked in data/fonts (as Car Lyrics)
            let F_BOLD = 'bold', F_MED = 'label';
            try {
                const dirs = [path.join(__dirname, 'fonts'), path.join(__dirname, 'data', 'fonts')];
                const src = pack.open(fs.existsSync(dirs[0] + '.pack') || fs.existsSync(dirs[0]) ? dirs[0] : dirs[1]);
                if (fonts.register('cl_bold', src.json('cl_bold.json'))) F_BOLD = 'cl_bold';
                if (fonts.register('cl_med', src.json('cl_med.json'))) F_MED = 'cl_med';
            } catch (e) { log.warn('fonts: ' + e.message); }
            const B = { font: F_BOLD, literal: true }, M = { font: F_MED, literal: true };
            let toast = null;
            const say = (text, ms) => { toast = { text: text, until: Date.now() + (ms || 3000) }; };

            /* ---------- the track, and the clock that follows the car's time in it (Car Lyrics') ---------- */
            let cur = null;           // { key, title, artist, album, duration, playing }
            let clk = null;           // { pos, at, playing, last }: the song's time pos (ms) at at (ms epoch)
            let startAt = Date.now(); // a source with no time of its own: when the song (probably) began
            let lastState = '';
            const clockAt = (now) => clk.pos + (clk.playing ? Math.min(now - clk.at, HOLD_MS) : 0);
            const follow = () => {
                const t = np.track();
                if (!t) return;
                const key = t.title + '|' + t.artist;
                if (!cur || cur.key !== key) {
                    cur = { key: key, title: t.title, artist: t.artist, album: t.album, duration: t.duration || 0, playing: true };
                    clk = null; startAt = Date.now(); lastState = '';
                    log.info('track: "' + t.title + '" by "' + t.artist + '" (' + Math.round((t.duration || 0) / 1000) + ' s)');
                }
                if (t.duration) cur.duration = t.duration;
                if (t.album) cur.album = t.album;
                const playing = t.direct ? !!t.playing : true;
                cur.playing = playing;
                if (t.position === null || t.position === undefined) return;
                const at = t.positionAt || Date.now();
                if (!clk) { clk = { pos: t.position, at: at, playing: playing, last: t.position }; log.info('time: from the car'); return; }
                if (t.position === clk.last && playing === clk.playing) return;
                const predicted = clockAt(at), gap = t.position - predicted;
                if (!playing || !clk.playing || Math.abs(gap) > SNAP_MS) clk.pos = t.position;
                else clk.pos = predicted + gap * NUDGE;
                clk.at = at; clk.playing = playing; clk.last = t.position;
            };
            const offset = () => Number(settings.get('offset')) || 0;
            const position = (now) => (clk ? clockAt(now || Date.now()) : (now || Date.now()) - startAt) + offset();
            ui.onClick('BTN_SYNC', guard('sync', () => { startAt = Date.now(); say('Synced: the song starts now'); log.info('time: synced by button'); }));
            const lyricsFor = () => (cur ? lyrics.get({ title: cur.title, artist: cur.artist, album: cur.album, duration: cur.duration }) : null);

            /* ---------- the HUD (G's Music's layer, target 'hud') ---------- */
            const mh = new MC.MusicCluster({ log: log, app: 'amn_hudlyrics', Canvas: Canvas, target: 'hud' });
            const sport = new SportHud({ ctx: ctx, app: 'amn_hudlyrics', settings: settings });
            ui.onClick('BTN_SPORT', guard('sport test', () => { page = 'sport'; sport.demo(8000); say('Sport HUD: an 8 s rev sweep on the HUD'); log.info('sport hud: test sweep'); }));
            const guide = { nav: null, carplay: null, aa: null };      // the latest raw value of each source
            const pushGuide = () => {
                const show = !!settings.get('navShow');
                Object.keys(guide).forEach((src) => {
                    if (guide[src] === null) return;
                    // "Show during navigation": tell the layer no route runs (0 = INACTIVE for BMW's, false for the phones')
                    mh.guidance(src, show ? (src === 'nav' ? 0 : false) : guide[src]);
                });
            };
            // 0.4.0: Redline holds the HUD (its claim, /dev/shm/mgu-hud/redline) while it draws: in Sport by default, its
            // "In Comfort / Eco Pro" set to Don't show. The lyrics then leave the HUD to it and come back when it lets go.
            let yieldTo = [], claimAt = 0;
            const yielding = () => {
                const now = Date.now();
                if (now - claimAt >= CLAIM_MS) {
                    claimAt = now;
                    const o = settings.get('redline') === false ? [] : HudClaim.others('amn_hudlyrics');
                    if (o.join() !== yieldTo.join()) log.info('hud: ' + (o.length ? 'giving way to ' + o.join(', ') : 'back (no other app on the HUD)'));
                    yieldTo = o;
                }
                return yieldTo.length > 0;
            };
            const hudTick = () => {
                const t = cur ? { uri: cur.key, title: cur.title, artist: cur.artist, kind: 'track', duration: cur.duration, ad: false } : null;
                // Sport: the Ramp tach has the HUD, the lyrics step aside (another app holding the HUD outranks both)
                const other = yielding(), tach = !other && sport.tick();
                if (other) sport.close();
                mh.update({ setting: settings.get('hud') && !other && !tach ? 'lyrics' : 'off', ok: !!cur, track: t, playing: !!(cur && cur.playing),
                    pos: position(), posFn: () => position(), lyrics: settings.get('hud') ? lyricsFor() : null,
                    size: settings.get('size'), lines: ({ '2': 2, '3': 3 })[settings.get('lines')] || 1 });
            };
            np.onChange(guard('change', (key) => {
                if (/^CarPlayManager\//.test(key) && /\.projectedGuidanceActive$/.test(key)) {
                    const e = np.store.get(key);
                    guide.carplay = e ? e.value : null;
                    pushGuide();
                    return;
                }
                follow();
            }));
            if (ctx.signals && ctx.signals.watch) GUIDE.forEach((g) => {
                const h = {};
                h[g[2]] = guard('guidance', (v) => { guide[g[3]] = v; pushGuide(); });
                ctx.signals.watch(g[0], g[1], h, log).catch(() => {});
            });
            setInterval(guard('hud', hudTick), 250);
            settings.onChange(guard('settings', (k) => {
                if (k === 'navShow') pushGuide();
                // 0.6.1: a new size or place shows the tach there for 10 s, parked or in any mode, to judge it on the glass
                if (k === 'sportSize' || k === 'sportX' || k === 'sportY') { sport.demo(10000); log.info('sport hud: ' + k + ' ' + settings.get(k)); }
                if (k === 'hud') { log.info('hud: ' + (settings.get('hud') ? 'on' : 'off')); say(settings.get('hud') ? 'Lyrics in the HUD: on (experimental)' : 'Lyrics in the HUD: off'); }
                hudTick();
            }));
            process.once('exit', () => { try { mh.close(); } catch (e) { /* closing */ } try { sport.close(); } catch (e) { /* closing */ } });

            /* ---------- the centre screen: IPTV's design (0.7.0) ---------- */
            let shown = { i: -2, at: 0, prev: -1 };      // the lyric line on screen, and when it changed
            let page = 'playing';                        // 'playing' | 'sport'
            let previewAt = 0, previewPic = null;
            const btn = (cv, key, x, y, w, h, fn, r) => FS.button(cv, key, x, y, w, h, guard(key, fn), { r: r != null ? r : 16, slop: 4 });
            const DOT = { on: C.green, wait: C.amber, off: C.grey, none: C.red, error: C.red };

            function icon(cv, kind, cx, cy, col) {
                if (kind === 'playing') {          // a note
                    cv.circle(cx - 6, cy + 9, 7, col);
                    cv.line(cx, cy + 9, cx, cy - 14, 3.5, col); cv.line(cx, cy - 14, cx + 11, cy - 9, 3.5, col);
                } else if (kind === 'sport') {     // the tach
                    cv.arc(cx, cy + 6, 14, 17.5, 180, 360, col);
                    cv.line(cx, cy + 6, cx + 8, cy - 4, 3.5, col); cv.circle(cx, cy + 6, 3.5, col);
                }
            }
            function rail(cv, Ar) {
                const x = Ar.x, w = 108;
                cv.roundRect(x, Ar.y, w, Ar.h, 28, C.rail);
                const items = [['playing', 'Playing'], ['sport', 'Sport HUD']];
                const step = 96;
                items.forEach((it, i) => {
                    const cy = Ar.y + 24 + i * step + step / 2;
                    const on = page === it[0];
                    if (on) cv.roundRect(x + 8, cy - step / 2 + 6, w - 16, step - 12, 20, C.accentDim);
                    const col = on ? C.accent : '#e8e8ec';
                    icon(cv, it[0], x + w / 2, cy - 12, col);
                    cv.text(it[1], x + w / 2, cy + 26, 15, col, Object.assign({ align: 'center' }, on ? B : M));
                    btn(cv, 'rail_' + it[0], x + 6, cy - step / 2 + 4, w - 12, step - 8, () => { page = it[0]; }, 20);
                });
                // the M colours, small, at the rail's foot
                const by = Ar.y + Ar.h - 34, bx = x + w / 2 - 21;
                [C.mLight, C.mDark, C.mRed].forEach((c, k) => cv.quad([[bx + k * 15 + 5, by], [bx + k * 15 + 14, by], [bx + k * 15 + 9, by + 14], [bx + k * 15, by + 14]], c));
            }
            /** a pill that switches a setting: label, on / off */
            function toggle(cv, key, x, y, label, on, fn) {
                const h = 52, w = cv.textWidth(label, 20, B) + 96;
                cv.roundRect(x, y, w, h, h / 2, on ? C.accentDim : C.pill);
                cv.text(label, x + 24, y + h / 2 + 7, 20, on ? C.text : C.dim, B);
                const sx = x + w - 62, sy = y + h / 2 - 13;       // an iOS switch
                cv.roundRect(sx, sy, 46, 26, 13, on ? C.accent : '#3a3a3e');
                cv.circle(on ? sx + 33 : sx + 13, sy + 13, 10, C.text);
                btn(cv, key, x, y, w, h, fn, h / 2);
                return w;
            }
            function topBar(cv, Ar, x0) {
                const y = Ar.y, h = 52;
                let x = x0;                               // no title pill: the car's header names the app
                x += toggle(cv, 'tg_lyrics', x, y, 'Lyrics on the HUD', !!settings.get('hud'), () => settings.set('hud', !settings.get('hud'))) + 14;
                x += toggle(cv, 'tg_sport', x, y, 'Sport HUD', settings.get('sportHud') !== false, () => settings.set('sportHud', settings.get('sportHud') === false)) + 14;
                const m = sport.driveMode ? sport.driveMode() : null, mw = 200;
                if (Ar.right - x >= mw) {
                    const label = m === 'sport' ? 'Sport' : m === 'other' ? 'Comfort / Eco' : 'Drive mode ...';
                    cv.roundRect(Ar.right - mw, y, mw, h, h / 2, m === 'sport' ? '#3a1416' : C.pill);
                    cv.circle(Ar.right - mw + 26, y + h / 2, 6, m === 'sport' ? C.mRed : C.dim);
                    cv.text(label, Ar.right - mw + 44, y + h / 2 + 7, 20, C.text, B);
                }
            }
            function chips(cv, x0, y, right, items) {
                const gap = 12, h = 46, w = (right - x0 - gap * (items.length - 1)) / items.length;
                items.forEach((it, k) => {
                    const x = x0 + k * (w + gap);
                    cv.roundRect(x, y, w, h, h / 2, C.card);
                    cv.circle(x + 24, y + h / 2, 6, it[1]);
                    cv.text(it[0], x + 40, y + h / 2 + 6, 15, C.dim, B);
                    const lw = cv.textWidth(it[0], 15, B);
                    cv.text(fit(cv, it[2], 17, w - 60 - lw, M), x + 50 + lw, y + h / 2 + 6, 17, C.text, M);
                });
            }

            /* the Now Playing page */
            function drawPlaying(cv, Ar, x0, now, lyr) {
                const top = Ar.y + 76, cardW = 470, cardH = Ar.bottom - top - 88;
                cv.text('Now Playing', x0, top + 4, 26, C.text, B);
                const cx = x0, cy = top + 22, ix = cx + 28, iw = cardW - 56;
                cv.roundRect(cx, cy, cardW, cardH, 24, C.card);
                if (!cur) {
                    cv.text('Nothing playing', ix, cy + 62, 30, C.text, B);
                    wrap(cv, 'Play a song on your phone over CarPlay: its lyrics show here, and on the HUD when Lyrics on the HUD is on.', 19, iw, 4, M)
                        .forEach((r, k) => cv.text(r, ix, cy + 100 + k * 27, 19, C.dim, M));
                } else {
                    let size = 32;
                    while (size > 24 && cv.textWidth(LyricsLib.fold(cur.title), size, B) > iw) size -= 2;
                    const tl = wrap(cv, cur.title, size, iw, 2, B);
                    tl.forEach((r, k) => cv.text(r, ix, cy + 58 + k * (size + 6), size, C.text, B));
                    const ay = cy + 58 + tl.length * (size + 6) + 4;
                    cv.text(fit(cv, cur.artist || 'Unknown artist', 21, iw, M), ix, ay, 21, C.dim, M);
                    if (cur.album) cv.text(fit(cv, cur.album, 17, iw, M), ix, ay + 26, 17, C.faint, M);
                    const py = cy + cardH - 112, pos = Math.max(0, position(now) - offset()), dur = cur.duration || 0;
                    cv.roundRect(ix, py, iw, 6, 3, '#3a3a3e');
                    if (dur) cv.roundRect(ix, py, Math.max(6, Math.min(1, pos / dur) * iw), 6, 3, C.text);
                    cv.text(mmss(pos), ix, py + 30, 16, C.dim, M);
                    if (dur) cv.text('-' + mmss(dur - pos), ix + iw, py + 30, 16, C.dim, Object.assign({ align: 'right' }, M));
                    if (!cur.playing) cv.text('PAUSED', ix + iw / 2, py + 30, 14, C.amber, Object.assign({ align: 'center', spacing: 2 }, B));
                    const bw = 220, by = cy + cardH - 64;
                    cv.roundRect(ix, by, bw, 44, 22, C.pill);
                    cv.text('Song just started', ix + bw / 2, by + 29, 18, C.text, Object.assign({ align: 'center' }, B));
                    btn(cv, 'sync', ix, by, bw, 44, () => { startAt = Date.now(); say('Synced: the song starts now'); log.info('time: synced by tap'); }, 22);
                }
                lyricsPane(cv, now, lyr, x0 + cardW + 56, Ar.right, cy, cy + cardH);
                const hv = mh.view();
                if (hv.kind === 'off') hv.text = settings.get('hud') ? 'Starting' : 'Off';
                if (settings.get('hud') && yieldTo.length) { hv.kind = 'wait'; hv.text = (yieldTo.indexOf('redline') >= 0 ? 'Redline' : yieldTo[0]) + ' has it'; }
                if (!yieldTo.length && sport.wants()) { hv.kind = 'on'; hv.text = 'Sport tach'; }
                const lyrS = !cur ? [C.grey, 'Waiting'] : !lyr ? [C.amber, 'Searching'] : ({
                    synced: [C.green, 'Synced  ·  ' + (lyr.lines ? lyr.lines.length : 0) + ' lines'], loading: [C.amber, 'Searching'],
                    plain: [C.amber, 'Not synced'], instrumental: [C.grey, 'Instrumental'], none: [C.grey, 'Not on LRCLIB'],
                    undrawable: [C.grey, 'Letters not supported'], error: [C.red, net.online() ? 'Not answering' : 'Car offline'],
                })[lyr.state] || [C.grey, lyr.state];
                chips(cv, x0, Ar.bottom - 46, Ar.right, [
                    ['Song', cur ? (cur.playing ? C.green : C.amber) : C.grey, cur ? (cur.playing ? 'Playing' : 'Paused') : 'Nothing'],
                    ['Timing', clk ? C.green : cur ? C.amber : C.grey, clk ? 'From the car' : cur ? 'Tap Song just started' : '-'],
                    ['Lyrics', lyrS[0], lyrS[1]],
                    ['HUD', DOT[hv.kind] || C.grey, hv.text],
                ]);
            }
            /** The lyrics: the line before (faint), the line sung (large, white), the line after (dim). */
            function lyricsPane(cv, now, lyr, x, right, top, bottom) {
                const w = right - x, mid = (top + bottom) / 2;
                if (!cur) { message(cv, x, w, mid, 'Lyrics appear here', 'Synced from LRCLIB as the song plays.'); return; }
                if (!lyr || lyr.state !== 'synced' || !lyr.lines.length) {
                    const st = lyr ? lyr.state : 'loading';
                    const T = {
                        loading: ['Finding the lyrics...', ''],
                        plain: ['Lyrics without timing', 'LRCLIB has words for this song but no timing, so they cannot follow the music.'],
                        instrumental: ['Instrumental', 'Nothing to sing along to.'],
                        none: ['No lyrics for this song', 'LRCLIB has no lyrics for this title and artist yet.'],
                        undrawable: ['Lyrics in letters this app cannot draw yet', ''],
                        error: ['Cannot reach the lyrics', net.online() ? 'Trying again in a moment.' : 'The car is offline: turn on the phone hotspot, or Wi-Fi in the Store\'s settings.'],
                    }[st] || [st, ''];
                    message(cv, x, w, mid, T[0], T[1]);
                    return;
                }
                const lines = lyr.lines, p = position(now) + LEAD_MS, i = LyricsLib.lineAt(lines, p);
                if (i !== shown.i) shown = { i: i, at: now, prev: shown.i };
                const f = easeOut((now - shown.at) / FADE_MS);
                const textOf = (j) => (j >= 0 && j < lines.length ? lines[j].text : null);
                let n = i + 1;
                while (n < lines.length && !lines[n].text) n++;
                cv.clip(x - 8, top, w + 16, bottom - top);
                const before = textOf(i - 1);
                if (before) cv.text(fit(cv, before, 26, w, M), x, mid - 84 + (1 - f) * 20, 26, A(C.text, 0.22 + 0.2 * (1 - f)), M);
                const now0 = textOf(i);
                if (now0) {
                    let size = 48;
                    let rows = wrap(cv, now0, size, w, 2, B);
                    if (rows.length > 1) { size = 42; rows = wrap(cv, now0, size, w, 2, B); }
                    const y0 = mid + 14 - (rows.length - 1) * (size + 8) / 2 + (1 - f) * 26;
                    rows.forEach((r, k) => cv.text(r, x, y0 + k * (size + 8), size, A(C.text, 0.4 + 0.6 * f), B));
                } else {
                    const t0 = i >= 0 ? lines[i].t : 0, t1 = n < lines.length ? lines[n].t : t0 + 4000, g = Math.max(0, Math.min(1, (p - t0) / Math.max(1, t1 - t0)));
                    for (let k = 0; k < 3; k++) { const fk = Math.max(0, Math.min(1, g * 3 - k)); cv.circle(x + 14 + k * 38, mid, 10 + fk * 2, A(C.text, 0.3 + 0.7 * fk)); }
                }
                if (n < lines.length) cv.text(fit(cv, lines[n].text, 28, w, M), x, mid + 110 + (1 - f) * 16, 28, A(C.dim, 0.5 + 0.5 * f), M);
                cv.noclip();
            }
            function message(cv, x, w, y, a, b) {
                cv.text(fit(cv, a, 34, w, B), x, y, 34, C.text, B);
                if (b) wrap(cv, b, 20, w, 2, M).forEach((r, k) => cv.text(r, x, y + 40 + k * 27, 20, C.dim, M));
            }

            /* the Sport HUD page */
            function drawSport(cv, Ar, x0) {
                const top = Ar.y + 76;
                cv.text('Sport HUD', x0, top + 4, 26, C.text, B);
                const sv = sport.view(), on = settings.get('sportHud') !== false;
                cv.text(fit(cv, sv.text, 18, Ar.right - x0 - 360, M), x0 + 170, top + 2, 18, DOT[sv.kind] || C.dim, M);
                // the tach as it is on the glass, twice its size, on a black card
                const pw = 760, ph = 247, px = x0, py = top + 22;
                cv.roundRect(px, py, pw + 48, ph + 40, 24, C.card);
                cv.roundRect(px + 24, py + 20, pw, ph, 14, '#000000');
                try {
                    // the picture is sent to the renderer at most 3 times a second (record.setImage), drawn by id
                    if (Date.now() - previewAt > 330) {
                        const pc = sport.preview();
                        previewPic = { w: pc.w, h: pc.h, rgba: Buffer.from(pc.d.buffer, pc.d.byteOffset, pc.d.length) };
                        if (typeof record.setImage === 'function') record.setImage(PREVIEW_ID, previewPic.w, previewPic.h, previewPic.rgba);
                        previewAt = Date.now();
                    }
                    if (typeof cv.image === 'function') cv.image(PREVIEW_ID, px + 24, py + 20, pw, ph);
                    else if (previewPic) cv.drawImage(previewPic.rgba, previewPic.w, previewPic.h, px + 24, py + 20, pw, ph);
                } catch (e) { cv.text('Preview unavailable: ' + e.message, px + 48, py + 150, 20, C.dim, M); }
                if (!on) { cv.roundRect(px + 24, py + 20, pw, ph, 14, A('#000000', 0.6)); cv.text('Off', px + 24 + pw / 2, py + 170, 34, C.dim, Object.assign({ align: 'center' }, B)); }
                // the readouts, as tiles
                const tx = px + pw + 72, tw = (Ar.right - tx - 14) / 2, th = 136;
                const items = sport.items();
                const tones = { cold: C.mLight, warm: C.amber, hot: C.red, text: C.text };
                const tiles = ['OIL', 'GEARBOX', 'WATER', 'LIMIT'].map((l) => items.filter((it) => it.label === l)[0] || { label: l, value: '--', tone: 'off' });
                tiles.forEach((it, k) => {
                    const x = tx + (k % 2) * (tw + 14), y = py + Math.floor(k / 2) * (th + 14);
                    cv.roundRect(x, y, tw, th, 22, C.card);
                    cv.text(it.label === 'LIMIT' ? 'Cold limit' : it.label.charAt(0) + it.label.slice(1).toLowerCase(), x + 22, y + 38, 17, C.dim, B);
                    cv.text(String(it.value), x + 22, y + 98, 40, tones[it.tone] || C.faint, B);
                });
                // actions
                const by = py + ph + 58;
                cv.roundRect(px, by, 240, 52, 26, C.accent);
                cv.text('Test on the HUD', px + 120, by + 33, 20, C.text, Object.assign({ align: 'center' }, B));
                btn(cv, 'sport_test', px, by, 240, 52, () => { sport.demo(8000); say('Sport HUD: an 8 s rev sweep on the HUD'); log.info('sport hud: test sweep'); }, 26);
                cv.text('Shift lights at ' + sport.shiftAt() + ' rpm  ·  redline ' + sport.redline() + ' rpm  ·  size, place and readouts in Settings', px + 266, by + 33, 18, C.dim, M);
            }

            FS.setup(ctx);
            ctx.loop('MAIN', 6, guard('draw', async () => {
                const now = Date.now(), cv = ctx.canvas(W, H), Ar = FS.area(cv), fullH = H + (cv.extra || 0);
                if (cv.chrome) G.frame(cv, ctx.theme(), ['HUD'], 0, []);
                if (!cur) follow();
                const lyr = lyricsFor();
                if (lyr && lyr.state !== lastState) { lastState = lyr.state; log.info('lyrics: ' + lyr.state); }
                cv.fillRect(0, 0, W, fullH, C.bg);
                rail(cv, Ar);
                const x0 = Ar.x + 128;
                topBar(cv, Ar, x0);
                if (page === 'sport') drawSport(cv, Ar, x0); else drawPlaying(cv, Ar, x0, now, lyr);
                if (toast && now < toast.until) {
                    const s2 = fit(cv, toast.text, 19, 800, B), tw = cv.textWidth(s2, 19, B) + 52;
                    cv.roundRect(Ar.right - tw, Ar.bottom - 50, tw, 46, 23, A('#2c2c30', 0.97));
                    cv.text(s2, Ar.right - tw / 2, Ar.bottom - 20, 19, C.text, Object.assign({ align: 'center' }, B));
                }
                await ui.image('MAIN_GFX', cv);
            }));

            np.start().then(() => log.info('subscribed: ' + JSON.stringify(np.status())), (e) => log.error('nowplaying start: ' + (e && e.stack || e)));
            log.info('started ' + VERSION + ', fonts ' + F_BOLD + '/' + F_MED + ', HUD ' + (settings.get('hud') ? 'on' : 'off'));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
