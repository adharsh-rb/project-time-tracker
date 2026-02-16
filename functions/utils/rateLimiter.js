'use strict';
const requestCounts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

function rateLimit(userId) {
    const now = Date.now();
    const key = String(userId);
    if (!requestCounts.has(key)) { requestCounts.set(key, { count: 1, windowStart: now }); return; }
    const record = requestCounts.get(key);
    if (now - record.windowStart > WINDOW_MS) { requestCounts.set(key, { count: 1, windowStart: now }); return; }
    record.count++;
    if (record.count > MAX_REQUESTS) {
        const error = new Error('Too many requests. Please slow down.');
        error.statusCode = 429;
        throw error;
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requestCounts.entries()) {
        if (now - record.windowStart > WINDOW_MS * 2) requestCounts.delete(key);
    }
}, 5 * 60 * 1000);

module.exports = { rateLimit };