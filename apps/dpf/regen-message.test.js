'use strict';
// Validate the state machine without connecting to the vehicle or rendering a cluster frame.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const source = fs.readFileSync(__dirname + '/regen-message.js', 'utf8');
const moduleMock = { exports: {} };
vm.runInNewContext(source, {
    module: moduleMock,
    exports: moduleMock.exports,
    require: id => {
        if (id === './kit/cluster-icon') return {};
        if (id === './kit/canvas') return {Canvas: class {}};
        if (id === './kit/i18n') return {t: x => x};
        throw new Error(id);
    },
    Buffer
}, {filename:'regen-message.js'});
const {createIndicator,testMessage} = moduleMock.exports;
const indicator = createIndicator();
const message = (state, ms) => indicator(state, ms);
assert.strictEqual(message('idle',0),null);
assert.strictEqual(message('requested',100).text,'Requested');
assert.strictEqual(message('requested',700).text,'');
assert.strictEqual(message('requested',3200),null);
assert.strictEqual(message('active',4000).text,'Started');
assert.strictEqual(message('active',4600).text,'');
assert.strictEqual(message('active',7000).text,'In Progress');
assert.strictEqual(message('active',7600).text,'');
assert.strictEqual(message('active',10000),null);
assert.strictEqual(message('active',67000).text,'In Progress');
assert.strictEqual(message('idle',67500).text,'Finished');
assert.strictEqual(message('idle',68200).text,'');
assert.strictEqual(message('idle',71000),null);
assert.strictEqual(message('active',80000).text,'Started');
// Manual test mode: Requested -> Started -> In Progress -> Finished.
for(const [ms,name] of [[0,'Requested'],[3000,'Started'],[6000,'In Progress'],[9000,'Finished']])
    assert.strictEqual(testMessage(ms).text,name);
assert.strictEqual(testMessage(12000),null);
console.log('DPF regeneration cluster: all four messages and transitions passed.');
