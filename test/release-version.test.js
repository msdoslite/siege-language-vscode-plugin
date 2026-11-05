'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextVersion } = require('../scripts/next-release-version');
test('Public releases start at 1.0.0, ignoring old development tags', () => {
  assert.equal(nextVersion([]), '1.0.0');
  assert.equal(nextVersion(['v0.1.8', 'unrelated', 'v1.0.0-beta']), '1.0.0');
});
test('Minor releases increment numerically through 1.9, 1.10 and 1.11', () => {
  assert.equal(nextVersion(['v1.0.0']), '1.1.0');
  assert.equal(nextVersion(['v1.9.0', 'v1.2.0']), '1.10.0');
  assert.equal(nextVersion(['v1.9.0', 'v1.10.0', 'v1.1.0']), '1.11.0');
  assert.equal(nextVersion(['v1.11.0', 'v1.10.0']), '1.12.0');
});
