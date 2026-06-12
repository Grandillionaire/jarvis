'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ridx = require('../recall-index');
const recall = require('../recall');

// a small, varied corpus (the [SPOKEN] tag must be stripped identically on both paths)
const CORPUS = [
  { t: '2026-06-01T10:00:01', channel: 'local', user: 'how do I deploy the kubernetes cluster', urfael: '[SPOKEN]here[/SPOKEN] use kubectl apply and a rollout' },
  { t: '2026-06-01T10:00:02', channel: 'telegram', user: 'remind me about the dentist appointment', urfael: 'scheduled a reminder for the dentist' },
  { t: '2026-06-01T10:00:03', channel: 'local', user: 'what did we say about the database migration', urfael: 'we discussed a postgres migration and a rollback plan' },
  { t: '2026-06-01T10:00:04', channel: 'local', user: 'kubernetes ingress controller setup', urfael: 'install an ingress controller, then a kubernetes service' },
  { t: '2026-06-01T10:00:05', channel: 'discord', user: 'coffee order for the team', urfael: 'noted the coffee order' },
];

function buildIndex(entries) { const idx = ridx.create(); for (const e of entries) ridx.addDoc(idx, e); return idx; }
function userTexts(rows) { return rows.map((r) => r.user); }

test('index: query matches the legacy BM25 rank() order AND scores', () => {
  const idx = buildIndex(CORPUS);
  for (const q of ['kubernetes', 'kubernetes ingress', 'migration rollback', 'dentist']) {
    const viaIndex = ridx.entriesFor(idx, ridx.query(idx, q, 10));
    const viaScan = recall.rank(CORPUS.map((e) => ({ ...e })), q, 10); // rank() mutates .score, so pass copies
    assert.deepEqual(userTexts(viaIndex), userTexts(viaScan), 'order for: ' + q);
    for (let i = 0; i < viaIndex.length; i++) assert.ok(Math.abs(viaIndex[i].score - viaScan[i].score) < 1e-9, 'score parity for: ' + q);
  }
});

test('index: a term absent from the corpus returns nothing; empty query returns nothing', () => {
  const idx = buildIndex(CORPUS);
  assert.deepEqual(ridx.query(idx, 'nonexistentwordxyz', 10), []);
  assert.deepEqual(ridx.query(idx, '   ', 10), []);
  assert.deepEqual(ridx.query(ridx.create(), 'kubernetes', 10), []); // empty index
});

test('index: incremental addDoc is independent of how docs arrive (same result one-by-one or bulk)', () => {
  const a = buildIndex(CORPUS);
  const b = ridx.create();
  for (const e of [...CORPUS].reverse()) ridx.addDoc(b, e); // reversed insertion still indexes the same docs...
  // ...but docId order differs, so compare as SETS of matched user-texts for a query, not the array order
  const qa = new Set(userTexts(ridx.entriesFor(a, ridx.query(a, 'kubernetes', 10))));
  const qb = new Set(userTexts(ridx.entriesFor(b, ridx.query(b, 'kubernetes', 10))));
  assert.deepEqual([...qa].sort(), [...qb].sort());
});

test('index: serialize → deserialize roundtrips to identical query results; garbage → null', () => {
  const idx = buildIndex(CORPUS);
  const restored = ridx.deserialize(ridx.serialize(idx));
  assert.ok(restored, 'deserialize succeeded');
  assert.deepEqual(userTexts(ridx.entriesFor(restored, ridx.query(restored, 'kubernetes ingress', 10))),
                   userTexts(ridx.entriesFor(idx, ridx.query(idx, 'kubernetes ingress', 10))));
  for (const bad of ['', '{', 'null', JSON.stringify({ v: 999, docs: [] }), JSON.stringify({ docs: 'x' })]) assert.equal(ridx.deserialize(bad), null, JSON.stringify(bad));
});

test('index: equal-score ties break by RECENCY (newer docId first)', () => {
  const idx = ridx.create();
  ridx.addDoc(idx, { t: '2026-06-01T00:00:01', user: 'alpha token', urfael: '' }); // docId 0 (older)
  ridx.addDoc(idx, { t: '2026-06-01T00:00:02', user: 'alpha token', urfael: '' }); // docId 1 (newer) — identical text → equal score
  const rows = ridx.query(idx, 'alpha', 10);
  assert.equal(rows[0].d, 1, 'newer doc ranks first on a tie');
  assert.equal(rows[1].d, 0);
});

test('index: covers the WHOLE archive — an early/old doc stays searchable past any tail window', () => {
  const idx = ridx.create();
  ridx.addDoc(idx, { t: '2020-01-01T00:00:00', user: 'a very RAREWORD9 needle buried at the start', urfael: '' }); // the "old" doc
  for (let i = 0; i < 5000; i++) ridx.addDoc(idx, { t: '2026-06-01T00:00:00', user: 'routine filler turn number ' + i, urfael: 'ok' });
  const rows = ridx.entriesFor(idx, ridx.query(idx, 'rareword9', 5));
  assert.equal(rows.length, 1, 'the old needle is still found among 5001 docs');
  assert.match(rows[0].user, /needle buried at the start/);
});
