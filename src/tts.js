'use strict';
// Spoken announcements: greeting, goodnight, "build finished". The short phrases are rendered once with
// the neural voice (Kokoro, tts-worker.js) and cached as WAV files, so they play instantly at boot and at
// shutdown, when there is no time to load a model. The worker is stopped again once the clips exist.
const { app, utilityProcess } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const P = require('./platform');
const log = require('./log');
const { emit } = require('./state');
const { greetingKey, wavBuffer } = require('./audio');

const VOICE = { voice: 'af_nova', speed: 1 };
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

const PHRASES = {
  morning: 'Good morning, Boss.',
  afternoon: 'Good afternoon, Boss.',
  evening: 'Good evening, Boss.',
  goodnight: 'Good night, Boss. See you again soon.',
  buildDone: 'Boss, the build is finished.',
  buildFailed: 'Boss, the build ran into a problem.',
};

function phraseFile(key) {
  return path.join(app.getPath('userData'), 'voice', `${VOICE.voice}-${key}.wav`);
}

// ---- neural voice worker ----
let worker = null;
let workerPromise = null;
let reqSeq = 0;
const reqs = new Map();

function failAllRequests(message) {
  for (const r of reqs.values()) r.reject(new Error(message));
  reqs.clear();
}

function loadWorker() {
  if (!workerPromise) {
    workerPromise = new Promise((resolve, reject) => {
      const w = utilityProcess.fork(path.join(__dirname, '..', 'tts-worker.js'), [], { serviceName: 'Screen agent voice' });
      worker = w;
      let lastPct = -1;
      emit({ type: 'voice-status', text: 'Preparing the announcement voice (first run downloads about 90 MB)...' });
      w.on('message', (m) => {
        if (m.type === 'progress') {
          if (m.pct !== lastPct) { lastPct = m.pct; emit({ type: 'voice-status', text: `Downloading the announcement voice ${m.pct}%` }); }
        } else if (m.type === 'ready') {
          emit({ type: 'voice-status', text: '' });
          resolve();
        } else if (m.type === 'audio') {
          const r = reqs.get(m.req);
          if (r) { reqs.delete(m.req); r.resolve(m); }
        } else if (m.type === 'error') {
          const r = reqs.get(m.req);
          if (r) { reqs.delete(m.req); r.reject(new Error(m.message)); } else reject(new Error(m.message));
        }
      });
      w.on('exit', () => {
        if (worker === w) { worker = null; workerPromise = null; }
        failAllRequests('The voice process stopped.');
        reject(new Error('The voice process stopped.'));
      });
      w.postMessage({ type: 'init', cacheDir: path.join(app.getPath('userData'), 'models'), model: KOKORO_MODEL });
    });
    workerPromise.catch((err) => {
      log.error('Neural voice unavailable:', err.message);
      workerPromise = null;
      emit({ type: 'voice-status', text: '' });
    });
  }
  return workerPromise;
}

function releaseWorker() {
  if (worker) worker.kill();
}

function generate(text) {
  return new Promise((resolve, reject) => {
    const req = ++reqSeq;
    reqs.set(req, { resolve, reject });
    worker.postMessage({ type: 'generate', req, text, voice: VOICE.voice, speed: VOICE.speed });
  });
}

let rendering = null;
// Renders any missing clips. Needs the neural voice once; later runs never load it.
function ensurePhrases(keys) {
  const missing = keys.filter((k) => !fs.existsSync(phraseFile(k)));
  if (!missing.length) return Promise.resolve();
  if (!rendering) {
    rendering = (async () => {
      await loadWorker();
      fs.mkdirSync(path.dirname(phraseFile('morning')), { recursive: true });
      for (const k of missing) {
        const a = await generate(PHRASES[k]);
        fs.writeFileSync(phraseFile(k), wavBuffer(a.samples, a.rate));
      }
    })().catch((err) => log.error('Could not render voice clips:', err.message))
      .finally(() => { rendering = null; releaseWorker(); });
  }
  return rendering;
}

// ---- playback ----
let speechChild = null;

function osCandidates() {
  if (P.IS_WIN) {
    return [{
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd())'],
    }];
  }
  if (P.IS_MAC) return [{ cmd: 'say', args: [] }];
  return [
    { cmd: 'spd-say', args: ['-w', '-e'] },
    { cmd: 'espeak-ng', args: ['--stdin'] },
    { cmd: 'espeak', args: ['--stdin'] },
  ];
}

function stopSpeech() {
  const c = speechChild;
  speechChild = null;
  if (c) P.killTree(c);
}

function speakWith(candidates, text, onEnd) {
  const [cand, ...rest] = candidates;
  if (!cand) { onEnd(); return; }
  const child = spawn(cand.cmd, cand.args, { windowsHide: true, detached: !P.IS_WIN, stdio: ['pipe', 'ignore', 'ignore'] });
  speechChild = child;
  let settled = false;
  const next = (ok) => {
    if (settled) return;
    settled = true;
    if (speechChild === child) speechChild = null; else { onEnd(); return; } // cancelled on purpose
    if (ok) onEnd(); else speakWith(rest, text, onEnd); // tool missing or failed: try the next one
  };
  child.on('error', () => next(false));
  child.on('close', (code) => next(code === 0));
  child.stdin.on('error', () => { /* closed early */ });
  child.stdin.end(text);
}

function playerCandidates(file) {
  if (P.IS_WIN) {
    return [{
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', '(New-Object System.Media.SoundPlayer $env:SA_WAV).PlaySync()'],
      env: { SA_WAV: file },
    }];
  }
  if (P.IS_MAC) return [{ cmd: 'afplay', args: [file] }];
  return [
    { cmd: 'pw-play', args: [file] },
    { cmd: 'paplay', args: [file] },
    { cmd: 'aplay', args: ['-q', file] },
    { cmd: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', file] },
  ];
}

// Resolves when playback ends. Players are detached so they keep going while the app exits.
function playWav(file, onFail) {
  return new Promise((resolve) => {
    const tryNext = (list) => {
      const [c, ...rest] = list;
      if (!c) { if (onFail) onFail().then(resolve); else resolve(); return; }
      const child = spawn(c.cmd, c.args, {
        windowsHide: true, detached: !P.IS_WIN, stdio: 'ignore', env: { ...process.env, ...(c.env || {}) },
      });
      let settled = false;
      const end = (ok) => { if (settled) return; settled = true; if (ok) resolve(); else tryNext(rest); };
      child.on('error', () => end(false));
      child.on('close', (code) => end(code === 0));
      child.unref();
    };
    tryNext(playerCandidates(file));
  });
}

// Plays the cached clip; if it is not rendered yet, speaks the text with the system voice instead.
function announce(key) {
  const text = PHRASES[key];
  if (!text) return Promise.resolve();
  const fallback = () => new Promise((resolve) => speakWith(osCandidates(), text, resolve));
  if (fs.existsSync(phraseFile(key))) return playWav(phraseFile(key), fallback);
  ensurePhrases(Object.keys(PHRASES)); // have it ready next time
  return fallback();
}

module.exports = {
  PHRASES, greetingKey, phraseFile, ensurePhrases, announce, stopSpeech, releaseWorker,
};
