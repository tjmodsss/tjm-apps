'use strict';
/**
 * diaglog.js - M Track's compact diagnostic log: what it sent to cluster-render and what came back (renderer.js tap),
 * the test ladder's steps and every release check, in <data dir>/mtrack-diag.log, one line each with its UTC time
 * (newlines folded to " | "). Past maxKb the file becomes mtrack-diag.log.1. Never throws: a data folder that cannot
 * be written only loses the diagnostics. Node 8.
 *
 *   const diag = createDiag(dataDir, 256); diag('text'); diag.file
 */
const fs = require('fs');
const path = require('path');

function createDiag(dir, maxKb) {
    const file = path.join(dir || '.', 'mtrack-diag.log'), max = (maxKb || 256) * 1024;
    let size = -1;
    function diag(text) {
        try {
            if (size < 0) { try { size = fs.statSync(file).size; } catch (e) { size = 0; } }
            const s = new Date().toISOString() + ' ' + String(text).replace(/\s*\n\s*/g, ' | ') + '\n';
            if (size + s.length > max) { try { fs.renameSync(file, file + '.1'); } catch (e) { /* first rotation */ } size = 0; }
            fs.appendFileSync(file, s);
            size += s.length;
        } catch (e) { /* best effort */ }
    }
    diag.file = file;
    return diag;
}

module.exports = { createDiag };
