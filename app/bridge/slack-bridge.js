'use strict';
// Slack bridge — owner-allowlisted DM control of Urfael via Socket Mode (built-in WebSocket, no deps).
// Owner DMs are relayed to POST /ask with channel:'slack' (sandboxed by the daemon). Outbound only otherwise.
// Needs Node 22+ (global WebSocket) like the Discord bridge. Uses Socket Mode so NO inbound port is opened:
// we POST apps.connections.open with the app-level token to get a wss url, then stream events over it.
//   node slack-bridge.js            run the bridge
//   node slack-bridge.js --notify "text"   one-way push (used by jobs/brief)
const core = require('./bridge-core');

const cfg = core.loadEnv();
const APP_TOKEN = cfg.SLACK_APP_TOKEN;   // xapp-… (Socket Mode connection)
const BOT_TOKEN = cfg.SLACK_BOT_TOKEN;   // xoxb-… (Web API: chat.postMessage)
const OWNER = cfg.SLACK_OWNER_USER_ID;   // U… owner user id
const bucket = new core.TokenBucket(8, 20); // 8 burst, ~20/min sustained — bounds a flood/injection loop

let ws, backoff = 1000;

function send(o) { try { ws.send(JSON.stringify(o)); } catch {} }

async function handle(channel, text) {
  const t0 = Date.now();
  const reply = core.stripSpoken(await core.askDaemon(text, 'slack'));
  try { await core.slackPost(BOT_TOKEN, channel, reply); } catch {}
  core.audit({ ev: 'slack_turn', inLen: text.length, outLen: reply.length, ms: Date.now() - t0 });
}

function onMessage(p) {
  // Acknowledge every envelope that carries an envelope_id (Socket Mode requirement) before doing anything.
  if (p.envelope_id) send({ envelope_id: p.envelope_id });
  if (p.type === 'disconnect') { try { ws.close(); } catch {} return; } // server asked us to reconnect
  if (p.type !== 'events_api' || !p.payload || !p.payload.event) return;
  const e = p.payload.event;
  if (e.type !== 'message') return;
  if (e.bot_id || e.subtype) return;                                    // ignore bots/self/edits/joins
  if (e.channel_type !== 'im') return;                                  // DMs only
  if (String(e.user) !== String(OWNER)) { core.audit({ ev: 'slack_drop', from: e.user }); return; } // ALLOWLIST
  if (!e.text) return;
  if (!bucket.take()) { core.audit({ ev: 'slack_ratelimited' }); core.slackPost(BOT_TOKEN, e.channel, 'Rate limited — one sec.').catch(() => {}); return; }
  handle(e.channel, e.text).catch(() => {});
}

async function connect() {
  let url;
  try {
    const r = await core.slackApi(APP_TOKEN, 'apps.connections.open');
    if (!r.json || !r.json.ok || !r.json.url) throw new Error('connections.open: ' + ((r.json && r.json.error) || r.status));
    url = r.json.url;
  } catch (e) {
    core.audit({ ev: 'slack_open_error', err: String((e && e.message) || e), retryMs: backoff });
    setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); return;
  }
  ws = new WebSocket(url);
  ws.addEventListener('open', () => { backoff = 1000; core.audit({ ev: 'slack_open' }); });
  ws.addEventListener('message', (ev) => { let p; try { p = JSON.parse(ev.data); } catch { return; } onMessage(p); });
  ws.addEventListener('close', () => { core.audit({ ev: 'slack_close', retryMs: backoff }); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); }); // exp backoff, reset on open
  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

async function main() {
  const i = process.argv.indexOf('--notify');
  if (i >= 0) { if (BOT_TOKEN && OWNER) { try { await core.slackPost(BOT_TOKEN, OWNER, process.argv[i + 1] || ''); } catch {} } process.exit(0); }
  if (!APP_TOKEN || !BOT_TOKEN || !OWNER) { console.error('slack-bridge: set SLACK_APP_TOKEN, SLACK_BOT_TOKEN and SLACK_OWNER_USER_ID in ~/.claude/urfael/bridge.env'); process.exit(1); }
  if (typeof WebSocket === 'undefined') { console.error('slack-bridge: needs Node 22+ (built-in WebSocket). Telegram works on Node 18+.'); process.exit(1); }
  core.audit({ ev: 'slack_boot' });
  connect();
}

main().catch((e) => { console.error(e); process.exit(1); });
