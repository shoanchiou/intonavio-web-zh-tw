import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { computeSong } from "./compute.mjs";

const root = fileURLToPath(new URL("../.runtime/jobs", import.meta.url));
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const ttl = 48 * 60 * 60 * 1000;
const maxUpload = 100 * 1024 * 1024;
const outputs = new Map([
  ["original.mp3", "audio/mpeg"],
  ["vocals.mp3", "audio/mpeg"],
  ["instrumental.mp3", "audio/mpeg"],
  ["reference.json", "application/json"],
]);
let active;

async function save(folder, data) {
  await writeFile(join(folder, "job.new"), JSON.stringify(data));
  await rename(join(folder, "job.new"), join(folder, "job.json"));
}

async function prune() {
  const entries = await readdir(root, { withFileTypes: true });
  for (const dir of entries) {
    if (
      !dir.isDirectory() ||
      !uuid.test(dir.name) ||
      active?.data.id === dir.name
    )
      continue;
    const folder = resolve(root, dir.name);
    if (!folder.startsWith(resolve(root) + sep)) continue;
    const info = await stat(folder).catch(() => null);
    if (info && Date.now() - info.mtimeMs > ttl)
      await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

async function lookup(id) {
  if (active?.data.id === id) return active.data;
  const raw = await readFile(join(root, id, "job.json"), "utf8").catch(
    () => null,
  );
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (data.state === "running")
    return {
      ...data,
      state: "failed",
      error: "本機服務曾關閉或重新啟動，請重新送出歌曲。",
    };
  return data;
}

async function receiveSource(request, path) {
  const length = Number(request.headers["content-length"]);
  if (!Number.isSafeInteger(length) || length < 1 || length > maxUpload)
    throw new Error("請選擇 100 MB 以下的音檔。");
  let bytes = 0;
  const count = async function* (chunks) {
    for await (const chunk of chunks) {
      bytes += chunk.length;
      if (bytes > maxUpload || bytes > length)
        throw new Error("音檔大於允許上傳的大小。");
      yield chunk;
    }
    if (bytes !== length) throw new Error("音檔尚未傳到本機服務，請重試。");
  };
  await pipeline(request, count, createWriteStream(path, { flags: "wx" }));
}

async function finish(folder, task, video, source) {
  const { data, controller } = task;
  try {
    data.duration = await computeSong(
      video,
      folder,
      controller.signal,
      (stage, fraction) => {
        data.stage = stage;
        data.fraction = fraction;
      },
      source,
    );
    controller.signal.throwIfAborted();
    data.state = "ready";
  } catch (error) {
    data.error = controller.signal.aborted
      ? "已取消工作。"
      : error.message || "本機運算失敗。";
    data.state = controller.signal.aborted ? "cancelled" : "failed";
    for (const output of outputs.keys())
      await rm(join(folder, output), { force: true }).catch(() => {});
  } finally {
    if (source) await rm(source, { force: true }).catch(() => {});
    await save(folder, data).catch((error) =>
      process.stderr.write(`無法儲存工作狀態：${error.message}\n`),
    );
    active = undefined;
  }
}

export async function handleJob(req, res, url, origin, json) {
  const match = /^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match || !uuid.test(match[1]))
    return json(res, 404, { error: "找不到這項工作。" });
  const [, id, output] = match;
  const folder = join(root, id);
  if (
    (req.method === "POST" || req.method === "DELETE") &&
    (req.headers.origin !== origin ||
      req.headers["x-intonavio-action"] !== "compute")
  ) {
    return json(res, 403, { error: "請從本機 Intonavio 網頁送出工作。" });
  }
  if (req.method === "GET") {
    const data = await lookup(id);
    if (!data)
      return json(res, 404, {
        error: "這項工作尚未送達或已過期，請重新送出。",
      });
    if (!output) return json(res, 200, data);
    const type = outputs.get(output);
    if (data.state !== "ready" || !type)
      return json(res, 404, { error: "找不到運算結果。" });
    const path = join(folder, output);
    const info = await stat(path);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": info.size,
      "Cache-Control": "no-store",
    });
    return pipeline(createReadStream(path), res);
  }
  if (output) return json(res, 404, { error: "找不到這項工作。" });
  if (req.method === "DELETE") {
    if (active?.data.id === id) active.controller.abort();
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST")
    return json(res, 405, { error: "不支援這個方法。" });
  const existing = await lookup(id);
  if (existing) return json(res, 200, existing);
  const video = url.searchParams.get("v");
  if (video !== null && !videoId.test(video))
    return json(res, 400, { error: "YouTube 影片 ID 格式不正確。" });
  if (active)
    return json(res, 409, { error: "本機服務正在處理另一首歌，請稍後再試。" });
  const data = {
    id,
    state: "running",
    stage: video ? "fetching" : "writing-output",
    fraction: 0,
  };
  const task = { data, controller: new AbortController() };
  active = task;
  const source = video ? undefined : join(folder, "source.audio");
  try {
    await mkdir(root, { recursive: true });
    await mkdir(folder);
    if (source) await receiveSource(req, source);
    await save(folder, data);
  } catch (error) {
    if (source) await rm(source, { force: true }).catch(() => {});
    await rm(folder, { force: true, recursive: true }).catch(() => {});
    active = undefined;
    throw error;
  }
  void prune().catch(() => {});
  void finish(folder, task, video, source);
  return json(res, 202, data);
}
