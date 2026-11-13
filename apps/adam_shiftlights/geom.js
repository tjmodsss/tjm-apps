'use strict';
/**
 * geom.js - where every style is drawn: pure geometry, no I/O, Node 8 syntax.
 * Ported from docs/mockups/shiftlights-v4-oem.html (slatPoly, rowGap, barHull, stockBlocks) and
 * docs/mockups/hud-m-style.html (barGeom, PATH, at, strip). All points are in their target's pixels.
 *
 *   slatBar(st, scale, target)   a slat bar (config clusterStyles.* / hudStyles.bar) at size `scale`:
 *                                { rect, bar, polys: [{ i, pts }], hull, local: { cx, yb }, dims, style, fits }
 *   bracket(hud, T, k)           the HUD tach bracket: path, arc length, offsets, gear, gear box, rect (T: hudLayout's place)
 *   hudLayout(cfg, hudSel, warn) the HUD style's bar and bracket, centred on cfg.hud.centerX, sized and moved
 *   layersFor(cfg, display, sel, warn)   the layers a display mode and the two style selections want
 */
const TARGETS = { panel: [1920, 720], map: [1088, 480], hud: [800, 480] };   // idrive-apps PROTOCOL.md, iDrive 7
const ARC_PTS = 6;          // points inside the bracket's rounded knee (the path has 10 points: FS_BRACKET's u_path)
const PAD = 6;              // px round the bracket's art in its layer rect
const HUD_CX = 400;         // config hudStyles are drawn centred on this x (the scene's centre)

const inside = (r, t) => !!TARGETS[t] && r.x >= 0 && r.y >= 0 && r.x + r.w <= TARGETS[t][0] && r.y + r.h <= TARGETS[t][1];

/** A rect of the box x0..x1, y0..y1 grown by pad, whole pixels, cut to the target. */
function rectOf(x0, y0, x1, y1, pad, target) {
    const T = TARGETS[target];
    const x = Math.max(0, Math.floor(x0 - pad)), y = Math.max(0, Math.floor(y0 - pad));
    return { target, x, y, w: Math.min(T[0], Math.ceil(x1 + pad)) - x, h: Math.min(T[1], Math.ceil(y1 + pad)) - y };
}

/**
 * A slat bar. scale multiplies every length about the bar's centre (cx, cy). Slat kk counts from the axis
 * (0 = innermost); its lighting index is kk outward, perSide-1-kk inward; a centre slat has index perSide.
 * fits: the bar itself (glow aside) lies inside the target.
 */
function slatBar(st, scale, target) {
    const k = scale || 1, n = st.perSide;
    const slat = st.slat * k, pitch = st.pitch * k, inner = st.inner * k, centre = (st.centre || 0) * k, h = st.h * k;
    const sh = st.lean === 'none' ? 0 : st.shear * k, same = st.lean === 'same';
    const cx = st.cx, yt = st.cy - h / 2, yb = st.cy + h / 2;
    const half = inner + (n - 1) * pitch + slat;              // axis to the outer edge at the base
    const bar = { x0: cx - half, y0: yt, x1: cx + half + (same ? sh : 0), y1: yb };
    const rect = rectOf(bar.x0, bar.y0, bar.x1, bar.y1, st.glow || 0, target);
    const polys = [];
    for (let kk = 0; kk < n; kk++) {
        const din = inner + kk * pitch, dout = din + slat, i = st.stage ? 0 : st.fill === 'outward' ? kk : n - 1 - kk;
        [-1, 1].forEach((side) => {
            if (same) {         // '/' on both sides: the top edge sits sh to the right
                const a = Math.min(cx + side * din, cx + side * dout), b = Math.max(cx + side * din, cx + side * dout);
                polys.push({ i, pts: [[a, yb], [b, yb], [b + sh, yt], [a + sh, yt]] });
            } else {            // mirrored: the top edge moves toward the axis ('/' left, '\' right)
                polys.push({ i, pts: [[cx + side * dout, yb], [cx + side * din, yb], [cx + side * (din - sh), yt], [cx + side * (dout - sh), yt]] });
            }
        });
    }
    if (centre > 0) polys.push({ i: n, pts: [[cx - centre, yb], [cx + centre, yb], [cx + centre + sh, yt], [cx - centre + sh, yt]] });
    const hull = same ? [[cx - half, yb], [cx + half, yb], [cx + half + sh, yt], [cx - half + sh, yt]]
        : [[cx - half, yb], [cx + half, yb], [cx + half - sh, yt], [cx - half + sh, yt]];
    return {
        rect, bar, polys, hull, style: st,
        local: { cx: cx - rect.x, yb: yb - rect.y },
        dims: { slat, pitch, inner, centre, h, shear: sh, perSide: n, half },
        fits: bar.x0 >= 0 && bar.y0 >= 0 && bar.x1 <= TARGETS[target][0] && bar.y1 <= TARGETS[target][1],
    };
}

