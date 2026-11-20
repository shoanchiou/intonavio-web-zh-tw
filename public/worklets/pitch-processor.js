import { detectPitch } from "./yin.js";

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: "gain",
      defaultValue: 1,
      minValue: 0.25,
      maxValue: 2,
      automationRate: "k-rate",
    }];
  }

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
    this.inputPeak = 0;
    this.peak = 0;
    this.ordered = new Float32Array(1024);
  }
  process(inputs, _outputs, parameters) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    try {
      const gain = parameters.gain[0];
      for (let i = 0; i < input.length; i++) {
        const sample = input[i];
        const adjusted = sample * gain;
        this.inputPeak = Math.max(this.inputPeak, Math.abs(sample));
        this.peak = Math.max(this.peak, Math.abs(adjusted));
        this.sum += adjusted;
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
        for (let j = 0; j < 1024; j++)
          this.ordered[j] = this.buffer[(this.writeIndex + j) % 1024];
        const result = detectPitch(
          this.ordered,
          sampleRate / this.step,
          this.scratch,
        );
        this.port.postMessage({
          ...result,
          inputPeak: this.inputPeak,
          peak: this.peak,
        });
        this.inputPeak = 0;
        this.peak = 0;
      }
    } catch (error) {
      this.port.postMessage({ error: String(error) });
      return false;
    }
    return true;
  }
}
registerProcessor("intonavio-pitch", PitchProcessor);
