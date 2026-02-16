'use strict';
var catalyst = require('zcatalyst-sdk-node');
var urlModule = require('url');
var authMod = require('./auth');
var rateLimiterMod = require('./rateLimiter');
var logger = require('./logger');

var IS_PRODUCTION = process.env.CATALYST_ENV === 'production' || process.env.NODE_ENV === 'production';
var ALLOWED_ORIGINS = [process.env.ALLOWED_ORIGIN || '', 'http://localhost:3000'].filter(Boolean);

function parseBody(req) {
    if (!req.body) return {};
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body); } catch (e) { return {}; }
}

function matchRoute(method, urlParts, routes) {
    var dynamicMatch = null;
    var routeKeys = Object.keys(routes);
    for (var r = 0; r < routeKeys.length; r++) {
        var routeKey = routeKeys[r];
        var splitKey = routeKey.split(' ');
        var routeMethod = splitKey[0];
        var routePath = splitKey[1];
        if (routeMethod !== method) continue;
        var routeParts = routePath.split('/').filter(Boolean);
        if (routeParts.length !== urlParts.length) continue;
        var params = {};
        var isMatch = true;
        var isDynamic = false;
        for (var i = 0; i < routeParts.length; i++) {
            if (routeParts[i].charAt(0) === ':') { params[routeParts[i].substring(1)] = urlParts[i]; isDynamic = true; }
            else if (routeParts[i] !== urlParts[i]) { isMatch = false; break; }
        }
        if (isMatch) {
            if (!isDynamic) return { handler: routes[routeKey], params: params };
            if (!dynamicMatch) dynamicMatch = { handler: routes[routeKey], params: params };
        }
    }
    return dynamicMatch || { handler: null, params: {} };
}

function createHandler(routes) {
    return async function (req, res) {
        var startTime = Date.now();
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        var origin = (req.headers && req.headers.origin) || '';
        if (ALLOWED_ORIGINS.indexOf(origin) >= 0) res.setHeader('Access-Control-Allow-Origin', origin);
        else if (ALLOWED_ORIGINS.length > 0) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') return res.status(204).send('');

        try {
            var app = catalyst.initialize(req);
            var user = await authMod.getCurrentUser(req, app);
            rateLimiterMod.rateLimit(user.id);
            var rawUrl = req.url || '/';
            var parsedUrl = urlModule.parse(rawUrl, true);
            var rawPath = (parsedUrl.pathname || '/').replace(/\/+/g, '/');
            var pathParts = rawPath.split('/').filter(Boolean);
            var urlParts = pathParts;
            var matched = matchRoute(req.method, urlParts, routes);
            if (!matched.handler && urlParts.length > 0) matched = matchRoute(req.method, urlParts.slice(1), routes);
            if (!matched.handler && urlParts.length <= 1) matched = matchRoute(req.method, [], routes);
            if (!matched.handler) return res.status(404).send({ error: 'Route not found' });
            logger.info(req.method + ' ' + rawUrl + ' user: ' + user.email);
            var context = { app: app, user: user, params: matched.params, query: parsedUrl.query || {}, body: parseBody(req) };
            var result = await matched.handler(context);
            logger.info(req.method + ' ' + rawUrl + ' ' + (result.statusCode || 200) + ' ' + (Date.now() - startTime) + 'ms');
            return res.status(result.statusCode || 200).send(result.data || result);
        } catch (error) {
            var statusCode = error.statusCode || 500;
            logger.error(req.method + ' ' + req.url + ' ' + statusCode + ' ' + error.message);
            var resp = { error: error.message };
            if (!IS_PRODUCTION) resp.stack = error.stack;
            return res.status(statusCode).send(resp);
        }
    };
}

module.exports = { createHandler: createHandler, matchRoute: matchRoute };