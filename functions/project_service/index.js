'use strict';
var handler = require('./utils/handler');
var permissions = require('./utils/permissions');
var validators = require('./utils/validators');
var sanitize = require('./utils/sanitize');
var zcqlHelpers = require('./utils/zcqlHelpers');
var helpers = require('./utils/helpers');
var logger = require('./utils/logger');

module.exports = handler.createHandler({
    'GET /': listProjects,
    'POST /': createProject,
    'GET /:id': getProject,
    'PUT /:id': updateProject,
    'DELETE /:id': deleteProject,
});

async function listProjects(ctx) {
    var app = ctx.app, user = ctx.user, query = ctx.query;
    var zcql = app.zcql();
    var safeUserId = sanitize.sanitizeId(user.id);
    var page = Math.max(1, parseInt(query.page) || 1);
    var pageSize = Math.min(Math.max(1, parseInt(query.pageSize) || 20), 100);
    var offset = (page - 1) * pageSize;

    var memberQuery = 'SELECT project_id, role FROM project_members WHERE user_id = ' + safeUserId;
    var memberResult = await zcql.executeZCQLQuery(memberQuery);
    if (!memberResult || memberResult.length === 0) {
        return { statusCode: 200, data: { projects: [], pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 } } };
    }

    var memberMap = {};
    memberResult.forEach(function(row) {
        var pid = zcqlHelpers.getColumn(row, 'project_members', 'project_id');
        var role = zcqlHelpers.getColumn(row, 'project_members', 'role', 'Viewer');
        if (pid) memberMap[pid] = role;
    });

    var projectIds = Object.keys(memberMap);
    if (projectIds.length === 0) {
        return { statusCode: 200, data: { projects: [], pagination: { page: page, pageSize: pageSize, total: 0, totalPages: 0 } } };
    }

    var safeIds = projectIds.map(function(id) { return sanitize.sanitizeId(id); }).join(',');
    var projectQuery = 'SELECT ROWID, name, description, status, start_date, end_date, MODIFIEDTIME FROM projects WHERE ROWID IN (' + safeIds + ') AND is_deleted = false ORDER BY MODIFIEDTIME DESC';
    var projectResult = await zcql.executeZCQLQuery(projectQuery);

    var total = projectResult.length;
    var paginatedProjects = projectResult.slice(offset, offset + pageSize);

    var projects = paginatedProjects.map(function(row) {
        var pid = zcqlHelpers.getColumn(row, 'projects', 'ROWID');
        return {
            id: pid,
            name: zcqlHelpers.getColumn(row, 'projects', 'name', ''),
            description: zcqlHelpers.getColumn(row, 'projects', 'description', ''),
            status: zcqlHelpers.getColumn(row, 'projects', 'status', 'Active'),
            startDate: zcqlHelpers.getColumn(row, 'projects', 'start_date', ''),
            endDate: zcqlHelpers.getColumn(row, 'projects', 'end_date', ''),
            myRole: memberMap[pid] || 'Viewer',
            permissions: permissions.getPermissionsForRole(memberMap[pid] || 'Viewer'),
        };
    });

    return { statusCode: 200, data: { projects: projects, pagination: { page: page, pageSize: pageSize, total: total, totalPages: Math.ceil(total / pageSize) } } };
}

async function createProject(ctx) {
    var app = ctx.app, user = ctx.user, body = ctx.body;
    if (!body.name || body.name.trim() === '') { var e = new Error('Project name is required.'); e.statusCode = 400; throw e; }
    validators.validateLength(body.name, 500, 'Project name');
    validators.validateLength(body.description, 5000, 'Description');
    if (body.status) validators.validateEnum(body.status, validators.ENUMS.PROJECT_STATUS, 'status');

    var datastore = app.datastore();
    var projectTable = datastore.table('projects');
    var memberTable = datastore.table('project_members');
    var project;
    try {
        project = await projectTable.insertRow({
            name: body.name.trim(),
            description: body.description || '',
            status: body.status || 'Active',
            created_by_id: sanitize.toNumericId(user.id),
            start_date: body.startDate || '',
            end_date: body.endDate || '',
            is_deleted: false,
        });
        await memberTable.insertRow({
            project_id: sanitize.toNumericId(project.ROWID),
            user_id: sanitize.toNumericId(user.id),
            role: 'Owner',
        });
    } catch (error) {
        if (project && project.ROWID) {
            try { await projectTable.deleteRow(project.ROWID); logger.warn('Rolled back orphaned project: ' + project.ROWID); }
            catch (re) { logger.error('CRITICAL: Orphaned project ' + project.ROWID); }
        }
        throw error;
    }
    logger.info('Project created: ' + body.name + ' by ' + user.email);
    return {
        statusCode: 201,
        data: {
            message: 'Project created successfully',
            project: {
                id: project.ROWID, name: body.name.trim(), description: body.description || '',
                status: body.status || 'Active', startDate: body.startDate || '', endDate: body.endDate || '',
                myRole: 'Owner', permissions: permissions.getPermissionsForRole('Owner'),
            },
        },
    };
}

