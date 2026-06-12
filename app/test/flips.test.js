'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { toUsage } = require('../openai-api');
const { buildHeartbeatPrompt, budgetLimits, budgetState } = require('../lib');

// ---- usage guardrail (flip: usage-guardrail) ----------------------------------------------------------
test('budgetLimits: unset → dormant (fail-open); parses + clamps when set', () => {
  const off = budgetLimits({});
  assert.equal(off.active, false);
  assert.equal(off.windowH, 5); assert.equal(off.warnPct, 80); assert.equal(off.hard, false);
  const on = budgetLimits({ URFAEL_BUDGET_TURNS: '50', URFAEL_BUDGET_TOKENS: '1000000', URFAEL_BUDGET_WINDOW_H: '3', URFAEL_BUDGET_WARN_PCT: '90', URFAEL_BUDGET_HARD: '1' });
  assert.deepEqual([on.turns, on.tokens, on.windowH, on.warnPct, on.hard, on.active], [50, 1000000, 3, 90, true, true]);
  assert.equal(budgetLimits({ URFAEL_BUDGET_TURNS: '10', URFAEL_BUDGET_WARN_PCT: '999' }).warnPct, 100); // clamped
  assert.equal(budgetLimits({ URFAEL_BUDGET_TURNS: '0' }).turns, null);                                  // non-positive → ignored
});
test('budgetState: ok < warnPct ≤ warn < 100 ≤ over, for turns OR tokens (whichever binds first)', () => {
  const lim = budgetLimits({ URFAEL_BUDGET_TURNS: '100', URFAEL_BUDGET_TOKENS: '1000', URFAEL_BUDGET_WARN_PCT: '80' });
  assert.equal(budgetState({ turnsWin: 10, tokWin: 10 }, lim).level, 'ok');
  assert.equal(budgetState({ turnsWin: 85, tokWin: 0 }, lim).level, 'warn');   // turns hit warn
  assert.equal(budgetState({ turnsWin: 10, tokWin: 950 }, lim).level, 'warn'); // tokens hit warn
  assert.equal(budgetState({ turnsWin: 100, tokWin: 0 }, lim).level, 'over');  // turns over
  assert.equal(budgetState({ turnsWin: 0, tokWin: 1200 }, lim).level, 'over'); // tokens over
  assert.equal(budgetState({ turnsWin: 999, tokWin: 999 }, budgetLimits({})).level, 'ok'); // dormant → never blocks
});

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
