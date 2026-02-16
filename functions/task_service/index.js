'use strict';
var handler = require('./utils/handler');
var permissions = require('./utils/permissions');
var validators = require('./utils/validators');
var sanitize = require('./utils/sanitize');
var zcqlHelpers = require('./utils/zcqlHelpers');
var helpersMod = require('./utils/helpers');
var logger = require('./utils/logger');

var MAX_TASKS_PER_PROJECT = 500;

module.exports = handler.createHandler({
    'GET /project/:projectId': listTasks,
    'POST /project/:projectId': createTask,
    'GET /detail/:taskId': getTask,
    'PUT /detail/:taskId': updateTask,
    'DELETE /detail/:taskId': deleteTask,
    'GET /gantt/:projectId': getGanttData,
    'PUT /gantt-update/:taskId': ganttUpdate,
    'PUT /reorder/:projectId': reorderTasks,
});

async function listTasks(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, query = ctx.query;
    var projectId = sanitize.sanitizeId(params.projectId);
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Viewer');
    var zcql = app.zcql();

    var conditions = ['project_id = ' + projectId, 'is_deleted = false'];
    if (query.status) { validators.validateEnum(query.status, validators.ENUMS.TASK_STATUS, 'status'); conditions.push("status = '" + sanitize.sanitizeString(query.status) + "'"); }
    if (query.priority) { validators.validateEnum(query.priority, validators.ENUMS.TASK_PRIORITY, 'priority'); conditions.push("priority = '" + sanitize.sanitizeString(query.priority) + "'"); }
    if (query.assignee) { conditions.push('assignee_id = ' + sanitize.sanitizeId(query.assignee)); }

    var taskQuery = 'SELECT ROWID, title, description, status, priority, assignee_id, created_by_id, start_date, end_date, progress, depends_on, sort_order, milestone, MODIFIEDTIME FROM tasks WHERE ' + conditions.join(' AND ') + ' ORDER BY sort_order ASC, CREATEDTIME DESC';
    var taskResult = await zcql.executeZCQLQuery(taskQuery);

    var userIds = [];
    taskResult.forEach(function(row) {
        var aid = zcqlHelpers.getColumn(row, 'tasks', 'assignee_id');
        var cid = zcqlHelpers.getColumn(row, 'tasks', 'created_by_id');
        if (aid && userIds.indexOf(aid) === -1) userIds.push(aid);
        if (cid && userIds.indexOf(cid) === -1) userIds.push(cid);
    });

    var usersMap = {};
    if (userIds.length > 0) {
        var safeUserIds = userIds.map(function(id) { return sanitize.sanitizeId(id); }).join(',');
        var usersQuery = 'SELECT ROWID, name, email FROM users WHERE ROWID IN (' + safeUserIds + ')';
        var usersResult = await zcql.executeZCQLQuery(usersQuery);
        usersResult.forEach(function(r) {
            var uid = zcqlHelpers.getColumn(r, 'users', 'ROWID');
            usersMap[uid] = { id: uid, name: zcqlHelpers.getColumn(r, 'users', 'name', 'Unknown'), email: zcqlHelpers.getColumn(r, 'users', 'email', '') };
        });
    }

    var tasks = taskResult.map(function(row) {
        var aid = zcqlHelpers.getColumn(row, 'tasks', 'assignee_id');
        return {
            id: zcqlHelpers.getColumn(row, 'tasks', 'ROWID'),
            title: zcqlHelpers.getColumn(row, 'tasks', 'title', ''),
            description: zcqlHelpers.getColumn(row, 'tasks', 'description', ''),
            status: zcqlHelpers.getColumn(row, 'tasks', 'status', 'Todo'),
            priority: zcqlHelpers.getColumn(row, 'tasks', 'priority', 'Medium'),
            assignee: aid ? (usersMap[aid] || null) : null,
            startDate: zcqlHelpers.getColumn(row, 'tasks', 'start_date', ''),
            endDate: zcqlHelpers.getColumn(row, 'tasks', 'end_date', ''),
            progress: zcqlHelpers.getIntColumn(row, 'tasks', 'progress', 0),
            dependsOn: zcqlHelpers.getColumn(row, 'tasks', 'depends_on', ''),
            sortOrder: zcqlHelpers.getIntColumn(row, 'tasks', 'sort_order', 0),
            milestone: helpersMod.toBool(zcqlHelpers.getColumn(row, 'tasks', 'milestone', false)),
            modifiedTime: zcqlHelpers.getColumn(row, 'tasks', 'MODIFIEDTIME', ''),
        };
    });

    return {
        statusCode: 200,
        data: {
            tasks: tasks,
            total: tasks.length,
            permissions: permissions.getPermissionsForRole(membership.role),
        },
    };
}

