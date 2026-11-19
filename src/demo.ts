import { midiToHz } from "./pitch";
import type { Song } from "./types";

export function createWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    Array.from(value).forEach((letter, i) =>
      view.setUint8(offset + i, letter.charCodeAt(0)),
    );
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767),
      true,
    );
  return new Blob([buffer], { type: "audio/wav" });
}
export function makeDemo(): Song {
  const rate = 24000,
    notes = [60, 62, 64, 65, 67, 65, 64, 62, 60];
  const samples = new Float32Array(rate * (notes.length + 1));
  const reference = [];
  for (let n = 0; n < notes.length; n++) {
    const hz = midiToHz(notes[n]);
    for (let i = 0; i < rate; i++) {
      const t = i / rate;
      const envelope = Math.min(1, t / 0.04, Math.max(0, (0.85 - t) / 0.08));
      samples[(n + 1) * rate + i] =
        envelope *
        0.2 *
        (Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(4 * Math.PI * hz * t));
    }
    for (let i = 0; i < 20; i++)
      reference.push({
        t: n + 1 + i * 0.05,
        hz: i > 0 && i < 17 ? hz : null,
        confidence: 1,
      });
  }
  const original = createWav(samples, rate);
  return {
    id: "demo-scale-v1",
    title: "♪ Do Re Mi · 音階暖身",
    createdAt: Date.now(),
    duration: samples.length / rate,
    original,
    vocals: original,
    reference,
    history: [],
  };
}
