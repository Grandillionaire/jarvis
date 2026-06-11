'use strict';
// Ranked recall — pure, dependency-free BM25 over the session archive. Replaces substring-grep so
// "what did we discuss about X" returns the MOST RELEVANT past turns first, not just any line that
// happens to contain the substring. No deps, no I/O here: callers pass in already-loaded entries.
//
// rank(entries, query, k=20) ranks each entry by BM25 (k1=1.5, b=0.75) over its (user + ' ' + the
// urfael reply with [SPOKEN] tags stripped). Returns the top-k entries, each with a numeric .score
// (descending); ties broken by recency (newer .t first). Empty corpus/query -> []. Robust by design.

const K1 = 1.5, B = 0.75;

// Mirror bridge-core.stripSpoken so an entry's text matches what the user actually sees, without
// importing it (recall.js stays standalone for the daemon and for the inline Console copy).
function stripSpoken(t) { return (t || '').replace(/\[\/?SPOKEN\]/gi, '').trim(); }

// lowercase alnum tokenizer (Unicode-aware): same shape on both sides so query and corpus align.
function tokenize(s) { return String(s == null ? '' : s).toLowerCase().match(/[a-z0-9]+/g) || []; }

// Text of one archived entry as ranked: the user turn plus the spoken-stripped reply.
function entryText(e) { return ((e && e.user) || '') + ' ' + stripSpoken(e && e.urfael); }

// BM25 over the corpus. Returns [{ i, score }] for docs with score > 0, descending (recency tiebreak),
// where i indexes `entries`. Factored out so both rank() and rankHybrid() share one implementation.
function bm25Scored(entries, query) {
  const qTerms = tokenize(query);
  if (!qTerms.length) return [];
  const N = entries.length;
  const docs = new Array(N);
  let totalLen = 0;
  const df = new Map();
  for (let i = 0; i < N; i++) {
    const toks = tokenize(entryText(entries[i]));
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    docs[i] = { tf, len: toks.length };
    totalLen += toks.length;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const avgdl = totalLen / N || 1;
  const qUniq = [...new Set(qTerms)]; // a repeated query word shouldn't double-count its idf
  const idf = new Map();
  for (const t of qUniq) { const n = df.get(t) || 0; idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5))); }
  const scored = [];
  for (let i = 0; i < N; i++) {
    const { tf, len } = docs[i];
    let score = 0;
    for (const t of qUniq) {
      const f = tf.get(t);
      if (!f) continue;
      const denom = f + K1 * (1 - B + B * (len / avgdl));
      score += idf.get(t) * (f * (K1 + 1)) / denom;
    }
    if (score > 0) scored.push({ i, score });
  }
  scored.sort((a, b) => (b.score - a.score) || (String((entries[b.i] && entries[b.i].t) || '') < String((entries[a.i] && entries[a.i].t) || '') ? -1 : 1));
  return scored;
}

// rank(entries, query, k=20) -> top-k entries (each gets a .score), BM25 descending, recency tiebreak.
function rank(entries, query, k = 20) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const scored = bm25Scored(entries, query);
  const clamped = Math.min(Math.max(parseInt(k, 10) || 0, 1), scored.length);
  const out = [];
  for (let i = 0; i < clamped; i++) { const e = entries[scored[i].i]; e.score = scored[i].score; out.push(e); }
  return out;
}

// cosine similarity of two equal-ish-length numeric vectors; 0 if either is degenerate. Pure.
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// rankHybrid(entries, query, opts) — fuse lexical BM25 with semantic (cosine) ranking via Reciprocal Rank
// Fusion (RRF: each list contributes 1/(K + rank)). opts: { k=20, queryVec=null, entryVecs=null } where
// entryVecs[i] aligns with entries[i] (a number[] embedding, or null/absent). With no queryVec/entryVecs
// (embedder off or failed) this is identical to BM25 rank() — pure, dependency-free, fail-soft.
const RRF_K = 60;
function rankHybrid(entries, query, opts = {}) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const k = Math.min(Math.max(parseInt(opts.k, 10) || 20, 1), entries.length);
  const fused = new Map(); // entry index -> fused RRF score
  bm25Scored(entries, query).forEach((d, r) => fused.set(d.i, (fused.get(d.i) || 0) + 1 / (RRF_K + r + 1)));
  const { queryVec, entryVecs } = opts;
  if (Array.isArray(queryVec) && queryVec.length && Array.isArray(entryVecs)) {
    const sims = [];
    for (let i = 0; i < entries.length; i++) { const v = entryVecs[i]; if (Array.isArray(v) && v.length) { const s = cosine(queryVec, v); if (s > 0) sims.push({ i, s }); } }
    sims.sort((a, b) => b.s - a.s);
    sims.forEach((d, r) => fused.set(d.i, (fused.get(d.i) || 0) + 1 / (RRF_K + r + 1)));
  }
  if (!fused.size) return [];
  const out = [...fused.entries()].map(([i, score]) => ({ i, score }));
  out.sort((a, b) => (b.score - a.score) || (String((entries[b.i] && entries[b.i].t) || '') < String((entries[a.i] && entries[a.i].t) || '') ? -1 : 1));
  const top = [];
  for (let i = 0; i < Math.min(k, out.length); i++) { const e = entries[out[i].i]; e.score = out[i].score; top.push(e); }
  return top;
}

module.exports = { rank, rankHybrid, cosine, tokenize, stripSpoken };
