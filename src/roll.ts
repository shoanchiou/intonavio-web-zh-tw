import { hzToMidi, noteName, referenceNoteAt, type ReferenceNote } from "./pitch";
import { PitchViewport, pitchSpan } from "./pitch-viewport";

interface PitchPoint {
  time: number;
  midi: number | null;
}
export interface Point extends PitchPoint {
  color: string;
}

const maxPointGap = 0.13;
const isolatedJump = 7;

function follows(previous: PitchPoint, current: PitchPoint): boolean {
  const gap = current.time - previous.time;
  return gap > 0 && gap < maxPointGap;
}

function stabilizeTrace<T extends PitchPoint>(points: T[]): T[] {
  return points.map((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];
    if (
      point.midi === null ||
      previous?.midi == null ||
      next?.midi == null ||
      !follows(previous, point) ||
      !follows(point, next) ||
      Math.abs(previous.midi - next.midi) > 1
    )
      return point;
    const neighboringPitch = (previous.midi + next.midi) / 2;
    return Math.abs(point.midi - neighboringPitch) >= isolatedJump
      ? { ...previous, time: point.time, midi: neighboringPitch }
      : point;
  });
}

export class PianoRoll {
  private viewport = new PitchViewport();
  private context: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法繪製音高圖。");
    this.context = context;
  }

  resetViewport(): void {
    this.viewport.reset();
  }

  draw(
    now: number,
    reference: ReferenceNote[],
    live: Point[],
    transpose: number,
    animationTime: number,
    followLive: boolean,
  ): void {
    const { canvas, context: ctx } = this;
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio, 2);
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const start = now - 3,
      end = now + 4;
    const nearby = reference.filter(
      (note) => note.start < end && note.end > start,
    );
    const center = this.viewport.update(
      this.followPitch(now, nearby, live, transpose, followLive),
      animationTime,
    );
    const low = center - pitchSpan / 2,
      high = center + pitchSpan / 2;
    const x = (time: number) =>
      44 + ((width - 44) * (time - start)) / (end - start);
    const y = (midi: number) => (height * (high - midi)) / pitchSpan;
    this.drawGrid(x, y, start, end, width, height, low, high);
    ctx.save();
    ctx.beginPath();
    ctx.rect(44, 0, width - 44, height);
    ctx.clip();
    this.drawNoteBars(nearby, x, y, height / pitchSpan, now, transpose);
    const singing = live.filter((point) => point.time >= start - maxPointGap);
    this.drawLive(stabilizeTrace(singing), x, y);
    ctx.strokeStyle = "#e6f6ff99";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(now), 0);
    ctx.lineTo(x(now), height);
    ctx.stroke();
    ctx.restore();
  }

  private followPitch(
    time: number,
    reference: ReferenceNote[],
    live: Point[],
    transpose: number,
    followLive: boolean,
  ): number | null {
    // Look slightly ahead so the scale starts moving before the note reaches the edge.
    const targets = [0, 0.1, 0.2].flatMap((ahead) => {
      const hz = referenceNoteAt(reference, time + ahead)?.hz;
      return hz ? [hzToMidi(hz) + transpose] : [];
    });
    if (targets.length) {
      targets.sort((a, b) => a - b);
      return targets[Math.floor((targets.length - 1) / 2)];
    }
    if (!this.viewport.positioned) {
      const upcoming = reference.find(
        (note) => note.start >= time && note.start <= time + 1,
      )?.hz;
      if (upcoming) return hzToMidi(upcoming) + transpose;
    }
    if (!followLive) return null;
    const notes = live
      .slice(-8)
      .flatMap(({ time: at, midi }) =>
        at >= time - 0.2 && midi !== null ? [midi] : [],
      )
      .sort((a, b) => a - b);
    return notes.length >= 3 ? notes[Math.floor(notes.length / 2)] : null;
  }

  private drawGrid(
    x: (n: number) => number,
    y: (n: number) => number,
    start: number,
    end: number,
    width: number,
    height: number,
    low: number,
    high: number,
  ): void {
    const ctx = this.context;
    const row = height / pitchSpan;
    ctx.font = "10px system-ui";
    ctx.textBaseline = "middle";
    for (let note = Math.ceil(low - 0.5); note <= high + 0.5; note++) {
      const black = [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
      const top = y(note) - row / 2;
      ctx.fillStyle = black ? "#15161b" : "#191b23";
      ctx.fillRect(0, top, width, row - 0.5);
      ctx.fillStyle = black ? "#171922" : "#292c36";
      ctx.fillRect(0, top, 43, row - 0.6);
      if (note % 12 === 0 || (note - 7) % 12 === 0) {
        ctx.fillStyle = "#bfc2cd";
        ctx.fillText(noteName(note), 9, y(note));
      }
    }
    ctx.strokeStyle = "#ffffff19";
    ctx.lineWidth = 1;
    for (let second = Math.ceil(start); second <= end; second++) {
      ctx.beginPath();
      ctx.moveTo(x(second), 0);
      ctx.lineTo(x(second), height);
      ctx.stroke();
    }
  }

  private drawNoteBars(
    notes: ReferenceNote[],
    x: (n: number) => number,
    y: (n: number) => number,
    row: number,
    now: number,
    transpose: number,
  ): void {
    const ctx = this.context;
    const height = Math.min(12, row * 0.55);
    for (const note of notes) {
      const left = x(note.start);
      const width = x(note.end) - left;
      const top = y(hzToMidi(note.hz) + transpose) - height / 2;
      ctx.fillStyle =
        now >= note.start && now < note.end ? "#c8b5ff" : "#a58af2";
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, height / 2);
      ctx.fill();
    }
  }

  private drawLive(
    points: Point[],
    x: (n: number) => number,
    y: (n: number) => number,
  ): void {
    const ctx = this.context;
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    let previous: Point | undefined;
    for (const point of points) {
      if (
        point.midi !== null &&
        previous?.midi != null &&
        follows(previous, point) &&
        Math.abs(point.midi - previous.midi) < isolatedJump
      ) {
        ctx.strokeStyle = point.color;
        ctx.beginPath();
        ctx.moveTo(x(previous.time), y(previous.midi));
        ctx.lineTo(x(point.time), y(point.midi));
        ctx.stroke();
      }
      previous = point;
    }
  }
}
