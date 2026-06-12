'use strict';
// Persistent inverted index for recall AT SCALE — the FTS5-equivalent, in pure dependency-free JS.
//
// The old path (recall.rank over loadSessions) re-tokenized the loaded corpus on EVERY query and only ever
// loaded the most recent RECALL_MAX_LINES, so history beyond the cap became unsearchable as the archive grew.
// This module is a BM25 inverted index that is built ONCE, kept warm in the daemon, persisted to disk, and
// caught up INCREMENTALLY (only new turns are tokenized). A query then costs O(sum of postings for the query
// terms) — it never rescans the corpus — and it covers the WHOLE archive, not a tail window.
//
// Pure + serializable: no fs/I/O here (the daemon owns reads/writes and the per-file byte watermark), so the
// whole thing is unit-testable. Fail-soft is the daemon's job: if this index is unavailable it falls back to
// the legacy scan, so recall never breaks.

const { tokenize, stripSpoken } = require('./recall');

const K1 = 1.5, B = 0.75;            // same BM25 params as recall.js, so ranking is consistent across both paths
const VERSION = 1;

function entryText(e) { return ((e && e.user) || '') + ' ' + stripSpoken(e && e.urfael); }

// An empty index. `post[term]` is a FLAT array [docId, tf, docId, tf, …] (compact in memory + JSON). `files`
// is the incremental watermark: bytes of each session file already ingested. `docs[d]` holds the display
// fields + token length; docId is the append order, so a higher docId is strictly newer (recency tiebreak).
function create() { return { v: VERSION, docs: [], post: Object.create(null), df: Object.create(null), totalLen: 0, files: Object.create(null) }; }

// Add one archived entry. Tokenizes once; updates postings, df, and totalLen. O(tokens in the entry).
function addDoc(idx, entry) {
  const toks = tokenize(entryText(entry));
  const d = idx.docs.length;
  idx.docs.push({ t: entry && entry.t, channel: (entry && entry.channel) || '', user: (entry && entry.user) || '', urfael: (entry && entry.urfael) || '', len: toks.length });
  idx.totalLen += toks.length;
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  for (const [t, f] of tf) {
    let p = idx.post[t];
    if (!p) { p = idx.post[t] = []; idx.df[t] = 0; }
    p.push(d, f);
    idx.df[t] = (idx.df[t] || 0) + 1;
  }
}

// BM25 query via postings. Returns the top-k docIds with scores (descending; recency tiebreak), WITHOUT
// touching docs that don't contain a query term. Empty query / empty index → [].
function query(idx, q, k = 20) {
  if (!idx || !idx.docs || !idx.docs.length) return [];
  const qTerms = [...new Set(tokenize(q))];
  if (!qTerms.length) return [];
  const N = idx.docs.length;
  const avgdl = idx.totalLen / N || 1;
  const scores = new Map();                                   // docId -> accumulated BM25 score
  for (const t of qTerms) {
    const n = idx.df[t] || 0;
    if (!n) continue;
    const post = idx.post[t];
    if (!post) continue;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (let j = 0; j < post.length; j += 2) {
      const d = post[j], f = post[j + 1];
      const doc = idx.docs[d];
      if (!doc) continue;
      const denom = f + K1 * (1 - B + B * (doc.len / avgdl));
      scores.set(d, (scores.get(d) || 0) + idf * (f * (K1 + 1)) / denom);
    }
  }
  if (!scores.size) return [];
  const out = [...scores.entries()].map(([d, score]) => ({ d, score }));
  out.sort((a, b) => (b.score - a.score) || (b.d - a.d));     // higher docId = newer → recency tiebreak
  const clamped = Math.min(Math.max(parseInt(k, 10) || 20, 1), out.length);
  return out.slice(0, clamped);
}

// Map query() results back to the stored display entries (so callers get {t,channel,user,urfael,score}).
function entriesFor(idx, scored) {
  const res = [];
  for (const s of scored) { const doc = idx.docs[s.d]; if (doc) res.push({ t: doc.t, channel: doc.channel, user: doc.user, urfael: doc.urfael, score: s.score }); }
  return res;
}

// Serialize / deserialize for on-disk persistence (so a daemon restart loads the index instead of rebuilding).
// deserialize is defensive: any shape mismatch → null, and the daemon rebuilds from scratch (fail-soft).
function serialize(idx) { return JSON.stringify({ v: VERSION, docs: idx.docs, post: idx.post, df: idx.df, totalLen: idx.totalLen, files: idx.files }); }
function deserialize(str) {
  let o; try { o = JSON.parse(str); } catch { return null; }
  if (!o || o.v !== VERSION || !Array.isArray(o.docs) || typeof o.post !== 'object' || typeof o.df !== 'object') return null;
  return { v: VERSION, docs: o.docs, post: o.post || Object.create(null), df: o.df || Object.create(null), totalLen: Number(o.totalLen) || 0, files: o.files || Object.create(null) };
}

module.exports = { create, addDoc, query, entriesFor, serialize, deserialize, entryText, VERSION };
