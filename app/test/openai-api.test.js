'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
// Requiring the module is side-effect-free now (the server bootstrap is behind require.main === module).
const api = require('../openai-api');

// ---- stripSpoken: the spoken aside must NEVER reach an OpenAI client (it wants the written answer) ----
test('stripSpoken removes complete, unterminated, and bare [SPOKEN] markers', () => {
  assert.equal(api.stripSpoken('Answer.[SPOKEN]aside[/SPOKEN] more'), 'Answer. more');
  assert.equal(api.stripSpoken('Answer.[SPOKEN]an open aside with no close'), 'Answer.'); // unterminated -> dropped
  assert.equal(api.stripSpoken('a [/SPOKEN] b [SPOKEN] c'), 'a  b'); // bare partners stripped, trimmed
  assert.equal(api.stripSpoken('plain text, no tags'), 'plain text, no tags');
  assert.equal(api.stripSpoken(null), '');
});

// ---- safeRawPrefix + stripSpoken: the INCREMENTAL streaming path (the trickiest, previously-uncovered code).
// Feed the answer one character at a time; at EVERY prefix the emitted text must never leak the aside or a raw tag.
test('streaming: a [SPOKEN] aside never leaks at ANY character of the stream', () => {
  const full = 'Here is the answer.[SPOKEN]On it, sir.[/SPOKEN] More text after.';
  for (let n = 1; n <= full.length; n++) {
    const acc = full.slice(0, n);
    const shown = api.stripSpoken(api.safeRawPrefix(acc));
    assert.ok(!/on it, sir/i.test(shown), 'aside text leaked at n=' + n + ': ' + JSON.stringify(shown));
    assert.ok(!/\[spoken\]/i.test(shown), 'a raw [SPOKEN] tag leaked at n=' + n + ': ' + JSON.stringify(shown));
    assert.ok(!/\[\/spoken\]/i.test(shown), 'a raw [/SPOKEN] tag leaked at n=' + n + ': ' + JSON.stringify(shown));
  }
  assert.equal(api.stripSpoken(full), 'Here is the answer. More text after.'); // final written answer, aside gone
});

test('streaming: holds a trailing partial tag fragment so a tag can never half-emit', () => {
  // each of these is a prefix that is mid-way through forming a tag; the safe prefix must drop the fragment.
  for (const frag of ['answer[', 'answer[/', 'answer[sp', 'answer[SPOK', 'answer[/SPOKE']) {
    assert.equal(api.safeRawPrefix(frag), 'answer', 'must hold the partial tag in ' + JSON.stringify(frag));
  }
  // a COMPLETE marker must NOT be cut here (stripSpoken handles it) — otherwise the partner would orphan + unmask.
  assert.ok(api.safeRawPrefix('a[SPOKEN]b[/SPOKEN]').includes('[/SPOKEN]'));
});

test('streaming: an aside that is still OPEN at end-of-stream is fully held back', () => {
  const acc = 'The result is ready.[SPOKEN]Reading your calendar';
  assert.equal(api.stripSpoken(api.safeRawPrefix(acc)), 'The result is ready.');
});

// ---- buildPrompt / flattenContent: collapse an OpenAI messages[] into one prompt ----
test('flattenContent handles a string and an array of text parts; ignores non-text', () => {
  assert.equal(api.flattenContent('hello'), 'hello');
  const f = api.flattenContent([{ type: 'text', text: 'apple' }, { type: 'image_url', image_url: {} }, { type: 'text', text: 'banana' }]);
  assert.ok(f.includes('apple') && f.includes('banana'), 'both text parts kept');
  assert.ok(!/image_url/.test(f), 'non-text parts dropped');
});

test('buildPrompt prepends system messages, renders prior turns, and caps length', () => {
  const p = api.buildPrompt([
    { role: 'system', content: 'You are terse.' },
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'second question' },
  ]);
  assert.ok(p.includes('You are terse.'));
  assert.ok(/User:[\s\S]*first question/.test(p) || p.includes('first question'));
  assert.ok(p.includes('second question'));
  assert.ok(p.includes('first answer'));
  // a huge history is bounded (no throw, finite string)
  const big = api.buildPrompt(Array.from({ length: 5000 }, (_, i) => ({ role: 'user', content: 'x'.repeat(50) + i })));
  assert.ok(typeof big === 'string' && big.length <= 24000 + 4000);
});
