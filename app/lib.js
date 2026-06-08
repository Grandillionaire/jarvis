'use strict';
// Pure, unit-testable logic shared by main.js and the test suite.
// (Extracted so the race-prone bits — routing + sentence segmentation — are actually covered.)

const MODELS = { sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-7' };

// Pick the model tier for an utterance: Opus 4.7 for hard work (code, deep reasoning,
// architecture, analysis); Sonnet 4.6 for everything else — it still reasons. No Haiku.
function classifyModel(text) {
  const t = (text || '').toLowerCase();
  if (/\b(code|coding|program|function|debug|bug|refactor|repos?\b|git|api|python|javascript|typescript|rust|golang|sql|regex|compile|deploy|terminal|stack ?trace|build|script|class|architect|algorithm|optimi[sz]e|figure out|think through|reason|trade.?off|complex|in.?depth|step.?by.?step|analy[sz]e|hard problem)\b/.test(t)) return MODELS.opus;
  return MODELS.sonnet;
}

// Pull complete sentences from a streaming buffer for incremental TTS.
// Returns { sentences: string[], rest: string }. `force` flushes the remainder at end-of-turn.
function segmentSentences(buf, force) {
  let s = buf;
  const sentences = [];
  const re = /^([\s\S]*?[.!?…]+)(\s|$)/;
  let m;
  while ((m = re.exec(s))) { const x = m[1].trim(); if (x) sentences.push(x); s = s.slice(m[0].length); }
  if (!force && s.length > 170) { const i = s.lastIndexOf(' '); if (i > 60) { sentences.push(s.slice(0, i).trim()); s = s.slice(i + 1); } }
  if (force && s.trim()) { sentences.push(s.trim()); s = ''; }
  return { sentences, rest: s };
}

module.exports = { MODELS, classifyModel, segmentSentences };
