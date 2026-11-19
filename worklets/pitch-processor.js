import { detectPitch } from "./yin.js";

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.scratch = new Float32Array(512);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.sum = 0;
    this.step = Math.max(1, Math.round(sampleRate / 12000));
    this.hop = 0;
    this.ready = false;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    try {
      for (let i = 0; i < input.length; i++) {
        this.sum += input[i];
        if (++this.sampleCount < this.step) continue;
        this.buffer[this.writeIndex++] = this.sum / this.step;
        this.sum = 0;
        this.sampleCount = 0;
        if (this.writeIndex === this.buffer.length) {
          this.writeIndex = 0;
          this.ready = true;
        }
        if (++this.hop < 512 || !this.ready) continue;
        this.hop = 0;
        // YIN uses time differences: a cyclic rotation introduces one boundary,
        // so restore chronological sample order before analysing.
        const ordered = new Float32Array(1024);
        for (let j = 0; j < 1024; j++)
          ordered[j] = this.buffer[(this.writeIndex + j) % 1024];
        const result = detectPitch(
          ordered,
          sampleRate / this.step,
          this.scratch,
        );
        this.port.postMessage(result);
      }
    } catch (error) {
      this.port.postMessage({ error: String(error) });
      return false;
    }
    return true;
  }
}
registerProcessor("intonavio-pitch", PitchProcessor);
