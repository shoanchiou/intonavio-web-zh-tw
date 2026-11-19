import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { downloadAudio } from "./youtube.mjs";

const exec = promisify(execFile);
const directory = fileURLToPath(new URL("../.runtime/", import.meta.url));
const modelName = "UVR-MDX-NET-Voc_FT.onnx";
const modelUrl = `https://huggingface.co/Blane187/all_public_uvr_models/resolve/fddec39677560e41e3194f24a9e4c4cd32ef0e83/${modelName}`;
const modelHash =
  "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111";

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

async function ensureModel(signal, update) {
  const folder = join(directory, "models");
  await mkdir(folder, { recursive: true });
  const target = join(folder, modelName);
  if ((await sha256(target).catch(() => "")) === modelHash) return target;
  update("download", 0);
  const temporary = `${target}.part`;
  try {
    const response = await fetch(modelUrl, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
    });
    if (!response.ok || !response.body)
      throw new Error(`模型下載失敗（HTTP ${response.status}）。請重試。`);
    let received = 0;
    const counted = async function* (chunks) {
      for await (const bytes of chunks) {
        received += bytes.length;
        if (received > 80000000) throw new Error("模型檔案大小不符預期。");
        update("download", Math.min(received / 66762490, 1));
        yield bytes;
      }
    };
    const { createWriteStream } = await import("node:fs");
    await pipeline(
      Readable.fromWeb(response.body),
      counted,
      createWriteStream(temporary),
      { signal },
    );
    if ((await sha256(temporary)) !== modelHash)
      throw new Error("模型檔案校驗失敗，請重試。");
    await rename(temporary, target);
    return target;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function ensurePython(signal, update) {
  const venv = join(directory, "compute");
  const python = join(venv, "Scripts", "python.exe");
  const options = {
    signal,
    timeout: 300000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  };
  try {
    await exec(python, ["-c", "import numpy, onnxruntime"], options);
    return python;
  } catch {
    signal.throwIfAborted();
  }
  update("setup-engine", 0);
  try {
    await exec("py", ["-3.13", "-m", "venv", venv], options);
    await exec(
      python,
      [
        "-m",
        "pip",
        "--isolated",
        "install",
        "--only-binary=:all:",
        "--disable-pip-version-check",
        "numpy==2.5.5",
        "onnxruntime==1.32.0",
      ],
      options,
    );
    return python;
  } catch (error) {
    signal.throwIfAborted();
    const detail = String(error.stderr ?? "")
      .trim()
      .split(/\r?\n/)
      .at(-1)
      ?.slice(0, 220);
    throw new Error(
      `背景運算環境未能準備。請確認已安裝 Python 3.13，並可連線到 PyPI。${detail ? ` ${detail}` : ""}`,
    );
  }
}

function runSeparation(python, args, signal, update) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2700000)]),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pending = "",
      errors = "",
      duration;
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        try {
          const data = JSON.parse(line);
          if (typeof data.duration === "number") duration = data.duration;
          if (typeof data.stage === "string") update(data.stage, data.fraction);
        } catch {
          /* Subprocess progress is newline-delimited JSON. */
        }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      errors = (errors + chunk).slice(-5000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && typeof duration === "number") resolve(duration);
      else
        reject(
          new Error(
            `本機人聲分離失敗。${errors.trim().split(/\r?\n/).at(-1)?.slice(0, 240) ?? ""}`,
          ),
        );
    });
  });
}

export async function computeSong(id, folder, signal, update, source) {
  const original = join(folder, "original.mp3");
  if (source) {
    update("writing-output", 0);
    await exec(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-t",
        "480.6",
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        original,
      ],
      { signal, timeout: 150000, windowsHide: true },
    );
  } else {
    update("fetching", 0);
    await writeFile(original, await downloadAudio(id, directory, signal));
  }
  const python = await ensurePython(signal, update);
  const model = await ensureModel(signal, update);
  update("loading-model", 0);
  const duration = await runSeparation(
    python,
    [
      fileURLToPath(new URL("separate.py", import.meta.url)),
      original,
      model,
      folder,
    ],
    signal,
    update,
  );
  update("analyzing", 0);
  await exec(
    process.execPath,
    [
      fileURLToPath(new URL("reference.mjs", import.meta.url)),
      join(folder, "vocals.mp3"),
      join(folder, "reference.json"),
    ],
    { signal, timeout: 180000, windowsHide: true },
  );
  return duration;
}
