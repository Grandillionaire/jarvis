'use strict';
// Jarvis Mk II overlay. Voice: idle until "Jarvis"/tap → conversation (listen→answer→listen),
// streaming TTS, barge-in. HUD: an altitude-based J.A.R.V.I.S. console that deploys on activity,
// shows live reasoning/response/vitals, and retracts when idle.

const EL = { base: 'https://api.elevenlabs.io/v1' };
let cfg = { apiKey: '', voiceId: '', model: 'eleven_flash_v2_5' };

const canvas = document.getElementById('orb');
const caption = document.getElementById('caption');
const orb = new JarvisOrb(canvas);

let ctx, analyser, micAnalyser, td;
let micStream = null, micSource = null, recorder = null, chunks = [];
let state = 'idle';
let convo = false, loopRunning = false;
let recording = false, speechAt = 0, lastVoice = 0, bargeFrames = 0;
let liveTurn = 0, mutedTurn = -1, audioQ = [], pendingFetches = 0, playing = false, curSource = null, streamEnded = false;
let finished = false, finishTimer = null;

const START_RMS = 0.05, KEEP_RMS = 0.03, SILENCE_MS = 700, MAX_MS = 12000;  // 700ms end-of-speech (was 850) — snappier without clipping
const BARGE_RMS = 0.085, BARGE_FRAMES = 10;

const MODEL_LABEL = { 'claude-sonnet-4-6': 'Sonnet', 'claude-opus-4-7': 'Opus' };
const TOOL_LABEL = (n) => {
  n = (n || '').toLowerCase();
  if (n.includes('event') || n.includes('calendar')) return 'Checking your calendar';
  if (n.includes('thread') || n.includes('mail') || n.includes('draft') || n.includes('label')) return 'Checking your email';
  if (n.includes('search') || n.includes('vault') || n.includes('read') || n.includes('list') || n.includes('document')) return 'Searching your notes';
  if (n.includes('write') || n.includes('append') || n.includes('patch') || n.includes('create')) return 'Writing to your vault';
  if (n.includes('navigate') || n.includes('browser') || n.includes('page') || n.includes('click')) return 'Browsing the web';
  if (n.includes('drive') || n.includes('file')) return 'Looking in Drive';
  if (n.includes('applescript') || n.includes('macos') || n.includes('automator')) return 'Operating the desktop';
  return 'Using ' + n;
};

function setState(s, text) {
  state = s;
  orb.setState(s === 'capturing' ? 'listening' : s);
  const lbl = { idle: convo ? 'Listening…' : 'Say “Jarvis”…', capturing: 'Listening… (tap to stop)', thinking: 'Thinking…', speaking: '' };
  caption.textContent = text != null ? text : (lbl[s] || '');
  caption.classList.toggle('dim', s === 'idle' && !convo);
}

function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.7;
  micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 512; micAnalyser.smoothingTimeConstant = 0.5;
  td = new Uint8Array(micAnalyser.fftSize);
  orb.attach(analyser);
}
function rms() {
  micAnalyser.getByteTimeDomainData(td);
  let s = 0; for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / td.length);
}

// ============================ HUD ============================
const reasonEl = document.getElementById('reason');
const responseEl = document.getElementById('response');
const chipsEl = document.getElementById('chips');
let altitude = 'idle', collapseTimer = null, toolCount = 0, respText = '';

