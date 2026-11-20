import assert from "node:assert/strict";
import test from "node:test";
import { detectPitch } from "../public/worklets/yin.js";
import { extractVideoId } from "../src/youtube.ts";
import {
  buildReferenceNotes,
  centsBetween,
  frameScore,
  midiToHz,
  referenceNoteAt,
  stabilizeReference,
} from "../src/pitch.ts";

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
  const notes = buildReferenceNotes(referenceFrames([440, 440, null]));
  assert.equal(referenceNoteAt(notes, 0.05)?.hz, 440);
  assert.equal(referenceNoteAt(notes, 0.1), undefined);
  assert.equal(referenceNoteAt(notes, 5), undefined);
  assert.equal(frameScore(null, 440, "beginner"), 0);
  assert.equal(frameScore(440, 440, "advanced"), 100);
  assert.equal(frameScore(440 * 2 ** (1 / 12), 440, "advanced"), 0);
  assert.equal(frameScore(440 * 2 ** (1 / 12), 440, "beginner"), 100);
});

const referenceFrames = (notes) =>
  notes.map((hz, index) => ({ t: index * 0.05, hz, confidence: 0.98 }));

test("Reference pitch corrects a brief octave error between stable notes", () => {
  const reference = referenceFrames([220, 220, 440, 110, 440, 220, 220]);
  const stabilized = stabilizeReference(reference);
  assert.deepEqual(stabilized, referenceFrames([220, 220, 220, 220, 220, 220, 220]));
  assert.equal(reference[2].hz, 440);
  assert.equal(referenceNoteAt(buildReferenceNotes(reference), 0.12)?.hz, 220);
});

test("Reference notes use a stable center, drop isolated detections and keep distinct pitches", () => {
  const notes = buildReferenceNotes(referenceFrames([
    midiToHz(57.2), midiToHz(56.8), midiToHz(57),
    null, 900, null,
    midiToHz(58), midiToHz(58), 440, 440, 440, 440,
  ]));
  assert.equal(notes.length, 3);
  assert.equal(referenceNoteAt(notes, 0.05)?.hz, 220);
  assert.equal(referenceNoteAt(notes, 0.2), undefined);
  assert.equal(referenceNoteAt(notes, 0.31)?.hz, midiToHz(58));
  const switchAt = notes[1].end;
  assert.equal(switchAt, notes[2].start);
  assert.equal(referenceNoteAt(notes, switchAt)?.hz, 440);
  assert.equal(frameScore(440, referenceNoteAt(notes, 0.5)?.hz, "advanced"), 100);
});

test("Reference notes leave room for missing frames", () => {
  const frames = referenceFrames([440, 440, 440, 440]);
  frames[2].t = 1;
  frames[3].t = 1.05;
  const notes = buildReferenceNotes(frames);
  assert.equal(notes.length, 2);
  assert.equal(referenceNoteAt(notes, 0.5), undefined);
});

test("SwiftF0 frame spacing keeps notes and rejects short unconfirmed detections", () => {
  const frames = [220, 220, 220, 220, 220, 220, null, 440, 440, 440, null,
    330, 330, 330, 330, 330, 330].map((hz, index) => ({
    t: index * 0.016,
    hz,
    confidence: 0.98,
  }));
  const notes = buildReferenceNotes(frames);
  assert.equal(notes.length, 2);
  assert.equal(referenceNoteAt(notes, 0.048)?.hz, 220);
  assert.equal(referenceNoteAt(notes, 0.128), undefined);
  assert.ok(Math.abs(referenceNoteAt(notes, 0.224)?.hz - 330) < 0.01);
});

test("Reference pitch preserves real transitions, rests and unfinished phrases", () => {
  for (const notes of [
    [220, 220, 440, 440, 440, 440, 220, 220],
    [220, 220, 440, 440, 330, 330],
    [220, 220, 440, null, 220, 220],
    [220, 220, 440, 440, 220],
  ]) {
    const reference = referenceFrames(notes);
    assert.deepEqual(stabilizeReference(reference), reference);
  }
});
