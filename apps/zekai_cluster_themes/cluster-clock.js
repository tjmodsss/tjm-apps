'use strict';

function pacificOffset(date) {
    const year = date.getUTCFullYear();
    const sunday = (month) => 1 + (7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7;
    const starts = Date.UTC(year, 2, sunday(2) + 7, 10);
    const ends = Date.UTC(year, 10, sunday(10), 9);
    return date >= starts && date < ends ? -7 : -8;
}

function clusterClock(settings, now = Date.now()) {
    const zone = settings.get('clockZone');
    const adjustment = Number(settings.get('clockCorrection')) || 0;
    const date = new Date(now + adjustment * 60000);
    let hour = date.getHours(), minute = date.getMinutes();
    if (zone !== 'vehicle') {
        const custom = Number(settings.get('clockOffset'));
        let offset = -7; // Vancouver uses UTC−7 year round from March 2026.
        if (zone === 'utc') offset = 0;
        if (zone === 'pacific') offset = pacificOffset(date);
        if (zone === 'custom' && Number.isFinite(custom)) offset = custom;
        const zoned = new Date(date.getTime() + offset * 3600000);
        hour = zoned.getUTCHours();
        minute = zoned.getUTCMinutes();
    }
    hour %= 24;
    const mm = String(minute).padStart(2, '0');
    if (settings.get('clockFormat') === '12') return (hour % 12 || 12) + ':' + mm + (hour < 12 ? ' AM' : ' PM');
    return String(hour).padStart(2, '0') + ':' + mm;
}

module.exports = { clusterClock };
