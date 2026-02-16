'use strict';
const { sanitizeId, sanitizeString } = require('./sanitize');

const ENUMS = Object.freeze({
    PROJECT_STATUS: Object.freeze(['Active', 'OnHold', 'Completed', 'Archived']),
    MEMBER_ROLE: Object.freeze(['Owner', 'Manager', 'Member', 'Viewer']),
    TASK_STATUS: Object.freeze(['Todo', 'InProgress', 'InReview', 'Done']),
    TASK_PRIORITY: Object.freeze(['Low', 'Medium', 'High', 'Critical']),
});

function validateEnum(value, allowedValues, fieldName) {
    if (!allowedValues.includes(value)) { const e = new Error('Invalid ' + fieldName + ': ' + value + '. Allowed: ' + allowedValues.join(', ')); e.statusCode = 400; throw e; }
}

function validateLength(value, maxLength, fieldName) {
    if (value && String(value).length > maxLength) { const e = new Error(fieldName + ' must be ' + maxLength + ' chars or less.'); e.statusCode = 400; throw e; }
}

async function checkDuplicateMembership(app, projectId, userId) {
    const zcql = app.zcql();
    const result = await zcql.executeZCQLQuery('SELECT ROWID FROM project_members WHERE project_id = ' + sanitizeId(projectId) + ' AND user_id = ' + sanitizeId(userId));
    if (result && result.length > 0) { const e = new Error('User is already a member.'); e.statusCode = 409; throw e; }
}

function validateDateFormat(dateStr, fieldName) {
    if (!dateStr) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { const e = new Error(fieldName + ' must be YYYY-MM-DD.'); e.statusCode = 400; throw e; }
    if (isNaN(new Date(dateStr).getTime())) { const e = new Error(fieldName + ' is not a valid date.'); e.statusCode = 400; throw e; }
}

function validateTimeFormat(timeStr, fieldName) {
    if (!timeStr) return;
    if (!/^\d{2}:\d{2}$/.test(timeStr)) { const e = new Error(fieldName + ' must be HH:MM.'); e.statusCode = 400; throw e; }
}

const STATUS_TRANSITIONS = Object.freeze({
    Todo: Object.freeze(['InProgress']),
    InProgress: Object.freeze(['InReview', 'Todo']),
    InReview: Object.freeze(['Done', 'InProgress']),
    Done: Object.freeze(['InProgress']),
});

function validateStatusTransition(currentStatus, newStatus, role) {
    if (currentStatus === newStatus) return;
    if (['Owner', 'Manager'].includes(role)) return;
    var allowed = STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) { const e = new Error("Cannot change from '" + currentStatus + "' to '" + newStatus + "'."); e.statusCode = 400; throw e; }
}

function hasCircularDependency(taskId, newDeps, allDepsMap) {
    const visited = new Set();
    const stack = newDeps.slice();
    while (stack.length > 0) {
        const current = stack.pop();
        if (String(current) === String(taskId)) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        var deps = allDepsMap.get(String(current)) || [];
        for (var i = 0; i < deps.length; i++) stack.push(deps[i]);
    }
    return false;
}

module.exports = { ENUMS, validateEnum, validateLength, checkDuplicateMembership, validateDateFormat, validateTimeFormat, validateStatusTransition, STATUS_TRANSITIONS, hasCircularDependency };