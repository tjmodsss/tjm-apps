'use strict';
/**
 * uplink.js - the network as the Store's mgu-uplink gives it, for every app that goes online (G's Music's
 * and G's Dash's Spotify client, G's TV, the remote logs).
 *
 * mgu-uplink gives an app whose package.json says "mguInternet": true a route out and writes the lease
 * to <data>/uplink.json ({ interface, ip, dns: [...], ... }, present only while online; also
 * /run/mgu-uplink/lease.json). The unit's own resolver does not reach the internet, so host names are
 * resolved through the lease's DNS servers (as mgu-updater's fetch.js does); without a lease (a PC, the
 * emulator) the system resolver is used. Offline, connections fail with EHOSTUNREACH.
 *
 * Node 8: no ?., ?? or object spread.
 */
const dns = require('dns');
const fs = require('fs');
const path = require('path');

/** The uplink lease (mgu-uplink), or null while offline. */
function lease(dataDir) {
    const files = [path.join(dataDir, 'uplink.json'), '/run/mgu-uplink/lease.json'];
    for (let i = 0; i < files.length; i++) {
        try {
            const l = JSON.parse(fs.readFileSync(files[i], 'utf8'));
            if (l && l.ip) return l;
        } catch (e) { /* next */ }
    }
    return null;
}

/**
 * Optional ca.pem in the data folder: PEM roots to trust instead of Node's bundled ones (as
 * mgu-updater's ca_file). Only a regular file owned by root and not writable by group or others
 * counts: the app's own uid can write its data folder, so a file it (or anything running as it)
 * put there must not be able to replace the TLS roots. Anything else: null, Node's bundled roots.
 */
function trustedCa(dir) {
    const file = path.join(dir, 'ca.pem');
    try {
        const st = fs.lstatSync(file);
        if (!st.isFile() || st.uid !== 0 || (st.mode & 0o022)) return null;
        return fs.readFileSync(file, 'utf8');
    } catch (e) { return null; }
}

/**
 * One client's resolver: lookupFor(lease) is the `lookup` option of http(s).request through the
 * lease's DNS servers (one dns.Resolver, made again only when the servers change), or undefined when
 * there are none (the system resolver, e.g. a PC).
 */
function resolver() {
    let res = null, key = '';
    return function lookupFor(l) {
        const servers = l && Array.isArray(l.dns) ? l.dns.filter((s) => typeof s === 'string' && s) : [];
        if (!servers.length) return undefined;
        const k = servers.join(',');
        if (k !== key) { res = new dns.Resolver(); res.setServers(servers); key = k; }
        const r = res;
        return (hostname, options, cb) => {
            if (typeof options === 'function') cb = options;
            r.resolve4(hostname, (err, addrs) => {
                if (err || !addrs || !addrs.length) { cb(err || new Error('no address for ' + hostname)); return; }
                cb(null, addrs[0], 4);
            });
        };
    };
}

module.exports = { lease, trustedCa, resolver };
