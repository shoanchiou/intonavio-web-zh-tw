const minimumSpan = 18;
const padding = 2.5;

export function fitPitchRange(pitches: readonly number[]): {
  low: number;
  high: number;
} {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const pitch of pitches) {
    if (!Number.isFinite(pitch)) continue;
    lowest = Math.min(lowest, pitch);
    highest = Math.max(highest, pitch);
  }
  // Free singing and songs without a guide use the full microphone pitch range.
  if (lowest === Infinity) return { low: 34, high: 86 };

  const low = Math.floor(lowest - padding);
  const high = Math.ceil(highest + padding);
  const extra = Math.max(0, minimumSpan - (high - low));
  return { low: low - Math.floor(extra / 2), high: high + Math.ceil(extra / 2) };
}