/** The same layer on the map target (when both displays show): the rect moved by off, y at least off.minY. */
function toMap(rect, off) {
    return { target: 'map', x: rect.x - off.x, y: Math.max(off.minY, rect.y - off.y), w: rect.w, h: rect.h };
}

/** The bracket's path in u: tip, the knee rounded by a quadratic through ARC_PTS points, end (10 points). */
function pathU(B) {
    const a = B.path[0], k = B.path[1], e = B.path[2], r = B.round;
    const d1 = Math.hypot(k[0] - a[0], k[1] - a[1]), d2 = Math.hypot(e[0] - k[0], e[1] - k[1]);
    const p1 = [k[0] - (k[0] - a[0]) / d1 * r, k[1] - (k[1] - a[1]) / d1 * r], p2 = [k[0] + (e[0] - k[0]) / d2 * r, k[1] + (e[1] - k[1]) / d2 * r];
    const pts = [a, p1];
    for (let i = 1; i <= ARC_PTS; i++) {
        const t = i / (ARC_PTS + 1), q = 1 - t;
        pts.push([q * q * p1[0] + 2 * q * t * k[0] + t * t * p2[0], q * q * p1[1] + 2 * q * t * k[1] + t * t * p2[1]]);
    }
    return pts.concat([p2, e]);
}

/**
 * The HUD tach bracket (scene px), the same place for every HUD style: the path centred on x 400, its top at
 * B.top, then through T (hudLayout's centre, size and move; none: as designed) with lengths x k.
 */
function bracket(hud, T, k) {
    const B = hud.bracket, k1 = k || 1, place = T || ((p) => p), S = B.scale * k1;
    const px = B.path.map((p) => p[0]), x0 = Math.min.apply(null, px), w = (Math.max.apply(null, px) - x0) * B.scale;
    const ox = HUD_CX - w / 2 - x0 * B.scale, oy = B.top;
    const pts = pathU(B).map((p) => place([ox + p[0] * B.scale, oy + p[1] * B.scale]));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const sOf = (rpm) => Math.min(1, Math.max(0, rpm / B.scaleMax)) * L;
    /** The point s px along the path, with the unit normal toward the bar (below the rail). */
    const at = (s) => {
        const d = Math.min(L, Math.max(0, s));
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const a = pts[i - 1], b = pts[i], f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return { x: a[0] + dx * f, y: a[1] + dy * f, nx: -dy / l, ny: dx / l };
    };
    const rail = B.rail * S, o0 = (B.rail + B.gapRail) * S, o1 = o0 + B.bar * S;
    const pad = hud.cells.pad * S, numH = B.numH * S, numWd = B.numH / 1.6 * 1.15 * S, numSw = 2.6 * S;
    const nums = [];
    for (let k = 0; k <= B.scaleMax / 1000; k++) {
        const p = at(sOf(k * 1000)), off = (B.numOff + (k === 0 ? 4 : 0)) * S;
        nums.push({ k, x: p.x + p.nx * off + (k === 0 ? 6 : 4) * S, y: p.y + p.ny * off });
    }
    const gc = place([B.gear.x, B.gear.y]), G = { x: gc[0], y: gc[1], h: B.gear.h * k1 }, gu = G.h / 1.6, gwd = gu * 1.3, gsw = G.h * 0.23;
    const gearBox = { x: Math.floor(G.x - gwd / 2 - gsw - 2), y: Math.floor(G.y - G.h / 2 - gsw - 2) };
    gearBox.w = Math.ceil(G.x + gwd / 2 + gsw + 2) - gearBox.x;
    gearBox.h = Math.ceil(G.y + G.h / 2 + gsw + 2) - gearBox.y;
    // bounds of everything drawn: rail to the cells' outer edge, tick ends, numerals, gear
    const xs = [], ys = [];
    const add = (x, y) => { xs.push(x); ys.push(y); };
    pts.forEach((p, i) => {
        const q = at(cum[i]);
        add(p[0] - q.nx, p[1] - q.ny);
        add(p[0] + q.nx * (o1 + pad + 1), p[1] + q.ny * (o1 + pad + 1));
    });
    nums.forEach((m) => { add(m.x - numWd / 2 - numSw, m.y - numH / 2 - numSw); add(m.x + numWd / 2 + numSw, m.y + numH / 2 + numSw); });
    add(gearBox.x, gearBox.y); add(gearBox.x + gearBox.w, gearBox.y + gearBox.h);
    const rect = rectOf(Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys), PAD, 'hud');
    return {
        B, S, origin: place([ox, oy]), pts, cum, L, sOf, at, rail, o0, o1, cells: [o0 - pad, o1 + pad], nums,
        numH, numWd, numSw, gear: G, gearBox, rect,
        fits: xs.every((x) => x >= 0 && x <= TARGETS.hud[0]) && ys.every((y) => y >= 0 && y <= TARGETS.hud[1]),
    };
}

