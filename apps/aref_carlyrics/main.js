'use strict';
/**
 * Car Lyrics: synced lyrics for whatever the car is playing (Apple Music over CarPlay, Bluetooth, USB),
 * with no Spotify and no phone app. The track and the time in it come from the head unit itself
 * (car/nowplaying.js: BMW's MediaPlayer, CarPlay's instance CarPlayMedia), the lyrics from LRCLIB
 * (stage/lyrics.js, from G's Music), the album art from Apple's iTunes Search API (art/artwork.js).
 *
 * A full-screen page ("fullscreen": true, kit/runtime/fullscreen.js), drawn like Apple Music's lyrics
 * view: the song's artwork blurred behind everything, the cover with the title and a progress line on
 * the left, and the lyrics on the right, big and bold, the line being sung bright and the rest faded,
 * gliding up line by line. Header tabs: Lyrics, Probe (every value the car reports), Settings.
 * Where the kit can't run the screen (software renderer) the HMI's bar buttons do the same jobs.
 *
 * Timing: the car sends the time in the song about once a second (currentItemTime.elapsed, ms). The page
 * runs its own clock between those, pulled gently toward each new value, so the lyrics move smoothly
 * and never jump; paused, it stops. Only a source that sends no time falls back to timing the song from
 * when it changed (and the Sync button).
 *
 * Read-only toward the car: it subscribes to and reads fields, never calls a method or writes a value.
 *
 * Node 8 only (the car's version): no ?. ?? import, object spread, flat(), class fields, optional catch
 * binding. Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const FS = require('./kit/fullscreen');
const record = require('./kit/record');
const fonts = require('./kit/fonts');
const pack = require('./kit/pack');
const NP = require('./nowplaying');
const LyricsLib = require('./lyrics');
const ART = require('./artwork');
const http = require('./http');
const HW = require('./kit/homewidget');

const VERSION = '0.6.6';
const HOMEPAGE = 'https://github.com/arefahmad/idrive7-apps';
const W = 1600, H = 520;
const IFACES = [
    { iface: 'de.bmw.infotainment.a4a.carplay.CarPlayManager', instances: ['CarPlayManagerInst1'] },
    { iface: 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer', instances: [] },
    // found by Car Explorer on a G22: what the HMI's own media screens show, and the dynamic (streaming) player
    { iface: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', instances: [] },
    { iface: 'de.bmw.infotainment.entertainment.dynamicmediaplayer.DynamicMediaPlayer', instances: [] },
];
const ART_ID = 41, BG_ID = 42, BG2_ID = 43;    // pixel picture ids (record.setImage)
const FRAME_MS = 1000 / 60;       // the animation clock's step: up to 60 different frames a second while lines glide (identical frames still aren't sent)
const LEAD_MS = 250;              // a line lights up this much before its time (reading takes a moment)
const GLIDE_MS = 620;             // the lyrics glide to the next line over this long
const STAGGER_MS = 45;            // ... each line below a little after the one above (Apple Music's ripple)
const FADE_MS = 320;              // a line brightens (and the last one fades) over this long
const NUDGE = 0.3;                // share of the gap to a new time from the car that the clock takes at once
const SNAP_MS = 1500;             // a gap bigger than this (a seek, a skip back) is jumped, not glided
const HOLD_MS = 4000;             // the clock runs at most this far past the car's last time
const IDLE_MS = 60000;            // off screen this long: the app goes idle (no subscriptions, no timers)
const REPORT_MS = 60000;          // carlyrics-probe.txt is written again this often (when anything changed)
// the lyrics as Apple Music on a Mac draws them: big bold text, wrapped; the line being sung full white,
// the ones to come at 40 %, the ones sung at 25 %, both softly blurred, more the further they are
const LYR = { size: 50, lh: 60, gap: 24, max: 4 };   // text size, line height, gap between lines, wrapped lines at most (Settings > Lyrics size)
const LYR_SIZES = { small: 42, medium: 50, large: 58, huge: 66 };
const COVER_SIZES = { small: 0.8, medium: 1, large: 1.15 };
const NEXT_A = 0.4, PAST_A = 0.25;                  // brightness of the lines to come and of the lines sung
const BLUR_PX = 1.2, BLUR_MAX = 3.6;                // blur radius per line away from the one being sung, and at most

const WHITE = '#ffffff';
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
/** Word-wrap s to lines of at most w px (at most max lines; the last one cut). */
function wrap(cv, s, size, w, max, opt) {
    const o = Object.assign({ literal: true }, opt || {});
    const words = LyricsLib.fold(String(s || '')).split(/\s+/).filter(Boolean), out = [];
    let cur = '';
    words.forEach((word) => {
        const next = cur ? cur + ' ' + word : word;
        if (!cur || cv.textWidth(next, size, o) <= w) cur = next; else { out.push(cur); cur = word; }
    });
    if (cur) out.push(cur);
    if (max && out.length > max) { const rest = out.slice(max - 1).join(' '); out.length = max - 1; out.push(fit(cv, rest, size, w, opt)); }
    return out;
}
/** Colours for a song without artwork, from its name (each song its own). */
function nameColours(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const hue = h % 360, hsl = (hh, ss, ll) => {
        const a = ss * Math.min(ll, 1 - ll), f = (n) => { const k = (n + hh / 30) % 12; const v = Math.round(255 * (ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); return ('0' + v.toString(16)).slice(-2); };
        return '#' + f(0) + f(8) + f(4);
    };
    return { top: hsl(hue, 0.5, 0.24), bottom: hsl((hue + 35) % 360, 0.55, 0.08), glow: hsl((hue + 330) % 360, 0.7, 0.42), art1: hsl(hue, 0.6, 0.5), art2: hsl((hue + 45) % 360, 0.65, 0.28) };
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
            const lyrics = new LyricsLib.Lyrics(request, log, 'CarLyrics/' + VERSION + ' (iDrive 7 head-unit app; ' + HOMEPAGE + ')', path.join(ctx.dataDir, 'lyrics'));   // kept on disk: offline next time
            const artwork = new ART.Artwork(request, log, undefined, { dir: path.join(ctx.dataDir, 'covers') });   // covers kept on disk: replays show at once
            const np = new NP.NowPlaying(ctx.signals, log, IFACES);
            // Inter (OFL), the open look-alike of Apple's SF Pro: data/fonts/, baked by tools/bake_fonts.py
            let F_BOLD = 'bold', F_MED = 'label';
            try {
                const dirs = [path.join(__dirname, 'fonts'), path.join(__dirname, 'data', 'fonts')];
                const src = pack.open(fs.existsSync(dirs[0] + '.pack') || fs.existsSync(dirs[0]) ? dirs[0] : dirs[1]);
                if (fonts.register('cl_bold', src.json('cl_bold.json'))) F_BOLD = 'cl_bold';
                if (fonts.register('cl_med', src.json('cl_med.json'))) F_MED = 'cl_med';
            } catch (e) { log.warn('fonts: ' + e.message); }
            log.info('fonts: ' + F_BOLD + ', ' + F_MED);
            let catalog = { error: 'not read yet', hits: [] };
            let toast = null;
            const say = (text, ms) => { toast = { text: text, until: Date.now() + (ms || 3000) }; };

            /* ---------- the track, and the clock that follows the car's time in it ---------- */
            let cur = null;           // { key, title, artist, album, duration, playing }
            let clk = null;           // { pos, at, playing, last }: the song's time pos (ms) at at (ms epoch)
            let idle = false;         // off screen a minute: subscriptions closed (see "idle off screen" below)
            let startAt = Date.now(); // a source with no time of its own: when the song (probably) began
            const clockAt = (now) => clk.pos + (clk.playing ? Math.min(now - clk.at, HOLD_MS) : 0);
            const follow = () => {
                const t = np.track();
                if (!t) return;
                const key = t.title + '|' + t.artist;
                if (!cur || cur.key !== key) {
                    cur = { key: key, title: t.title, artist: t.artist, album: t.album, duration: t.duration || 0, playing: true };
                    clk = null; startAt = Date.now();
                    log.info('track: "' + t.title + '" by "' + t.artist + '" on "' + (t.album || '') + '" (' + Math.round((t.duration || 0) / 1000) + ' s) from ' + t.from);
                }
                if (t.duration) cur.duration = t.duration;
                if (t.album) cur.album = t.album;
                if (t.cover) cur.cover = t.cover;
                const playing = t.direct ? !!t.playing : true;
                cur.playing = playing;
                if (t.position === null || t.position === undefined) return;
                const at = t.positionAt || Date.now();
                if (!clk) { clk = { pos: t.position, at: at, playing: playing, last: t.position }; return; }
                if (t.position === clk.last && playing === clk.playing) return;
                const predicted = clockAt(at), gap = t.position - predicted;
                // a seek, a skip back, a pause or a resume: jump; else glide toward the car's time
                if (!playing || !clk.playing || Math.abs(gap) > SNAP_MS) clk.pos = t.position;
                else clk.pos = predicted + gap * NUDGE;
                clk.at = at; clk.playing = playing; clk.last = t.position;
            };
            np.onChange(guard('change', follow));
            const offset = () => Number(settings.get('offset')) || 0;
            const position = (now) => (clk ? clockAt(now || Date.now()) : (now || Date.now()) - startAt) + offset();
            const sync = () => { startAt = Date.now(); say('Synced: the song starts now'); };
            ui.onClick('BTN_SYNC', guard('sync', sync));

            /* ---------- artwork: uploaded to the renderer once per song ---------- */
            let artShown = 0;         // the artwork version uploaded
            let lastArt = null;
            const artFor = () => {
                if (!cur) return null;
                const a = artwork.get({ title: cur.title, artist: cur.artist, album: cur.album, cover: cur.cover });   // cover: the car's own file
                // not ready yet: the song's own colours (cover placeholder and background), never the last song's art
                if (a.state !== 'ready') return (lastArt = null);
                lastArt = a;
                if (a.ver !== artShown) {
                    record.setImage(ART_ID, ART.ART_PX, ART.ART_PX, a.cover);
                    record.setImage(BG_ID, ART.BG_W, ART.BG_H, a.blur);
                    record.setImage(BG2_ID, ART.BG_W, ART.BG_H, a.blur2);
                    artShown = a.ver;
                }
                return a;
            };

            /* ---------- the page ---------- */
            FS.setup(ctx);                            // where the kit runs the screen: the page's own buttons and tabs
            let probe = false;                        // the Probe tab
            if (ctx.onTab) ctx.onTab(guard('tab', (i) => { probe = i === 1; page = 0; vpage = 0; showButtons(); }));

            /** The layout in the safe area A: the cover centred in the left half, the lyrics in the right half. */
            // 0.5.1-0.5.3 kept the arrangement in 'layout', which is the kit's (full screen or BMW's frame): moved over
            try { if (settings.get('layout') === 'side') { settings.set('arrangement', 'side'); settings.set('layout', 'full'); log.info('settings: arrangement moved out of layout'); } } catch (e) { /* */ }
            const glassOn = () => settings.get('style') !== 'classic';
            const sideOn = () => settings.get('arrangement') === 'side';   // ('layout' is the kit's own: full screen or not)      // a big cover, the lyrics beside it
            /** iOS 26 Apple Music: a glass capsule with the cover and names top left, the lyrics full width under it,
             * a slim glass progress pill at the bottom, a round ⋯ glass button top right (Settings). */
            function geoGlass(A) {
                const top = A.y + 120, bottom = A.bottom - 64;
                return { A: A, glass: true, LX: A.x + 48, LW: A.w - 96, top: top, bottom: bottom };
            }
            function glassRect(cv, x, y, w, h, r) {
                // Liquid Glass on a blurred backdrop: a light frosted fill, a brighter rim, a highlight along the top;
                // Classic: a plain dark pill
                if (!glassOn()) { cv.roundRect(x, y, w, h, r, G.withAlpha('#000000', 0.35)); return; }
                cv.roundRect(x, y, w, h, r, G.withAlpha(WHITE, 0.12));
                cv.strokeRoundRect(x, y, w, h, r, 1, G.withAlpha(WHITE, 0.3));
                cv.roundRect(x + r * 0.6, y + 1.5, w - r * 1.2, 1.5, 1, G.withAlpha(WHITE, 0.35));
            }
            function openSettings() { try { const b = ui.rhmi && ui.rhmi.getByName('BTN_SETTINGS'); if (b && b.emit) b.emit('action', {}); } catch (e) { log.warn('settings: ' + e.message); } }
            /** ⋯ (Settings), a round glass button top right: there's no Settings tab in the header. */
            function moreButton(cv, A) {
                const d = 64, mx = A.right - 24 - d, my = A.y + 24;
                glassRect(cv, mx, my, d, d, d / 2);
                for (let k = -1; k <= 1; k++) cv.circle(mx + d / 2 + k * 13, my + d / 2, 4, WHITE);
                if (cv.own) FS.button(cv, 'more', mx, my, d, d, guard('more', openSettings), { r: d / 2, slop: 10 });
            }
            function glassChrome(cv, Q, a, P, now) {
                const A = Q.A, B = { font: F_BOLD, literal: true }, M = { font: F_MED, literal: true };
                // the capsule: cover, title, artist
                const s = 76, cx = A.x + 24, cy = A.y + 18, tw = Math.min(620, Math.max(cv.textWidth(LyricsLib.fold(cur.title), 28, B), cv.textWidth(LyricsLib.fold(cur.artist || ''), 22, M)));
                glassRect(cv, cx, cy, s + tw + 52, s + 16, (s + 16) / 2);
                if (a) cv.image(ART_ID, cx + 8, cy + 8, s, s);
                else cv.card(cx + 8, cy + 8, s, s, 12, [[0, P.art1], [1, P.art2]]);
                cv.text(fit(cv, cur.title, 28, 620, B), cx + s + 26, cy + 44, 28, WHITE, B);
                cv.text(fit(cv, cur.artist || '', 22, 620, M), cx + s + 26, cy + 74, 22, G.withAlpha(WHITE, 0.66), M);
                moreButton(cv, A);
                // progress: a slim glass pill with the times
                const pos = Math.max(0, position(now) - offset()), dur = cur.duration || 0, pw = Math.min(760, A.w - 96), px = A.x + (A.w - pw) / 2, py = A.bottom - 50;
                glassRect(cv, px, py, pw, 36, 18);
                const bx = px + 76, bw = pw - 152;
                cv.roundRect(bx, py + 16, bw, 4, 2, G.withAlpha(WHITE, 0.25));
                if (dur) cv.roundRect(bx, py + 16, Math.max(4, Math.min(1, pos / dur) * bw), 4, 2, WHITE);
                cv.text(mmss(pos), px + 22, py + 24, 16, G.withAlpha(WHITE, 0.75), M);
                cv.text(dur ? '-' + mmss(dur - pos) : '', px + pw - 22, py + 24, 16, G.withAlpha(WHITE, 0.75), Object.assign({ align: 'right' }, M));
                if (!clk && cv.own) {
                    const bw2 = 220, bx2 = A.right - 24 - bw2, by2 = py - 4;
                    glassRect(cv, bx2, by2, bw2, 44, 22);
                    cv.text('Song just started', bx2 + bw2 / 2, by2 + 29, 18, WHITE, { align: 'center', font: F_BOLD, literal: true });
                    FS.button(cv, 'sync', bx2, by2, bw2, 44, sync, { r: 22 });
                }
            }

            function geo(A) {
                const S = Math.round(Math.max(200, Math.min(480, (A.h - 150) * (COVER_SIZES[settings.get('cover_size')] || 1))));
                const half = A.x + Math.round(A.w * 0.46);
                const colH = S + 150, x0 = A.x + Math.round((half - A.x - S) / 2), y0 = A.y + Math.max(0, Math.round((A.h - colH) / 2));
                const LX = half + 20;
                return { A: A, S: S, x0: x0, y0: y0, LX: LX, LW: A.right - 56 - LX };
            }

            /** The blurred artwork behind everything (or the song's colours), drifting slowly while it plays. */
            /**
             * Where the kit runs the screen, the HMI's own picture under it is one plain colour (the theme's bg); it
             * shows where the surface is see-through (a few px along the bottom). The back column itself gets the
             * backdrop drawn into it (bgEdge), so this is just the backdrop's darker lower tone, song by song.
             */
            const THEMES = require('./kit/themes');
            let hmiBgShown = null;
            function hmiBg(a, P) {
                const c = edgeColour(a, P);
                if (c === hmiBgShown) return;
                hmiBgShown = c;
                // what shows in the few px the page doesn't cover (along the bottom): the backdrop's darker lower tone
                const n = (i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
                const bg = '#' + [0, 1, 2].map((i) => ('0' + Math.round(n(i) * 0.62).toString(16)).slice(-2)).join('');
                if (ctx.setTheme) ctx.setTheme(() => Object.assign({}, THEMES.theme(settings.get('theme')), { bg: bg }));
            }

            /** The backdrop's colour at its left edge (the blurred cover's left 8 %, dimmed as the glass dims it), as #rrggbb. */
            const edgeCache = { ver: -1, c: null };
            function edgeColour(a, P) {
                const hex = (r, g, b) => '#' + [r, g, b].map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
                if (!a || !a.blur) {
                    const t = String(P.top || '#202020'), b = String(P.bottom || '#101010'), n = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) || 0;
                    return hex((n(t, 0) + n(b, 0)) / 2 * 0.85, (n(t, 1) + n(b, 1)) / 2 * 0.85, (n(t, 2) + n(b, 2)) / 2 * 0.85);
                }
                if (edgeCache.ver === a.ver && edgeCache.c) return edgeCache.c;
                const bw = ART.BG_W, bh = ART.BG_H, cols = Math.max(2, Math.round(bw * 0.08));
                let r = 0, g = 0, b = 0, k = 0;
                for (let y = 0; y < bh; y++) for (let x = 0; x < cols; x++) { const i = (y * bw + x) * 4; r += a.blur[i]; g += a.blur[i + 1]; b += a.blur[i + 2]; k++; }
                edgeCache.ver = a.ver; edgeCache.c = hex(r / k * 0.82, g / k * 0.82, b / k * 0.82);
                return edgeCache.c;
            }

            const OVER = 160;          // logical px drawn past the page's top and bottom edges
            function backdrop(cv, a, now, P, fullH, x0) {
                x0 = x0 || 0;      // < 0: the copy for BMW's back column (bgEdge), so its plain fills start there too
                if (a) {
                    // two blurred layers of the cover drifting past each other, slowly, as Apple Music's background flows
                    // Settings > Background motion: still (default) or a slow drift, as Apple Music's
                    const d = settings.get('bg_motion') === 'drift' && cur && cur.playing ? now / 1000 : 0;
                    // drift: each layer wanders ~14 % of the screen and breathes (zooms 6 % in and out) over 30-50 s, the
                    // two at different speeds, so the colours visibly flow (Nov 21: 7 % over ~1 min read as still)
                    const layer = (id, sc, fx, fy, ph) => {
                        const z = sc * (1 + 0.06 * Math.sin(d / (fx * 1.3) + ph));
                        const bw = W * z, bh = (fullH + 2 * OVER) * z;   // tall enough to cover past the page (full screen)
                        cv.image(id, (W - bw) / 2 + Math.sin(d / fx + ph) * 0.14 * W, (fullH - bh) / 2 + Math.cos(d / fy + ph) * 0.12 * fullH, bw, bh);
                    };
                    layer(BG_ID, 1.4, 5, 6.5, 0);
                    cv.alpha(0.55);
                    layer(BG2_ID, 1.6, 7.5, 4.5, 2);
                    cv.alpha(1);
                } else {
                    cv.gradientRect(x0, 0, W - x0, fullH, [[0, P.top], [1, P.bottom]]);
                    cv.fillRect(x0, -OVER, W - x0, OVER, P.top); cv.fillRect(x0, fullH, W - x0, OVER, P.bottom);
                    for (let r = 340; r > 20; r -= 16) cv.circle(300, 120, r, G.withAlpha(P.glow, 0.016));
                    for (let r = 300; r > 20; r -= 16) cv.circle(1300, fullH - 60, r, G.withAlpha(P.glow, 0.012));
                }
                // a little darker at the top and the bottom, as glass over the artwork
                cv.gradientRect(x0, 0, W - x0, fullH, [[0, G.withAlpha('#000000', 0.3)], [0.45, G.withAlpha('#000000', 0)], [1, G.withAlpha('#000000', 0.4)]]);
                // the screen reaches past the page at the top and bottom (full screen): the same dimming there, so those
                // rows match the page instead of showing the art undimmed
                cv.fillRect(x0, -OVER, W - x0, OVER, G.withAlpha('#000000', 0.3)); cv.fillRect(x0, fullH, W - x0, OVER, G.withAlpha('#000000', 0.4));
            }

            function coverColumn(cv, Q, a, P, now) {
                const x = Q.x0, y = Q.y0, s = Q.S, r = Math.round(s * 0.04);
                // a soft shadow under the cover
                for (let k = 1; k <= 6; k++) cv.roundRect(x - k * 3, y + 8 + k, s + k * 6, s + k * 2, r + k * 3, G.withAlpha('#000000', 0.06));
                if (a) cv.image(ART_ID, x, y, s, s);
                else {
                    cv.card(x, y, s, s, r, [[0, P.art1], [1, P.art2]]);
                    const ini = LyricsLib.fold(cur.title).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                    cv.text(ini, x + s / 2, y + s / 2 + s * 0.13, Math.round(s * 0.36), G.withAlpha(WHITE, 0.92), { font: F_BOLD, align: 'center', literal: true });
                }
                const B = { font: F_BOLD, literal: true }, M = { font: F_MED, literal: true };
                let ty = y + s + 46, size = 30;
                while (size > 22 && cv.textWidth(LyricsLib.fold(cur.title), size, B) > s) size -= 2;
                cv.text(fit(cv, cur.title, size, s, B), x, ty, size, WHITE, B);
                ty += 32;
                const by = [cur.artist, cur.album].filter(Boolean).join('  ·  ');
                cv.text(fit(cv, by, 22, s, M), x, ty, 22, G.withAlpha(WHITE, 0.62), M);
                // the progress line, and the times under it
                const py = ty + 28, pos = Math.max(0, position(now) - offset()), dur = cur.duration || 0;
                // Apple Music's: a rounded bar a little thicker than a line, the played part white, the times under its ends
                cv.roundRect(x, py, s, 7, 3.5, G.withAlpha(WHITE, 0.22));
                if (dur) cv.roundRect(x, py, Math.max(7, Math.min(1, pos / dur) * s), 7, 3.5, G.withAlpha(WHITE, 0.92));
                cv.text(mmss(pos), x, py + 30, 16, G.withAlpha(WHITE, 0.55), M);
                if (dur) cv.text('-' + mmss(dur - pos), x + s, py + 30, 16, G.withAlpha(WHITE, 0.55), Object.assign({ align: 'right' }, M));
                const state = !cur.playing ? 'Paused' : !clk ? 'Timed from the song change' : '';
                if (state) cv.text(state, x + s / 2, py + 30, 16, G.withAlpha(WHITE, 0.55), Object.assign({ align: 'center' }, M));
                // no time from the car: the Sync button (here where the kit runs the screen, the bar's elsewhere)
                if (!clk && cv.own) {
                    const bw = 220, bx = x + (s - bw) / 2, bt = py + 44;
                    cv.roundRect(bx, bt, bw, 46, 23, G.withAlpha(WHITE, 0.14));
                    cv.strokeRoundRect(bx, bt, bw, 46, 23, 1, G.withAlpha(WHITE, 0.3));
                    cv.text('Song just started', bx + bw / 2, bt + 30, 18, WHITE, { align: 'center', font: F_BOLD, literal: true });
                    FS.button(cv, 'sync', bx, bt, bw, 46, sync, { r: 23 });
                }
            }

            /* the lyrics' layout for a song: each line wrapped, and where it sits (cached; textWidth isn't free) */
            let laid = null;          // { lines, w, blocks: [{ rows, top, h, gap }] }
            function layout(cv, lines, w) {
                if (laid && laid.lines === lines && laid.w === w && laid.size === LYR.size) return laid;
                const opt = { font: F_BOLD, literal: true }, blocks = [];
                let y = 0;
                lines.forEach((l) => {
                    const rows = l.text ? wrap(cv, l.text, LYR.size, w, LYR.max, opt) : [];
                    const h = rows.length ? rows.length * LYR.lh : LYR.lh;
                    blocks.push({ rows: rows, top: y, h: h });
                    y += h + LYR.gap;
                });
                laid = { lines: lines, w: w, blocks: blocks, size: LYR.size };
                return laid;
            }
            let glide = { i: -2, from: 0, to: 0, at: 0, prev: -1 };    // the scroll to line i
            function drawSynced(cv, Q, lines, now) {
                const L = layout(cv, lines, Q.LW), B = L.blocks, p = position(now) + LEAD_MS, i = LyricsLib.lineAt(lines, p);
                const target = B[Math.max(0, i)].top;
                if (i !== glide.i) {
                    const shown = glide.i === -2 ? target : scrollOf(glide, 0, now);
                    glide = { i: i, from: shown, to: target, at: now, prev: glide.i };
                }
                const top = Q.top || Q.A.y, bottom = Q.bottom || Q.A.bottom, anchor = top + Math.round((bottom - top) * (Q.glass ? 0.22 : 0.3));
                const fadeIn = easeOut((now - glide.at) / FADE_MS);
                cv.clip(Q.LX - 20, top, W - (Q.LX - 20), bottom - top);
                const first = Math.max(0, i - 3);
                for (let j = first; j < B.length; j++) {
                    const b = B[j], y = anchor + b.top - scrollOf(glide, Math.max(0, j - i), now);
                    if (y > bottom + 20) break;
                    if (y + b.h < top - 20) continue;
                    // the line being sung lights up as the one before goes back to the rest
                    const rest = j < i ? PAST_A : NEXT_A;
                    let a = rest, blur = Math.min(BLUR_MAX, Math.abs(j - Math.max(0, i)) * BLUR_PX);
                    if (j === i) { a = rest + (1 - rest) * fadeIn; blur *= 1 - fadeIn; } else if (j === glide.prev && glide.prev >= 0) { a = 1 - (1 - PAST_A) * fadeIn; blur = Math.min(BLUR_MAX, BLUR_PX) * fadeIn; }
                    if (j === i && i >= 0) blur = 0;
                    const edge = Math.min(1, (y + b.h - top) / 90, (bottom - y) / 140);
                    a *= Math.max(0, edge);
                    if (a <= 0.01) continue;
                    if (!b.rows.length) { dots(cv, Q.LX, y, j === i ? 1 : a, lines, j, p); continue; }
                    b.rows.forEach((row, k) => soft(cv, row, Q.LX, y + k * LYR.lh + Math.round(LYR.size * 0.8), LYR.size, a, blur));
                }
                cv.noclip();
            }
            /**
             * Text at brightness a, blurred by radius r. The kit draws no blur, so the line is drawn several times,
             * once in place and in rings around it, each faint, adding up to a soft-edged line of brightness a:
             * one ring of 6 for a light blur, rings of 8 and 4 (13 copies in all) for a heavier one.
             */
            const ring = (n, k, ph) => { const out = []; for (let q = 0; q < n; q++) out.push([Math.cos(ph + q * 2 * Math.PI / n) * k, Math.sin(ph + q * 2 * Math.PI / n) * k]); return out; };
            const LIGHT = [[0, 0]].concat(ring(6, 1, 0)), HEAVY = [[0, 0]].concat(ring(8, 1, 0), ring(4, 0.5, Math.PI / 4));
            function soft(cv, s, x, y, size, a, r) {
                const o = { font: F_BOLD, literal: true };
                if (r < 0.35) { cv.alpha(a); cv.text(s, x, y, size, WHITE, o); cv.alpha(1); return; }
                const taps = r < 1.6 ? LIGHT : HEAVY;
                cv.alpha(1 - Math.pow(1 - a, 1 / taps.length));
                taps.forEach((d) => cv.text(s, x + d[0] * r, y + d[1] * r, size, WHITE, o));
                cv.alpha(1);
            }
            /** The scroll (px) of a line `lag` lines below the one being sung: each starts its glide a little later. */
            function scrollOf(g, lag, now) {
                return g.from + (g.to - g.from) * easeOut((now - g.at - Math.min(lag, 6) * STAGGER_MS) / GLIDE_MS);
            }
            /** An instrumental break: three dots that fill up as the next line comes closer. */
            function dots(cv, x, y, a, lines, j, p) {
                const t0 = lines[j].t, t1 = j + 1 < lines.length ? lines[j + 1].t : t0 + 4000, f = Math.max(0, Math.min(1, (p - t0) / Math.max(1, t1 - t0)));
                for (let k = 0; k < 3; k++) {
                    const fk = Math.max(0, Math.min(1, f * 3 - k));
                    cv.circle(x + 12 + k * 34, y + LYR.lh / 2, 10 + fk * 2, G.withAlpha(WHITE, a * (0.35 + 0.65 * fk)));
                }
            }
            function drawPlain(cv, Q, text) {
                cv.text('Lyrics (not synced to the song)', Q.LX, (Q.top || Q.A.y) + 34, 18, G.withAlpha(WHITE, 0.6), { font: F_MED, literal: true });
                let y = Q.A.y + 80;
                text.filter(Boolean).some((s, k) => {
                    const rows = wrap(cv, s, 32, Q.LW, 2, { font: F_BOLD, literal: true });
                    if (y + rows.length * 42 > Q.A.bottom) return true;
                    rows.forEach((r) => { cv.text(r, Q.LX, y, 32, G.withAlpha(WHITE, k ? 0.6 : 1), { font: F_BOLD, literal: true }); y += 42; });
                    y += 12;
                    return false;
                });
            }
            function message(cv, Q, a, b) {
                const y = Q.A.y + Math.round(Q.A.h * 0.42);
                cv.text(fit(cv, a, 40, Q.LW, { font: F_BOLD }), Q.LX, y, 40, WHITE, { font: F_BOLD, literal: true });
                if (b) wrap(cv, b, 22, Q.LW, 2, { font: F_MED }).forEach((r, k) => cv.text(r, Q.LX, y + 46 + k * 30, 22, G.withAlpha(WHITE, 0.62), { font: F_MED, literal: true }));
            }

            ctx.loop('MAIN', 2, guard('main', async () => {
                if (probe) { await drawProbe(); return; }
                // one clock for the frame in FRAME_MS steps: a frame like the last one isn't sent again
                const now = Math.floor(Date.now() / FRAME_MS) * FRAME_MS;
                const cv = ctx.canvas(W, H), A0 = FS.area(cv), fullH = H + (cv.extra || 0);
                if (!!A0.own !== ownNow) {
                    ownNow = !!A0.own;
                    // back to full screen (after Settings, a pop-up, a renderer reconnect): BMW's bar hidden again
                    if (ownNow && ctx.display && ctx.display._hmiBar) { ctx.display.hmiBarHidden = null; try { ctx.display._hmiBar(); } catch (e) { /* older kit */ } }
                    else if (!ownNow) { shownKey = ''; showButtons(true); }
                }
                // in the HMI's own frame BMW draws its side-panel tab (<) over the left edge: content starts right of
                // it, and the edge is shaded so the tab sits on a band of its own (Nov 18 photo)
                const SIDE = A0.own ? 0 : 72, A = Object.assign({}, A0, { x: A0.x + SIDE, w: A0.w - SIDE });
                // BMW's back column (the left 84 screen px, under its < tab) shows the HMI's own copy of this picture, drawn
                // without the blur and the dimming, so it came out lighter than the page (Nov 20 photo). Opaque fills draw
                // the same in both: the column gets the backdrop's own left-edge colour, solid, blending into the page
                const sideBand = (a, P) => {
                    if (!SIDE) return;
                    const c = edgeColour(a, P), w = 84, fade = 90;
                    cv.fillRect(0, 0, w, fullH, c);
                    for (let i = 0; i < fade; i += 3) cv.fillRect(w + i, 0, 3, fullH, G.withAlpha(c, 1 - (i + 1.5) / fade));
                };
                if (cv.chrome) G.frame(cv, ctx.theme(), settings.get('probe_tab') ? ['Lyrics', 'Probe'] : [], 0, []);   // no tabs: the ⋯ button opens Settings
                if (!cur) follow();
                if (!cur) {
                    const P = nameColours('Car Lyrics');
                    backdrop(cv, null, now, P, fullH); if (cv.bgEdge) cv.bgEdge(() => backdrop(cv, null, now, P, fullH, -300)); sideBand(null, P); hmiBg(null, P);
                    const cy = A.y + A.h / 2;
                    cv.text('Play a song on your phone', A.x + A.w / 2, cy - 6, 40, WHITE, { font: F_BOLD, align: 'center', literal: true });
                    cv.text('Apple Music over CarPlay, or any app over Bluetooth. The lyrics show up here.', A.x + A.w / 2, cy + 40, 22, G.withAlpha(WHITE, 0.62), { align: 'center', font: F_MED, literal: true });
                } else {
                    LYR.size = LYR_SIZES[settings.get('lyrics_size')] || 50; LYR.lh = Math.round(LYR.size * 1.2); LYR.gap = Math.round(LYR.size * 0.48);
                    const P = nameColours(cur.title + cur.artist), a = artFor(), Q = sideOn() ? geo(A) : geoGlass(A);
                    backdrop(cv, a, now, P, fullH); if (cv.bgEdge) cv.bgEdge(() => backdrop(cv, a, now, P, fullH, -300)); sideBand(a, P); hmiBg(a, P);
                    if (Q.glass) glassChrome(cv, Q, a, P, now); else { coverColumn(cv, Q, a, P, now); moreButton(cv, A); }
                    const lyr = lyrics.get({ title: cur.title, artist: cur.artist, album: cur.album, duration: cur.duration });
                    if (lyr.state === 'synced' && lyr.lines.length) drawSynced(cv, Q, lyr.lines, now);
                    else if (lyr.state === 'plain') drawPlain(cv, Q, lyr.text);
                    else if (lyr.state === 'loading') message(cv, Q, 'Finding the lyrics...', '');
                    else if (lyr.state === 'instrumental') message(cv, Q, 'Instrumental', 'Nothing to sing along to.');
                    else if (lyr.state === 'error') message(cv, Q, 'Can\'t reach the lyrics', net.online() ? 'Trying again in a moment.' : 'The car is offline: turn on Wi-Fi in the Store\'s settings, or connect to a phone hotspot.');
                    else if (lyr.state === 'undrawable') message(cv, Q, 'Lyrics in letters this app can\'t draw yet', '');
                    else message(cv, Q, 'No lyrics for this song', 'LRCLIB has no lyrics for this title and artist yet.');
                }
                if (toast && Date.now() < toast.until) {
                    const TO = { font: F_MED, literal: true }, s = fit(cv, toast.text, 22, 1000, TO), w = cv.textWidth(s, 22, TO) + 64, ty = A.bottom - 64;
                    cv.roundRect((W - w) / 2, ty, w, 50, 25, '#000000c0');
                    cv.strokeRoundRect((W - w) / 2, ty, w, 50, 25, 1, G.withAlpha(WHITE, 0.25));
                    cv.text(s, W / 2, ty + 32, 22, WHITE, Object.assign({ align: 'center' }, TO));
                }
                await ui.image('MAIN_GFX', cv);
            }));

            /* ---------- home-screen widget: the song and the line playing ---------- */
            HW.start(ctx, () => {
                if (!cur) return { label: 'Car Lyrics', value: 'Nothing playing', sub: 'Play a song on your phone', small: ['Car Lyrics', 'Nothing playing'] };
                const lyr = lyrics.get({ title: cur.title, artist: cur.artist, album: cur.album, duration: cur.duration });
                let line = '';
                if (lyr.state === 'synced') { const i = LyricsLib.lineAt(lyr.lines, position() + LEAD_MS); line = i >= 0 ? lyr.lines[i].text : ''; }
                return { label: 'Now playing', value: cur.title, sub: line || cur.artist, sub2: line ? cur.artist : '',
                    bar: cur.duration ? (position() - offset()) / cur.duration : null, small: [cur.title, line || cur.artist] };
            }, { fps: 1 });

            /*
             * PROBE: everything the car reports (the Probe tab; the Probe bar button where the kit can't run the
             * screen). Pages: the values, the media interfaces in the catalog, the subscriptions.
             */
            let page = 0, vpage = 0;
            const PAGES = ['Values the car sends', 'Media interfaces in the catalog', 'Subscriptions'];
            const PROBE_BTNS = ['BTN_PAGE', 'BTN_MORE', 'BTN_SAVE'];
            // the bar's buttons (software renderer only: where the kit runs the screen they are hidden anyway)
            let shownKey = '';
            let ownNow = false;       // the kit runs the screen (full screen): BMW's bar is the kit's to hide, not ours
            const showButtons = (force) => {
                if (ownNow) return;
                const key = probe + '|' + !!clk;
                if (key === shownKey && !force) return;
                shownKey = key;
                PROBE_BTNS.forEach((b) => ui.visible(b, probe));
                ui.visible('BTN_SYNC', !probe && !clk);
                ui.text('BTN_PROBE', probe ? 'Lyrics' : 'Probe');
            };
            ctx.onLayout(guard('layout', () => showButtons(true)));
            showButtons();
            setInterval(guard('buttons', () => { if (!idle) showButtons(); }), 3000);
            ui.onClick('BTN_PROBE', guard('probe', () => { probe = !probe; page = 0; vpage = 0; showButtons(); }));
            const nextPage = () => { page = (page + 1) % PAGES.length; vpage = 0; };
            ui.onClick('BTN_PAGE', guard('page', nextPage));
            ui.onClick('BTN_MORE', guard('more', () => { vpage++; }));
            const report = () => {
                const L = ['Car Lyrics ' + VERSION + ' probe, ' + new Date().toISOString(), ''];
                L.push('== track picked: ' + (cur ? JSON.stringify(cur) : 'none') + (clk ? ', clock ' + JSON.stringify(clk) : ', no time from the car'), '');
                L.push('== subscriptions');
                np.status().forEach((s) => L.push(s.iface + ' / ' + s.instance + ': ' + (s.available ? 'available' : 'not available') + ', ' + s.fields + ' fields' + (s.error ? ', error ' + s.error : '')));
                L.push('', '== values (newest first)');
                np.values().forEach((v) => L.push(v.key + ' = ' + v.text + (v.changes ? '  (' + v.changes + ' changes)' : '')));
                L.push('', '== catalog (' + (catalog.error ? 'error ' + catalog.error : catalog.total + ' interfaces') + '): interfaces naming a title, artist, album or now-playing data');
                catalog.hits.forEach((h) => L.push(h.iface + ': ' + h.words.join(', ')));
                return L.join('\n') + '\n';
            };
            const reportFile = path.join(ctx.dataDir, 'carlyrics-probe.txt');
            let lastReport = '';
            const saveReport = () => {
                const r = report();
                if (r.slice(r.indexOf('\n')) === lastReport) return false;
                lastReport = r.slice(r.indexOf('\n'));
                fs.writeFileSync(reportFile, r);
                return true;
            };
            const saveNow = () => { saveReport(); say('Saved to ' + reportFile, 5000); };
            ui.onClick('BTN_SAVE', guard('save', saveNow));
            setInterval(guard('report', () => { if (!idle && np.values().length) saveReport(); }), REPORT_MS);

            // the values that say most about what is playing first: metadata, item, title, state, time
            const RANK = /metadata|item|title|artist|album|state|time|track|song/i;
            async function drawProbe() {
                const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg), A = FS.area(cv);
                G.frame(cv, t, cv.chrome ? ['Lyrics', 'Probe'] : ['Car Lyrics: probe'], cv.chrome ? 1 : 0, []);
                const PER = Math.max(8, Math.floor((A.h - 120) / 24));
                cv.text(PAGES[page] + '  (' + (page + 1) + '/' + PAGES.length + ')', A.x + 16, A.y + 30, 26, t.text, { font: 'bold', literal: true });
                cv.text(fit(cv, cur ? 'Track: "' + cur.title + '" by "' + cur.artist + '"' + (clk ? ', time from the car' : '') : 'Track: not found yet', 18, 760), A.right - 16, A.y + 30, 18, t.dim, { align: 'right', literal: true });
                let rows = [];
                if (page === 0) {
                    const v = np.values().slice().sort((a, b) => (RANK.test(b.key) ? 1 : 0) - (RANK.test(a.key) ? 1 : 0) || b.changes - a.changes || b.at - a.at);
                    if (!v.length) rows.push('Nothing yet. Play a song on your phone with CarPlay connected.');
                    rows = rows.concat(v.map((x) => x.key.replace('MediaPlayer/', '') + ' = ' + x.text + (x.changes ? '  (' + x.changes + ' changes)' : '')));
                } else if (page === 1) {
                    if (catalog.error) rows.push('Catalog not read: ' + catalog.error);
                    rows = rows.concat(catalog.hits.map((h) => h.iface.replace('de.bmw.infotainment.', '') + ': ' + h.words.join(', ')));
                    if (!catalog.error && !catalog.hits.length) rows.push('No interface in the catalog names a title or an artist.');
                } else {
                    np.status().forEach((s2) => rows.push(s2.iface.split('.').pop() + ' / ' + s2.instance + ': ' + (s2.available ? 'available' : 'not available') + ', ' + s2.fields + ' fields' + (s2.error ? ' - ' + s2.error : '')));
                    rows.push('', 'Report file: ' + reportFile, 'Online: ' + (net.online() ? 'yes' : 'no (lyrics need the Store\'s internet)'));
                }
                const pages = Math.max(1, Math.ceil(rows.length / PER)), pg = vpage % pages;
                rows.slice(pg * PER, pg * PER + PER).forEach((r, k) => cv.text(fit(cv, r, 19, A.w - 32), A.x + 16, A.y + 66 + k * 24, 19, k % 2 ? t.dim : t.text, { literal: true }));
                // the page's buttons where the kit runs the screen
                if (cv.own) {
                    const bw = 200, bh = 52, by = A.bottom - bh;
                    [['Next page', nextPage], ['More', () => { vpage++; }], ['Save report', saveNow]].forEach((b, k) => {
                        const bx = A.right - (3 - k) * (bw + 14);
                        cv.roundRect(bx, by, bw, bh, 14, G.withAlpha(WHITE, 0.07));
                        cv.strokeRoundRect(bx, by, bw, bh, 14, 1, G.withAlpha(WHITE, 0.2));
                        cv.text(b[0].toUpperCase(), bx + bw / 2, by + 33, 17, t.text, { align: 'center', font: 'bold', spacing: 1.5, literal: true });
                        FS.button(cv, 'probe' + k, bx, by, bw, bh, guard('probe button', b[1]), { r: 14, slop: 6 });
                    });
                }
                cv.text((pages > 1 ? 'Page ' + (pg + 1) + ' of ' + pages + (cv.own ? '' : ' (More)') : '') + (toast && Date.now() < toast.until ? '   ' + toast.text : ''), A.x + 16, A.bottom - 18, 16, t.dim, { literal: true });
                await ui.image('MAIN_GFX', cv);
            }

            /* ---------- start: the catalog (one read), then the subscriptions ---------- */
            catalog = NP.scanCatalog();
            log.info('catalog: ' + (catalog.error ? 'error ' + catalog.error : catalog.total + ' interfaces, ' + catalog.hits.length + ' look like media'));
            np.start().then(() => log.info('subscribed: ' + JSON.stringify(np.status())), (e) => log.error('nowplaying start: ' + (e && e.stack || e)));

            /* ---------- idle off screen: a minute after the screen goes, nothing runs until it's back ---------- */
            // the app can't quit itself (an app that exits on its own gets its data wiped by the head unit), so it goes
            // quiet instead: subscriptions closed, timers skip, caches dropped, memory collected
            let idleTimer = null;
            const goIdle = guard('idle', () => {
                idleTimer = null;
                if (idle || (ui.isVisible && ui.isVisible('MAIN'))) return;
                idle = true;
                np.pause(); cur = null; clk = null;
                if (artwork.cache) artwork.cache.clear();
                if (lyrics.cache) lyrics.cache.clear();
                if (typeof global.gc === 'function') { try { global.gc(); } catch (e) { /* */ } }
                log.info('idle: off screen, subscriptions closed');
            });
            if (ui.onVisible) ui.onVisible(guard('visible', (name, v) => {
                if (name !== 'MAIN') return;
                if (!v) { if (!idleTimer && !idle) idleTimer = setTimeout(goIdle, IDLE_MS); return; }
                // back on screen (from Settings, another app): BMW may have put its bar back; in full screen, hide it again
                if (ownNow && ctx.display && ctx.display._hmiBar) { ctx.display.hmiBarHidden = null; try { ctx.display._hmiBar(); } catch (e) { /* older kit */ } }
                if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
                if (idle) {
                    idle = false;
                    np.start().then(() => log.info('awake: subscribed again'), (e) => log.error('nowplaying restart: ' + (e && e.message)));
                }
            }));
            if (ui.isVisible && !ui.isVisible('MAIN')) idleTimer = setTimeout(goIdle, IDLE_MS);
            log.info('started ' + VERSION);
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
