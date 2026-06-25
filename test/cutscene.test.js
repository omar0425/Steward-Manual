'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldFireCutscene, isCutsceneUser, CUTSCENE_EVERY } = require('../services/cutscene');

test('isCutsceneUser: matches the cutscene account case-insensitively, with trim', () => {
  assert.equal(isCutsceneUser('LoudFlipFlopz'), true);
  assert.equal(isCutsceneUser('loudflipflopz'), true);
  assert.equal(isCutsceneUser('  LoudFlipFlopz  '), true);
  assert.equal(isCutsceneUser('SomeoneElse'), false);
  assert.equal(isCutsceneUser(''), false);
  assert.equal(isCutsceneUser(null), false);
});

test('shouldFireCutscene: fires on exact multiples of 75 for the cutscene user', () => {
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 75), true);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 150), true);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 225), true);
  assert.equal(CUTSCENE_EVERY, 75);
});

test('shouldFireCutscene: does NOT fire on non-multiples', () => {
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 1), false);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 74), false);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 76), false);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 0), false);
});

test('shouldFireCutscene: never fires for other users, even on a multiple of 75', () => {
  assert.equal(shouldFireCutscene('SomeoneElse', 75), false);
  assert.equal(shouldFireCutscene('', 150), false);
  assert.equal(shouldFireCutscene(null, 75), false);
});

test('shouldFireCutscene: tolerates bad counts', () => {
  assert.equal(shouldFireCutscene('LoudFlipFlopz', '75'), true); // numeric string ok
  assert.equal(shouldFireCutscene('LoudFlipFlopz', 75.5), false);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', NaN), false);
  assert.equal(shouldFireCutscene('LoudFlipFlopz', undefined), false);
});
