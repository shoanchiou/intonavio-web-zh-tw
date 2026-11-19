export const pitchSpan = 18;

const followThreshold = 5;
const settleDistance = 3;
const holdMs = 160;
const maxSemitonesPerSecond = 16;

export class PitchViewport {
  center = 60;
  positioned = false;
  private lastTime?: number;
  private direction = 0;
  private since = 0;

  reset(): void {
    this.center = 60;
    this.positioned = false;
    this.lastTime = undefined;
    this.direction = 0;
  }

  update(pitch: number | null, now: number): number {
    const elapsed = now - (this.lastTime ?? now);
    this.lastTime = now;
    if (elapsed > 250 || pitch === null) this.direction = 0;
    if (pitch === null) return this.center;
    if (!this.positioned) {
      this.positioned = true;
      this.center = Math.round(pitch);
      return this.center;
    }

    const distance = pitch - this.center;
    const direction = Math.sign(distance);
    const following =
      direction === this.direction && now - this.since >= holdMs;
    if (following && Math.abs(distance) > settleDistance) {
      const step = (Math.min(elapsed, 50) * maxSemitonesPerSecond) / 1000;
      this.center +=
        direction * Math.min(step, Math.abs(distance) - settleDistance);
    } else if (Math.abs(distance) <= followThreshold) {
      this.direction = 0;
    } else if (direction !== this.direction) {
      this.direction = direction;
      this.since = now;
    }
    return this.center;
  }
}