async function createTask(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var projectId = sanitize.sanitizeId(params.projectId);
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Member');
    await permissions.assertProjectWritable(app, projectId);

    if (!body.title || body.title.trim() === '') { var e = new Error('Task title is required.'); e.statusCode = 400; throw e; }
    validators.validateLength(body.title, 500, 'Title');
    validators.validateLength(body.description, 5000, 'Description');
    if (body.status) validators.validateEnum(body.status, validators.ENUMS.TASK_STATUS, 'status');
    if (body.priority) validators.validateEnum(body.priority, validators.ENUMS.TASK_PRIORITY, 'priority');
    if (body.startDate) validators.validateDateFormat(body.startDate, 'startDate');
    if (body.endDate) validators.validateDateFormat(body.endDate, 'endDate');
    if (body.startDate && body.endDate) validators.validateDateRange(body.startDate, body.endDate);
    if (body.progress !== undefined) {
        var prog = parseInt(body.progress);
        if (isNaN(prog) || prog < 0 || prog > 100) { var e2 = new Error('Progress must be 0-100.'); e2.statusCode = 400; throw e2; }
    }

    var zcql = app.zcql();
    var countQuery = 'SELECT ROWID FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false';
    var countResult = await zcql.executeZCQLQuery(countQuery);
    if (countResult.length >= MAX_TASKS_PER_PROJECT) { var e3 = new Error('Maximum ' + MAX_TASKS_PER_PROJECT + ' tasks per project.'); e3.statusCode = 400; throw e3; }

    if (body.assigneeId) {
        var safeAssigneeId = sanitize.sanitizeId(body.assigneeId);
        var memberCheck = await zcql.executeZCQLQuery('SELECT ROWID FROM project_members WHERE project_id = ' + projectId + ' AND user_id = ' + safeAssigneeId);
        if (!memberCheck || memberCheck.length === 0) { var e4 = new Error('Assignee must be a project member.'); e4.statusCode = 400; throw e4; }
    }

    if (body.dependsOn) {
        var depIds = String(body.dependsOn).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        for (var i = 0; i < depIds.length; i++) {
            var depId = sanitize.sanitizeId(depIds[i]);
            var depCheck = await zcql.executeZCQLQuery('SELECT ROWID FROM tasks WHERE ROWID = ' + depId + ' AND project_id = ' + projectId + ' AND is_deleted = false');
            if (!depCheck || depCheck.length === 0) { var e5 = new Error('Dependency task ' + depId + ' not found in this project.'); e5.statusCode = 400; throw e5; }
        }
    }

    var maxOrderQuery = 'SELECT sort_order FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false ORDER BY sort_order DESC';
    var maxOrderResult = await zcql.executeZCQLQuery(maxOrderQuery);
    var nextOrder = 1;
    if (maxOrderResult && maxOrderResult.length > 0) {
        nextOrder = zcqlHelpers.getIntColumn(maxOrderResult[0], 'tasks', 'sort_order', 0) + 1;
    }

    var datastore = app.datastore();
    var task = await datastore.table('tasks').insertRow({
        project_id: sanitize.toNumericId(projectId),
        title: body.title.trim(),
        description: body.description || '',
        status: body.status || 'Todo',
        priority: body.priority || 'Medium',
        assignee_id: body.assigneeId ? sanitize.toNumericId(body.assigneeId) : null,
        created_by_id: sanitize.toNumericId(user.id),
        start_date: body.startDate || '',
        end_date: body.endDate || '',
        progress: body.progress !== undefined ? parseInt(body.progress) : 0,
        depends_on: body.dependsOn || '',
        sort_order: nextOrder,
        milestone: body.milestone || false,
        is_deleted: false,
    });

    logger.info('Task created: ' + body.title + ' in project ' + projectId + ' by ' + user.email);
    return { statusCode: 201, data: { message: 'Task created successfully', taskId: task.ROWID } };
}

