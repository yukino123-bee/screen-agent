'use strict';
// Collects the microphone's 128-sample blocks into larger frames for the voice detector.
class MicFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.len = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.len++] = ch[i];
      if (this.len === this.buf.length) {
        this.port.postMessage(this.buf);
        this.buf = new Float32Array(2048);
        this.len = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic-frames', MicFrames);
