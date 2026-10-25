'use strict';
// Local speech-to-text (Whisper via @huggingface/transformers).
const { app, ipcMain } = require('electron');
const path = require('path');
const log = require('./log');
const settings = require('./settings');
const { emit, fromWindow, state } = require('./state');
const { cleanTranscript } = require('./transcript');

const MAX_VOICE_SAMPLES = 16000 * 60;
const IDLE_UNLOAD_MS = 5 * 60 * 1000;

let asrPromise = null;
let asrQueue = Promise.resolve();
let idleTimer = null;

function loadAsr() {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.join(app.getPath('userData'), 'models');
      emit({ type: 'voice-status', text: 'Loading speech model (first run downloads about 40 MB)...' });
      let lastPct = -1;
      const asr = await pipeline('automatic-speech-recognition', settings.get('voiceModel'), {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p.status !== 'progress') return;
          const pct = Math.floor(p.progress / 10) * 10;
          if (pct !== lastPct) { lastPct = pct; emit({ type: 'voice-status', text: `Downloading speech model ${pct}%` }); }
        },
      });
      emit({ type: 'voice-status', text: '' });
      return asr;
    })().catch((err) => { asrPromise = null; throw err; });
  }
  return asrPromise;
}

// Frees the model's memory when it has not been used for a while; the next phrase reloads it from disk.
function scheduleUnload() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const p = asrPromise;
    asrPromise = null;
    if (!p) return;
    try { const asr = await p; if (asr.dispose) await asr.dispose(); } catch (err) { log.warn('speech model unload:', err.message); }
  }, IDLE_UNLOAD_MS);
  idleTimer.unref();
}

function register() {
  ipcMain.handle('voice:prepare', async (e) => {
    if (!fromWindow(e, state.chatWin)) return { ok: false };
    try { await loadAsr(); scheduleUnload(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('voice:transcribe', (e, samples) => {
    if (!fromWindow(e, state.chatWin)) return { ok: false, error: 'Not allowed.' };
    if (!samples || !ArrayBuffer.isView(samples) || samples.length < 1600 || samples.length > MAX_VOICE_SAMPLES) {
      return { ok: false, error: 'Bad audio.' };
    }
    const audio = new Float32Array(samples.buffer, samples.byteOffset, samples.byteLength / 4);
    // One transcription at a time.
    const job = asrQueue.then(async () => {
      const asr = await loadAsr();
      const out = await asr(audio, { chunk_length_s: 30 });
      scheduleUnload();
      return { ok: true, text: cleanTranscript(out.text) };
    }).catch((err) => { log.error('transcribe:', err.message); return { ok: false, error: err.message }; });
    asrQueue = job;
    return job;
  });
}

module.exports = { register };
