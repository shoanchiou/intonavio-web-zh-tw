import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { downloadAudio } from "../server/youtube.mjs";

test(
  "authenticated audio uses a private cookie copy, limits downloads to public videos, and cleans up",
  { skip: process.platform === "win32" },
  async (context) => {
    const fixture = await mockDownloader(
      context,
      [
        "#!/bin/sh",
        "set -eu",
        'while [ "$#" -gt 0 ]; do',
        '  case "$1" in',
        '    --cookies) cookie="$2"; shift ;;',
        '    --match-filters) filter="$2"; shift ;;',
        '    --no-cache-dir) no_cache=1 ;;',
        "  esac",
        "  shift",
        "done",
        '[ "$cookie" = "$PWD/cookies.txt" ]',
        '[ "$(head -n 1 "$cookie")" = "# Netscape HTTP Cookie File" ]',
        '[ "$filter" = "availability = public & duration <= 480 & !is_live" ]',
        '[ "$no_cache" = 1 ]',
        'printf "updated by downloader" > "$cookie"',
        'printf "example audio" > FULL.mp3',
      ].join("\n") + "\n",
    );
    const cookiesFile = join(fixture, "mounted-cookies.txt");
    const cookies = "\uFEFF# Netscape HTTP Cookie File\n";
    await writeFile(cookiesFile, cookies);
    const scratch = join(fixture, "jobs");
    const audio = await downloadAudio("S62iyTeWGWA", scratch, undefined, {
      runtime: "node",
      cookiesFile,
    });
    assert.equal(audio.toString(), "example audio");
    assert.equal(await readFile(cookiesFile, "utf8"), cookies);
    assert.deepEqual(await readdir(scratch), []);
  },
);

test(
  "Render identifies missing and rejected cookies without exposing downloader details",
  { skip: process.platform === "win32" },
  async (context) => {
    const fixture = await mockDownloader(
      context,
      "#!/bin/sh\nprintf '%s\\n' 'Sign in to confirm; private downloader output' >&2\nexit 1\n",
    );
    const cookiesFile = join(fixture, "mounted-cookies.txt");
    const scratch = join(fixture, "jobs");
    const retrieve = () =>
      downloadAudio("S62iyTeWGWA", scratch, undefined, {
        runtime: "node",
        cookiesFile,
      });
    await assert.rejects(retrieve(), { message: /Render 找不到 cookies.txt/ });
    await writeFile(cookiesFile, "invalid cookie data");
    await assert.rejects(retrieve(), { message: /YouTube Cookie 格式錯誤/ });
    await writeFile(cookiesFile, "# Netscape HTTP Cookie File\n");
    await assert.rejects(retrieve(), {
      message: "YouTube 要求重新驗證。請檢查 Render 的 YouTube Cookie 是否仍有效。",
    });
    assert.deepEqual(await readdir(scratch), []);
  },
);

test(
  "an old yt-dlp reports how to update it",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const fixture = await mockDownloader(
      context,
      "#!/bin/sh\nprintf '%s\\n' 'yt-dlp: error: no such option: --js-runtimes' >&2\nexit 2\n",
    );
    await assert.rejects(
      downloadAudio("HOfdboHvshg", join(fixture, "jobs")),
      /yt-dlp.+版本太舊。.+重新開啟新版 Mac 套件/,
    );
  },
);

test(
  "yt-dlp receives the selected FFmpeg directory and reports missing tools",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const fixture = await mockDownloader(
      context,
      [
        "#!/bin/sh",
        'while [ "$#" -gt 1 ]; do',
        '  if [ "$1" = --ffmpeg-location ] && [ "$2" = "$INTONAVIO_FFMPEG_DIR" ]; then',
        "    echo 'ERROR: Postprocessing: ffprobe and ffmpeg not found.' >&2",
        "    exit 1",
        "  fi",
        "  shift",
        "done",
        "exit 2",
      ].join("\n") + "\n",
    );
    const previousDirectory = process.env.INTONAVIO_FFMPEG_DIR;
    process.env.INTONAVIO_FFMPEG_DIR = join(fixture, "media binaries");
    context.after(() => {
      if (previousDirectory === undefined)
        delete process.env.INTONAVIO_FFMPEG_DIR;
      else process.env.INTONAVIO_FFMPEG_DIR = previousDirectory;
    });
    await assert.rejects(
      downloadAudio("HOfdboHvshg", join(fixture, "jobs")),
      /找不到音訊轉檔工具.+重新開啟最新版 Mac 套件/,
    );
  },
);

async function mockDownloader(context, script) {
  const fixture = await mkdtemp(join(tmpdir(), "intonavio-test-"));
  const path = process.env.PATH;
  context.after(async () => {
    process.env.PATH = path;
    await rm(fixture, { recursive: true, force: true });
  });
  const bin = join(fixture, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "yt-dlp"), script, { mode: 0o755 });
  process.env.PATH = [bin, path].join(delimiter);
  return fixture;
}