async function getTask(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var taskId = sanitize.sanitizeId(params.taskId);
    var zcql = app.zcql();

    var taskQuery = 'SELECT ROWID, project_id, title, description, status, priority, assignee_id, created_by_id, start_date, end_date, progress, depends_on, sort_order, milestone, CREATEDTIME, MODIFIEDTIME FROM tasks WHERE ROWID = ' + taskId + ' AND is_deleted = false';
    var taskResult = await zcql.executeZCQLQuery(taskQuery);
    if (!taskResult || taskResult.length === 0) { var e = new Error('Task not found.'); e.statusCode = 404; throw e; }

    var projectId = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'project_id');
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Viewer');

    var assigneeId = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'assignee_id');
    var createdById = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'created_by_id');
    var userIds = [];
    if (assigneeId) userIds.push(sanitize.sanitizeId(assigneeId));
    if (createdById && userIds.indexOf(sanitize.sanitizeId(createdById)) === -1) userIds.push(sanitize.sanitizeId(createdById));

    var usersMap = {};
    if (userIds.length > 0) {
        var usersQuery = 'SELECT ROWID, name, email FROM users WHERE ROWID IN (' + userIds.join(',') + ')';
        var usersResult = await zcql.executeZCQLQuery(usersQuery);
        usersResult.forEach(function(r) {
            var uid = zcqlHelpers.getColumn(r, 'users', 'ROWID');
            usersMap[uid] = { id: uid, name: zcqlHelpers.getColumn(r, 'users', 'name', 'Unknown'), email: zcqlHelpers.getColumn(r, 'users', 'email', '') };
        });
    }

    var timelogQuery = 'SELECT ROWID, user_id, log_date, start_time, end_time, minutes, notes FROM time_logs WHERE task_id = ' + taskId + ' ORDER BY log_date DESC';
    var timelogResult = await zcql.executeZCQLQuery(timelogQuery);

    var logUserIds = [];
    timelogResult.forEach(function(r) {
        var uid = sanitize.sanitizeId(zcqlHelpers.getColumn(r, 'time_logs', 'user_id'));
        if (uid && logUserIds.indexOf(uid) === -1) logUserIds.push(uid);
    });
    if (logUserIds.length > 0) {
        var logUsersQuery = 'SELECT ROWID, name FROM users WHERE ROWID IN (' + logUserIds.join(',') + ')';
        var logUsersResult = await zcql.executeZCQLQuery(logUsersQuery);
        logUsersResult.forEach(function(r) {
            var uid = zcqlHelpers.getColumn(r, 'users', 'ROWID');
            if (!usersMap[uid]) usersMap[uid] = { id: uid, name: zcqlHelpers.getColumn(r, 'users', 'name', 'Unknown'), email: ''; };
        });
    }

    var isViewerOrMember = ['Viewer', 'Member'].indexOf(membership.role) >= 0;
    var filteredTimelogs = timelogResult;
    var filterMessage = null;
    if (isViewerOrMember) {
        filteredTimelogs = timelogResult.filter(function(r) { return String(zcqlHelpers.getColumn(r, 'time_logs', 'user_id')) === String(user.id); });
        if (filteredTimelogs.length < timelogResult.length) filterMessage = 'Showing only your time logs. Managers and Owners can see all logs.';
    }

    var totalMinutes = 0;
    var timelogs = filteredTimelogs.map(function(r) {
        var mins = zcqlHelpers.getIntColumn(r, 'time_logs', 'minutes', 0);
        totalMinutes += mins;
        var logUserId = zcqlHelpers.getColumn(r, 'time_logs', 'user_id');
        return {
            id: zcqlHelpers.getColumn(r, 'time_logs', 'ROWID'),
            userId: logUserId,
            userName: usersMap[logUserId] ? usersMap[logUserId].name : 'Unknown',
            logDate: zcqlHelpers.getColumn(r, 'time_logs', 'log_date', ''),
            startTime: zcqlHelpers.getColumn(r, 'time_logs', 'start_time', ''),
            endTime: zcqlHelpers.getColumn(r, 'time_logs', 'end_time', ''),
            minutes: mins,
            notes: zcqlHelpers.getColumn(r, 'time_logs', 'notes', ''),
        };
    });

    var task = {
        id: taskId,
        projectId: projectId,
        title: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'title', ''),
        description: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'description', ''),
        status: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'status', 'Todo'),
        priority: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'priority', 'Medium'),
        assignee: assigneeId ? (usersMap[assigneeId] || null) : null,
        createdBy: createdById ? (usersMap[createdById] || null) : null,
        startDate: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'start_date', ''),
        endDate: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'end_date', ''),
        progress: zcqlHelpers.getIntColumn(taskResult[0], 'tasks', 'progress', 0),
        dependsOn: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'depends_on', ''),
        sortOrder: zcqlHelpers.getIntColumn(taskResult[0], 'tasks', 'sort_order', 0),
        milestone: helpersMod.toBool(zcqlHelpers.getColumn(taskResult[0], 'tasks', 'milestone', false)),
        createdAt: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'CREATEDTIME', ''),
        updatedAt: zcqlHelpers.getColumn(taskResult[0], 'tasks', 'MODIFIEDTIME', ''),
    };

    var isAssignee = assigneeId && String(assigneeId) === String(user.id);
    var taskPerms = permissions.getPermissionsForRole(membership.role);
    taskPerms.canEditOwnTask = isAssignee || ['Owner', 'Manager'].indexOf(membership.role) >= 0;
    taskPerms.canEditOwnTimeLog = true;

    return {
        statusCode: 200,
        data: {
            task: task,
            timelogs: timelogs,
            timeSummary: { totalMinutes: totalMinutes, entryCount: timelogs.length },
            filterMessage: filterMessage,
            permissions: taskPerms,
        },
    };
}