function setAltitude(a) {
  if (a === altitude) return;
  altitude = a;
  document.body.className = 'state-' + a;
}
function escalate(a) { // never downgrade within a turn; idle<active<expanded
  const rank = { idle: 0, active: 1, expanded: 2 };
  if (rank[a] > rank[altitude]) setAltitude(a);
}
function scheduleCollapse() {
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => { if (!convo && state !== 'thinking' && state !== 'speaking') setAltitude('idle'); }, 6000);
}
function resolvePendingRows() { reasonEl.querySelectorAll('.row:not(.done):not(.model)').forEach((r) => { r.classList.add('done'); r.querySelector('.mk').textContent = '✓'; }); }
function reasonRow(text, cls) {
  const d = document.createElement('div'); d.className = 'row' + (cls ? ' ' + cls : '');
  const m = document.createElement('span'); m.className = 'mk'; m.textContent = cls === 'model' ? '▸' : '⟳';
  d.appendChild(m); d.appendChild(document.createTextNode(text));
  reasonEl.appendChild(d);
  while (reasonEl.children.length > 40) reasonEl.removeChild(reasonEl.firstChild);
  reasonEl.scrollTop = reasonEl.scrollHeight;
}

window.jarvis.onThinking((p) => {
  if (p.reset) {
    liveTurn = p.turnId; mutedTurn = -1; toolCount = 0; respText = '';
    reasonEl.innerHTML = ''; responseEl.textContent = ''; chipsEl.innerHTML = '';
    reasonRow((MODEL_LABEL[p.model] || 'Jarvis') + ' engaged', 'model');
    escalate(p.model === 'claude-opus-4-7' ? 'expanded' : 'active');
    refreshVitals();
  } else if (p.tool) {
    resolvePendingRows(); reasonRow(TOOL_LABEL(p.tool)); spawnMotes(6);
    if (++toolCount >= 2) escalate('expanded');
  } else if (p.delta) {
    respText += p.delta;
    const shown = answerForScreen(respText).slice(-1400);
    responseEl.innerHTML = '';
    responseEl.appendChild(document.createTextNode(shown));
    const c = document.createElement('span'); c.className = 'cursor'; c.textContent = '▋'; responseEl.appendChild(c);
    responseEl.scrollTop = responseEl.scrollHeight;
  }
});
// show only the WRITTEN answer on screen — strip the [SPOKEN] comment (that part is voiced, not read)
function answerForScreen(t) {
  const i = t.search(/\[\/SPOKEN\]/i);
  if (i >= 0) return t.slice(i).replace(/\[\/?SPOKEN\]/gi, '').trim();
  if (/\[SPOKEN\]/i.test(t)) return '';                 // comment still streaming, answer not started
  return t.replace(/\[\/?SPOKEN\]/gi, '').trim();        // no tags (fallback) → show all
}
window.jarvis.onDone((p) => {
  resolvePendingRows();
  const full = answerForScreen((p && p.text) || respText);
  responseEl.textContent = full.slice(0, 1400);
  renderChips(full);
  refreshVitals();
  scheduleCollapse();
});

// extract clickable github/vault references from the answer
function renderChips(text) {
  chipsEl.innerHTML = '';
  const seen = new Set();
  const add = (label, q) => { if (seen.has(label)) return; seen.add(label); const c = document.createElement('span'); c.className = 'chip hot'; c.textContent = label; c.onclick = () => window.jarvis.ask(q); chipsEl.appendChild(c); };
  (text.match(/[\w.-]+\/[\w.-]+(?=\s|$|[),.])/g) || []).filter((s) => s.includes('/') && !s.includes('//')).slice(0, 3).forEach((r) => add('⌥ ' + r, 'Tell me about the GitHub repo ' + r));
  (text.match(/\b[\w-]+\.md\b/g) || []).slice(0, 2).forEach((f) => add('▤ ' + f, 'Open ' + f + ' and summarize it'));
}

// vitals (real data from the daemon)
async function refreshVitals() {
  let v; try { v = await window.jarvis.vitals(); } catch { v = null; }
  if (!v) return;
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  const mEl = document.getElementById('v-model');
  if (mEl) { mEl.textContent = MODEL_LABEL[v.model] || '—'; mEl.classList.toggle('opus', v.model === 'claude-opus-4-7'); }
  set('v-warm', (v.warm || []).length); set('v-lat', v.avgMs ? v.avgMs + 'ms' : '—');
  set('v-turns', v.turnsToday); set('v-mem', v.memCommits);
  set('v-up', v.uptimeS != null ? (v.uptimeS < 3600 ? Math.round(v.uptimeS / 60) + 'm' : Math.round(v.uptimeS / 3600) + 'h') : '—');
}
setInterval(() => { if (altitude !== 'idle') refreshVitals(); }, 5000);

