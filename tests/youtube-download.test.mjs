import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { downloadAudio } from "../server/youtube.mjs";

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
