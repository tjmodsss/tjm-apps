'use strict';
/**
 * autopilot.js - Canyon Glide: a simple pilot that flies the cave by itself.
 * The tests use it to show the caves can be flown. It looks ahead at a few distances, finds the
 * open stretches of air there and steers for the middle of the one nearest its course (sticking
 * with the side it picked, so it doesn't dither in front of a spire).
 */
const { clamp } = require('./cave');
const { GX } = require('./game');

/** stretches of y free of rock at every x from x0 to x1 */
function openings(game, x0, x1) {
    const s = game.cave.at(x1), out = [];
    let run = null;
    const isFree = (y) => { for (let x = x0; x <= x1; x += 25) if (game.hits(x, y)) return false; return !game.hits(x1, y); };
    for (let y = s.ceil; y <= s.floor; y += 4) {
        const free = isFree(y);
        if (free) { if (!run) run = { a: y, b: y }; else run.b = y; }
        if ((!free || y + 4 > s.floor) && run) { out.push(run); run = null; }
    }
    return out;
}

/** pitch -1..1 (+ = climb) to fly game (a Round) with */
function pilot(game) {
    const wx = game.dist + GX + 110 * game.speed() / 300;
    const ops = openings(game, game.dist + GX + 30, wx);
    const prev = game.pilotAim == null ? game.y : game.pilotAim;
    let best = null;
    for (const o of ops) {
        const mid = (o.a + o.b) / 2;
        // nearest to where it is, wide ones preferred, and the one it chose last time preferred
        const d = Math.abs(mid - game.y) - (o.b - o.a) * 0.25 + (o.a <= prev && prev <= o.b ? -40 : 0);
        if (!best || d < best.d) best = { mid: mid, d: d };
    }
    const s = game.cave.at(wx);
    const target = best ? best.mid : (s.ceil + s.floor) / 2;
    game.pilotAim = target;
    // up is smaller y; damp with the vertical speed
    return clamp((game.y - target) / 45 - game.vy / 600, -1, 1);
}

module.exports = { pilot };
