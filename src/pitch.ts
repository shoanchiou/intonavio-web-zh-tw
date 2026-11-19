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
export function frameAt(
  frames: PitchFrame[],
  time: number,
): PitchFrame | undefined {
  if (
    !frames.length ||
    time < frames[0].t - 0.05 ||
    time > frames[frames.length - 1].t + 0.06
  )
    return undefined;
  let low = 0,
    high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (frames[mid].t <= time) low = mid;
    else high = mid - 1;
  }
  return Math.abs(time - frames[low].t) <= 0.06 ? frames[low] : undefined;
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
