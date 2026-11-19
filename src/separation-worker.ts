/// <reference lib="webworker" />
import { AudioUtils, createSeparator } from "web-audio-separation";
import { loadVerifiedModel } from "./model";
import type { SeparationUpdate } from "./separate";

const worker = self as unknown as DedicatedWorkerGlobalScope;

function send(data: SeparationUpdate): void {
  worker.postMessage(data);
}

worker.onmessage = (event: MessageEvent<Float32Array[]>) => {
  void runSeparation(event.data).catch((error: unknown) =>
    send({ error: error instanceof Error ? error.message : String(error) }),
  );
};

async function runSeparation(channels: Float32Array[]): Promise<void> {
  // The separator's default loader needs OfflineAudioContext. This worker gets
  // the same 44.1 kHz PCM from the page and handles everything after decoding.
  AudioUtils.loadAudioFile = async () => channels;
  const bytes = await loadVerifiedModel((fraction) =>
    send({ stage: "download", fraction }),
  );
  const modelUrl = URL.createObjectURL(new Blob([bytes]));
  let urls: string[] = [];
  try {
    const separator = createSeparator("UVR-MDX-NET-Voc_FT", {
      common: {
        modelUrl,
        modelPath: modelUrl,
        logLevel: "error",
        onProgress: ({ stage, fraction }) => send({ stage, fraction }),
      },
      mdx: {
        executionProviders: "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"],
        segmentSize: 256,
        overlap: 0.25,
        batchSize: 1,
      },
    });
    await separator.loadModel();
    urls = await separator.separate("imported audio");
    if (urls.length !== 2) throw new Error("分離輸出數量不符預期。");
    // The library returns the secondary stem first, then the primary stem.
    const [instrumental, vocals] = await Promise.all(
      urls.map(async (url) => (await fetch(url)).blob()),
    );
    send({ vocals, instrumental });
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
    URL.revokeObjectURL(modelUrl);
  }
}
