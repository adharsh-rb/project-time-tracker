'use strict';

function getColumn(row, tableName, columnName, defaultValue) {
    if (defaultValue === undefined) defaultValue = null;
    if (!row) return defaultValue;
    if (row[tableName] && row[tableName][columnName] !== undefined) return row[tableName][columnName];
    if (row[columnName] !== undefined) return row[columnName];
    if (row[tableName]) {
        for (const key of Object.keys(row[tableName])) {
            if (key.toLowerCase() === columnName.toLowerCase()) return row[tableName][key];
        }
    }
    for (const key of Object.keys(row)) {
        if (typeof row[key] === 'object' && row[key] !== null) {
            for (const subKey of Object.keys(row[key])) {
                if (subKey.toLowerCase() === columnName.toLowerCase()) return row[key][subKey];
            }
        }
    }
    return defaultValue;
}

function getIntColumn(row, tableName, columnName, defaultValue) {
    if (defaultValue === undefined) defaultValue = 0;
    const val = getColumn(row, tableName, columnName, defaultValue);
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

module.exports = { getColumn, getIntColumn };