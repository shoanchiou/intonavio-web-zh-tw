import { detectPitch } from "./yin.js";

self.onmessage = (event) => {
  try {
    const { samples, sampleRate } = event.data;
    const scratch = new Float32Array(512);
    const hop = Math.round(sampleRate * 0.05);
    const frames = [];
    for (let offset = 0; offset + 1024 <= samples.length; offset += hop) {
      const result = detectPitch(
        samples.subarray(offset, offset + 1024),
        sampleRate,
        scratch,
      );
      frames.push({
        t: (offset + 512) / sampleRate,
        hz: result.confidence >= 0.85 && result.rms >= 0.01 ? result.hz : null,
        confidence: result.confidence,
      });
      if (frames.length % 100 === 0)
        self.postMessage({ progress: offset / samples.length });
    }
    self.postMessage({ frames });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
