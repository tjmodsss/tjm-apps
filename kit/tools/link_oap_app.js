#!/usr/bin/env node
'use strict';
/**
 * link_oap_app.js <appDir> <out.tgz> <donor>... - builds an app that has mgu-app.json instead of
 * app.json (apps/tjm_waze_cluster) into a flat OAP tgz, with Robert Nisipeanu's oap_link.js
 * (third_party/robertn-idrive-apps, GPL-3.0-or-later). A donor is the car's x_call package
 * (oap-sdk/donor/x_call.tgz) or its javascript/app.js, which the installer's "Extract SDK" keeps.
 * Called by kit/tools/build_oap_app.py.
 */
const path = require('path');
const link = require(path.join(__dirname, '..', '..', 'third_party', 'robertn-idrive-apps', 'tools', 'oap_link.js'));

const [appDir, out, ...donors] = process.argv.slice(2);
if (!appDir || !out || !donors.length) {
    console.error('usage: link_oap_app.js <appDir> <out.tgz> <donor>...');
    process.exit(2);
}
try {
    const r = link.build(path.resolve(appDir), path.resolve(out),
        { donors: donors.map((d) => path.resolve(d)), epoch: process.env.SOURCE_DATE_EPOCH });
    console.log(`linked ${r.id} ${r.version}: ${r.moduleCount} modules, sdk from ${r.donor}, entry ${r.entry || 'app.js'}`);
} catch (e) {
    console.error(`link: ${e.message}`);
    process.exit(1);
}