async function updateTask(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var taskId = sanitize.sanitizeId(params.taskId);
    var zcql = app.zcql();

    var taskQuery = 'SELECT ROWID, project_id, status, assignee_id FROM tasks WHERE ROWID = ' + taskId + ' AND is_deleted = false';
    var taskResult = await zcql.executeZCQLQuery(taskQuery);
    if (!taskResult || taskResult.length === 0) { var e = new Error('Task not found.'); e.statusCode = 404; throw e; }

    var projectId = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'project_id');
    var currentStatus = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'status');
    var currentAssignee = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'assignee_id');
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Member');
    await permissions.assertProjectWritable(app, projectId);

    var isAssignee = currentAssignee && String(currentAssignee) === String(user.id);
    if (membership.role === 'Member' && !isAssignee) {
        var e2 = new Error('Members can only edit tasks assigned to them.'); e2.statusCode = 403; throw e2;
    }

    if (body.title !== undefined) {
        if (body.title.trim() === '') { var e3 = new Error('Title cannot be empty.'); e3.statusCode = 400; throw e3; }
        validators.validateLength(body.title, 500, 'Title');
    }
    if (body.description !== undefined) validators.validateLength(body.description, 5000, 'Description');
    if (body.status) {
        validators.validateEnum(body.status, validators.ENUMS.TASK_STATUS, 'status');
        validators.validateStatusTransition(currentStatus, body.status, membership.role);
    }
    if (body.priority) validators.validateEnum(body.priority, validators.ENUMS.TASK_PRIORITY, 'priority');
    if (body.startDate) validators.validateDateFormat(body.startDate, 'startDate');
    if (body.endDate) validators.validateDateFormat(body.endDate, 'endDate');
    if (body.progress !== undefined) {
        var prog = parseInt(body.progress);
        if (isNaN(prog) || prog < 0 || prog > 100) { var e4 = new Error('Progress must be 0-100.'); e4.statusCode = 400; throw e4; }
    }

    if (body.assigneeId) {
        var safeAssigneeId = sanitize.sanitizeId(body.assigneeId);
        var memberCheck = await zcql.executeZCQLQuery('SELECT ROWID FROM project_members WHERE project_id = ' + projectId + ' AND user_id = ' + safeAssigneeId);
        if (!memberCheck || memberCheck.length === 0) { var e5 = new Error('Assignee must be a project member.'); e5.statusCode = 400; throw e5; }
    }

    if (body.dependsOn !== undefined) {
        var depIds = String(body.dependsOn).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (depIds.length > 0) {
            var allTasksQuery = 'SELECT ROWID, depends_on FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false';
            var allTasks = await zcql.executeZCQLQuery(allTasksQuery);
            var depsMap = new Map();
            allTasks.forEach(function(r) {
                var tid = zcqlHelpers.getColumn(r, 'tasks', 'ROWID');
                var deps = (zcqlHelpers.getColumn(r, 'tasks', 'depends_on', '') || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
                depsMap.set(String(tid), deps);
            });
            if (validators.hasCircularDependency(taskId, depIds, depsMap)) {
                var e6 = new Error('Circular dependency detected.'); e6.statusCode = 400; throw e6;
            }
        }
    }

    var updateData = { ROWID: taskId };
    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.description !== undefined) updateData.description = body.description;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.assigneeId !== undefined) updateData.assignee_id = body.assigneeId ? sanitize.toNumericId(body.assigneeId) : null;
    if (body.startDate !== undefined) updateData.start_date = body.startDate;
    if (body.endDate !== undefined) updateData.end_date = body.endDate;
    if (body.progress !== undefined) updateData.progress = parseInt(body.progress);
    if (body.dependsOn !== undefined) updateData.depends_on = body.dependsOn;
    if (body.milestone !== undefined) updateData.milestone = body.milestone;

    var datastore = app.datastore();
    await datastore.table('tasks').updateRow(updateData);
    logger.info('Task updated: ' + taskId + ' in project ' + projectId + ' by ' + user.email);
    return { statusCode: 200, data: { message: 'Task updated successfully' } };
}