// particle motes — streak toward the orb when a tool fires
const pcanvas = document.getElementById('particles'); const pctx = pcanvas.getContext('2d');
let motes = [];
function resizeParticles() { pcanvas.width = window.innerWidth; pcanvas.height = window.innerHeight; }
window.addEventListener('resize', resizeParticles); resizeParticles();
function orbCenter() { return { x: window.innerWidth - 198, y: window.innerHeight - 248 }; }
function spawnMotes(n) {
  const o = orbCenter();
  for (let i = 0; i < n; i++) {
    const edge = Math.floor(Math.random() * 3);
    const sx = edge === 0 ? Math.random() * window.innerWidth : (edge === 1 ? 0 : window.innerWidth);
    const sy = edge === 0 ? 0 : Math.random() * window.innerHeight;
    motes.push({ x: sx, y: sy, tx: o.x, ty: o.y, life: 1 });
  }
}
function drawParticles() {
  pctx.clearRect(0, 0, pcanvas.width, pcanvas.height);
  pctx.globalCompositeOperation = 'lighter';
  motes = motes.filter((m) => m.life > 0);
  for (const m of motes) {
    m.x += (m.tx - m.x) * 0.06; m.y += (m.ty - m.y) * 0.06; m.life -= 0.012;
    const d = Math.hypot(m.tx - m.x, m.ty - m.y);
    pctx.strokeStyle = `rgba(25,224,255,${Math.min(0.6, m.life)})`; pctx.lineWidth = 1.6;
    pctx.beginPath(); pctx.moveTo(m.x, m.y); pctx.lineTo(m.x + (m.tx - m.x) * 0.08, m.y + (m.ty - m.y) * 0.08); pctx.stroke();
    if (d < 14) m.life = 0;
  }
  pctx.globalCompositeOperation = 'source-over';
  requestAnimationFrame(drawParticles);
}
drawParticles();

// click-through except over lit/interactive elements (window is ignoreMouseEvents:true by default)
let interactiveNow = false;
const HOT = '#orb, #close, .chip, #rail, #dock';
window.addEventListener('mousemove', (e) => {
  const over = !!(e.target.closest && e.target.closest(HOT));
  if (over !== interactiveNow) { interactiveNow = over; window.jarvis.setInteractive(over); }
});

// dock launcher chips — set these to your own projects/areas (tap a chip → "Brief me on <name>")
const PROJECTS = ['work', 'personal', 'research', 'health', 'finances', 'ideas'];
const dock = document.getElementById('dock');
PROJECTS.forEach((p) => { const c = document.createElement('span'); c.className = 'chip hot'; c.textContent = p; c.onclick = () => { ensureAudio(); window.jarvis.ask('Brief me on ' + p); }; dock.appendChild(c); });

window.jarvis.onHudToggle(() => setAltitude(altitude === 'expanded' ? 'idle' : 'expanded'));

