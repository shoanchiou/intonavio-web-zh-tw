/// <reference lib="webworker" />
import { env, InferenceSession, Tensor } from "onnxruntime-web";
import modelUrl from "./models/swift-f0.onnx?url";
import { wasmPaths } from "./onnx-wasm";
import type { PitchFrame } from "./types";

// SwiftF0 by Lars Nieradzik (MIT), from lars76/swift-f0@d1ba77fe.
// Input and window sizes follow the upstream SwiftF0 inference wrapper.
const sampleRate = 16000;
const hop = 256;
const windowFrames = 1875;
const leftContext = 11;
const rightContext = 10;
const worker = self as unknown as DedicatedWorkerGlobalScope;

env.wasm.wasmPaths = wasmPaths;

worker.onmessage = ({ data }: MessageEvent<Float32Array<ArrayBuffer>>) => {
  void analyze(data).then(
    (frames) => worker.postMessage({ frames }),
    (error: unknown) =>
      worker.postMessage({
        error: error instanceof Error ? error.message : String(error),
      }),
  );
};

async function analyze(samples: Float32Array<ArrayBuffer>): Promise<PitchFrame[]> {
  const frameCount = Math.floor(samples.length / hop);
  if (!frameCount) return [];
  const model = new URL(modelUrl, worker.location.href).href;
  const session = await InferenceSession.create(model, {
    executionProviders: ["wasm"],
  });
  const fmin = new Tensor("float32", [65], []);
  const fmax = new Tensor("float32", [1100], []);
  try {
    const frames: PitchFrame[] = [];
    for (let start = 0; start < frameCount; start += windowFrames) {
      const end = Math.min(start + windowFrames, frameCount);
      const left = Math.max(0, start - leftContext);
      const window = samples.subarray(
        left * hop,
        end < frameCount ? (end + rightContext) * hop : samples.length,
      );
      const { pitch, confidence } = await session.run({
        audio: new Tensor("float32", window, [1, window.length]),
        fmin,
        fmax,
      });
      const frequencies = pitch.data as Float32Array;
      const probabilities = confidence.data as Float32Array;
      for (let frame = start; frame < end; frame++) {
        const offset = frame * hop;
        let peak = 0;
        for (let i = offset; i < offset + hop; i++)
          peak = Math.max(peak, Math.abs(samples[i]));
        const score = peak >= 0.001 ? probabilities[frame - left] : 0;
        frames.push({
          t: offset / sampleRate,
          hz: score >= 0.5 ? frequencies[frame - left] : null,
          confidence: score,
        });
      }
      worker.postMessage({ progress: end / frameCount });
    }
    return frames;
  } finally {
    await session.release();
  }
}
