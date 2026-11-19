interface Player {
  mute(): void;
  destroy(): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  unMute(): void;
  getDuration(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
}
interface PlayerOptions {
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: { target: Player }): void;
    onError(event: { data: number }): void;
    onStateChange(): void;
  };
}
interface YouTubeWindow extends Window {
  YT?: { Player: new (element: HTMLElement, options: PlayerOptions) => Player };
  onYouTubeIframeAPIReady?: () => void;
}
const youtubeWindow = window as YouTubeWindow;
let loading: Promise<NonNullable<YouTubeWindow["YT"]>> | undefined;
function loadPlayer() {
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timeout);
      loading = undefined;
      script.remove();
      reject(new Error("無法載入 YouTube 播放器。"));
    };
    const timeout = window.setTimeout(fail, 12000);
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (youtubeWindow.YT?.Player) resolve(youtubeWindow.YT);
      else fail();
    };
    script.onerror = fail;
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return loading;
}

// The original Swift WKWebView bridge uses the same IFrame API. Here local
// stems own the playback clock, and the optional video follows while muted.
export class VideoPlayer {
  private player?: Player;
  private ready = false;
  private generation = 0;
  constructor(private container: HTMLElement) {}

  async open(
    id: string,
    onError: (message: string) => void,
    streaming = false,
    onChange = () => {},
  ): Promise<void> {
    this.close();
    this.container.hidden = false;
    const generation = this.generation;
    const api = await loadPlayer();
    if (generation !== this.generation) return;
    const target = document.createElement("div");
    this.container.append(target);
    this.player = new api.Player(target, {
      videoId: id,
      playerVars: {
        controls: streaming ? 1 : 0,
        rel: 0,
        playsinline: 1,
        origin: location.origin,
      },
      events: {
        onReady: ({ target: player }) => {
          if (generation !== this.generation) return;
          if (streaming) player.unMute();
          else player.mute();
          this.ready = true;
          onChange();
        },
        onStateChange: () => {
          if (generation === this.generation) onChange();
        },
        onError: ({ data }) => {
          if (generation === this.generation) {
            this.close();
            onError(
              `YouTube 無法嵌入此影片（${data}）。仍可播放已處理的音軌。`,
            );
          }
        },
      },
    });
  }
  sync(time: number, rate: number, isPlaying: boolean, force = false): void {
    if (!this.ready || !this.player) return;
    if (force || Math.abs(this.player.getCurrentTime() - time) > 0.35)
      this.player.seekTo(time, true);
    if (!force) return;
    const speeds = this.player.getAvailablePlaybackRates();
    const nearest = speeds.reduce(
      (a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a),
      1,
    );
    this.player.setPlaybackRate(nearest);
    if (isPlaying) this.player.playVideo();
    else this.player.pauseVideo();
  }
  isPlaying(): boolean {
    return (
      !this.ready ||
      this.player?.getPlayerState() === 1 ||
      this.player?.getPlayerState() === 3
    );
  }
  get canPlay(): boolean {
    return this.ready;
  }
  get time(): number {
    return this.ready ? (this.player?.getCurrentTime() ?? 0) : 0;
  }
  get duration(): number {
    return this.ready ? (this.player?.getDuration() ?? 0) : 0;
  }
  get playing(): boolean {
    return this.ready && this.player?.getPlayerState() === 1;
  }
  play(): void {
    if (this.ready) this.player?.playVideo();
  }
  pause(): void {
    if (this.ready) this.player?.pauseVideo();
  }
  seek(time: number): void {
    if (this.ready) this.player?.seekTo(time, true);
  }
  speed(rate: number): void {
    if (!this.ready || !this.player) return;
    const nearest = this.player
      .getAvailablePlaybackRates()
      .reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a), 1);
    this.player.setPlaybackRate(nearest);
  }
  close(): void {
    this.generation++;
    this.ready = false;
    this.player?.destroy();
    this.player = undefined;
    this.container.replaceChildren();
    this.container.hidden = true;
  }
}
