'use strict';
// Wake-word listener, runs in its own thread so its blocking mic reads never freeze the UI.
// Listens on-device for "Jarvis" (no cloud, no transcription) and posts a message on detect.
const { parentPort, workerData } = require('worker_threads');
const { Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node');
const { PvRecorder } = require('@picovoice/pvrecorder-node');

let porcupine = null, recorder = null, running = true, paused = false;

try {
  porcupine = new Porcupine(workerData.accessKey, [BuiltinKeyword.JARVIS], [workerData.sensitivity || 0.55]);
  recorder = new PvRecorder(porcupine.frameLength, -1);
  recorder.start();
  parentPort.postMessage({ type: 'ready' });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: String((e && e.message) || e) });
  running = false;
}

parentPort.on('message', (m) => {
  if (m === 'pause') { paused = true; try { recorder && recorder.stop(); } catch {} }       // free the mic for the renderer
  else if (m === 'resume') { try { recorder && recorder.start(); } catch {} paused = false; }
  else if (m === 'stop') { running = false; try { recorder && recorder.release(); } catch {} try { porcupine && porcupine.release(); } catch {} process.exit(0); }
});

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  while (running) {
    if (paused || !recorder) { await sleep(80); continue; }
    let frame;
    try { frame = await recorder.read(); } catch { await sleep(80); continue; }
    if (paused || !recorder) continue;   // state may have changed during the awaited read — don't process a boundary frame
    let idx = -1;
    try { idx = porcupine.process(frame); } catch {}
    if (idx >= 0) { paused = true; try { recorder.stop(); } catch {} parentPort.postMessage({ type: 'wake' }); }
  }
})();
