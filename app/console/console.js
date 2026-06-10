'use strict';
// Urfael Console — the desktop-app surface. Chat with streamed tool activity, the session archive,
// reminders, jobs, hearth, settings. Same daemon, same brain as the orb; this is just a bigger window
// onto it. Keyboard-first: ⌘1–6 views, ⌘K search, Enter sends, ↑ recalls.

const $ = (s) => document.querySelector(s);
const VIEWS = ['converse', 'archive', 'reminders', 'jobs', 'hearth', 'settings'];

// ---- view switching --------------------------------------------------------
let view = 'converse';
function show(v) {
  view = v;
  for (const x of VIEWS) { $('#view-' + x).hidden = x !== v; }
  document.querySelectorAll('.nav').forEach((b) => b.setAttribute('aria-current', b.dataset.view === v ? 'true' : 'false'));
  if (v === 'archive') loadDays();
  if (v === 'reminders') loadReminders();
  if (v === 'jobs') loadJobs();
  if (v === 'hearth') loadHearth();
  if (v === 'settings') loadSettings();
  if (v === 'converse') $('#input').focus();
}
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '6') { e.preventDefault(); show(VIEWS[+e.key - 1]); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show('archive'); $('#arch-search').focus(); }
});

// ---- converse ---------------------------------------------------------------
const thread = $('#thread');
const input = $('#input');
const sendBtn = $('#send');
let liveMsg = null, liveText = '', liveTools = [], lastSent = '', asking = false;

const TOOL_LABEL = (n) => {
  n = (n || '').toLowerCase();
  if (n.includes('event') || n.includes('calendar')) return 'Checking the calendar';
  if (n.includes('thread') || n.includes('mail') || n.includes('draft') || n.includes('label')) return 'Checking email';
  if (n.includes('search') || n.includes('vault') || n.includes('read') || n.includes('list') || n.includes('document') || n.includes('grep') || n.includes('glob')) return 'Searching the archive';
  if (n.includes('write') || n.includes('append') || n.includes('patch') || n.includes('create') || n.includes('edit')) return 'Writing to the vault';
  if (n.includes('navigate') || n.includes('browser') || n.includes('page') || n.includes('click') || n.includes('fetch')) return 'Reaching into the web';
  if (n.includes('bash') || n.includes('terminal')) return 'Working the forge';
  return 'Using ' + n;
};

// pin-to-bottom autoscroll: only follow the stream if the reader is already at the bottom (NN/g)
function nearBottom() { return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48; }
function follow(pinned) { if (pinned) thread.scrollTop = thread.scrollHeight; }

function addMsg(who, text) {
  $('#thread-empty')?.remove();
  const d = document.createElement('div'); d.className = 'msg ' + who;
  const w = document.createElement('div'); w.className = 'who'; w.textContent = who === 'you' ? 'You' : 'Urfael';
  const t = document.createElement('div'); t.className = 'text'; t.textContent = text;
  d.append(w, t); thread.appendChild(d);
  return d;
}
function splitSpoken(t) {
  const m = (t || '').match(/\[SPOKEN\]([\s\S]*?)\[\/SPOKEN\]/i);
  const remark = m ? m[1].trim() : '';
  const body = (t || '').replace(/\[SPOKEN\][\s\S]*?\[\/SPOKEN\]/i, '').replace(/\[\/?SPOKEN\]/gi, '').trim();
  return { remark, body: body || remark };
}
function renderLive() {
  if (!liveMsg) return;
  const pinned = nearBottom();
  const { remark, body } = splitSpoken(liveText);
  liveMsg.querySelector('.remark').textContent = remark;
  const t = liveMsg.querySelector('.text');
  t.textContent = body === remark && /\[SPOKEN\]/i.test(liveText) && !/\[\/SPOKEN\]/i.test(liveText) ? '' : body;
  t.appendChild(Object.assign(document.createElement('span'), { className: 'cursor', textContent: '▋' }));
  follow(pinned);
}
let renderQueued = false;
function queueRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderLive(); }); } }

