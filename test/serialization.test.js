'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseJsonArray,
  parseJsonObject,
} = require('../services/serialization');

test('JSON config readers accept only their expected container shape', () => {
  assert.deepEqual(parseJsonArray('[1,2]'), [1, 2]);
  assert.deepEqual(parseJsonArray('{"a":1}'), []);
  assert.deepEqual(parseJsonArray('bad'), []);
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('[1,2]'), {});
  assert.deepEqual(parseJsonObject(null), {});
});
