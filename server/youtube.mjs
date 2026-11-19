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

// Adapted from workers/stem-splitter/src/youtube.py: best audio → FFmpeg → FULL.mp3.
export async function downloadAudio(
  id,
  scratchRoot,
  signal,
  { runtime = "deno", maxBytes = 100 * 1024 * 1024 } = {},
) {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, "youtube-"));
  const ffmpegDirectory = process.env.INTONAVIO_FFMPEG_DIR;
  try {
    await run(
      "yt-dlp",
      [
        ...baseArgs,
        ...(runtime === "node" ? ["--no-js-runtimes"] : []),
        "--js-runtimes",
        runtime,
        ...(ffmpegDirectory ? ["--ffmpeg-location", ffmpegDirectory] : []),
        "--format",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "192K",
        "--max-filesize",
        `${Math.floor(maxBytes / (1024 * 1024))}M`,
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
    if (!info?.size || info.size > maxBytes)
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
      const stderr = String(error.stderr);
      if (/no such option:\s*--(?:no-)?js-runtimes\b/i.test(stderr)) {
        const update =
          process.platform === "darwin"
            ? "請關閉舊的終端機視窗，重新開啟新版 Mac 套件的啟動檔。看到更新提示時輸入 y，再重新處理歌曲。"
            : "請在終端機執行 winget upgrade --id yt-dlp.yt-dlp，更新後重新啟動練唱工具再試。";
        throw new Error("YouTube 下載工具（yt-dlp）版本太舊。" + update);
      }
      if (/(?:ffmpeg|ffprobe) not found\b/i.test(stderr)) {
        const repair =
          process.platform === "darwin"
            ? "請關閉舊的終端機視窗，重新開啟最新版 Mac 套件的啟動檔。出現安裝或修復提示時輸入 y。"
            : "請安裝包含 ffprobe 的 FFmpeg，再重新啟動練唱工具。";
        throw new Error("找不到音訊轉檔工具（ffmpeg 或 ffprobe）。" + repair);
      }
      const detail = stderr
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
