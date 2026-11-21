import assert from "node:assert/strict";
import test from "node:test";

let PitchProcessor;
globalThis.AudioWorkletProcessor = class {
  port = { postMessage() {} };
};
globalThis.registerProcessor = (_name, processor) => {
  PitchProcessor = processor;
};
await import("../public/worklets/pitch-processor.js");

function capture(rate, makeSample) {
  globalThis.sampleRate = rate;
  const processor = new PitchProcessor();
  const frames = [];
  const input = new Float32Array(128);
  let end = 0;
  processor.port.postMessage = (frame) => {
    assert.equal(frame.error, undefined);
    if (end >= 0.15) frames.push({ ...frame, end });
  };
  for (let offset = 0; offset < rate * 2; offset += input.length) {
    for (let i = 0; i < input.length; i++)
      input[i] = makeSample((offset + i) / rate);
    end = (offset + input.length) / rate;
    processor.process([[input]], [], { gain: [1] });
  }
  return frames;
}

function voice(rate, frequency, amplitude) {
  let phase = 0;
  return (time) => {
    phase += (2 * Math.PI * frequency(time)) / rate;
    return amplitude(time) * (
      0.75 * Math.sin(phase) +
      0.45 * Math.sin(2 * phase) +
      0.24 * Math.sin(3 * phase)
    );
  };
}

test("live pitch tracks quiet notes and quick note changes", () => {
  for (const rate of [44100, 48000]) {
    const quiet = capture(rate, voice(rate, () => 220, () => 0.004));
    assert.ok(quiet.length > 30);
    assert.ok(quiet.every(({ hz }) => hz !== null && Math.abs(hz - 220) < 2));

    const notes = capture(
      rate,
      voice(rate, (t) => (Math.floor(t / 0.18) % 2 ? 329.63 : 220), () => 0.07),
    );
    assert.ok(notes.length > 30);
    assert.ok(notes.every(({ hz }) => hz !== null));
    assert.ok(notes.some(({ hz }) => Math.abs(hz - 220) < 2));
    assert.ok(notes.some(({ hz }) => Math.abs(hz - 329.63) < 2));
  }
});

test("live pitch leaves quiet noise and rests unvoiced", () => {
  let seed = 77;
  const noise = capture(48000, () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return (seed / 2147483648 - 1) * 0.005;
  });
  assert.ok(noise.length > 30);
  assert.ok(noise.every(({ hz }) => hz === null));
  const rest = capture(48000, voice(48000, () => 220, (t) => (t < 1 ? 0.07 : 0)));
  assert.ok(rest.some(({ hz, end }) => end < 1 && hz !== null));
  assert.ok(rest.filter(({ end }) => end > 1.12).every(({ hz }) => hz === null));
});