async function send() {
  const text = input.value.trim();
  if (!text || asking) return;
  lastSent = text; input.value = ''; autosize();
  asking = true; sendBtn.disabled = true;
  addMsg('you', text);
  const pinned = nearBottom();
  liveMsg = document.createElement('div'); liveMsg.className = 'msg urfael';
  liveMsg.innerHTML = '<div class="who">Urfael</div><div class="remark"></div><div class="text"><span class="cursor">▋</span></div><div class="meta"></div>';
  thread.appendChild(liveMsg); follow(pinned);
  liveText = ''; liveTools = [];
  const r = await window.urfael.ask(text).catch(() => null);
  finishLive(r);
}
function finishLive(r) {
  const wasMine = asking;
  asking = false; sendBtn.disabled = false;
  if (!liveMsg) return;
  const pinned = nearBottom();
  const { remark, body } = splitSpoken((r && r.text) || liveText);
  if (wasMine) speak(remark || (body || '').split(/(?<=[.!?])\s/)[0]);
  liveMsg.querySelector('.remark').textContent = remark;
  liveMsg.querySelector('.text').textContent = body || '(no reply — is the brain awake?)';
  for (const tr of liveTools) tr.classList.add('done');
  if (r && r.model) liveMsg.querySelector('.meta').textContent = r.model;
  liveMsg = null; liveText = '';
  follow(pinned);
}

// live events from the daemon (also mirrors voice turns started at the orb)
window.urfael.onThinking((p) => {
  if (p.reset) {
    if (!liveMsg && view === 'converse') { // a turn started elsewhere (voice/CLI) — mirror it
      const pinned = nearBottom();
      liveMsg = document.createElement('div'); liveMsg.className = 'msg urfael';
      liveMsg.innerHTML = '<div class="who">Urfael</div><div class="remark"></div><div class="text"></div><div class="meta"></div>';
      $('#thread-empty')?.remove(); thread.appendChild(liveMsg); follow(pinned);
    }
    liveText = ''; liveTools = [];
  } else if (p.tool && liveMsg) {
    const pinned = nearBottom();
    const tr = document.createElement('div'); tr.className = 'toolrow'; tr.textContent = TOOL_LABEL(p.tool);
    liveMsg.before(tr); liveTools.push(tr); follow(pinned);
  } else if (p.delta && liveMsg) {
    liveText += p.delta; queueRender();
  }
});
window.urfael.onDone((p) => { if (liveMsg && !asking) finishLive(p); });

// ---- voice in the Console: push-to-talk in, spoken remark out ------------------
const micBtn = $('#mic'), muteBtn = $('#mute');
let recState = null, voiceOn = true, actx = null;
async function toggleMic() {
  if (recState) { try { recState.stop(); } catch {} return; }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch(() => null);
  if (!stream) { micBtn.title = 'Mic blocked — allow it in System Settings'; return; }
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    recState = null; micBtn.classList.remove('rec');
    const buf = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
    const said = (await window.urfael.stt(buf).catch(() => '')) || '';
    const clean = said.replace(/[\(\[][^)\]]*[\)\]]/g, '').trim();
    if (clean.length > 1) { input.value = clean; send(); }
  };
  recorder.start(); recState = recorder; micBtn.classList.add('rec');
}
micBtn.addEventListener('click', toggleMic);
async function speak(text) {
  if (!voiceOn || !text) return;
  try {
    const clean = text.replace(/[#>*_~|`\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const u8 = await window.urfael.tts(clean);
    actx = actx || new AudioContext();
    const audio = await actx.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    const src = actx.createBufferSource(); src.buffer = audio; src.connect(actx.destination); src.start();
  } catch {}
}
muteBtn.addEventListener('click', () => {
  voiceOn = !voiceOn;
  muteBtn.textContent = voiceOn ? '🔊' : '🔇'; muteBtn.classList.toggle('off', !voiceOn);
  window.urfael.setConfig('CONSOLE_VOICE', voiceOn ? '1' : '0');
});

function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  else if (e.key === 'ArrowUp' && !input.value) { input.value = lastSent; autosize(); }
});
sendBtn.addEventListener('click', send);