async function getProject(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var projectId = sanitize.sanitizeId(params.id);
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Viewer');
    var zcql = app.zcql();

    var projectQuery = 'SELECT ROWID, name, description, status, start_date, end_date, created_by_id, CREATEDTIME, MODIFIEDTIME FROM projects WHERE ROWID = ' + projectId;
    var projectResult = await zcql.executeZCQLQuery(projectQuery);

    var taskSummaryQuery = 'SELECT status FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false';
    var taskSummaryResult = await zcql.executeZCQLQuery(taskSummaryQuery);
    var tasksByStatus = {};
    var totalTasks = 0;
    taskSummaryResult.forEach(function(row) {
        var status = zcqlHelpers.getColumn(row, 'tasks', 'status', 'Todo');
        tasksByStatus[status] = (tasksByStatus[status] || 0) + 1;
        totalTasks++;
    });

    var memberQuery = 'SELECT ROWID FROM project_members WHERE project_id = ' + projectId;
    var memberResult = await zcql.executeZCQLQuery(memberQuery);

    return {
        statusCode: 200,
        data: {
            project: {
                id: zcqlHelpers.getColumn(projectResult[0], 'projects', 'ROWID'),
                name: zcqlHelpers.getColumn(projectResult[0], 'projects', 'name', ''),
                description: zcqlHelpers.getColumn(projectResult[0], 'projects', 'description', ''),
                status: zcqlHelpers.getColumn(projectResult[0], 'projects', 'status', 'Active'),
                startDate: zcqlHelpers.getColumn(projectResult[0], 'projects', 'start_date', ''),
                endDate: zcqlHelpers.getColumn(projectResult[0], 'projects', 'end_date', ''),
                createdAt: zcqlHelpers.getColumn(projectResult[0], 'projects', 'CREATEDTIME', ''),
                updatedAt: zcqlHelpers.getColumn(projectResult[0], 'projects', 'MODIFIEDTIME', ''),
            },
            taskSummary: { total: totalTasks, byStatus: tasksByStatus },
            memberCount: memberResult.length,
            myRole: membership.role,
            permissions: permissions.getPermissionsForRole(membership.role),
        },
    };
}

async function updateProject(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var projectId = sanitize.sanitizeId(params.id);
    await permissions.assertProjectRole(app, user.id, projectId, 'Owner');
    if (body.name !== undefined) {
        if (body.name.trim() === '') { var e = new Error('Project name cannot be empty.'); e.statusCode = 400; throw e; }
        validators.validateLength(body.name, 500, 'Project name');
    }
    if (body.description !== undefined) validators.validateLength(body.description, 5000, 'Description');
    if (body.status) validators.validateEnum(body.status, validators.ENUMS.PROJECT_STATUS, 'status');

    var updateData = { ROWID: projectId };
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.description !== undefined) updateData.description = body.description;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.startDate !== undefined) updateData.start_date = body.startDate;
    if (body.endDate !== undefined) updateData.end_date = body.endDate;

    var datastore = app.datastore();
    await datastore.table('projects').updateRow(updateData);
    logger.info('Project updated: ' + projectId + ' by ' + user.email);
    return { statusCode: 200, data: { message: 'Project updated successfully' } };
}

async function deleteProject(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var projectId = sanitize.sanitizeId(params.id);
    await permissions.assertProjectRole(app, user.id, projectId, 'Owner');
    var zcql = app.zcql();
    var datastore = app.datastore();

    var taskQuery = 'SELECT ROWID FROM tasks WHERE project_id = ' + projectId + ' AND is_deleted = false';
    var tasks = await zcql.executeZCQLQuery(taskQuery);
    var taskTable = datastore.table('tasks');
    for (var i = 0; i < tasks.length; i++) {
        var taskId = zcqlHelpers.getColumn(tasks[i], 'tasks', 'ROWID');
        if (taskId) await taskTable.updateRow({ ROWID: taskId, is_deleted: true });
    }

    await datastore.table('projects').updateRow({ ROWID: projectId, is_deleted: true });
    logger.info('Project deleted (soft): ' + projectId + ' - ' + tasks.length + ' tasks cascade-deleted');
    return { statusCode: 200, data: { message: 'Project and all tasks deleted successfully' } };
}