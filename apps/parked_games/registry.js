'use strict';
/**
 * registry.js - finds the games (games/<id>/index.js) and keeps their scores and saved values.
 *
 *   const games = load(dir, log)        -> [game modules, checked, sorted by order]
 *   const sc = new Scores(file)         -> sc.add(game, score), sc.top(id), sc.best(id)
 *   const st = new Store(file)          -> st.forGame(id) = { get(key), set(key, value) }
 */
const fs = require('fs');
const path = require('path');

const TOP_N = 5;

/** Problems with a game module (GAMES.md), [] when it is fine. */
function check(m, folder) {
    const bad = [];
    if (!m || typeof m !== 'object') return ['exports no object'];
    if (typeof m.id !== 'string' || !/^[a-z0-9-]+$/.test(m.id)) bad.push('id must be lower-case letters, digits and dashes');
    else if (folder && m.id !== folder) bad.push('id "' + m.id + '" is not its folder name "' + folder + '"');
    if (typeof m.title !== 'string' || !m.title) bad.push('no title');
    if (typeof m.create !== 'function') bad.push('no create(api)');
    // every game is played with the knob (and touch): there are no other inputs to need
    if (m.needs !== undefined && (!Array.isArray(m.needs) || m.needs.length)) bad.push('needs: must be [] (knob and touch only)');
    if (m.score !== undefined && (typeof m.score !== 'object' || m.score === null)) bad.push('score must be { unit, lower }');
    return bad;
}

function load(dir, log) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'index.js'))); } catch (e) { log && log.warn('no games folder: ' + dir); }
    const out = [];
    names.forEach((n) => {
        try {
            const m = require(path.join(dir, n, 'index.js'));
            const bad = check(m, n);
            if (bad.length) { log && log.error('game ' + n + ' left out: ' + bad.join('; ')); return; }
            out.push(Object.assign({ blurb: '', order: 100, needs: [], score: {} }, m));
        } catch (e) { log && log.error('game ' + n + ' failed to load', e); }
    });
    out.sort((a, b) => (a.order - b.order) || (a.title < b.title ? -1 : 1));
    return out;
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; } }
function writeJson(file, v) { try { fs.writeFileSync(file, JSON.stringify(v)); return true; } catch (e) { return false; } }

class Scores {
    constructor(file) { this.file = file; this.all = readJson(file); }
    top(id) { return (this.all[id] || []).slice(); }
    best(id) { const t = this.all[id]; return t && t.length ? t[0].score : null; }
    /** Adds a score; returns its place (1 = new best) or 0 when it didn't make the list. */
    add(game, score, at) {
        if (typeof score !== 'number' || !isFinite(score)) return 0;
        const lower = !!(game.score && game.score.lower);
        const list = (this.all[game.id] || []).slice();
        const e = { score, at: at || Date.now() };
        list.push(e);
        list.sort((a, b) => (lower ? a.score - b.score : b.score - a.score) || (a.at - b.at));
        const kept = list.slice(0, TOP_N);
        this.all[game.id] = kept;
        writeJson(this.file, this.all);
        return kept.indexOf(e) + 1;
    }
}

class Store {
    constructor(file) { this.file = file; this.all = readJson(file); }
    forGame(id) {
        return {
            get: (k) => { const g = this.all[id]; return g ? g[k] : undefined; },
            set: (k, v) => { (this.all[id] = this.all[id] || {})[k] = v; writeJson(this.file, this.all); },
        };
    }
}

module.exports = { load, check, Scores, Store, TOP_N };