// ---- archive ----------------------------------------------------------------
async function loadDays() {
  const days = await window.urfael.sessionsDays();
  const el = $('#arch-days'); el.innerHTML = '';
  if (!days.length) { el.innerHTML = '<div class="hint" style="padding:8px 10px">Nothing yet — every conversation will land here.</div>'; return; }
  for (const d of days) {
    const b = document.createElement('button'); b.className = 'day'; b.textContent = d; b.setAttribute('role', 'listitem');
    b.onclick = () => { document.querySelectorAll('.day').forEach((x) => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); renderDay(d); };
    el.appendChild(b);
  }
}
function archTurn(e) {
  const d = document.createElement('div'); d.className = 'arch-turn';
  const { body } = splitSpoken(e.urfael || '');
  d.innerHTML = '<div class="t"></div><div class="u"></div><div class="a"></div>';
  d.querySelector('.t').textContent = (e.t || '').slice(0, 16).replace('T', '  ') + (e.channel && e.channel !== 'local' ? '  · ' + e.channel : '');
  d.querySelector('.u').textContent = e.user || '';
  d.querySelector('.a').textContent = body;
  return d;
}
async function renderDay(day) {
  const body = $('#arch-body'); body.innerHTML = '';
  const entries = await window.urfael.sessionRead(day);
  if (!entries.length) { body.innerHTML = '<div class="empty"><p>Nothing recorded that day.</p></div>'; return; }
  for (const e of entries) body.appendChild(archTurn(e));
}
let searchT = null;
$('#arch-search').addEventListener('input', () => {
  clearTimeout(searchT);
  searchT = setTimeout(async () => {
    const q = $('#arch-search').value.trim();
    if (!q) { $('#arch-body').innerHTML = '<div class="empty"><p>Pick a day — or search. Every word is kept.</p></div>'; return; }
    const hits = await window.urfael.sessionsSearch(q);
    const body = $('#arch-body'); body.innerHTML = '';
    if (!hits.length) { body.innerHTML = '<div class="empty"><p>No trace of that.</p></div>'; return; }
    for (const e of hits) body.appendChild(archTurn(e));
  }, 220);
});

// ---- reminders ----------------------------------------------------------------
async function loadReminders() {
  const list = await window.urfael.reminders() || [];
  const el = $('#rem-list'); el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<p class="hint">Nothing scheduled. Set one above, or just ask Urfael.</p>'; return; }
  for (const r of list) {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = '<span class="when"></span><span class="grow"></span><span class="state"></span><button class="row-act small">Cancel</button>';
    d.querySelector('.when').textContent = (r.at || '').slice(0, 16).replace('T', ' ');
    d.querySelector('.grow').textContent = r.text;
    d.querySelector('.state').textContent = r.repeat ? (typeof r.repeat === 'string' ? r.repeat : 'every ' + r.repeat.everyMins + 'm') : '';
    d.querySelector('button').onclick = async () => { await window.urfael.reminderCancel(r.id); loadReminders(); };
    el.appendChild(d);
  }
}
$('#rem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const spec = { text: $('#rem-text').value.trim(), inMins: Number($('#rem-mins').value || 0) };
  const rep = $('#rem-repeat').value; if (rep) spec.repeat = rep;
  if (!spec.text) return;
  await window.urfael.remind(spec);
  $('#rem-text').value = ''; $('#rem-mins').value = '';
  loadReminders();
});

// ---- jobs ----------------------------------------------------------------------
async function loadJobs() {
  const jobs = await window.urfael.jobs() || [];
  const el = $('#job-list'); el.innerHTML = ''; $('#job-log').hidden = true;
  if (!jobs.length) { el.innerHTML = '<p class="hint">No background work. Ask Urfael to research something “in the background”.</p>'; return; }
  for (const j of jobs.slice(0, 30)) {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = '<span class="when"></span><span class="grow"></span><span class="state"></span><button class="row-act small">Log</button><button class="row-act small">Cancel</button>';
    d.querySelector('.when').textContent = (j.createdAt || '').slice(5, 16).replace('T', ' ');
    d.querySelector('.grow').textContent = j.kind + '  ·  ' + j.id;
    const st = d.querySelector('.state'); st.textContent = j.state; st.classList.add(j.state);
    const [logBtn, cancelBtn] = d.querySelectorAll('button');
    logBtn.onclick = async () => { const full = await window.urfael.job(j.id); $('#job-log').textContent = (full && full.log) || '(no log)'; $('#job-log').hidden = false; };
    cancelBtn.onclick = async () => { await window.urfael.jobCancel(j.id); loadJobs(); };
    if (j.state !== 'running') cancelBtn.remove();
    el.appendChild(d);
  }
}

