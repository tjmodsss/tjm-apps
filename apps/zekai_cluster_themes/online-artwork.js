'use strict';

const https = require('https');
const url = require('url');
const uplink = require('./kit/uplink');
const { decodeArtwork } = require('./media-artwork');

const MAX_BODY = 850000;
const RETRY_MS = 60000;
const UA = 'ID7ClusterThemes/0.8.25 (https://github.com/ZEKAI-Design/ID7-Cluster-Themes)';

function request(target, network, lookupFor, ca, redirects = 0) {
    const destination = url.parse(target);
    const { hostname } = destination;
    if (destination.protocol !== 'https:' || destination.auth || destination.port || !hostname ||
        !/^(musicbrainz\.org|coverartarchive\.org|(?:[a-z0-9-]+\.)*archive\.org)$/i.test(hostname) ||
        redirects > 4) return Promise.resolve(null);
    return new Promise((resolve) => {
        const req = https.get({ hostname, path: destination.path, lookup: lookupFor(network), ca,
            headers: { 'User-Agent': UA }, timeout: 7000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(request(url.resolve(target, res.headers.location), network, lookupFor, ca, redirects + 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }
            let size = 0;
            const chunks = [];
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > MAX_BODY) req.destroy();
                else chunks.push(chunk);
            });
            res.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks, size)));
            res.on('error', () => resolve(null));
            res.on('aborted', () => resolve(null));
        });
        const timer = setTimeout(() => { req.destroy(); resolve(null); }, 9000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function norm(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s.,'’"“”！？!?]/g, '');
}

function quote(value) {
    return '"' + value.replace(/[\\"]/g, '\\$&') + '"';
}

async function findCover(track, get) {
    let artist = track.artist;
    let album = track.album;
    const combined = artist.split(' - ');
    if (!album && combined.length === 2) [artist, album] = combined;
    const term = (album ? 'releasegroup:' + quote(album) : 'recording:' + quote(track.title)) + ' AND artist:' + quote(artist);
    const entity = album ? 'release-group' : 'recording';
    const result = await get('https://musicbrainz.org/ws/2/' + entity + '/?fmt=json&limit=10&query=' + encodeURIComponent(term));
    if (!result) return null;
    const list = JSON.parse(result.toString('utf8'))[album ? 'release-groups' : 'recordings'];
    const hit = (list || []).find((entry) => norm(entry.title) === norm(album || track.title) &&
        (entry['artist-credit'] || []).some((credit) => norm(credit.name) === norm(artist) ||
            norm(credit.artist && credit.artist.name) === norm(artist)));
    if (!hit) return null;
    const groups = album ? [hit.id] : (hit.releases || []).map((release) => release['release-group'] && release['release-group'].id);
    const id = groups.find((id) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id));
    if (!id) return null;
    const image = await get('https://coverartarchive.org/release-group/' + id + '/front-250');
    return image ? decodeArtwork(image) : null;
}

class OnlineArtwork {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.lookupFor = dataDir ? uplink.resolver() : null;
        this.cover = null;
        this.revision = 0;
        this.nextRequest = 0;
        this.busy = false;
    }

    get(track, now) {
        if (!track.title || !track.artist || !this.lookupFor) return null;
        const key = JSON.stringify([track.title, track.artist, track.album]);
        if (this.cover && this.cover.key === key) {
            if (this.cover.artwork) return this.cover;
            if (now < this.cover.retryAt) return null;
        }
        if (this.busy || now < this.nextRequest) return null;
        const network = uplink.lease(this.dataDir);
        if (!network) {
            this.nextRequest = now + 5000;
            return null;
        }
        const cover = { key, retryAt: now + RETRY_MS, artwork: null };
        this.cover = cover;
        this.nextRequest = now + 1500; // MusicBrainz allows up to one request per second.
        this.busy = true;
        findCover(track, (target) => request(target, network, this.lookupFor, uplink.trustedCa(this.dataDir)))
            .then((artwork) => {
                if (!artwork) return;
                cover.artwork = artwork;
                cover.revision = ++this.revision;
            })
            .catch(() => {})
            .then(() => { this.busy = false; });
        return null;
    }
}

module.exports = { OnlineArtwork, findCover };
