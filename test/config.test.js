'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('default site link points to the current SalvaMoney site', () => {
  const configPath = require.resolve('../src/config');
  const previousSiteUrl = process.env.SITE_URL;

  try {
    delete process.env.SITE_URL;
    delete require.cache[configPath];

    const { config } = require('../src/config');

    assert.equal(config.siteUrl, 'https://cdzaorib.github.io/Salvamoney-site/');
  } finally {
    if (previousSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = previousSiteUrl;
    }

    delete require.cache[configPath];
  }
});

test('weekly report scheduler is enabled by default and can be disabled without becoming mandatory', () => {
  const configPath = require.resolve('../src/config');
  const previousValue = process.env.WEEKLY_REPORT_SCHEDULER_ENABLED;

  try {
    delete process.env.WEEKLY_REPORT_SCHEDULER_ENABLED;
    delete require.cache[configPath];
    assert.equal(require('../src/config').config.weeklyReportSchedulerEnabled, true);

    process.env.WEEKLY_REPORT_SCHEDULER_ENABLED = 'false';
    delete require.cache[configPath];
    assert.equal(require('../src/config').config.weeklyReportSchedulerEnabled, false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.WEEKLY_REPORT_SCHEDULER_ENABLED;
    } else {
      process.env.WEEKLY_REPORT_SCHEDULER_ENABLED = previousValue;
    }

    delete require.cache[configPath];
  }
});

test('route tokens are mandatory by default and flexible only in explicit local or test environments', () => {
  const configPath = require.resolve('../src/config');
  const previousValue = process.env.NODE_ENV;

  try {
    delete process.env.NODE_ENV;
    delete require.cache[configPath];
    assert.equal(require('../src/config').config.requireRouteTokens, true);

    process.env.NODE_ENV = 'production';
    delete require.cache[configPath];
    assert.equal(require('../src/config').config.requireRouteTokens, true);

    process.env.NODE_ENV = 'test';
    delete require.cache[configPath];
    assert.equal(require('../src/config').config.requireRouteTokens, false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousValue;
    }

    delete require.cache[configPath];
  }
});
