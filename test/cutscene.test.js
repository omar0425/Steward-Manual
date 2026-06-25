'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCutsceneUser, paydownTriggersCutscene, pickCutsceneVideo, selectCutsceneVideo,
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
  // (Pass the pool explicitly so this doesn't depend on process env state.)
  assert.ok(DEFAULT_CUTSCENE_VIDEOS.includes(pickCutsceneVideo(Math.random, DEFAULT_CUTSCENE_VIDEOS)));
});

test('pickCutsceneVideo: empty pool → null', () => {
  assert.equal(pickCutsceneVideo(Math.random, []), null);
});

test('selectCutsceneVideo: same seed → same clip (stable across range requests)', () => {
  const pool = ['a', 'b', 'c'];
  // A fixed seed must always resolve to the same clip — this is what keeps every
  // range request in one playback pointed at the same file.
  assert.equal(selectCutsceneVideo(7, pool), selectCutsceneVideo(7, pool));
  assert.equal(selectCutsceneVideo(7, pool), pool[7 % 3]);
  assert.equal(selectCutsceneVideo(0, pool), 'a');
  assert.equal(selectCutsceneVideo(4, pool), pool[1]);
});

test('selectCutsceneVideo: non-numeric seed falls back to a pool member; empty → null', () => {
  const pool = ['a', 'b', 'c'];
  assert.ok(pool.includes(selectCutsceneVideo(undefined, pool)));
  assert.ok(pool.includes(selectCutsceneVideo('xyz', pool)));
  assert.equal(selectCutsceneVideo(7, []), null);
});
