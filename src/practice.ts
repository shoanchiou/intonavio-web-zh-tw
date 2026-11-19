import { element } from "./dom";
import { t } from "./i18n";
import { Microphone } from "./microphone";
import {
  centsBetween,
  formatTime,
  frameAt,
  frameScore,
  hzToMidi,
  noteName,
} from "./pitch";
import { PianoRoll, type Point } from "./roll";
import { VideoPlayer } from "./video-player";
import type { Detection, Difficulty, Song, Track } from "./types";

export class Practice {
  private audio = element<HTMLAudioElement>("audio");
  private seek = element<HTMLInputElement>("seek");
  private track = element<HTMLSelectElement>("track");
  private micButton = element<HTMLButtonElement>("mic");
  private graph = new PianoRoll(element("chart"));
  private microphone = new Microphone();
  private video = new VideoPlayer(element("video"));
  private url?: string;
  private song?: Song;
  private markerA?: number;
  private markerB?: number;
  private total = 0;
  private count = 0;
  private points: Point[] = [];
  private live: Detection = { hz: null, rms: 0, confidence: 0 };
  private lastVideoSync = 0;
  private displayedReference: number | null = null;
  private micStartedAt = 0;
  private isVideoOpen = false;

  constructor(private notify: (message: string, kind?: string) => void) {
    element("play").onclick = () => {
      if (this.streaming) {
        if (this.video.playing) this.video.pause();
        else this.video.play();
        return;
      }
      if (this.audio.paused)
        void this.audio
          .play()
          .catch(() => this.notify(t("decodeError"), "error"));
      else this.audio.pause();
    };
    this.audio.onplay =
      this.audio.onpause =
      this.audio.onended =
        () => {
          this.syncVideo(true);
          this.render();
        };
    this.audio.onerror = () => {
      if (this.audio.getAttribute("src"))
        this.notify(t("decodeError"), "error");
    };
    this.seek.oninput = () => {
      this.seekTo(Number(this.seek.value));
      this.graph.resetViewport();
      this.reset();
      this.syncVideo(true);
    };
    this.track.onchange = () => this.playTrack(this.track.value as Track, true);
    element<HTMLSelectElement>("speed").onchange = () => {
      this.applyRate();
      this.syncVideo(true);
    };
    element("difficulty").onchange = () => this.reset();
    element("octave").onchange = () => {
      this.graph.resetViewport();
      this.reset();
    };
    element("a").onclick = () => {
      this.markerA = this.time;
      this.markerB = undefined;
      this.reset();
      this.render();
    };
    element("b").onclick = () => this.markEnd();
    element("clear-loop").onclick = () => {
      this.markerA = this.markerB = undefined;
      this.reset();
      this.render();
    };
    this.micButton.onclick = () => void this.toggleMic();
    element("toggle-video").onclick = () => void this.toggleVideo();
    window.addEventListener("pagehide", () => this.microphone.stop());
    requestAnimationFrame(this.tick);
  }

  select(song?: Song): void {
    const sameSong = this.song?.id === song?.id;
    this.song = song;
    if (sameSong && this.url) {
      this.render();
      return;
    }
    this.video.close();
    this.isVideoOpen = false;
    this.markerA = this.markerB = undefined;
    this.track.value = "original";
    this.graph.resetViewport();
    this.playTrack("original");
    this.reset();
    this.render();
    if (this.streaming && song?.videoId) {
      this.isVideoOpen = true;
      const onError = (message: string) => {
        if (this.song?.id === song.id) this.notify(message, "error");
      };
      void this.video
        .open(song.videoId, onError, true, () => {
          this.applyRate();
          this.render();
        })
        .catch((error: Error) => onError(error.message));
    }
  }

  private playTrack(track: Track, preserveTime = false): void {
    const time = preserveTime ? this.audio.currentTime : 0;
    const resume = preserveTime && !this.audio.paused;
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    const blob = this.song?.[track];
    if (!blob) {
      this.url = undefined;
      this.audio.removeAttribute("src");
      this.audio.load();
      return;
    }
    this.url = URL.createObjectURL(blob);
    this.audio.onloadedmetadata = () => {
      this.audio.currentTime = Math.min(time, this.audio.duration);
      this.applyRate();
      if (resume)
        void this.audio
          .play()
          .catch(() => this.notify(t("decodeError"), "error"));
    };
    this.audio.src = this.url;
  }

