'use strict';
// One-way owner-only push to every configured bridge channel (Telegram/Discord). Single fixed destination
// each — there is NO recipient argument, so this can't be turned into a spam/exfil tool. No-op if no bridge.env.
//   node notify.js "your message"
const core = require('./bridge-core');
core.notifyAll(process.argv.slice(2).join(' ')).then(() => process.exit(0)).catch(() => process.exit(0));
