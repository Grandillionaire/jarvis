'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyModel, segmentSentences, MODELS } = require('../lib');

test('routing: code/dev → Opus', () => {
  for (const q of ['debug this python function', 'refactor the auth module', 'push my code to the repo', 'architect a caching layer'])
    assert.equal(classifyModel(q), MODELS.opus, q);
});

test('routing: chat/admin/writing → Sonnet', () => {
  for (const q of ['hey what is up', "what's on my calendar", 'draft an email to Alex', 'add a meeting tomorrow at 3pm'])
    assert.equal(classifyModel(q), MODELS.sonnet, q);
});

test('routing: "report" must not trip "repo"', () => {
  assert.equal(classifyModel('write a report on Q2'), MODELS.sonnet);
});

test('segment: emits only complete sentences, keeps remainder', () => {
  const { sentences, rest } = segmentSentences('Hello there. How are you', false);
  assert.deepEqual(sentences, ['Hello there.']);
  assert.equal(rest, 'How are you');
});

test('segment: no premature break under the clause threshold', () => {
  const { sentences } = segmentSentences('a short clause with no terminator yet', false);
  assert.deepEqual(sentences, []);
});

test('segment: force flushes the trailing remainder', () => {
  const { sentences, rest } = segmentSentences('the final trailing bit', true);
  assert.deepEqual(sentences, ['the final trailing bit']);
  assert.equal(rest, '');
});

test('segment: multiple sentences in one buffer', () => {
  const { sentences } = segmentSentences('One. Two! Three? ', false);
  assert.deepEqual(sentences, ['One.', 'Two!', 'Three?']);
});