async function deleteTask(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var taskId = sanitize.sanitizeId(params.taskId);
    var zcql = app.zcql();

    var taskQuery = 'SELECT ROWID, project_id, title FROM tasks WHERE ROWID = ' + taskId + ' AND is_deleted = false';
    var taskResult = await zcql.executeZCQLQuery(taskQuery);
    if (!taskResult || taskResult.length === 0) { var e = new Error('Task not found.'); e.statusCode = 404; throw e; }

    var projectId = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'project_id');
    await permissions.assertProjectRole(app, user.id, projectId, 'Manager');

    var datastore = app.datastore();
    await datastore.table('tasks').updateRow({ ROWID: taskId, is_deleted: true });

    var dependentTasks = await zcql.executeZCQLQuery("SELECT ROWID, depends_on FROM tasks WHERE project_id = " + projectId + " AND is_deleted = false AND depends_on LIKE '%" + taskId + "%'");
    var taskTable = datastore.table('tasks');
    for (var i = 0; i < dependentTasks.length; i++) {
        var depRow = dependentTasks[i];
        var depRowId = zcqlHelpers.getColumn(depRow, 'tasks', 'ROWID');
        var currentDeps = (zcqlHelpers.getColumn(depRow, 'tasks', 'depends_on', '') || '').split(',').map(function(s) { return s.trim(); }).filter(function(d) { return d && d !== taskId; });
        await taskTable.updateRow({ ROWID: depRowId, depends_on: currentDeps.join(',') });
    }

    logger.info('Task deleted (soft): ' + taskId + ' - cleaned ' + dependentTasks.length + ' dependencies');
    return { statusCode: 200, data: { message: 'Task deleted successfully' } };
}

