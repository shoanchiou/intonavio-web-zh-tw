import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { detectPitch } from "../dist/worklets/yin.js";

const [, , input, output] = process.argv;
const { stdout } = await promisify(execFile)(
  "ffmpeg",
  [
    "-nostdin",
    "-v",
    "error",
    "-i",
    input,
    "-ac",
    "1",
    "-ar",
    "12000",
    "-f",
    "f32le",
    "pipe:1",
  ],
  {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
    timeout: 120000,
    windowsHide: true,
  },
);
const samples = new Float32Array(
  stdout.buffer,
  stdout.byteOffset,
  stdout.byteLength / 4,
);
const frames = [];
const scratch = new Float32Array(512);
for (let offset = 0; offset + 1024 <= samples.length; offset += 600) {
  const pitch = detectPitch(
    samples.subarray(offset, offset + 1024),
    12000,
    scratch,
  );
  const hz = pitch.confidence >= 0.85 && pitch.rms >= 0.01 ? pitch.hz : null;
  frames.push({ t: (offset + 512) / 12000, hz, confidence: pitch.confidence });
}
await writeFile(output, JSON.stringify(frames));
