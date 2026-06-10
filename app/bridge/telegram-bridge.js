'use strict';
// Telegram bridge — owner-allowlisted phone control of Urfael. Outbound long-poll only (NO inbound port).
// Every owner message is relayed to POST /ask with channel:'telegram', which the daemon forces into the
// sandboxed 'untrusted' profile (no bypass, no computer-use, read/search/web/notes only). Works on Node 18+.
//   node telegram-bridge.js            run the bridge
//   node telegram-bridge.js --notify "text"   one-way push (used by jobs/brief)
const core = require('./bridge-core');

const cfg = core.loadEnv();
const TOKEN = cfg.TELEGRAM_BOT_TOKEN;
const OWNER = cfg.TELEGRAM_OWNER_CHAT_ID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notifyMode() {
  const i = process.argv.indexOf('--notify');
  if (i < 0) return false;
  if (TOKEN && OWNER) { try { await core.telegramSend(TOKEN, OWNER, process.argv[i + 1] || ''); } catch {} }
  process.exit(0);
}

async function handle(text) {
  const t0 = Date.now();
  const placeholder = await core.telegramSend(TOKEN, OWNER, '…thinking');
  const mid = placeholder.json && placeholder.json.result && placeholder.json.result.message_id;
  const reply = core.stripSpoken(await core.askDaemon(text, 'telegram'));
  if (mid) {
    try {
      await core.httpsJson({ hostname: 'api.telegram.org', path: `/bot${TOKEN}/editMessageText`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
        { chat_id: OWNER, message_id: mid, text: reply.slice(0, 4000), disable_web_page_preview: true });
    } catch { await core.telegramSend(TOKEN, OWNER, reply); }
  } else { await core.telegramSend(TOKEN, OWNER, reply); }
  core.audit({ ev: 'telegram_turn', inLen: text.length, outLen: reply.length, ms: Date.now() - t0 });
}

// Voice memo → local whisper transcript → normal sandboxed turn. The transcript is echoed back
// first so you can see what was heard. Degrades with a clear message if whisper-cpp isn't installed.
async function handleVoice(voice) {
  const t0 = Date.now();
  if ((voice.duration || 0) > 300) { await core.telegramSend(TOKEN, OWNER, 'Voice memo too long (5 min max).'); return; }
  let tmp = '';
  try {
    const meta = await core.httpsJson({ hostname: 'api.telegram.org', path: `/bot${TOKEN}/getFile?file_id=${encodeURIComponent(voice.file_id)}`, method: 'GET' });
    const fp = meta.json && meta.json.result && meta.json.result.file_path;
    if (!fp) throw new Error('getFile failed');
    tmp = require('os').tmpdir() + '/uf-voice-' + Date.now() + '.' + (fp.split('.').pop() || 'oga');
    await core.httpsDownload(`https://api.telegram.org/file/bot${TOKEN}/${fp}`, tmp);
    const said = core.transcribeLocal(tmp);
    if (!said) { await core.telegramSend(TOKEN, OWNER, 'Could not transcribe (is whisper-cpp installed on the Mac?).'); return; }
    core.audit({ ev: 'telegram_voice', secs: voice.duration || 0, chars: said.length, ms: Date.now() - t0 });
    await core.telegramSend(TOKEN, OWNER, '🎙 ' + said.slice(0, 500));
    await handle(said);
  } catch (e) { core.audit({ ev: 'telegram_voice_error', err: String((e && e.message) || e) }); }
  finally { if (tmp) { try { require('fs').unlinkSync(tmp); } catch {} } }
}

async function main() {
  if (await notifyMode()) return;
  if (!TOKEN || !OWNER) { console.error('telegram-bridge: set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID in ~/.claude/urfael/bridge.env'); process.exit(1); }

  const bucket = new core.TokenBucket(8, 20); // 8 burst, ~20/min sustained — bounds a flood/injection loop
  let offset = 0;
  core.audit({ ev: 'telegram_start' });
  for (;;) {
    let updates = [];
    try {
      const r = await core.httpsJson({ hostname: 'api.telegram.org', path: `/bot${TOKEN}/getUpdates?timeout=50&offset=${offset}`, method: 'GET' });
      updates = (r.json && r.json.result) || [];
    } catch { await sleep(3000); continue; }
    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message || u.edited_message;
      if (!msg) continue;
      if (String(msg.chat.id) !== String(OWNER)) { core.audit({ ev: 'telegram_drop', from: msg.chat.id }); continue; } // ALLOWLIST, before the brain
      if (!msg.text && !msg.voice && !msg.audio) continue;
      if (!bucket.take()) { core.audit({ ev: 'telegram_ratelimited' }); try { await core.telegramSend(TOKEN, OWNER, 'Rate limited — give me a second.'); } catch {} continue; }
      if (msg.text) handle(msg.text).catch(() => {});
      else handleVoice(msg.voice || msg.audio).catch(() => {});
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
