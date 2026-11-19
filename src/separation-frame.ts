import { createSeparator } from "web-audio-separation";
import { loadVerifiedModel } from "./model";

function send(data: object): void {
  parent.postMessage(data, location.origin);
}
let started = false;
window.addEventListener(
  "message",
  (event: MessageEvent<{ command?: string; file?: Blob }>) => {
    if (event.origin !== location.origin || event.source !== parent || started)
      return;
    if (event.data.command !== "separate" || !(event.data.file instanceof Blob))
      return;
    started = true;
    void runSeparation(event.data.file).catch((error: unknown) =>
      send({ error: error instanceof Error ? error.message : String(error) }),
    );
  },
);

async function runSeparation(file: Blob): Promise<void> {
  const bytes = await loadVerifiedModel((fraction) =>
    send({ stage: "download", fraction }),
  );
  send({ stage: "loading-model", fraction: 0 });
  const modelUrl = URL.createObjectURL(new Blob([bytes]));
  const inputUrl = URL.createObjectURL(file);
  try {
    const separator = createSeparator("UVR-MDX-NET-Voc_FT", {
      common: {
        modelUrl,
        modelPath: modelUrl,
        logLevel: "error",
        onProgress: (progress) => send(progress),
      },
      mdx: {
        executionProviders: "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"],
        segmentSize: 256,
        overlap: 0.25,
        batchSize: 1,
      },
    });
    await separator.loadModel();
    const urls = await separator.separate(inputUrl);
    if (urls.length !== 2) throw new Error("分離輸出數量不符預期。");
    // This library writes the secondary stem first: Instrumental, then Vocals.
    const instrumental = await (await fetch(urls[0])).blob();
    const vocals = await (await fetch(urls[1])).blob();
    urls.forEach((url) => URL.revokeObjectURL(url));
    send({ vocals, instrumental, complete: true });
  } finally {
    URL.revokeObjectURL(modelUrl);
    URL.revokeObjectURL(inputUrl);
  }
}
send({ ready: true });
