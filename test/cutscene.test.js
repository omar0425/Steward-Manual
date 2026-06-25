'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCutsceneUser, paydownTriggersCutscene, pickCutsceneVideo,
  BALANCE_DROP_TRIGGER, DEFAULT_CUTSCENE_VIDEOS,
} = require('../services/cutscene');

test('isCutsceneUser: matches the cutscene account case-insensitively, with trim', () => {
  assert.equal(isCutsceneUser('LoudFlipFlopz'), true);
  assert.equal(isCutsceneUser('loudflipflopz'), true);
  assert.equal(isCutsceneUser('  LoudFlipFlopz  '), true);
  assert.equal(isCutsceneUser('SomeoneElse'), false);
  assert.equal(isCutsceneUser(''), false);
  assert.equal(isCutsceneUser(null), false);
});

test('paydownTriggersCutscene: fires on a $500+ drop for the cutscene user', () => {
  assert.equal(BALANCE_DROP_TRIGGER, 500);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', 500), true);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', 1200), true);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', 500.01), true);
});

test('paydownTriggersCutscene: does NOT fire below $500 or on a debt increase', () => {
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', 499.99), false);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', 0), false);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', -800), false); // debt grew
});

test('paydownTriggersCutscene: never fires for other users, even on a big drop', () => {
  assert.equal(paydownTriggersCutscene('SomeoneElse', 5000), false);
  assert.equal(paydownTriggersCutscene(null, 5000), false);
});

test('paydownTriggersCutscene: tolerates bad amounts', () => {
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', NaN), false);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', undefined), false);
  assert.equal(paydownTriggersCutscene('LoudFlipFlopz', '750'), true); // numeric string ok
});

test('pickCutsceneVideo: returns a clip from the pool; rng selects deterministically', () => {
  const pool = ['a', 'b', 'c'];
  assert.equal(pickCutsceneVideo(() => 0, pool), 'a');
  assert.equal(pickCutsceneVideo(() => 0.5, pool), 'b');
  assert.equal(pickCutsceneVideo(() => 0.999, pool), 'c');
  // Default pool: whatever it returns must be one of the configured clips.
  assert.ok(DEFAULT_CUTSCENE_VIDEOS.includes(pickCutsceneVideo()));
});

test('pickCutsceneVideo: empty pool → null', () => {
  assert.equal(pickCutsceneVideo(Math.random, []), null);
});
