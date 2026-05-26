'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { File } = require('node:buffer');

test('groq provider polyfills global File before using SDK file uploads', () => {
  const providerPath = require.resolve('../src/providers/groq');
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'File');

  delete require.cache[providerPath];
  delete globalThis.File;

  try {
    assert.equal(globalThis.File, undefined);

    const { createGroqClient } = require('../src/providers/groq');

    assert.equal(typeof createGroqClient, 'function');
    assert.equal(globalThis.File, File);
  } finally {
    delete require.cache[providerPath];

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'File', originalDescriptor);
    } else {
      delete globalThis.File;
    }
  }
});