  private get streaming(): boolean {
    return Boolean(this.song?.videoId && !this.song.original);
  }
  private get playing(): boolean {
    return this.streaming ? this.video.playing : !this.audio.paused;
  }
  private get time(): number {
    return this.streaming ? this.video.time : this.audio.currentTime;
  }
  private get duration(): number {
    return this.streaming ? this.video.duration : (this.song?.duration ?? 0);
  }
  private applyRate(): void {
    const rate = Number(element<HTMLSelectElement>("speed").value);
    if (this.streaming) this.video.speed(rate);
    else this.audio.playbackRate = rate;
  }
  private seekTo(time: number): void {
    if (this.streaming) this.video.seek(time);
    else this.audio.currentTime = time;
  }
  private syncVideo(force = false): void {
    if (!this.streaming)
      this.video.sync(
        this.audio.currentTime,
        this.audio.playbackRate,
        !this.audio.paused,
        force,
      );
  }
  private async toggleVideo(): Promise<void> {
    if (this.isVideoOpen) {
      this.video.close();
      this.isVideoOpen = false;
      this.render();
      return;
    }
    if (!this.song?.videoId) return;
    this.isVideoOpen = true;
    this.render();
    const closeOnError = (message: string) => {
      this.video.close();
      this.isVideoOpen = false;
      this.notify(message, "error");
      this.render();
    };
    try {
      await this.video.open(this.song.videoId, closeOnError);
    } catch (error) {
      closeOnError(error instanceof Error ? error.message : String(error));
    }
  }

  private markEnd(): void {
    const currentTime = this.time;
    if (this.markerA === undefined || currentTime < this.markerA + 0.3)
      return this.notify(t("invalidLoop"), "error");
    this.markerB = currentTime;
    this.reset();
    this.render();
  }
  private reset(): void {
    this.total = this.count = 0;
    this.points = [];
  }
  private get difficulty(): Difficulty {
    return element<HTMLSelectElement>("difficulty").value as Difficulty;
  }
  private get transpose(): number {
    return Number(element<HTMLSelectElement>("octave").value);
  }
  private targetAt(time: number): number | null {
    const hz = frameAt(this.song?.reference ?? [], time)?.hz;
    return hz ? hz * 2 ** (this.transpose / 12) : null;
  }
  get score() {
    return this.count
      ? {
          date: new Date().toISOString(),
          score: Math.round(this.total / this.count),
          samples: this.count,
          difficulty: this.difficulty,
          isLoop: this.markerB !== undefined,
        }
      : null;
  }

  private async toggleMic(): Promise<void> {
    if (this.microphone.active) {
      this.microphone.stop();
      this.live = { hz: null, confidence: 0, rms: 0 };
      this.render();
      return;
    }
    this.micButton.disabled = true;
    element("mic-status").textContent = t("micPending");
    try {
      if (!this.song) this.points = [];
      this.micStartedAt = performance.now();
      await this.microphone.start((detection) => this.onDetection(detection));
    } catch {
      this.notify(t("micDenied"), "error");
    } finally {
      this.micButton.disabled = false;
      this.render();
    }
  }

  private onDetection(detection: Detection): void {
    this.live = detection;
    if (detection.error) {
      this.notify(detection.error, "error");
      this.render();
      return;
    }
    const hz = detection.confidence >= 0.85 ? detection.hz : null;
    const latency = Number(element<HTMLInputElement>("latency").value) / 1000;
    const time = this.song
      ? Math.max(0, this.time - latency)
      : (performance.now() - this.micStartedAt) / 1000;
    const ref = this.targetAt(time);
    const points = ref ? frameScore(hz, ref, this.difficulty) : 0;
    if (!this.song || this.playing) {
      this.points.push({
        time,
        midi: hz ? hzToMidi(hz) : null,
        color: ref
          ? points === 100
            ? "#70e2b2"
            : points
              ? "#fbbf24"
              : "#f87171"
          : "#fbbf24",
      });
      while (this.points.length > 550) this.points.shift();
    }
    if (ref && this.playing) {
      this.total += points;
      this.count++;
    }
    this.render();
  }