// ---- hearth ---------------------------------------------------------------------
let hearthTimer = null;
async function loadHearth() {
  const v = await window.urfael.vitals();
  const el = $('#hearth-grid'); el.innerHTML = '';
  if (!v) { el.innerHTML = '<p class="hint">The brain is asleep — send a message to wake it.</p>'; return; }
  const tok = v.tokToday >= 1000 ? Math.round(v.tokToday / 1000) + 'k' : (v.tokToday || 0);
  const cells = [['model', v.model], ['warm sessions', (v.warm || []).length], ['turns today', v.turnsToday],
    ['tokens today', tok], ['avg latency', v.avgMs ? v.avgMs + 'ms' : '—'], ['memory commits', v.memCommits],
    ['uptime', v.uptimeS < 3600 ? Math.round(v.uptimeS / 60) + 'm' : Math.round(v.uptimeS / 3600) + 'h'], ['brain restarts', v.errors]];
  for (const [k, val] of cells) {
    const d = document.createElement('div'); d.className = 'vital';
    d.innerHTML = '<label></label><span></span>';
    d.querySelector('label').textContent = k.toUpperCase(); d.querySelector('span').textContent = val;
    el.appendChild(d);
  }
  clearInterval(hearthTimer);
  hearthTimer = setInterval(() => { if (view === 'hearth') loadHearth(); else clearInterval(hearthTimer); }, 5000);
}
$('#distill').addEventListener('click', () => { window.urfael.conversationEnd(); $('#distill').textContent = '✦ Distilling…'; setTimeout(() => ($('#distill').textContent = '✦ Distill memory'), 2500); });

// ---- settings ---------------------------------------------------------------------
const SETTINGS = [
  ['URFAEL_THEME', 'Orb look', ['sigil', 'rune', 'ember', 'eye']],
  ['TTS_PROVIDER', 'Voice (TTS)', ['say', 'kokoro', 'elevenlabs']],
  ['SAY_VOICE', 'macOS voice', null],
  ['SAY_RATE', 'Speech rate (wpm)', null],
  ['URFAEL_ACKS', 'Spoken acknowledgments', ['1', '0']],
  ['WAKE_KEYWORD', 'Wake word (built-in)', null],
  ['WAKE_WORD_LABEL', 'Wake word label', null],
  ['WHISPER_MODEL', 'Whisper model', ['base.en', 'small.en', 'tiny.en']],
];
async function loadSettings() {
  const cfg = await window.urfael.config();
  const cur = { URFAEL_THEME: cfg.theme, TTS_PROVIDER: cfg.ttsProvider, SAY_VOICE: cfg.sayVoice, SAY_RATE: cfg.sayRate,
    URFAEL_ACKS: cfg.acks ? '1' : '0', WAKE_KEYWORD: cfg.wakeKeyword, WAKE_WORD_LABEL: cfg.wakeLabel, WHISPER_MODEL: cfg.whisperModel };
  const grid = $('#settings-grid'); grid.innerHTML = '';
  for (const [key, label, opts] of SETTINGS) {
    const l = document.createElement('label'); l.textContent = label; l.htmlFor = 's-' + key;
    let f;
    if (opts) {
      f = document.createElement('select');
      for (const o of opts) { const op = document.createElement('option'); op.value = o; op.textContent = o; f.appendChild(op); }
      f.value = opts.includes(String(cur[key])) ? String(cur[key]) : opts[0];
    } else { f = document.createElement('input'); f.type = 'text'; f.value = cur[key] || ''; }
    f.id = 's-' + key;
    f.addEventListener('change', () => window.urfael.setConfig(key, f.value));
    grid.append(l, f);
  }
}

// jump-to-latest appears whenever the reader is scrolled away from the live tail (NN/G)
const jump = $('#jump');
thread.addEventListener('scroll', () => { jump.hidden = nearBottom(); });
jump.addEventListener('click', () => { thread.scrollTop = thread.scrollHeight; jump.hidden = true; });
document.querySelectorAll('.sug').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent; send(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.activeElement?.blur?.(); });

// ---- boot -----------------------------------------------------------------------
(async () => {
  const cfg = await window.urfael.config().catch(() => ({}));
  voiceOn = cfg.consoleVoice !== false;
  muteBtn.textContent = voiceOn ? '🔊' : '🔇'; muteBtn.classList.toggle('off', !voiceOn);
})();
show('converse');
