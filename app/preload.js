'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  config: () => ipcRenderer.invoke('jarvis:config'),
  ask: (text) => ipcRenderer.invoke('jarvis:ask', text),
  vitals: () => ipcRenderer.invoke('jarvis:vitals'),
  tts: (text) => ipcRenderer.invoke('jarvis:tts', text),   // local TTS → audio bytes
  stt: (buf) => ipcRenderer.invoke('jarvis:stt', buf),     // local STT → transcript text
  hide: () => ipcRenderer.send('jarvis:hide'),
  quit: () => ipcRenderer.send('jarvis:quit'),
  shutdown: () => ipcRenderer.send('jarvis:shutdown'),
  setTheme: (t) => ipcRenderer.send('jarvis:set-theme', t),
  setInteractive: (on) => ipcRenderer.send('jarvis:interactive', on), // mouse passthrough toggle
  conversationEnd: () => ipcRenderer.send('jarvis:conversation-end'),
  wakePause: () => ipcRenderer.send('jarvis:wake-pause'),
  wakeDone: () => ipcRenderer.send('jarvis:wake-done'),
  onShown: (cb) => ipcRenderer.on('jarvis:shown', () => cb()),
  onThinking: (cb) => ipcRenderer.on('jarvis:thinking', (_e, p) => cb(p)),
  onSay: (cb) => ipcRenderer.on('jarvis:say', (_e, p) => cb(p)),
  onDone: (cb) => ipcRenderer.on('jarvis:done', (_e, p) => cb(p)),
  onWake: (cb) => ipcRenderer.on('jarvis:wake', (_e, p) => cb(p)),
  onTheme: (cb) => ipcRenderer.on('jarvis:theme', (_e, t) => cb(t)),
  onGaze: (cb) => ipcRenderer.on('jarvis:gaze', (_e, g) => cb(g)),
  onHudToggle: (cb) => ipcRenderer.on('jarvis:hud-toggle', () => cb()),
});
