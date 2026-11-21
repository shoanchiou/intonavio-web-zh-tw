// YIN, based on the algorithm documented in Intonavio (MIT, Pawel Gawliczek).
// This module is shared by the AudioWorklet, offline worker and unit tests.
export function detectPitch(
  samples,
  sampleRate,
  scratch = new Float32Array(512),
  minimumRms = 0.006,
) {
  const count = Math.floor(samples.length / 2);
  const maxLag = Math.min(
    Math.ceil(sampleRate / 65),
    count - 2,
    scratch.length - 2,
  );
  const minLag = Math.max(2, Math.floor(sampleRate / 1100));
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / samples.length);
  if (!Number.isFinite(rms) || rms < minimumRms || minLag >= maxLag)
    return { hz: null, confidence: 0, rms };
  let cumulative = 0;
  scratch[0] = 1;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const d = samples[i] - samples[i + lag];
      sum += d * d;
    }
    cumulative += sum;
    scratch[lag] = cumulative > 0 ? (sum * lag) / cumulative : 1;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scratch[lag] >= 0.15) continue;
    while (lag < maxLag && scratch[lag + 1] < scratch[lag]) lag++;
    const denominator = scratch[lag - 1] - 2 * scratch[lag] + scratch[lag + 1];
    const offset =
      Math.abs(denominator) > 1e-9
        ? (scratch[lag - 1] - scratch[lag + 1]) / (2 * denominator)
        : 0;
    const hz = sampleRate / (lag + offset);
    if (hz >= 65 && hz <= 1100)
      return { hz, confidence: 1 - scratch[lag], rms };
    break;
  }
  return { hz: null, confidence: 0, rms };
}
