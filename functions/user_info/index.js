'use strict';
var handler = require('./utils/handler');

module.exports = handler.createHandler({
    'GET /': getUserInfo,
});

async function getUserInfo(ctx) {
    return {
        statusCode: 200,
        data: {
            id: ctx.user.id,
            name: ctx.user.name,
            email: ctx.user.email,
            globalRole: ctx.user.globalRole,
        },
    };
}