import type { PitchFrame } from "./types";

export async function decodeAudio(
  blob: Blob,
  rate = 12000,
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, 1, rate);
  return context.decodeAudioData(await blob.arrayBuffer());
}

export async function analyzeReference(
  blob: Blob,
  onProgress: (fraction: number) => void,
): Promise<PitchFrame[]> {
  const buffer = await decodeAudio(blob, 16000);
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++)
      samples[i] += data[i] / buffer.numberOfChannels;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./reference-worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("音高分析逾時，請縮短音檔後重試。"));
    }, 180000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = (
      event: MessageEvent<{
        progress?: number;
        frames?: PitchFrame[];
        error?: string;
      }>,
    ) => {
      if (event.data.progress !== undefined) onProgress(event.data.progress);
      if (event.data.error) {
        finish();
        reject(new Error(event.data.error));
      }
      if (event.data.frames) {
        finish();
        resolve(event.data.frames);
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "無法啟動音高分析。"));
    };
    worker.postMessage(samples, [samples.buffer]);
  });
}
