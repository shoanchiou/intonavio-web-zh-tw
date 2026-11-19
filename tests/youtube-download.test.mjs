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
    const fixture = await mkdtemp(join(tmpdir(), "intonavio-test-"));
    const path = process.env.PATH;
    context.after(async () => {
      process.env.PATH = path;
      await rm(fixture, { recursive: true, force: true });
    });
    const bin = join(fixture, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "yt-dlp"),
      "#!/bin/sh\nprintf '%s\\n' 'yt-dlp: error: no such option: --js-runtimes' >&2\nexit 2\n",
      { mode: 0o755 },
    );
    process.env.PATH = [bin, path].join(delimiter);
    await assert.rejects(
      downloadAudio("HOfdboHvshg", join(fixture, "jobs")),
      /yt-dlp.+版本太舊。.+重新開啟新版 Mac 套件/,
    );
  },
);