  private tick = (now: number): void => {
    const time = this.time;
    if (
      this.playing &&
      this.markerA !== undefined &&
      this.markerB !== undefined &&
      time >= this.markerB - 0.025
    ) {
      this.seekTo(this.markerA);
      this.points = [];
      this.syncVideo(true);
    }
    if (!this.streaming && this.isVideoOpen && now - this.lastVideoSync > 500) {
      this.lastVideoSync = now;
      this.syncVideo(!this.audio.paused && !this.video.isPlaying());
    }
    if (this.playing) this.renderTransport();
    const clock = this.song
      ? this.time
      : this.microphone.active
        ? (now - this.micStartedAt) / 1000
        : 0;
    if (this.playing && !this.microphone.active) {
      const reference = this.targetAt(clock);
      if (reference !== this.displayedReference)
        this.renderReference(reference, null);
    }
    this.graph.draw(
      clock,
      this.song?.reference ?? [],
      this.points,
      this.transpose,
      now,
      !this.song?.reference?.length &&
        this.microphone.active &&
        (!this.song || this.playing),
    );
    requestAnimationFrame(this.tick);
  };

  private renderTransport(): void {
    this.seek.max = String(this.duration || 1);
    this.seek.value = String(this.time);
    element("time").textContent =
      `${formatTime(this.time)} / ${formatTime(this.duration)}`;
  }
  render(): void {
    this.renderTransport();
    const playable = Boolean(
      this.song && (!this.streaming || this.video.canPlay),
    );
    this.seek.disabled = !playable;
    element("song-title").textContent = this.song?.title ?? t("ready");
    element("song-artist").textContent = this.song?.artist ?? "";
    for (const id of ["play", "a", "b", "clear-loop"])
      element<HTMLButtonElement>(id).disabled = !playable;
    element("play").textContent = t(this.playing ? "pause" : "play");
    this.track.disabled = !this.song?.original;
    for (const track of ["vocals", "instrumental"] as const) {
      const option = [...this.track.options].find(
        (item) => item.value === track,
      );
      if (option) option.disabled = !this.song?.[track];
    }
    const loopLabel = (time?: number) =>
      time === undefined ? "—" : `${time.toFixed(1)} s`;
    element("loop-info").textContent =
      `A ${loopLabel(this.markerA)} · B ${loopLabel(this.markerB)}`;
    element("toggle-video").hidden = !this.song?.videoId || this.streaming;
    element("toggle-video").textContent = this.isVideoOpen
      ? t("hideVideo")
      : t("showVideo");
    this.renderPitch();
  }
  private renderPitch(): void {
    const active = this.microphone.active;
    this.micButton.textContent = t(active ? "micOff" : "micOn");
    this.micButton.setAttribute("aria-pressed", String(active));
    if (!this.micButton.disabled)
      element("mic-status").textContent = t(active ? "micLive" : "micIdle");
    element<HTMLMeterElement>("level").value = this.live.rms;
    const hz = active && this.live.confidence >= 0.85 ? this.live.hz : null;
    const ref = this.targetAt(this.time);
    element("live-note").textContent = hz ? noteName(hzToMidi(hz)) : "—";
    element("live-hz").textContent = hz ? `${hz.toFixed(1)} Hz` : t("noVoice");
    this.renderReference(ref, hz);
    element("score").textContent = this.score ? `${this.score.score}%` : "—";
    element("score-count").textContent = this.count
      ? `${this.count} ${t("samples")}`
      : "";
    element<HTMLButtonElement>("save-score").disabled = !this.score;
  }

  private renderReference(ref: number | null, hz: number | null): void {
    this.displayedReference = ref;
    element("target-note").textContent = ref ? noteName(hzToMidi(ref)) : "—";
    element("deviation").textContent =
      ref && hz
        ? `${centsBetween(hz, ref).toFixed(0)} ${t("cents")}`
        : ref
          ? `${ref.toFixed(1)} Hz`
          : t("noTarget");
  }
}
