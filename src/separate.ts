export interface SeparationResult {
  vocals: Blob;
  instrumental: Blob;
}
export class SeparationTask {
  private cancelCurrent?: () => void;
  run(
    file: Blob,
    onProgress: (stage: string, fraction: number) => void,
  ): Promise<SeparationResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.title = "本機人聲分離運算";
      frame.src = `${import.meta.env.BASE_URL}separate.html`;
      const timeout = setTimeout(
        () => {
          cleanup();
          reject(new Error("處理逾時，請縮短歌曲後重試。"));
        },
        60 * 60 * 1000,
      );
      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        frame.remove();
        this.cancelCurrent = undefined;
      };
      const receive = (event: MessageEvent<Record<string, unknown>>) => {
        if (
          event.origin !== location.origin ||
          event.source !== frame.contentWindow
        )
          return;
        if (event.data.ready)
          frame.contentWindow?.postMessage(
            { command: "separate", file },
            location.origin,
          );
        if (
          typeof event.data.stage === "string" &&
          typeof event.data.fraction === "number"
        )
          onProgress(event.data.stage, event.data.fraction);
        if (typeof event.data.error === "string") {
          cleanup();
          reject(new Error(event.data.error));
        }
        if (
          event.data.complete &&
          event.data.vocals instanceof Blob &&
          event.data.instrumental instanceof Blob
        ) {
          cleanup();
          resolve({
            vocals: event.data.vocals,
            instrumental: event.data.instrumental,
          });
        }
      };
      this.cancelCurrent = () => {
        cleanup();
        reject(new DOMException("已取消", "AbortError"));
      };
      window.addEventListener("message", receive);
      document.body.appendChild(frame);
    });
  }
  cancel(): void {
    this.cancelCurrent?.();
  }
}
