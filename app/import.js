'use strict';
// Migration importer — pull memory + skills from an existing OpenClaw or Hermes install into Urfael.
// Hermes ships `claw migrate` to import OpenClaw; Urfael imports BOTH. A foreign install is UNTRUSTED:
// its skill markdown is fed to the brain and can tell it to run commands, so every skill goes through
// skillhub.scan() and anything that trips DANGER is SKIPPED. We MERGE memory under a clearly-marked,
// dated '## Imported from <source>' section (never clobber existing notes — append). DRY-RUN by default;
// only --apply writes. Pure, path-validated (never write outside the memory/skills dirs), and we NEVER
// execute anything we import. Built-in fs/os/path only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const hub = require('./skillhub');

const HOME = os.homedir();
const MEMORY_DIR = path.join(HOME, process.env.URFAEL_MEMORY_DIR || 'Urfael-memory');
const VAULT = path.join(HOME, process.env.URFAEL_VAULT_DIR || 'Urfael');
const SKILLS_DIR = path.join(VAULT, '_urfael', 'skills');
const MAX_MD = 256 * 1024; // a memory/skill md is text; cap hard so a hostile file can't flood us

const gold = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// The two source layouts we understand. `memoryFiles` map source basenames -> the Urfael memory file
// they merge into; `skillsDir` is the relative folder of *.md skill files. `signature` is the file/dir
// that UNIQUELY identifies the layout (OpenClaw's `memory/` vs Hermes' `memories/`/`USER.md`); `probes`
// are weaker shared markers used only as a last resort. Auto-detect prefers a signature match so a tree
// is never misread as the wrong source. Paths are joined onto the root and never trusted as absolute.
const SOURCES = {
  openclaw: {
    label: 'OpenClaw',
    root: () => path.join(HOME, '.openclaw', 'workspace'),
    signature: ['memory'], // OpenClaw keeps loose notes in memory/ (Hermes uses memories/)
    probes: ['MEMORY.md', 'SOUL.md', 'skills'],
    memoryFiles: { 'MEMORY.md': 'MEMORY.md', 'SOUL.md': 'USER.md' },
    memoryDirs: ['memory'], // extra loose *.md notes folded into MEMORY.md
    skillsDir: 'skills',
  },
  hermes: {
    label: 'Hermes',
    root: () => path.join(HOME, '.hermes'),
    signature: ['memories', 'USER.md'], // memories/ or USER.md are Hermes-only
    probes: ['MEMORY.md', 'SOUL.md', 'skills'],
    memoryFiles: { 'MEMORY.md': 'MEMORY.md', 'USER.md': 'USER.md', 'SOUL.md': 'USER.md' },
    memoryDirs: ['memories'],
    skillsDir: 'skills',
  },
};

// ---- pure helpers -----------------------------------------------------------

// Does a marker (file or dir) from `markers` exist under `root`? Pure (only stats existence).
function hasAny(root, markers) {
  if (!root || !markers) return false;
  for (const p of markers) {
    try { if (fs.existsSync(path.join(root, p))) return true; } catch {}
  }
  return false;
}

// Does this directory look like the given source? True if any signature OR probe marker is present.
// Pure (only stats existence); never reads or executes anything.
function looksLike(root, src) {
  if (!root || !src) return false;
  return hasAny(root, src.signature) || hasAny(root, src.probes);
}