async function getGanttData(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var projectId = sanitize.sanitizeId(params.projectId);
    await permissions.assertProjectRole(app, user.id, projectId, 'Viewer');
    var zcql = app.zcql();

    var taskQuery = 'SELECT ROWID, title, status, priority, assignee_id, start_date, end_date, progress, depends_on, milestone, MODIFIEDTIME FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false ORDER BY sort_order ASC';
    var taskResult = await zcql.executeZCQLQuery(taskQuery);

    var userIds = [];
    taskResult.forEach(function(r) {
        var aid = zcqlHelpers.getColumn(r, 'tasks', 'assignee_id');
        if (aid && userIds.indexOf(aid) === -1) userIds.push(aid);
    });
    var usersMap = {};
    if (userIds.length > 0) {
        var usersQuery = 'SELECT ROWID, name FROM users WHERE ROWID IN (' + userIds.map(function(id) { return sanitize.sanitizeId(id); }).join(',') + ')';
        var usersResult = await zcql.executeZCQLQuery(usersQuery);
        usersResult.forEach(function(r) { usersMap[zcqlHelpers.getColumn(r, 'users', 'ROWID')] = zcqlHelpers.getColumn(r, 'users', 'name', 'Unknown'); });
    }

    var timeQuery = 'SELECT task_id, minutes FROM time_logs WHERE task_id IN (SELECT ROWID FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false)';
    var timeResult = await zcql.executeZCQLQuery(timeQuery);
    var timeMap = {};
    timeResult.forEach(function(r) {
        var tid = zcqlHelpers.getColumn(r, 'time_logs', 'task_id');
        timeMap[tid] = (timeMap[tid] || 0) + zcqlHelpers.getIntColumn(r, 'time_logs', 'minutes', 0);
    });

    var tasks = taskResult.map(function(row) {
        var tid = zcqlHelpers.getColumn(row, 'tasks', 'ROWID');
        var aid = zcqlHelpers.getColumn(row, 'tasks', 'assignee_id');
        return {
            id: tid,
            title: zcqlHelpers.getColumn(row, 'tasks', 'title', ''),
            status: zcqlHelpers.getColumn(row, 'tasks', 'status', 'Todo'),
            priority: zcqlHelpers.getColumn(row, 'tasks', 'priority', 'Medium'),
            assigneeId: aid,
            assigneeName: aid ? (usersMap[aid] || 'Unknown') : null,
            startDate: zcqlHelpers.getColumn(row, 'tasks', 'start_date', ''),
            endDate: zcqlHelpers.getColumn(row, 'tasks', 'end_date', ''),
            progress: zcqlHelpers.getIntColumn(row, 'tasks', 'progress', 0),
            dependsOn: zcqlHelpers.getColumn(row, 'tasks', 'depends_on', ''),
            milestone: helpersMod.toBool(zcqlHelpers.getColumn(row, 'tasks', 'milestone', false)),
            totalMinutesLogged: timeMap[tid] || 0,
            modifiedTime: zcqlHelpers.getColumn(row, 'tasks', 'MODIFIEDTIME', ''),
        };
    });

    return { statusCode: 200, data: { tasks: tasks, total: tasks.length } };
}

async function ganttUpdate(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var taskId = sanitize.sanitizeId(params.taskId);
    var zcql = app.zcql();

    var taskQuery = 'SELECT ROWID, project_id FROM tasks WHERE ROWID = ' + taskId + ' AND is_deleted = false';
    var taskResult = await zcql.executeZCQLQuery(taskQuery);
    if (!taskResult || taskResult.length === 0) { var e = new Error('Task not found.'); e.statusCode = 404; throw e; }

    var projectId = zcqlHelpers.getColumn(taskResult[0], 'tasks', 'project_id');
    await permissions.assertProjectRole(app, user.id, projectId, 'Member');

    var updateData = { ROWID: taskId };
    if (body.startDate) { validators.validateDateFormat(body.startDate, 'startDate'); updateData.start_date = body.startDate; }
    if (body.endDate) { validators.validateDateFormat(body.endDate, 'endDate'); updateData.end_date = body.endDate; }
    if (body.progress !== undefined) {
        var prog = parseInt(body.progress);
        if (!isNaN(prog) && prog >= 0 && prog <= 100) updateData.progress = prog;
    }

    var datastore = app.datastore();
    await datastore.table('tasks').updateRow(updateData);
    return { statusCode: 200, data: { message: 'Task updated' } };
}

async function reorderTasks(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var projectId = sanitize.sanitizeId(params.projectId);
    await permissions.assertProjectRole(app, user.id, projectId, 'Member');

    if (!body.order || !Array.isArray(body.order)) { var e = new Error('Order array is required.'); e.statusCode = 400; throw e; }

    var datastore = app.datastore();
    var taskTable = datastore.table('tasks');
    for (var i = 0; i < body.order.length; i++) {
        var safeId = sanitize.sanitizeId(body.order[i]);
        await taskTable.updateRow({ ROWID: safeId, sort_order: i + 1 });
    }

    return { statusCode: 200, data: { message: 'Tasks reordered' } };
}