import assert from "node:assert/strict";
import test from "node:test";
import { detectPitch } from "../public/worklets/yin.js";
import { extractVideoId } from "../src/youtube.ts";
import { centsBetween, frameAt, frameScore } from "../src/pitch.ts";

test("YouTube URL support uses exact hosts and 11-character identifiers", () => {
  const id = "HOfdboHvshg";
  assert.equal(extractVideoId(`https://youtu.be/${id}?t=42`), id);
  assert.equal(
    extractVideoId(`https://www.youtube.com/watch?list=PL&v=${id}`),
    id,
  );
  assert.equal(extractVideoId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(
    extractVideoId(`https://youtube.com.example.org/watch?v=${id}`),
    null,
  );
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}xx`), null);
});

test("YIN measures voiced pitch and ignores silence and DC offsets", () => {
  for (const rate of [12000, 11025, 16000]) {
    for (const hz of [82.41, 261.63, 440, 988]) {
      const samples = Float32Array.from(
        { length: 1024 },
        (_, i) => 0.1 * Math.sin((i * 2 * Math.PI * hz) / rate),
      );
      const result = detectPitch(samples, rate);
      assert.ok(
        result.confidence >= 0.85 &&
          Math.abs(centsBetween(result.hz ?? 1, hz)) < 8,
        `${hz} Hz at ${rate} Hz`,
      );
    }
  }
  assert.equal(detectPitch(new Float32Array(1024), 12000).hz, null);
  assert.equal(detectPitch(new Float32Array(1024).fill(0.1), 12000).hz, null);
});

test("Scoring respects reference rests, pitch errors and difficulty", () => {
  const frames = [
    { t: 0.05, hz: 440, confidence: 1 },
    { t: 0.1, hz: null, confidence: 0 },
  ];
  assert.equal(frameAt(frames, 0.08)?.hz, 440);
  assert.equal(frameAt(frames, 0.1)?.hz, null);
  assert.equal(frameAt(frames, 5), undefined);
  assert.equal(frameScore(null, 440, "beginner"), 0);
  assert.equal(frameScore(440, 440, "advanced"), 100);
  assert.equal(frameScore(440 * 2 ** (1 / 12), 440, "advanced"), 0);
  assert.equal(frameScore(440 * 2 ** (1 / 12), 440, "beginner"), 100);
});
