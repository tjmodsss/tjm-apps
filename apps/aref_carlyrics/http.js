'use strict';
/**
 * http.js - one HTTPS request through the Store's internet uplink (mgu-uplink).
 *
 * The head unit's own resolver can't reach the internet, so host names go through the uplink
 * lease's DNS servers (kit/runtime/uplink.js), the same way G's Music and G's TV do it.
 *
 *   const http = require('./http').client(dataDir);
 *   const r = await http.request('GET', 'lrclib.net', '/api/get?...', { 'User-Agent': '...' });
 *   // r = { status, headers, body (Buffer) }
 *
 * Node 8: no ?., ?? or object spread.
 */
const https = require('https');
const uplink = require('./kit/uplink');

const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;

function client(dataDir) {
    const lookupFor = uplink.resolver();
    return {
        online() { return !!uplink.lease(dataDir); },
        request(method, host, pathname, headers, body) {
            return new Promise((resolve, reject) => {
                const opts = { method: method, host: host, port: 443, path: pathname, headers: headers || {}, timeout: TIMEOUT_MS };
                const lookup = lookupFor(uplink.lease(dataDir));
                if (lookup) opts.lookup = lookup;
                const ca = uplink.trustedCa(dataDir);
                if (ca) opts.ca = ca;
                if (body != null) opts.headers['Content-Length'] = Buffer.byteLength(body);
                const req = https.request(opts, (res) => {
                    const chunks = [];
                    let n = 0;
                    res.on('data', (c) => {
                        n += c.length;
                        if (n > MAX_BODY) { req.abort(); reject(new Error('response too large')); return; }
                        chunks.push(c);
                    });
                    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
                    res.on('error', reject);
                });
                req.on('timeout', () => { req.abort(); reject(new Error('timed out')); });
                req.on('error', reject);
                if (body != null) req.write(body);
                req.end();
            });
        },
    };
}

module.exports = { client };
