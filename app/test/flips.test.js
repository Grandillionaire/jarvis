'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { toUsage } = require('../openai-api');
const { buildHeartbeatPrompt } = require('../lib');

// ---- OpenAI usage propagation (flip: openai-usage) ----------------------------------------------------
test('toUsage: maps daemon tokens to the OpenAI shape (cached reads count as input)', () => {
  assert.deepEqual(toUsage({ input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 25 }),
    { prompt_tokens: 125, completion_tokens: 40, total_tokens: 165 });
  assert.deepEqual(toUsage({ input_tokens: 10, output_tokens: 5 }),
    { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
});
test('toUsage: null / missing usage → all zeros (never NaN, never undefined)', () => {
  for (const u of [null, undefined, {}, { output_tokens: 7 }]) {
    const r = toUsage(u);
    assert.ok(Number.isFinite(r.prompt_tokens) && Number.isFinite(r.completion_tokens) && Number.isFinite(r.total_tokens), JSON.stringify(u));
    assert.equal(r.total_tokens, r.prompt_tokens + r.completion_tokens);
  }
  assert.deepEqual(toUsage(null), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});

// ---- heartbeat predictive (flip: heartbeat-predictive) ------------------------------------------------
test('heartbeat: default prompt is byte-identical to legacy (zero regression) and has NO predictive clause', () => {
  const base = buildHeartbeatPrompt();
  assert.equal(buildHeartbeatPrompt({ predictive: false }), base);
  assert.ok(base.includes('HEARTBEAT_OK'));
  assert.ok(!/Open threads \/ likely next/.test(base));
});
test('heartbeat: predictive prompt adds the surface-only "likely next" clause (never acts)', () => {
  const p = buildHeartbeatPrompt({ predictive: true });
  assert.ok(p.startsWith(buildHeartbeatPrompt()));                 // strict superset of the base
  assert.ok(/Open threads \/ likely next/.test(p) && /PREPARE/.test(p));
  assert.ok(/Do NOT send, write, schedule, or act/.test(p));       // surface-only guarantee
});
