import assert from "node:assert/strict";
import test from "node:test";
import { fitPitchRange } from "../src/pitch-viewport.ts";

test("a narrow melody gets at least 18 semitones of display space", () => {
  assert.deepEqual(fitPitchRange([60, 62, 64]), { low: 53, high: 71 });
});

test("a wide melody keeps room for the full pitch range at once", () => {
  const pitches = [60, 84.25, 72, 45.75, 48, 68];
  assert.deepEqual(fitPitchRange(pitches), { low: 43, high: 87 });
  assert.deepEqual(fitPitchRange(pitches.reverse()), { low: 43, high: 87 });
});

test("free singing uses a fixed range that covers microphone detection", () => {
  assert.deepEqual(fitPitchRange([]), { low: 34, high: 86 });
  assert.deepEqual(fitPitchRange([NaN, Infinity]), { low: 34, high: 86 });
});
