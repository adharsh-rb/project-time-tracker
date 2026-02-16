'use strict';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function shouldLog(level) { return LEVELS[level] >= LEVELS[LOG_LEVEL]; }
const logger = {
    debug: (...args) => shouldLog('debug') && console.log('[DEBUG]', new Date().toISOString(), ...args),
    info:  (...args) => shouldLog('info')  && console.log('[INFO]',  new Date().toISOString(), ...args),
    warn:  (...args) => shouldLog('warn')  && console.warn('[WARN]', new Date().toISOString(), ...args),
    error: (...args) => shouldLog('error') && console.error('[ERROR]', new Date().toISOString(), ...args),
};
module.exports = logger;