/**
 * The shift that puts [a0, a1] (one axis) inside [lo + m, hi - m], as close to `want` as it can. Wider than the room:
 * centred in [lo, hi].
 */
function pull(a0, a1, lo, hi, m, want) {
    const min = lo + m - a0, max = hi - m - a1;
    if (min > max) return (lo + hi) / 2 - (a0 + a1) / 2;      // does not fit: centred (the margin cannot be kept)
    return Math.min(max, Math.max(min, want));
}

/**
 * The HUD style's art (hudSel = logic.readStyle(..., 'hud')): { k, size, x, y, bar, bracket, barShift, fits }. Every point
 * of the design goes through T(x, y) = [C + (x - 400) k, A + y' + (y - A) k], C = hud.centerX + the move
 * x, A = hud.anchorY, y' = the move y, k = size / 100: centred on the stock speed, the bottom fixed while the size
 * grows upward. bar: the slat bar (large, bar; classic: at cfg.hudStyles.smallBar of its size, on the Large bar's base
 * line and middle), bracket: the tach bracket and gear (large, classic, bracket).
 * The bar alone also moves by hudSel.barX (px, right; default 0; Large and Bar only, the Small bar stays centred) and is then
 * held inside the visible box (cfg.hud.visible.x0 / x1, less cfg.hud.barMargin; left and right only: up / down is the HUD
 * move's job, and a bar pulled down would sit on the bracket): barShift = { x (px actually moved), asked, clamped }.
 * Art off the scene falls back to size 100, then to no move, each with one warn(text).
 */
function hudLayout(cfg, hudSel, warn) {
    const say = typeof warn === 'function' ? warn : () => {}, hs = hudSel.style, st = cfg.hudStyles.bar, H = cfg.hud;
    const V = H.visible || { x0: 0, y0: 0, x1: TARGETS.hud[0], y1: TARGETS.hud[1] }, m = H.barMargin || 0;
    const small = hs === 'classic', s = small ? cfg.hudStyles.smallBar : 1, barX = small ? 0 : hudSel.barX || 0;
    const at = (size, x, y) => {
        const k = size / 100, C = H.centerX + x, A = H.anchorY;
        const T = (p) => [C + (p[0] - HUD_CX) * k, A + y + (p[1] - A) * k];
        const c = T([st.cx, st.cy]);
        let bar = null, barShift = { x: 0, asked: barX, clamped: false };
        if (hs === 'large' || hs === 'bar' || small) {
            const mk = (kk, dx, dy) => slatBar(Object.assign({}, st, { cx: c[0] + dx, cy: c[1] + dy }), kk, 'hud');
            const big = mk(k, 0, 0).bar, b0 = mk(k * s, 0, 0).bar;
            const ox = (big.x0 + big.x1 - b0.x0 - b0.x1) / 2, oy = big.y1 - b0.y1;      // Small: the Large bar's middle and base
            const dx = pull(b0.x0 + ox, b0.x1 + ox, V.x0, V.x1, m, barX);
            bar = mk(k * s, ox + dx, oy);
            barShift = { x: dx, asked: barX, clamped: Math.abs(dx - barX) > 0.01 };
        }
        const br = hs === 'large' || hs === 'classic' || hs === 'bracket' ? bracket(cfg.hudStyles, T, k) : null;
        return { k, size, x, y, bar, bracket: br, barShift, fits: (!bar || bar.fits) && (!br || br.fits) };
    };
    const x = hudSel.x || 0, y = hudSel.y || 0;
    let l = at(hudSel.size || 100, x, y);
    if (!l.fits && l.size !== 100) { say('hud size ' + l.size + ' % does not fit the hud: using 100 %'); l = at(100, x, y); }
    if (!l.fits && (x || y)) { say('hud move ' + x + ', ' + y + ' px does not fit the hud: using the centre'); l = at(100, 0, 0); }
    return l;
}

