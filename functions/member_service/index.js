'use strict';
var handler = require('./utils/handler');
var permissions = require('./utils/permissions');
var validators = require('./utils/validators');
var sanitize = require('./utils/sanitize');
var zcqlHelpers = require('./utils/zcqlHelpers');
var helpersMod = require('./utils/helpers');
var logger = require('./utils/logger');

var MAX_MEMBERS = 100;

module.exports = handler.createHandler({
    'GET /:projectId': listMembers,
    'POST /:projectId': addMember,
    'PUT /:projectId/:userId': changeRole,
    'DELETE /:projectId/:userId': removeMember,
});

async function listMembers(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var projectId = sanitize.sanitizeId(params.projectId);
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Viewer');
    var zcql = app.zcql();

    var memberQuery = 'SELECT ROWID, user_id, role, CREATEDTIME FROM project_members WHERE project_id = ' + projectId;
    var memberResult = await zcql.executeZCQLQuery(memberQuery);

    var userIds = [];
    memberResult.forEach(function(r) {
        var uid = sanitize.sanitizeId(zcqlHelpers.getColumn(r, 'project_members', 'user_id'));
        if (uid && userIds.indexOf(uid) === -1) userIds.push(uid);
    });

    var usersMap = {};
    if (userIds.length > 0) {
        var usersQuery = 'SELECT ROWID, name, email, avatar_url FROM users WHERE ROWID IN (' + userIds.join(',') + ')';
        var usersResult = await zcql.executeZCQLQuery(usersQuery);
        usersResult.forEach(function(r) {
            usersMap[zcqlHelpers.getColumn(r, 'users', 'ROWID')] = {
                name: zcqlHelpers.getColumn(r, 'users', 'name', 'Unknown'),
                email: zcqlHelpers.getColumn(r, 'users', 'email', ''),
                avatarUrl: zcqlHelpers.getColumn(r, 'users', 'avatar_url', null),
            };
        });
    }

    var roleOrder = { Owner: 1, Manager: 2, Member: 3, Viewer: 4 };
    var members = memberResult.map(function(row) {
        var uid = zcqlHelpers.getColumn(row, 'project_members', 'user_id');
        var userInfo = usersMap[uid] || { name: 'Deleted User', email: '', avatarUrl: null };
        return {
            id: uid,
            membershipId: zcqlHelpers.getColumn(row, 'project_members', 'ROWID'),
            name: userInfo.name,
            email: userInfo.email,
            avatarUrl: userInfo.avatarUrl,
            role: zcqlHelpers.getColumn(row, 'project_members', 'role', 'Viewer'),
            joinedAt: zcqlHelpers.getColumn(row, 'project_members', 'CREATEDTIME', ''),
        };
    }).sort(function(a, b) { return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99); });

    return {
        statusCode: 200,
        data: {
            members: members,
            total: members.length,
            myRole: membership.role,
            permissions: permissions.getPermissionsForRole(membership.role),
        },
    };
}

async function addMember(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var projectId = sanitize.sanitizeId(params.projectId);
    var membership = await permissions.assertProjectRole(app, user.id, projectId, 'Manager');
    await permissions.assertProjectWritable(app, projectId);

    if (!body.email || body.email.trim() === '') { var e = new Error('Email is required.'); e.statusCode = 400; throw e; }
    if (body.role) validators.validateEnum(body.role, validators.ENUMS.MEMBER_ROLE, 'role');

    var newRole = body.role || 'Member';
    if (membership.role !== 'Owner' && (newRole === 'Owner' || newRole === 'Manager')) {
        var e2 = new Error('Only Owners can assign Owner or Manager roles.'); e2.statusCode = 403; throw e2;
    }

    var zcql = app.zcql();
    var countQuery = 'SELECT ROWID FROM project_members WHERE project_id = ' + projectId;
    var countResult = await zcql.executeZCQLQuery(countQuery);
    if (countResult.length >= MAX_MEMBERS) { var e3 = new Error('Maximum ' + MAX_MEMBERS + ' members per project.'); e3.statusCode = 400; throw e3; }

    var normalizedEmail = body.email.trim().toLowerCase();
    var userQuery = "SELECT ROWID, name, email, is_active FROM users WHERE email = '" + sanitize.sanitizeString(normalizedEmail) + "'";
    var userResult = await zcql.executeZCQLQuery(userQuery);
    if (!userResult || userResult.length === 0) { var e4 = new Error('User not found. They must log in at least once.'); e4.statusCode = 404; throw e4; }

    var targetUserId = zcqlHelpers.getColumn(userResult[0], 'users', 'ROWID');
    if (helpersMod.toBool(zcqlHelpers.getColumn(userResult[0], 'users', 'is_active', true)) === false) {
        var e5 = new Error('Cannot add a deactivated user.'); e5.statusCode = 400; throw e5;
    }

    await validators.checkDuplicateMembership(app, projectId, targetUserId);

    var datastore = app.datastore();
    await datastore.table('project_members').insertRow({
        project_id: sanitize.toNumericId(projectId),
        user_id: sanitize.toNumericId(targetUserId),
        role: newRole,
    });

    logger.info('Member added: ' + normalizedEmail + ' as ' + newRole + ' to project ' + projectId);
    return { statusCode: 201, data: { message: zcqlHelpers.getColumn(userResult[0], 'users', 'name', normalizedEmail) + ' added as ' + newRole } };
}