// Auto-detect the source kind from an explicit root, or by probing each known default location.
// Returns { kind, root, src } or null. An explicit `from` pins the layout but the root must still match.
// Auto-detect (no --from) prefers a UNIQUE signature match before falling back to shared probes so a
// tree carrying both is never misread (e.g. Hermes' memories/ wins over the shared MEMORY.md/SOUL.md).
function detectSource(opts = {}) {
  const from = opts.from ? String(opts.from).toLowerCase() : '';
  if (from && !SOURCES[from]) return null; // unknown --from is a hard error, not a guess
  const want = from ? [from] : Object.keys(SOURCES);
  const rootFor = (src) => (opts.path ? path.resolve(String(opts.path)) : src.root());
  if (from) { // pinned: the named layout must still match its root
    const src = SOURCES[from], root = rootFor(src);
    return looksLike(root, src) ? { kind: from, root, src } : null;
  }
  // pass 1: a unique signature is decisive; pass 2: fall back to any shared probe
  for (const kind of want) { const src = SOURCES[kind], root = rootFor(src); if (hasAny(root, src.signature)) return { kind, root, src }; }
  for (const kind of want) { const src = SOURCES[kind], root = rootFor(src); if (hasAny(root, src.probes)) return { kind, root, src }; }
  return null;
}

// Resolve a child path under `root` and REFUSE if it escapes (symlink/.. traversal). Returns the
// absolute path or null. The single chokepoint for every read off an untrusted source tree.
function safeJoin(root, rel) {
  const base = path.resolve(root);
  let p = path.resolve(base, String(rel || ''));
  // Resolve symlinks too — path.resolve only collapses '..' lexically; a symlink inside the source could
  // otherwise point the realpath outside `base`. realpath the deepest existing ancestor and re-check.
  try { p = fs.realpathSync.native(p); } catch { try { p = fs.realpathSync.native(path.dirname(p)) + path.sep + path.basename(p); } catch {} }
  const rbase = (() => { try { return fs.realpathSync.native(base); } catch { return base; } })();
  if (p !== rbase && !p.startsWith(rbase + path.sep)) return null;
  return p;
}

// Read a text file with a hard size cap; '' if missing/oversize/binary-ish. Never throws.
function readCapped(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_MD) return '';
    return fs.readFileSync(p, 'utf8');
  } catch { return ''; }
}

// Build the dated, clearly-marked import block appended to a memory file. Idempotent shape so a
// re-import is visible as a distinct section, never silently merged into the user's own headings.
function importHeader(label, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return '\n\n## Imported from ' + label + ' (' + date + ')\n';
}

// Merge `incoming` text into `existing` under a fresh '## Imported from <label>' section. Pure string
// work: NEVER clobbers — returns existing + a new appended section. Returns existing unchanged if
// there's nothing to add. This is the function the appends-not-clobbers test locks down.
function mergeMemory(existing, incoming, label, now = new Date()) {
  const cur = String(existing || '');
  const add = String(incoming || '').replace(/\s+$/, '');
  if (!add.trim()) return cur;
  const block = importHeader(label, now) + add + '\n';
  // never drop the user's content: the result always STARTS with the full existing text
  return (cur.endsWith('\n') || !cur ? cur.replace(/\n+$/, '') : cur) + block;
}

// Validate a skill slug derived from a foreign filename. Returns a clean [a-z0-9-] slug or '' (refuse).
// Reuses skillhub.slugify so the on-disk filename rules are identical to the hub's.
function skillSlug(name) {
  const slug = hub.slugify(name);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return '';
  return slug;
}

// Resolve the destination path for a skill slug and PROVE it lands directly inside skillsDir. Returns
// the absolute path or null. Belt-and-suspenders against a slug that somehow smuggles a separator.
function skillDest(slug, skillsDir) {
  if (!/^[a-z0-9-]+$/.test(String(slug))) return null;
  const dest = path.join(skillsDir, slug + '.md');
  if (path.dirname(path.resolve(dest)) !== path.resolve(skillsDir)) return null;
  return dest;
}

// Scan one foreign skill body and decide its fate. Pure (no fs, no exec). Returns
// { verdict:'import'|'skip'|'overwrite', danger, flags } — 'skip' when DANGER trips (untrusted!).
function judgeSkill(body, opts = {}) {
  const { flags } = hub.scan(String(body || ''));
  const danger = flags.some((f) => f.level === 'danger');
  let verdict;
  if (danger) verdict = 'skip';                              // DANGER (malware) is UNCONDITIONAL — --force never imports a flagged skill
  else if (opts.exists && !opts.force) verdict = 'overwrite'; // a name collision needs --force; flagged, not silent
  else verdict = 'import';
  return { verdict, danger, flags };
}

