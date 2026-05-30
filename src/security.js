'use strict';

const { timingSafeEqual } = require('node:crypto');

function tokenMatches(expected, provided) {
  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(String(expected));
  const providedBuffer = Buffer.from(String(provided));

  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}

function bearerToken(req) {
  const auth = String(req.get('authorization') || '');

  return auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function webhookRequestToken(req) {
  return String(
    req.get('x-webhook-token') ||
    bearerToken(req) ||
    req.query?.webhook_token ||
    req.query?.token ||
    ''
  );
}

function dashboardRequestToken(req) {
  return String(
    req.get('x-dashboard-token') ||
    bearerToken(req) ||
    req.query?.dashboard_token ||
    req.query?.token ||
    ''
  );
}

function routeAuthorized(expectedToken, providedToken, requireToken = false) {
  if (!expectedToken) {
    return !requireToken;
  }

  return tokenMatches(expectedToken, providedToken);
}

function dashboardAuthorized(req, dashboardToken, requireToken = false) {
  return routeAuthorized(dashboardToken, dashboardRequestToken(req), requireToken);
}

function webhookAuthorized(req, webhookToken, requireToken = false) {
  return routeAuthorized(webhookToken, webhookRequestToken(req), requireToken);
}

module.exports = {
  dashboardAuthorized,
  routeAuthorized,
  tokenMatches,
  webhookAuthorized,
  webhookRequestToken,
};
