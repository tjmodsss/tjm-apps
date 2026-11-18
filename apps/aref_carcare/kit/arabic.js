'use strict';
/**
 * arabic.js - Arabic text for the kit's glyph-by-glyph drawing: each letter in the form its neighbours call for
 * (isolated, final, initial, medial: Unicode's presentation forms, which the 'arabic' atlas holds), lam-alef
 * ligatures, and the line in visual order (right to left, Latin and digit runs kept left to right).
 *
 *   visual(s) -> s unchanged when it has no Arabic letters, else the string to draw left to right
 *   has(s)    -> whether s has Arabic letters
 *
 * A simple bidi: the line's base direction is right to left when its first strong letter is Arabic; runs of
 * Latin letters and digits stay in their order. Harakat (short-vowel marks) are dropped: the atlas draws no
 * combining marks. Node 8.
 */

const RE = /[؀-ۿﭐ-﷿ﹰ-﻿]/;

// letter -> [isolated, final, initial, medial] (0: that form doesn't exist: the letter doesn't join forward)
const F = {
    0x0621: [0xfe80, 0, 0, 0], 0x0622: [0xfe81, 0xfe82, 0, 0], 0x0623: [0xfe83, 0xfe84, 0, 0], 0x0624: [0xfe85, 0xfe86, 0, 0],
    0x0625: [0xfe87, 0xfe88, 0, 0], 0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], 0x0627: [0xfe8d, 0xfe8e, 0, 0],
    0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], 0x0629: [0xfe93, 0xfe94, 0, 0], 0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
    0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], 0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], 0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
    0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], 0x062f: [0xfea9, 0xfeaa, 0, 0], 0x0630: [0xfeab, 0xfeac, 0, 0],
    0x0631: [0xfead, 0xfeae, 0, 0], 0x0632: [0xfeaf, 0xfeb0, 0, 0], 0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
    0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], 0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], 0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
    0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], 0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], 0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
    0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], 0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], 0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
    0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], 0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], 0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
    0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], 0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], 0x0648: [0xfeed, 0xfeee, 0, 0],
    0x0649: [0xfeef, 0xfef0, 0, 0], 0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
    // Persian / Urdu letters songs use: peh, tcheh, jeh, keheh, gaf, farsi yeh
    0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59], 0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d], 0x0698: [0xfb8a, 0xfb8b, 0, 0],
    0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91], 0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95], 0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff],
};
// lam + alef forms: [isolated, final]
const LAM_ALEF = { 0x0622: [0xfef5, 0xfef6], 0x0623: [0xfef7, 0xfef8], 0x0625: [0xfef9, 0xfefa], 0x0627: [0xfefb, 0xfefc] };
const TATWEEL = 0x0640;
const MARK = (c) => (c >= 0x064b && c <= 0x065f) || c === 0x0670;

const has = (s) => RE.test(s);
const joinsBack = (c) => !!F[c] || c === TATWEEL;                 // takes a connection from the letter before
const joinsFwd = (c) => (F[c] && F[c][2] !== 0) || c === TATWEEL;  // connects to the letter after

/** Logical order in, shaped logical order out (presentation forms). */
function shape(s) {
    const cps = Array.from(s).map((ch) => ch.codePointAt(0)).filter((c) => !MARK(c));
    const out = [];
    for (let i = 0; i < cps.length; i++) {
        const c = cps[i];
        if (!F[c]) { out.push(c); continue; }
        const prev = i > 0 ? cps[i - 1] : 0, next = i + 1 < cps.length ? cps[i + 1] : 0;
        const back = joinsFwd(prev) && joinsBack(c);
        if (c === 0x0644 && LAM_ALEF[next]) { out.push(LAM_ALEF[next][back ? 1 : 0]); i++; continue; }
        const fwd = joinsFwd(c) && joinsBack(next);
        const f = F[c];
        out.push(back && fwd ? f[3] : back ? f[1] : fwd ? f[2] : f[0]);
    }
    return out;
}

const isAr = (c) => (c >= 0x0600 && c <= 0x06ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);
const isLtr = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f) ||
    (c >= 0x660 && c <= 0x669);
const MIRROR = { 0x28: 0x29, 0x29: 0x28, 0x5b: 0x5d, 0x5d: 0x5b, 0x7b: 0x7d, 0x7d: 0x7b, 0x3c: 0x3e, 0x3e: 0x3c };

/** The string to draw left to right. */
function visual(s) {
    s = String(s);
    if (!has(s)) return s;
    const cps = shape(s);
    const first = cps.find((c) => isAr(c) || isLtr(c));
    const rtl = first === undefined || isAr(first);
    // runs: strong LTR (letters, digits, and the spaces / punctuation between them) vs the rest
    const runs = [];
    for (let i = 0; i < cps.length;) {
        if (isLtr(cps[i])) {
            let j = i + 1;
            while (j < cps.length && !isAr(cps[j])) j++;
            while (j > i + 1 && !isLtr(cps[j - 1])) j--;    // trailing spaces / punctuation belong to the RTL side
            runs.push({ ltr: true, c: cps.slice(i, j) }); i = j;
        } else {
            let j = i + 1;
            while (j < cps.length && !isLtr(cps[j])) j++;
            runs.push({ ltr: false, c: cps.slice(i, j) }); i = j;
        }
    }
    const pieces = runs.map((r) => (r.ltr ? r.c : r.c.slice().reverse().map((c) => MIRROR[c] || c)));
    if (rtl) pieces.reverse();
    return String.fromCodePoint.apply(null, [].concat.apply([], pieces));
}

module.exports = { visual, has, shape };
