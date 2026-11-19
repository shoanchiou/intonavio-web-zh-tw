import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);
const baseArgs = [
  "--ignore-config",
  "--no-playlist",
  "--no-progress",
  "--no-warnings",
  "--socket-timeout",
  "15",
  "--retries",
  "1",
  "--js-runtimes",
  "deno",
];
const videoUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// Same YouTube oEmbed lookup used by upstream apps/api/src/songs/utils/youtube.util.ts.
export async function lookupVideo(id) {
  const url = new URL("https://www.youtube.com/oembed");
  url.searchParams.set("url", videoUrl(id));
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error("YouTube 無法預覽這支影片。請確認影片公開且允許嵌入。");
  const data = await response.json();
  return {
    title: String(data.title ?? id).slice(0, 200),
    artist: String(data.author_name ?? "").slice(0, 200),
    id,
  };
}

// Windows port of workers/stem-splitter/src/youtube.py: best audio → FFmpeg → FULL.mp3.
export async function downloadAudio(id, scratchRoot, signal) {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, "youtube-"));
  try {
    await run(
      "yt-dlp",
      [
        ...baseArgs,
        "--format",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "192K",
        "--max-filesize",
        "100M",
        "--match-filters",
        "duration <= 480 & !is_live",
        "--output",
        "FULL.%(ext)s",
        "--",
        videoUrl(id),
      ],
      {
        cwd: directory,
        signal,
        timeout: 150000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      },
    );
    const result = join(directory, "FULL.mp3");
    const info = await stat(result).catch(() => undefined);
    if (!info?.size || info.size > 100 * 1024 * 1024)
      throw new Error(
        "沒有取得有效音訊。請使用 8 分鐘內、可取得音訊的公開影片。",
      );
    return await readFile(result);
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error(
        "找不到 yt-dlp。請確認 yt-dlp、FFmpeg 與 Deno 已安裝並可從 PATH 執行。",
      );
    if (error?.stderr) {
      const detail = String(error.stderr)
        .split(/\r?\n/)
        .filter(Boolean)
        .at(-1)
        ?.slice(0, 260);
      throw new Error(`YouTube 音訊取得失敗。${detail ? ` ${detail}` : ""}`);
    }
    throw error;
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 150,
    });
  }
}