// ============================ voice (preserved) ============================
window.jarvis.onSay((p) => {
  if (p.text) enqueueSay(p.text, p.turnId);
  else if (p.end && p.turnId === liveTurn && p.turnId !== mutedTurn) { streamEnded = true; maybeFinish(); }
});
let sayTurn = -1, prevSpoken = '';
async function enqueueSay(text, turnId) {
  if (turnId !== liveTurn || turnId === mutedTurn) return;
  const spoken = cleanForSpeech(text);
  if ((cfg.ttsProvider === 'elevenlabs' && !cfg.apiKey) || !spoken) return;   // only EL needs a key; local needs nothing
  pendingFetches++;
  try {
    let audioBytes; // raw audio (ArrayBuffer) for decodeAudioData — same playback path = orb stays reactive
    if (cfg.ttsProvider === 'elevenlabs') {
      if (turnId !== sayTurn) { sayTurn = turnId; prevSpoken = ''; }
      const myPrev = prevSpoken.slice(-600); prevSpoken += (prevSpoken ? ' ' : '') + spoken;
      const r = await fetch(`${EL.base}/text-to-speech/${cfg.voiceId}?optimize_streaming_latency=3`, {
        method: 'POST', headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spoken, model_id: cfg.model, previous_text: myPrev || undefined, voice_settings: { stability: 0.85, similarity_boost: 0.9, style: 0.0, use_speaker_boost: true, speed: cfg.speed || 1.0 } }),
      });
      if (!r.ok) { caption.textContent = `Voice error (${r.status})`; pendingFetches--; if (!playing) playNext(); return; }
      audioBytes = await r.arrayBuffer();
    } else {
      // LOCAL (say / kokoro): main process synthesizes and returns mp3 bytes
      const u8 = await window.jarvis.tts(spoken);                  // Uint8Array over IPC
      audioBytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    }
    const audio = await ctx.decodeAudioData(audioBytes);
    if (turnId === liveTurn && turnId !== mutedTurn) audioQ.push({ turnId, audio });
  } catch (e) { caption.textContent = (e && e.message ? e.message : 'Voice unavailable'); }
  pendingFetches--;
  if (!playing) playNext();
}
function playNext() {
  if (!audioQ.length) { playing = false; maybeFinish(); return; }
  const item = audioQ.shift();
  if (item.turnId === mutedTurn) return playNext();
  playing = true;
  if (state !== 'speaking') setState('speaking');
  curSource = ctx.createBufferSource();
  curSource.buffer = item.audio; curSource.connect(analyser); curSource.connect(ctx.destination);
  curSource.onended = () => { curSource = null; playNext(); };
  curSource.start();
}
function maybeFinish() { if (!playing && !audioQ.length && streamEnded && pendingFetches === 0) finishSpeaking(); }
function finishSpeaking() {
  if (finished) return; finished = true;
  streamEnded = false;
  if (finishTimer) clearTimeout(finishTimer);
  finishTimer = setTimeout(() => { if (convo) beginListening(); else { window.jarvis.wakeDone(); setState('idle'); scheduleCollapse(); } }, 250);
}
function stopPlayback() {
  if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
  finished = true;
  if (curSource) { try { curSource.onended = null; curSource.stop(); } catch {} curSource = null; }
  audioQ = []; playing = false; streamEnded = false; pendingFetches = 0;
}
function beginListening() { if (!convo) return; if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; } setState('capturing'); recording = false; bargeFrames = 0; if (!loopRunning) { loopRunning = true; convoLoop(); } }
function convoLoop() {
  if (!convo) { loopRunning = false; return; }
  const lvl = rms(), now = performance.now();
  if (state === 'capturing') {
    if (!recording) { if (lvl > START_RMS) startRec(now); }
    else { if (lvl > KEEP_RMS) lastVoice = now; if (now - speechAt > MAX_MS || now - lastVoice > SILENCE_MS) stopRec(); }
  } else if (state === 'speaking') {
    if (lvl > BARGE_RMS) { if (++bargeFrames >= BARGE_FRAMES) barge(); } else bargeFrames = 0;
  }
  requestAnimationFrame(convoLoop);
}
function barge() { mutedTurn = liveTurn; stopPlayback(); beginListening(); }
function startRec(now) {
  chunks = []; recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => handleUtterance();
  recorder.start();
  recording = true; speechAt = now; lastVoice = now;
}
function stopRec() { recording = false; if (recorder && recorder.state !== 'inactive') recorder.stop(); }
async function handleUtterance() {
  setState('thinking', 'Transcribing…');
  const said = await transcribe(new Blob(chunks, { type: 'audio/webm' }));
  const clean = (said || '').replace(/[\(\[][^)\]]*[\)\]]/g, '').trim();
  if (!clean || clean.length < 2) return convo ? beginListening() : resetIdle('');
  finished = false; streamEnded = false; audioQ = []; pendingFetches = 0;
  window.jarvis.ask(clean)
    .then(() => { setTimeout(() => { if (!finished && !playing && !audioQ.length && pendingFetches === 0) finishSpeaking(); }, 60); })
    .catch(() => finishSpeaking());
}
window.jarvis.onWake((p) => {
  if (p.detected) enterConversation();
  else if (p.ready) setState('idle', 'Say “Jarvis”…');
  else if (p.noKey) setState('idle', 'Tap to start (add a Picovoice key)');
  else if (p.error) setState('idle', 'Tap to start');
});
canvas.addEventListener('click', () => { ensureAudio(); if (convo) endConversation(); else enterConversation(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.jarvis.hide(); });
window.jarvis.onShown(() => ensureAudio());
async function enterConversation() {
  if (convo) return;
  convo = true; escalate('active'); window.jarvis.wakePause(); ensureAudio();
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { convo = false; return resetIdle('Mic blocked — enable it in System Settings'); }
  micSource = ctx.createMediaStreamSource(micStream);
  micSource.connect(micAnalyser); micSource.connect(analyser);
  beginListening();
}
function releaseMic() {
  if (micSource) { try { micSource.disconnect(); } catch {} micSource = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
}
function resetIdle(msg) { convo = false; stopPlayback(); releaseMic(); window.jarvis.wakeDone(); setState('idle', msg); scheduleCollapse(); }
function endConversation() {
  convo = false; recording = false; stopPlayback();
  if (recorder && recorder.state !== 'inactive') { try { recorder.onstop = null; recorder.stop(); } catch {} }
  releaseMic(); window.jarvis.wakeDone(); window.jarvis.conversationEnd();
  setState('idle', 'Stopped — say “Jarvis”'); scheduleCollapse();
}
async function transcribe(blob) {
  if (cfg.sttProvider !== 'elevenlabs') {
    // LOCAL whisper.cpp: main process transcribes the recorded audio
    try { return (await window.jarvis.stt(await blob.arrayBuffer())) || ''; }
    catch (e) { caption.textContent = (e && e.message) ? e.message : 'Local STT unavailable'; return ''; }
  }
  if (!cfg.apiKey) { resetIdle('No ElevenLabs key'); return ''; }
  const form = new FormData();
  form.append('file', blob, 'speech.webm'); form.append('model_id', 'scribe_v1'); form.append('tag_audio_events', 'false');
  try {
    const r = await fetch(`${EL.base}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': cfg.apiKey }, body: form });
    if (!r.ok) { caption.textContent = `Speech-to-text error (${r.status})`; return ''; }
    return ((await r.json()).text || '').trim();
  } catch { return ''; }
}
function cleanForSpeech(t) {
  return t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
          .replace(/[#>*_~|`\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

window.jarvis.onTheme((t) => orb.setTheme(t));
window.jarvis.onGaze((g) => orb.setGaze(g));
document.getElementById('close').addEventListener('click', (e) => { e.stopPropagation(); window.jarvis.shutdown(); });

// boot sequence then idle
(async () => {
  cfg = await window.jarvis.config();
  orb.setTheme(cfg.theme || 'mk2');
  orb.start();
  const boot = document.getElementById('boot'), bl = document.getElementById('bootline');
  const seq = ['INITIALIZING', 'LOADING MEMORY', 'SYSTEMS NOMINAL'];
  let i = 0; const iv = setInterval(() => { i++; if (bl && seq[i]) bl.textContent = seq[i]; }, 480);
  setTimeout(() => { clearInterval(iv); if (boot) boot.classList.add('gone'); setState('idle', 'Say “Jarvis”…'); refreshVitals(); }, 1500);
})();
