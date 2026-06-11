'use strict';
// Optional local-first embeddings client for semantic recall. Talks to an OpenAI-compatible
// /v1/embeddings endpoint (Ollama, LM Studio, llama.cpp, vLLM, ...) set via URFAEL_EMBED_URL +
// URFAEL_EMBED_MODEL (+ optional URFAEL_EMBED_KEY). FAIL-SOFT by contract: any error returns null and
// recall degrades to pure BM25. No new deps (built-in http/https only); never throws.
const http = require('http');
const https = require('https');
const { URL } = require('url');

function enabled() { return !!process.env.URFAEL_EMBED_URL; }

function post(urlStr, body, timeoutMs) {
  return new Promise((resolve) => {
    let u; try { u = new URL(urlStr); } catch { return resolve(null); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve(null);
    const lib = u.protocol === 'https:' ? https : http;
    let data; try { data = Buffer.from(JSON.stringify(body)); } catch { return resolve(null); }
    const headers = { 'Content-Type': 'application/json', 'Content-Length': data.length };
    if (process.env.URFAEL_EMBED_KEY) headers.Authorization = 'Bearer ' + process.env.URFAEL_EMBED_KEY;
    let req;
    try {
      req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: (u.pathname || '/') + (u.search || ''), method: 'POST', headers, timeout: timeoutMs || 25000 }, (res) => {
        let out = '';
        res.on('data', (d) => { out += d; if (out.length > 64 * 1024 * 1024) req.destroy(); }); // cap response
        res.on('end', () => { try { resolve(res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(out) : null); } catch { resolve(null); } });
      });
    } catch { return resolve(null); }
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.end(data);
  });
}

// embed(texts) -> number[][] | null (one vector per input, order-preserved; null on ANY failure so the
// caller falls back to BM25). Accepts the OpenAI shape ({data:[{embedding}]}) and the Ollama/native
// shapes ({embeddings:[...]} / {embedding:[...]}).
async function embed(texts) {
  if (!enabled() || !Array.isArray(texts) || !texts.length) return null;
  const model = process.env.URFAEL_EMBED_MODEL || 'nomic-embed-text';
  const input = texts.map((t) => String(t == null ? '' : t).slice(0, 8000)); // bound each input
  const j = await post(process.env.URFAEL_EMBED_URL, { model, input });
  if (!j || typeof j !== 'object') return null;
  let vecs = null;
  if (Array.isArray(j.data)) vecs = j.data.map((d) => d && d.embedding).filter(Array.isArray);
  else if (Array.isArray(j.embeddings)) vecs = j.embeddings;
  else if (Array.isArray(j.embedding)) vecs = [j.embedding];
  if (!Array.isArray(vecs) || vecs.length !== input.length) return null;
  if (!vecs.every((v) => Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && Number.isFinite(x)))) return null;
  return vecs;
}

module.exports = { enabled, embed };