// ---- the runner -------------------------------------------------------------

// Gather every memory file the source maps into Urfael memory, returning
// [{ destFile, label, text }] where destFile is the Urfael memory basename (MEMORY.md / USER.md).
function collectMemory(root, src) {
  const buckets = {}; // destFile -> [chunk, ...]
  const push = (dest, header, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    (buckets[dest] = buckets[dest] || []).push((header ? '### ' + header + '\n' : '') + t);
  };
  for (const [name, dest] of Object.entries(src.memoryFiles)) {
    const p = safeJoin(root, name);
    if (p) push(dest, name === 'MEMORY.md' || name === 'USER.md' ? '' : name.replace(/\.md$/i, ''), readCapped(p));
  }
  for (const dir of src.memoryDirs || []) {
    const dp = safeJoin(root, dir);
    let files = [];
    try { files = fs.readdirSync(dp).filter((f) => f.toLowerCase().endsWith('.md')).sort(); } catch { continue; }
    for (const f of files) {
      const fp = safeJoin(dp, f);
      if (fp) push('MEMORY.md', f.replace(/\.md$/i, ''), readCapped(fp));
    }
  }
  return Object.entries(buckets).map(([destFile, chunks]) => ({ destFile, text: chunks.join('\n\n') }));
}

// Gather every skill the source ships, scanned and judged. Returns [{ srcFile, slug, name, verdict,
// danger, flags, body }]. Reads only inside src.skillsDir; skips anything with an unusable slug.
function collectSkills(root, src, skillsDir, opts = {}) {
  const sp = safeJoin(root, src.skillsDir);
  let files = [];
  try { files = fs.readdirSync(sp).filter((f) => f.toLowerCase().endsWith('.md')).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const fp = safeJoin(sp, f);
    if (!fp) continue;
    const body = readCapped(fp);
    if (!body.trim()) continue;
    const m = hub.meta(body, f.replace(/\.md$/i, ''));
    const slug = skillSlug(m.name) || skillSlug(f.replace(/\.md$/i, ''));
    if (!slug) { out.push({ srcFile: f, slug: '', name: m.name, verdict: 'skip', reason: 'no safe slug', danger: false, flags: [], body }); continue; }
    const dest = skillDest(slug, skillsDir);
    if (!dest) { out.push({ srcFile: f, slug, name: m.name, verdict: 'skip', reason: 'path escape', danger: false, flags: [], body }); continue; }
    const exists = fs.existsSync(dest);
    const { verdict, danger, flags } = judgeSkill(body, { force: opts.force, exists });
    out.push({ srcFile: f, slug, name: m.name, verdict, danger, flags, body, dest, exists });
  }
  return out;
}

