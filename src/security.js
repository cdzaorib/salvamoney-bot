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

function dashboardAuthorized(req, dashboardToken) {
  return !dashboardToken || tokenMatches(dashboardToken, dashboardRequestToken(req));
}

module.exports = {
  dashboardAuthorized,
  tokenMatches,
  webhookRequestToken,
};
