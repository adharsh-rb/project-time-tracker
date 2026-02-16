'use strict';

function sanitizeString(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\'")
        .replace(/"/g, '\"')
        .replace(/;/g, '')
        .replace(/--/g, '')
        .replace(/\/\*/g, '')
        .replace(/\*\//g, '');
}

function sanitizeId(value) {
    const num = String(value).replace(/[^0-9]/g, '');
    if (!num || num.length === 0) {
        const error = new Error('Invalid ID format.');
        error.statusCode = 400;
        throw error;
    }
    return num;
}

function toNumericId(value) {
    const num = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
    if (isNaN(num) || num <= 0) {
        const error = new Error('Invalid ID: must be a positive number.');
        error.statusCode = 400;
        throw error;
    }
    return num;
}

module.exports = { sanitizeString, sanitizeId, toNumericId };