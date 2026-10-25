'use strict';
// Microphone capture with a simple energy-based voice activity detector.
// Speech segments are handed to the caller as 16 kHz mono Float32Array (what Whisper expects).
(function () {
  const BUFFER = 2048;
  const TARGET_RATE = 16000;
  const START_FRAMES = 2;        // consecutive loud frames that start a phrase
  const END_SILENCE_S = 0.9;     // silence that ends a phrase
  const MIN_SPEECH_S = 0.4;
  const MAX_SPEECH_S = 28;
  const PRE_ROLL_FRAMES = 4;
  const MIN_THRESHOLD = 0.02;

  function resample(input, rate) {
    if (rate === TARGET_RATE) return input;
    const ratio = rate / TARGET_RATE;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j];
      out[i] = sum / Math.max(1, to - from);
    }
    return out;
  }

  window.createVoice = function ({ onSpeech, onState }) {
    let ctx = null;
    let stream = null;
    let node = null;
    let source = null;
    let mute = null;
    let paused = false;
    let state = 'off'; // off | listening | speech

    let noise = 0.01;
    let loud = 0;
    let silent = 0;
    let frames = [];
    let preRoll = [];

    function setState(s) {
      if (s !== state) { state = s; onState(s); }
    }

    function reset() {
      loud = 0; silent = 0; frames = []; preRoll = [];
      if (state === 'speech') setState('listening');
    }

    function finish() {
      const rate = ctx.sampleRate;
      const total = frames.reduce((n, f) => n + f.length, 0);
      const seconds = total / rate - silent * BUFFER / rate;
      const all = new Float32Array(total);
      let o = 0;
      for (const f of frames) { all.set(f, o); o += f.length; }
      reset();
      if (seconds >= MIN_SPEECH_S) onSpeech(resample(all, rate));
    }

    function onFrame(data) {
      if (paused || !ctx) return;
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const threshold = Math.max(MIN_THRESHOLD, noise * 3.5);
      const copy = new Float32Array(data);
      const isLoud = rms > threshold;

      if (state !== 'speech') {
        if (!isLoud) noise = noise * 0.95 + rms * 0.05;
        preRoll.push(copy);
        if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift();
        loud = isLoud ? loud + 1 : 0;
        if (loud >= START_FRAMES) {
          frames = preRoll.slice();
          preRoll = [];
          silent = 0;
          setState('speech');
        }
        return;
      }

      frames.push(copy);
      silent = isLoud ? 0 : silent + 1;
      const frameS = BUFFER / ctx.sampleRate;
      if (silent * frameS >= END_SILENCE_S || frames.length * frameS >= MAX_SPEECH_S) finish();
    }

    async function start() {
      if (ctx) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      ctx = new AudioContext();
      source = ctx.createMediaStreamSource(stream);
      try {
        await ctx.audioWorklet.addModule('mic-worklet.js');
        node = new AudioWorkletNode(ctx, 'mic-frames');
        node.port.onmessage = (ev) => onFrame(ev.data);
      } catch {
        // No AudioWorklet here: the older ScriptProcessor does the same job.
        node = ctx.createScriptProcessor(BUFFER, 1, 1);
        node.onaudioprocess = (ev) => onFrame(ev.inputBuffer.getChannelData(0));
      }
      mute = ctx.createGain();
      mute.gain.value = 0; // keep the node running without playing the mic back
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      paused = false;
      noise = 0.01;
      reset();
      setState('listening');
    }

    function stop() {
      if (!ctx) return;
      try { node.disconnect(); source.disconnect(); mute.disconnect(); } catch { /* already disconnected */ }
      for (const t of stream.getTracks()) t.stop();
      ctx.close();
      ctx = stream = node = source = mute = null;
      reset();
      setState('off');
    }

    return {
      start, stop,
      pause() { paused = true; reset(); },
      resume() { paused = false; reset(); },
      get active() { return !!ctx; },
    };
  };
})();