async function changeRole(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params, body = ctx.body;
    var projectId = sanitize.sanitizeId(params.projectId);
    var targetUserId = sanitize.sanitizeId(params.userId);
    await permissions.assertProjectRole(app, user.id, projectId, 'Owner');

    if (!body.role) { var e = new Error('New role is required.'); e.statusCode = 400; throw e; }
    validators.validateEnum(body.role, validators.ENUMS.MEMBER_ROLE, 'role');

    var zcql = app.zcql();
    var memberQuery = 'SELECT ROWID, role FROM project_members WHERE project_id = ' + projectId + ' AND user_id = ' + targetUserId;
    var memberResult = await zcql.executeZCQLQuery(memberQuery);
    if (!memberResult || memberResult.length === 0) { var e2 = new Error('User is not a member.'); e2.statusCode = 404; throw e2; }

    var currentRole = zcqlHelpers.getColumn(memberResult[0], 'project_members', 'role');
    var memberRowId = zcqlHelpers.getColumn(memberResult[0], 'project_members', 'ROWID');

    if (currentRole === 'Owner' && body.role !== 'Owner') {
        var ownerQuery = "SELECT ROWID FROM project_members WHERE project_id = " + projectId + " AND role = 'Owner'";
        var ownerResult = await zcql.executeZCQLQuery(ownerQuery);
        if (ownerResult.length <= 1) { var e3 = new Error('Cannot demote the last Owner.'); e3.statusCode = 400; throw e3; }
    }

    var datastore = app.datastore();
    await datastore.table('project_members').updateRow({ ROWID: memberRowId, role: body.role });
    logger.info('Role changed: user ' + targetUserId + ' from ' + currentRole + ' to ' + body.role + ' in project ' + projectId);
    return { statusCode: 200, data: { message: 'Role updated to ' + body.role } };
}

async function removeMember(ctx) {
    var app = ctx.app, user = ctx.user, params = ctx.params;
    var projectId = sanitize.sanitizeId(params.projectId);
    var targetUserId = sanitize.sanitizeId(params.userId);
    await permissions.assertProjectRole(app, user.id, projectId, 'Manager');

    if (String(user.id) === String(targetUserId)) { var e = new Error('You cannot remove yourself.'); e.statusCode = 400; throw e; }

    var zcql = app.zcql();
    var memberQuery = 'SELECT ROWID, role FROM project_members WHERE project_id = ' + projectId + ' AND user_id = ' + targetUserId;
    var memberResult = await zcql.executeZCQLQuery(memberQuery);
    if (!memberResult || memberResult.length === 0) { var e2 = new Error('User is not a member.'); e2.statusCode = 404; throw e2; }

    var targetRole = zcqlHelpers.getColumn(memberResult[0], 'project_members', 'role');
    var memberRowId = zcqlHelpers.getColumn(memberResult[0], 'project_members', 'ROWID');

    if (targetRole === 'Owner') {
        var ownerQuery = "SELECT ROWID FROM project_members WHERE project_id = " + projectId + " AND role = 'Owner'";
        var ownerResult = await zcql.executeZCQLQuery(ownerQuery);
        if (ownerResult.length <= 1) { var e3 = new Error('Cannot remove the last Owner.'); e3.statusCode = 400; throw e3; }
    }

    var datastore = app.datastore();
    await datastore.table('project_members').deleteRow(memberRowId);

    var assignedTasks = await zcql.executeZCQLQuery('SELECT ROWID FROM tasks WHERE project_id = ' + projectId + ' AND assignee_id = ' + targetUserId + ' AND is_deleted = false');
    var taskTable = datastore.table('tasks');
    for (var i = 0; i < assignedTasks.length; i++) {
        var tid = zcqlHelpers.getColumn(assignedTasks[i], 'tasks', 'ROWID');
        if (tid) await taskTable.updateRow({ ROWID: tid, assignee_id: null });
    }

    logger.info('Member removed: user ' + targetUserId + ' from project ' + projectId + '. ' + assignedTasks.length + ' tasks unassigned.');
    return { statusCode: 200, data: { message: 'Member removed successfully' } };
}