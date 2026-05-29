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
