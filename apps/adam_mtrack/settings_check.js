'use strict';
/**
 * settings_check.js - saved settings checked against app.json (pure, Node 8, no kit).
 *
 *   clean(schema, values) -> { values, bad: [keys] }
 * A bool must be a boolean, a choice one of its option values, a number one of its steps. Anything else falls
 * back to the setting's default; a key that was saved with a bad value is listed in bad (a missing key just gets
 * its default). Keys the schema doesn't know (the kit's _themeV, _reset_*) are kept as they are.
 */
function valid(s, v) {
    if (s.type === 'bool') return typeof v === 'boolean';
    if (s.type === 'choice') return (s.options || []).some((o) => o[0] === v);
    if (s.type === 'number') return (s.steps || []).indexOf(v) >= 0;
    return v !== undefined;
}

function clean(schema, values) {
    const src = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    const out = Object.assign({}, src), bad = [];
    (schema || []).forEach((s) => {
        if (!s || typeof s.key !== 'string') return;
        if (valid(s, src[s.key])) return;
        if (Object.prototype.hasOwnProperty.call(src, s.key)) bad.push(s.key);
        out[s.key] = s.default;
    });
    return { values: out, bad };
}

module.exports = { clean, valid };
