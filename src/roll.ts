import { hzToMidi, noteName } from "./pitch";
import type { PitchFrame } from "./types";

export interface Point {
  time: number;
  midi: number | null;
  color: string;
}
export class PianoRoll {
  private context: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法繪製音高圖。");
    this.context = context;
  }

  draw(
    now: number,
    reference: PitchFrame[],
    live: Point[],
    transpose: number,
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
      (frame) => frame.t >= start - 0.1 && frame.t <= end + 0.1,
    );
    const target = nearby.flatMap((frame) =>
      frame.hz ? [hzToMidi(frame.hz) + transpose] : [],
    );
    const sung = live
      .filter((point) => point.time >= start && point.midi !== null)
      .map((point) => point.midi as number);
    const center = target.length
      ? (Math.min(...target) + Math.max(...target)) / 2
      : (sung.at(-1) ?? 60);
    const span = Math.max(
      24,
      (target.length ? Math.max(...target) - Math.min(...target) : 0) + 6,
    );
    const low = Math.floor(center - span / 2),
      high = Math.ceil(center + span / 2);
    const x = (time: number) =>
      44 + ((width - 44) * (time - start)) / (end - start);
    const y = (midi: number) =>
      (height * (high - midi + 0.5)) / (high - low + 1);
    this.drawGrid(x, y, start, end, width, height, low, high);
    ctx.save();
    ctx.beginPath();
    ctx.rect(44, 0, width - 44, height);
    ctx.clip();
    const melody = nearby.map((frame) => ({
      time: frame.t,
      midi: frame.hz ? hzToMidi(frame.hz) + transpose : null,
      color: "#dc83ee",
    }));
    this.drawLine(melody, x, y, 5);
    this.drawLine(live, x, y, 3);
    ctx.strokeStyle = "#e6f6ff99";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(now), 0);
    ctx.lineTo(x(now), height);
    ctx.stroke();
    ctx.restore();
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
    const row = height / (high - low + 1);
    ctx.font = "10px system-ui";
    ctx.textBaseline = "middle";
    for (let note = low; note <= high; note++) {
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

  private drawLine(
    points: Point[],
    x: (n: number) => number,
    y: (n: number) => number,
    width: number,
  ): void {
    const ctx = this.context;
    ctx.lineCap = "round";
    ctx.lineWidth = width;
    let previous: Point | undefined;
    for (const point of points) {
      if (
        point.midi !== null &&
        previous?.midi != null &&
        point.time > previous.time &&
        point.time - previous.time < 0.13
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
