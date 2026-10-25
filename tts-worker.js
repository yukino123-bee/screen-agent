'use strict';
// Runs the Kokoro neural voice in its own process. It uses a different onnxruntime build than the
// speech recognition in main.js, and the two native libraries cannot share one process.
const path = require('path');

let tts = null;
const post = (msg) => process.parentPort.postMessage(msg);

process.parentPort.on('message', async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      const kokoroPath = require.resolve('kokoro-js');
      const { env } = require(require.resolve('@huggingface/transformers', { paths: [path.dirname(kokoroPath)] }));
      env.cacheDir = m.cacheDir;
      const { KokoroTTS } = require('kokoro-js');
      tts = await KokoroTTS.from_pretrained(m.model, {
        dtype: 'q8', device: 'cpu',
        progress_callback: (p) => { if (p.status === 'progress') post({ type: 'progress', pct: Math.floor(p.progress / 10) * 10 }); },
      });
      post({ type: 'ready' });
    } else if (m.type === 'generate') {
      const a = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
      post({ type: 'audio', req: m.req, rate: a.sampling_rate, samples: a.audio });
    }
  } catch (err) {
    post({ type: 'error', req: m.req, message: err.message });
  }
});
