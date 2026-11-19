// Pin the community mirror revision and verify the model before inference.
export const MODEL_URL =
  "https://huggingface.co/Blane187/all_public_uvr_models/resolve/fddec39677560e41e3194f24a9e4c4cd32ef0e83/UVR-MDX-NET-Voc_FT.onnx";
export const MODEL_SHA256 =
  "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111";
export async function loadVerifiedModel(
  progress: (fraction: number) => void,
): Promise<ArrayBuffer> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open("intonavio-verified-model-v1");
  } catch {
    /* Private browsing may disable CacheStorage. */
  }
  let response = await cache?.match(MODEL_URL);
  const isCached = Boolean(response);
  response ??= await fetch(MODEL_URL);
  if (!response.ok)
    throw new Error(`模型下載失敗（HTTP ${response.status}）。`);
  const length = Number(response.headers.get("content-length")) || 66762490;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("無法讀取模型下載資料。");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    const chunk = new Uint8Array(item.value);
    chunks.push(chunk);
    received += chunk.length;
    if (received > 80000000) throw new Error("模型大小不符預期，已停止。");
    progress(Math.min(1, received / length));
  }
  const buffer = await new Blob(chunks).arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== MODEL_SHA256) {
    await cache?.delete(MODEL_URL);
    throw new Error("模型校驗失敗，請重新下載；未執行此模型。");
  }
  if (!isCached) {
    try {
      await cache?.put(MODEL_URL, new Response(buffer));
    } catch {
      /* Inference can proceed without disk cache. */
    }
  }
  return buffer;
}
