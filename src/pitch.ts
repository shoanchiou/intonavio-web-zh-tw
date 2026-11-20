import type { Difficulty, PitchFrame } from "./types";

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
export function centsBetween(hz: number, reference: number): number {
  return 1200 * Math.log2(hz / reference);
}
const notes = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(midi: number): string {
  const rounded = Math.round(midi);
  return `${notes[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}
export function referenceNoteAt(
  notes: ReferenceNote[],
  time: number,
): ReferenceNote | undefined {
  let low = 0,
    high = notes.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (notes[mid].end <= time) low = mid + 1;
    else high = mid;
  }
  const note = notes[low];
  return note && note.start <= time && time < note.end ? note : undefined;
}

export interface ReferenceNote {
  start: number;
  end: number;
  hz: number;
}

const referenceHalfFrame = 0.025;
const maxReferenceGap = 0.08;

export function stabilizeReference(frames: PitchFrame[]): PitchFrame[] {
  const pitches = frames.map(({ hz }) =>
    hz !== null && Number.isFinite(hz) && hz > 0 ? hzToMidi(hz) : null,
  );
  const result = frames.slice();
  const adjacent = (left: number, right: number) => {
    const gap = frames[right].t - frames[left].t;
    return gap > 0 && gap <= maxReferenceGap;
  };
  const stablePair = (left: number, right: number) => {
    const a = pitches[left];
    const b = pitches[right];
    return (
      a !== null && b !== null &&
      adjacent(left, right) && Math.abs(a - b) <= 1
    );
  };

  // Correct a brief pitch excursion only when it returns to the same stable note.
  for (let start = 2; start < frames.length - 2; start++) {
    const before = pitches[start - 1];
    if (before === null || !stablePair(start - 2, start - 1)) continue;
    let end = start;
    while (
      end < frames.length - 1 &&
      frames[end].t - frames[start].t < 0.15 - 1e-6
    ) {
      const pitch = pitches[end];
      if (
        pitch === null || !adjacent(end - 1, end) ||
        Math.abs(pitch - before) < 7
      )
        break;
      end++;
    }
    const after = pitches[end];
    if (
      end === start || end >= frames.length - 1 || after === null ||
      !adjacent(end - 1, end) || !stablePair(end, end + 1) ||
      Math.abs(after - before) > 1
    )
      continue;

    const from = frames[start - 1];
    const to = frames[end];
    for (let index = start; index < end; index++) {
      const progress = (frames[index].t - from.t) / (to.t - from.t);
      result[index] = {
        ...frames[index],
        hz: midiToHz(before + (after - before) * progress),
        confidence: Math.min(from.confidence, to.confidence),
      };
    }
    start = end - 1;
  }
  return result;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] +
    sorted[Math.floor(sorted.length / 2)]) / 2;
}

export function buildReferenceNotes(frames: PitchFrame[]): ReferenceNote[] {
  if (frames.length < 2) return [];
  const stabilized = stabilizeReference(frames);
  const firstGap = frames[1].t - frames[0].t;
  const halfFrame = firstGap > 0 && firstGap <= maxReferenceGap
    ? firstGap / 2
    : referenceHalfFrame;
  const maxGap = Math.min(maxReferenceGap, halfFrame * 3.2);
  const notes: ReferenceNote[] = [];
  let pitches: number[] = [];
  let start = 0;
  let end = 0;
  const flush = () => {
    if (pitches.length >= 2 && end - start >= 0.075 - 1e-6)
      notes.push({ start, end, hz: midiToHz(median(pitches)) });
    pitches = [];
  };

  for (const [index, frame] of stabilized.entries()) {
    const { t, hz } = frame;
    if (hz === null || !Number.isFinite(hz) || hz <= 0) {
      flush();
      continue;
    }
    const midi = hzToMidi(hz);
    const previous = stabilized[index - 1]?.t ?? -Infinity;
    if (
      pitches.length &&
      (t - previous > maxGap ||
        Math.abs(midi - median(pitches.slice(-5))) > 0.8)
    )
      flush();
    if (!pitches.length) {
      start = Math.max(
        0,
        t - previous <= maxGap
          ? (previous + t) / 2
          : t - halfFrame,
      );
    }
    const next = stabilized[index + 1]?.t ?? Infinity;
    end = next - t <= maxGap ? (t + next) / 2 : t + halfFrame;
    pitches.push(midi);
  }
  flush();
  return notes;
}

const thresholds: Record<Difficulty, number[]> = {
  beginner: [150, 300, 450, 100, 75, 40],
  intermediate: [75, 150, 225, 100, 60, 25],
  advanced: [25, 40, 60, 100, 50, 20],
};
export function frameScore(
  hz: number | null,
  reference: number,
  difficulty: Difficulty,
): number {
  if (!hz || !Number.isFinite(hz) || reference <= 0) return 0;
  const error = Math.abs(centsBetween(hz, reference));
  const [excellent, good, fair, high, medium, low] = thresholds[difficulty];
  if (error <= excellent) return high;
  if (error <= good) return medium;
  return error <= fair ? low : 0;
}
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
