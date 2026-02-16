'use strict';
const { sanitizeId } = require('./sanitize');
const { toBool } = require('./helpers');
const { getColumn } = require('./zcqlHelpers');

const ROLE_HIERARCHY = { Viewer: 1, Member: 2, Manager: 3, Owner: 4 };

async function assertProjectRole(app, userId, projectId, minimumRole) {
    const zcql = app.zcql();
    const safePid = sanitizeId(projectId);
    const safeUid = sanitizeId(userId);

    const pResult = await zcql.executeZCQLQuery('SELECT ROWID, is_deleted FROM projects WHERE ROWID = ' + safePid);
    if (!pResult || pResult.length === 0) { const e = new Error('Project not found.'); e.statusCode = 404; throw e; }
    if (toBool(getColumn(pResult[0], 'projects', 'is_deleted', false))) { const e = new Error('Project deleted.'); e.statusCode = 404; throw e; }

    const mResult = await zcql.executeZCQLQuery('SELECT role FROM project_members WHERE project_id = ' + safePid + ' AND user_id = ' + safeUid);
    if (!mResult || mResult.length === 0) { const e = new Error('Not a member of this project.'); e.statusCode = 403; throw e; }

    const userRole = getColumn(mResult[0], 'project_members', 'role', 'Viewer');
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const reqLevel = ROLE_HIERARCHY[minimumRole] || 0;
    if (userLevel < reqLevel) { const e = new Error('Requires ' + minimumRole + ' role. You are ' + userRole + '.'); e.statusCode = 403; throw e; }

    return { role: userRole, roleLevel: userLevel, projectId: safePid, userId: parseInt(safeUid) };
}

async function assertCanAccessTask(app, userId, taskId, minimumRole) {
    const zcql = app.zcql();
    const safeTid = sanitizeId(taskId);
    const tResult = await zcql.executeZCQLQuery('SELECT ROWID, project_id, assignee_id, created_by_id, title, status, is_deleted FROM tasks WHERE ROWID = ' + safeTid);
    if (!tResult || tResult.length === 0) { const e = new Error('Task not found.'); e.statusCode = 404; throw e; }
    if (toBool(getColumn(tResult[0], 'tasks', 'is_deleted', false))) { const e = new Error('Task deleted.'); e.statusCode = 404; throw e; }

    const projectId = getColumn(tResult[0], 'tasks', 'project_id');
    const membership = await assertProjectRole(app, userId, projectId, minimumRole);

    return {
        task: {
            id: parseInt(getColumn(tResult[0], 'tasks', 'ROWID')), 
            projectId: parseInt(projectId),
            assigneeId: getColumn(tResult[0], 'tasks', 'assignee_id') ? parseInt(getColumn(tResult[0], 'tasks', 'assignee_id')) : null,
            createdById: getColumn(tResult[0], 'tasks', 'created_by_id') ? parseInt(getColumn(tResult[0], 'tasks', 'created_by_id')) : null,
            title: getColumn(tResult[0], 'tasks', 'title', ''),
            status: getColumn(tResult[0], 'tasks', 'status', 'Todo'),
        },
        membership: membership,
    };
}

async function assertProjectWritable(app, projectId) {
    const zcql = app.zcql();
    const result = await zcql.executeZCQLQuery('SELECT status FROM projects WHERE ROWID = ' + sanitizeId(projectId));
    if (!result || result.length === 0) { const e = new Error('Project not found.'); e.statusCode = 404; throw e; }
    const status = getColumn(result[0], 'projects', 'status', 'Active');
    if (status === 'Archived' || status === 'Completed') {
        const e = new Error('Cannot modify a ' + status.toLowerCase() + ' project.');
        e.statusCode = 403; throw e;
    }
}

function getPermissionsForRole(role) {
    const level = ROLE_HIERARCHY[role] || 0;
    return {
        canViewProject: level >= 1, canEditProject: level >= 4, canDeleteProject: level >= 4,
        canViewMembers: level >= 1, canInviteMembers: level >= 3, canRemoveMembers: level >= 3, canChangeRoles: level >= 4,
        canViewTasks: level >= 1, canCreateTask: level >= 2, canEditOwnTask: level >= 2, canEditAnyTask: level >= 3, canDeleteTask: level >= 3,
        canLogTime: level >= 2, canEditOwnTimeLog: level >= 2, canEditAnyTimeLog: level >= 3, canViewAllTimeLogs: level >= 3,
        canDragGanttBars: level >= 2,
    };
}

module.exports = { ROLE_HIERARCHY, assertProjectRole, assertCanAccessTask, assertProjectWritable, getPermissionsForRole };