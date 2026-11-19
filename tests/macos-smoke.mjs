import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const port = process.env.INTONAVIO_TEST_PORT || 3218;
const origin = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 40; attempt++) {
  const health = await fetch(`${origin}/api/health`).catch(() => null);
  if (health?.ok) {
    assert.equal((await health.json()).service, "intonavio-local");
    break;
  }
  if (attempt === 39) throw new Error("Local server did not start");
  await delay(250);
}

assert.match(await (await fetch(origin)).text(), /downloadMac/);
const audio = execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=3",
  "-ac",
  "2",
  "-ar",
  "44100",
  "-f",
  "wav",
  "pipe:1",
]);
const job = `${origin}/api/jobs/${randomUUID()}`;
const started = await fetch(job, {
  method: "POST",
  headers: { Origin: origin, "X-Intonavio-Action": "compute" },
  body: audio,
});
assert.equal(started.status, 202, await started.text());
let stage;
for (let attempt = 0; attempt < 360; attempt++) {
  const response = await fetch(job);
  assert.equal(response.status, 200);
  const status = await response.json();
  if (status.stage !== stage) {
    stage = status.stage;
    console.log(stage);
  }
  if (status.state === "ready") {
    assert.ok(status.duration > 2);
    for (const track of ["original", "vocals", "instrumental"]) {
      const result = await fetch(`${job}/${track}.mp3`);
      assert.equal(result.status, 200);
      assert.ok((await result.arrayBuffer()).byteLength > 1000);
    }
    const reference = await (await fetch(`${job}/reference.json`)).json();
    assert.ok(Array.isArray(reference) && reference.length > 25);
    assert.ok(reference.every((frame) => Number.isFinite(frame.t)));
    console.log("All three tracks and reference pitch frames returned.");
    break;
  }
  assert.equal(status.state, "running", status.error);
  if (attempt === 359) throw new Error("Audio processing timed out");
  await delay(2000);
}
