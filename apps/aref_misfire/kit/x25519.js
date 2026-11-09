'use strict';
/**
 * x25519.js - X25519 (RFC 7748) scalar multiplication in plain JavaScript for Node 8, which has no
 * X25519 in its crypto module. The field arithmetic is TweetNaCl's (public domain, by Daniel J.
 * Bernstein, Bernard van Gastel, Wesley Janssen, Tanja Lange, Peter Schwabe, Sjaak Smetsers;
 * JavaScript port by Dmitry Chestnykh and Devi Mandiri).
 *
 *   scalarMult(n32, p32) -> Buffer(32)    publicKey(sk32) -> Buffer(32)
 */
function gf(init) { const r = new Float64Array(16); if (init) for (let i = 0; i < init.length; i++) r[i] = init[i]; return r; }
const _121665 = gf([0xdb41, 1]);

function car25519(o) {
    let c = 1;
    for (let i = 0; i < 16; i++) { const v = o[i] + c + 65535; c = Math.floor(v / 65536); o[i] = v - c * 65536; }
    o[0] += c - 1 + 37 * (c - 1);
}
function sel25519(p, q, b) {
    const c = ~(b - 1);
    for (let i = 0; i < 16; i++) { const t = c & (p[i] ^ q[i]); p[i] ^= t; q[i] ^= t; }
}
function pack25519(o, n) {
    const m = gf(), t = gf();
    for (let i = 0; i < 16; i++) t[i] = n[i];
    car25519(t); car25519(t); car25519(t);
    for (let j = 0; j < 2; j++) {
        m[0] = t[0] - 0xffed;
        for (let i = 1; i < 15; i++) { m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1); m[i - 1] &= 0xffff; }
        m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
        const b = (m[15] >> 16) & 1;
        m[14] &= 0xffff;
        sel25519(t, m, 1 - b);
    }
    for (let i = 0; i < 16; i++) { o[2 * i] = t[i] & 0xff; o[2 * i + 1] = t[i] >> 8; }
}
function unpack25519(o, n) {
    for (let i = 0; i < 16; i++) o[i] = n[2 * i] + (n[2 * i + 1] << 8);
    o[15] &= 0x7fff;
}
function A(o, a, b) { for (let i = 0; i < 16; i++) o[i] = a[i] + b[i]; }
function Z(o, a, b) { for (let i = 0; i < 16; i++) o[i] = a[i] - b[i]; }
function M(o, a, b) {
    const t = new Float64Array(31);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) t[i + j] += a[i] * b[j];
    for (let i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
    for (let i = 0; i < 16; i++) o[i] = t[i];
    car25519(o); car25519(o);
}
function S(o, a) { M(o, a, a); }
function inv25519(o, i) {
    const c = gf();
    for (let a = 0; a < 16; a++) c[a] = i[a];
    for (let a = 253; a >= 0; a--) { S(c, c); if (a !== 2 && a !== 4) M(c, c, i); }
    for (let a = 0; a < 16; a++) o[a] = c[a];
}

function scalarMult(n, p) {
    const z = new Uint8Array(32), x = new Float64Array(80);
    const a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf();
    for (let i = 0; i < 31; i++) z[i] = n[i];
    z[31] = (n[31] & 127) | 64;
    z[0] &= 248;
    unpack25519(x, p);
    for (let i = 0; i < 16; i++) { b[i] = x[i]; d[i] = a[i] = c[i] = 0; }
    a[0] = d[0] = 1;
    for (let i = 254; i >= 0; --i) {
        const r = (z[i >>> 3] >>> (i & 7)) & 1;
        sel25519(a, b, r); sel25519(c, d, r);
        A(e, a, c); Z(a, a, c); A(c, b, d); Z(b, b, d);
        S(d, e); S(f, a); M(a, c, a); M(c, b, e);
        A(e, a, c); Z(a, a, c); S(b, a); Z(c, d, f);
        M(a, c, _121665); A(a, a, d); M(c, c, a); M(a, d, f); M(d, b, x); S(b, e);
        sel25519(a, b, r); sel25519(c, d, r);
    }
    for (let i = 0; i < 16; i++) { x[i + 16] = a[i]; x[i + 32] = c[i]; x[i + 48] = b[i]; x[i + 64] = d[i]; }
    const x32 = x.subarray(32), x16 = x.subarray(16);
    inv25519(x32, x32);
    M(x16, x16, x32);
    const q = new Uint8Array(32);
    pack25519(q, x16);
    return Buffer.from(q);
}
const BASE = new Uint8Array(32); BASE[0] = 9;
function publicKey(sk) { return scalarMult(sk, BASE); }

module.exports = { scalarMult, publicKey };