// run(opts): detect -> plan (memory merge + scanned skills) -> print -> (dry-run | --apply write).
// opts: { from, path, apply, force, memoryDir, skillsDir, now }. memoryDir/skillsDir are injectable
// for tests; default to the real Urfael dirs. Returns a summary object. Never executes imported content.
function run(opts = {}) {
  const memoryDir = opts.memoryDir || MEMORY_DIR;
  const skillsDir = opts.skillsDir || SKILLS_DIR;
  const apply = !!opts.apply;
  const now = opts.now instanceof Date ? opts.now : new Date();

  const found = detectSource(opts);
  if (!found) {
    console.error('✗ no OpenClaw or Hermes install found' + (opts.from ? ' for --from ' + opts.from : '') + (opts.path ? ' at ' + opts.path : ''));
    return { ok: false, error: 'no source' };
  }
  const { kind, root, src } = found;
  console.log(gold('→ importing from ' + src.label) + dim('  ' + root) + (apply ? '' : gold('  [DRY-RUN]') + dim(' — pass --apply to write')));

  // ---- memory ----
  const mem = collectMemory(root, src);
  const memPlan = [];
  for (const { destFile, text } of mem) {
    const destPath = path.join(memoryDir, destFile);
    const existing = readCapped(destPath);
    const merged = mergeMemory(existing, text, src.label, now);
    const added = merged.length - existing.length;
    memPlan.push({ destFile, destPath, merged, added });
    console.log('  ' + gold('memory') + ' ' + destFile + dim('  +' + added + ' bytes under "## Imported from ' + src.label + '"'));
  }
  if (!mem.length) console.log(dim('  (no memory files found in source)'));

  // ---- skills ----
  const skills = collectSkills(root, src, skillsDir, { force: opts.force });
  let willImport = 0, skipped = 0;
  for (const s of skills) {
    if (s.verdict === 'import') willImport++; else skipped++;
    const tag = s.verdict === 'import'
      ? gold('✓ import ')
      : (s.danger ? gold('✗ SKIP   ') : dim('⚠ skip   '));
    const why = s.danger ? ' (DANGER flags — untrusted, not imported)'
      : s.verdict === 'overwrite' ? ' (exists — needs --force)'
      : s.reason ? ' (' + s.reason + ')' : '';
    console.log('  ' + tag + (s.slug || s.srcFile) + dim('  from ' + s.srcFile) + (why ? gold(why) : ''));
    if (s.flags && s.flags.length) for (const fl of s.flags) console.log('      ' + (fl.level === 'danger' ? gold('[DANGER]') : dim('[warn]  ')) + ' ' + fl.why);
  }
  if (!skills.length) console.log(dim('  (no skills found in source)'));

  // ---- write (only on --apply) ----
  let wroteMem = 0, wroteSkills = 0;
  if (apply) {
    for (const m of memPlan) {
      try { fs.mkdirSync(path.dirname(m.destPath), { recursive: true }); fs.writeFileSync(m.destPath, m.merged, { encoding: 'utf8' }); wroteMem++; }
      catch (e) { console.error('✗ memory write failed: ' + m.destFile + ': ' + (e && e.message || e)); }
    }
    for (const s of skills) {
      if (s.verdict !== 'import') continue;
      const dest = s.dest || skillDest(s.slug, skillsDir);
      if (!dest) { console.error('✗ refusing to write outside skills dir: ' + s.slug); continue; }
      try { fs.mkdirSync(skillsDir, { recursive: true }); fs.writeFileSync(dest, s.body, { encoding: 'utf8', mode: 0o600 }); wroteSkills++; } // 0600: data, never executable
      catch (e) { console.error('✗ skill write failed: ' + s.slug + ': ' + (e && e.message || e)); }
    }
  }

  // ---- summary ----
  if (apply) console.log(gold('✓ imported') + dim('  ' + wroteMem + ' memory file(s), ' + wroteSkills + ' skill(s) — ' + skipped + ' skill(s) skipped'));
  else console.log(dim('would import ' + memPlan.length + ' memory file(s) and ' + willImport + ' skill(s); ' + skipped + ' would be skipped. Re-run with --apply to write.'));
  return { ok: true, source: kind, root, memory: memPlan.map((m) => ({ file: m.destFile, added: m.added })), skills: skills.map((s) => ({ slug: s.slug, file: s.srcFile, verdict: s.verdict, danger: !!s.danger })), wroteMem, wroteSkills, skipped, applied: apply };
}

module.exports = {
  run, detectSource, looksLike, hasAny, safeJoin, mergeMemory, importHeader,
  skillSlug, skillDest, judgeSkill, collectMemory, collectSkills,
  SOURCES, MEMORY_DIR, SKILLS_DIR,
};
