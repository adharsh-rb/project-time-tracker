'use strict';
const { sanitizeString } = require('./sanitize');
const { toBool } = require('./helpers');
const logger = require('./logger');

async function getCurrentUser(req, app) {
    const userManagement = app.userManagement();
    const zcql = app.zcql();
    const datastore = app.datastore();

    let zohoUser;
    try { zohoUser = await userManagement.getCurrentUser(); }
    catch (error) { const err = new Error('Authentication required.'); err.statusCode = 401; throw err; }

    if (!zohoUser || !zohoUser.email_id) { const err = new Error('Unable to identify user.'); err.statusCode = 401; throw err; }

    const email = zohoUser.email_id.toLowerCase();
    const name = zohoUser.first_name ? (zohoUser.first_name + ' ' + (zohoUser.last_name || '')).trim() : email.split('@')[0];
    const safeEmail = sanitizeString(email);
    const lookupQuery = "SELECT ROWID, name, email, global_role, is_active FROM users WHERE email = '" + safeEmail + "'";
    const result = await zcql.executeZCQLQuery(lookupQuery);

    let appUser;
    if (result && result.length > 0) {
        appUser = result[0].users;
    } else {
        logger.info('New user login: ' + email);
        const usersTable = datastore.table('users');
        try {
            const newUser = await usersTable.insertRow({ name: name, email: email, global_role: 'Member', is_active: true });
            const verifyQuery = "SELECT ROWID, name, email, global_role, is_active FROM users WHERE email = '" + safeEmail + "' ORDER BY CREATEDTIME ASC";
            const allUsers = await zcql.executeZCQLQuery(verifyQuery);
            if (allUsers.length > 1) {
                for (var i = 1; i < allUsers.length; i++) {
                    try { await usersTable.deleteRow(allUsers[i].users.ROWID); } catch (e) { logger.error('Cleanup failed:', e.message); }
                }
                appUser = allUsers[0].users;
            } else {
                appUser = { ROWID: newUser.ROWID, name: name, email: email, global_role: 'Member', is_active: true };
            }
        } catch (insertError) {
            const retryResult = await zcql.executeZCQLQuery(lookupQuery);
            if (retryResult && retryResult.length > 0) appUser = retryResult[0].users;
            else throw insertError;
        }
    }

    if (toBool(appUser.is_active) === false) { const err = new Error('Account deactivated.'); err.statusCode = 403; throw err; }

    return { id: parseInt(appUser.ROWID), name: appUser.name, email: appUser.email, globalRole: appUser.global_role || 'Member', isActive: true };
}

module.exports = { getCurrentUser };