/**
 * The layer specs for a display mode ('off' | 'cluster' | 'hud' | 'both', logic.readDisplays) and the two
 * style selections (logic.readStyle results):
 * [{ key, which, role: 'slats' | 'bracketImg' | 'bracketFill', target, rect, z, geom, style }]. Every effect layer flashes
 * with its display's state (the bracket fill too, in every style: 0.4.2).
 * 'both' puts the cluster on the map target (panel and hud share one scene: never up at once). The cluster bar is
 * moved by sel.cluster.x, y; a size, then a move, that does not fit its target falls back (100 %, then the default
 * place) with a warn(text); the HUD: hudLayout.
 */
function layersFor(cfg, display, sel, warn) {
    const out = [], say = typeof warn === 'function' ? warn : () => {};
    const showCl = display === 'cluster' || display === 'both', showHud = display === 'hud' || display === 'both';
    const sized = (which, st, size, target, map, x, y) => {
        const fit = (g) => g.fits && (!map || inside(toMap(g.rect, map), 'map'));
        const at = (k, dx, dy) => slatBar(dx || dy ? Object.assign({}, st, { cx: st.cx + dx, cy: st.cy + dy }) : st, k, target);
        const where = map ? 'map' : target;
        let g = at(size / 100, x, y);
        if (!fit(g) && size !== 100) { say(which + ' size ' + size + ' % does not fit the ' + where + ': using 100 %'); g = at(1, x, y); }
        if (!fit(g) && (x || y)) { say(which + ' move ' + x + ', ' + y + ' px does not fit the ' + where + ': using the default place'); g = at(1, 0, 0); }
        if (map) g.rect = toMap(g.rect, map);
        return g;
    };
    if (showCl && cfg.clusterStyles[sel.cluster.style]) {
        const map = display === 'both' ? cfg.mapOffset : null;
        const g = sized('cluster', cfg.clusterStyles[sel.cluster.style], sel.cluster.size, 'panel', map, sel.cluster.x || 0, sel.cluster.y || 0);
        out.push({ key: 'cluster:slats', which: 'cluster', role: 'slats', target: g.rect.target, rect: g.rect, z: 0, geom: g, style: sel.cluster.style });
    }
    if (showHud) {
        const hs = sel.hud.style, hl = hudLayout(cfg, sel.hud, say);
        if (hl.bar) out.push({ key: 'hud:slats', which: 'hud', role: 'slats', target: 'hud', rect: hl.bar.rect, z: 2, geom: hl.bar, style: hs });
        if (hl.bracket) {
            const b = hl.bracket;
            out.push({ key: 'hud:bracketImg', which: 'hud', role: 'bracketImg', target: 'hud', rect: b.rect, z: 0, geom: b, style: hs });
            out.push({ key: 'hud:bracketFill', which: 'hud', role: 'bracketFill', target: 'hud', rect: b.rect, z: 1, geom: b, style: hs });
        }
    }
    return out;
}

module.exports = { TARGETS, HUD_CX, slatBar, toMap, bracket, hudLayout, layersFor, inside, pull };
