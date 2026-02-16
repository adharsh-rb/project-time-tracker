'use strict';
var catalyst = require('zcatalyst-sdk-node');
var logger = require('./utils/logger');

module.exports = async function (req, res) {
    try {
        var app = catalyst.initialize(req);
        var zcql = app.zcql();
        var datastore = app.datastore();

        var existingProjects = await zcql.executeZCQLQuery('SELECT ROWID FROM projects');
        if (existingProjects && existingProjects.length > 0) {
            return res.status(200).send({ message: 'Seed data already exists. Skipping.', projectCount: existingProjects.length });
        }

        var usersTable = datastore.table('users');
        var projectsTable = datastore.table('projects');
        var membersTable = datastore.table('project_members');
        var tasksTable = datastore.table('tasks');
        var timeLogsTable = datastore.table('time_logs');

        var user1 = await usersTable.insertRow({ name: 'Alice Johnson', email: 'alice@example.com', global_role: 'Admin', is_active: true });
        var user2 = await usersTable.insertRow({ name: 'Bob Smith', email: 'bob@example.com', global_role: 'Member', is_active: true });
        var user3 = await usersTable.insertRow({ name: 'Carol Williams', email: 'carol@example.com', global_role: 'Member', is_active: true });
        logger.info('Created 3 sample users');

        var project = await projectsTable.insertRow({
            name: 'Website Redesign',
            description: 'Complete redesign of the company website with modern UI/UX',
            status: 'Active',
            created_by_id: parseInt(user1.ROWID),
            start_date: '2026-01-01',
            end_date: '2026-06-30',
            is_deleted: false,
        });
        logger.info('Created sample project: Website Redesign');

        await membersTable.insertRow({ project_id: parseInt(project.ROWID), user_id: parseInt(user1.ROWID), role: 'Owner' });
        await membersTable.insertRow({ project_id: parseInt(project.ROWID), user_id: parseInt(user2.ROWID), role: 'Manager' });
        await membersTable.insertRow({ project_id: parseInt(project.ROWID), user_id: parseInt(user3.ROWID), role: 'Member' });
        logger.info('Added 3 members to project');

        var task1 = await tasksTable.insertRow({
            project_id: parseInt(project.ROWID), title: 'Design mockups', description: 'Create initial design mockups for homepage and key pages',
            status: 'Done', priority: 'High', assignee_id: parseInt(user2.ROWID), created_by_id: parseInt(user1.ROWID),
            start_date: '2026-01-05', end_date: '2026-01-20', progress: 100, depends_on: '', sort_order: 1, milestone: false, is_deleted: false,
        });
        var task2 = await tasksTable.insertRow({
            project_id: parseInt(project.ROWID), title: 'Frontend development', description: 'Implement React components based on approved designs',
            status: 'InProgress', priority: 'High', assignee_id: parseInt(user3.ROWID), created_by_id: parseInt(user1.ROWID),
            start_date: '2026-01-21', end_date: '2026-03-15', progress: 45, depends_on: String(task1.ROWID), sort_order: 2, milestone: false, is_deleted: false,
        });
        var task3 = await tasksTable.insertRow({
            project_id: parseInt(project.ROWID), title: 'Backend API', description: 'Build REST API endpoints for the new website',
            status: 'InProgress', priority: 'Medium', assignee_id: parseInt(user2.ROWID), created_by_id: parseInt(user1.ROWID),
            start_date: '2026-01-21', end_date: '2026-03-01', progress: 60, depends_on: '', sort_order: 3, milestone: false, is_deleted: false,
        });
        var task4 = await tasksTable.insertRow({
            project_id: parseInt(project.ROWID), title: 'QA Testing', description: 'Comprehensive testing of all features',
            status: 'Todo', priority: 'Medium', assignee_id: null, created_by_id: parseInt(user1.ROWID),
            start_date: '2026-03-16', end_date: '2026-04-15', progress: 0, depends_on: [task2.ROWID, task3.ROWID].join(','), sort_order: 4, milestone: false, is_deleted: false,
        });
        var task5 = await tasksTable.insertRow({
            project_id: parseInt(project.ROWID), title: 'Launch', description: 'Production deployment and launch',
            status: 'Todo', priority: 'Critical', assignee_id: parseInt(user1.ROWID), created_by_id: parseInt(user1.ROWID),
            start_date: '2026-04-16', end_date: '2026-04-16', progress: 0, depends_on: String(task4.ROWID), sort_order: 5, milestone: true, is_deleted: false,
        });
        logger.info('Created 5 sample tasks');

        await timeLogsTable.insertRow({ task_id: parseInt(task1.ROWID), user_id: parseInt(user2.ROWID), log_date: '2026-01-10', start_time: '09:00', end_time: '12:00', minutes: 180, notes: 'Initial mockup drafts' });
        await timeLogsTable.insertRow({ task_id: parseInt(task1.ROWID), user_id: parseInt(user2.ROWID), log_date: '2026-01-15', start_time: '10:00', end_time: '16:00', minutes: 360, notes: 'Finalized mockups after feedback' });
        await timeLogsTable.insertRow({ task_id: parseInt(task2.ROWID), user_id: parseInt(user3.ROWID), log_date: '2026-01-25', start_time: '', end_time: '', minutes: 240, notes: 'Component scaffolding' });
        await timeLogsTable.insertRow({ task_id: parseInt(task3.ROWID), user_id: parseInt(user2.ROWID), log_date: '2026-01-28', start_time: '09:00', end_time: '17:00', minutes: 480, notes: 'Auth and project endpoints' });
        logger.info('Created 4 sample time logs');

        return res.status(201).send({
            message: 'Seed data created successfully',
            data: { users: 3, projects: 1, members: 3, tasks: 5, timeLogs: 4 },
        });
    } catch (error) {
        logger.error('Seed data error:', error.message);
        return res.status(500).send({ error: error.message });
    }
};