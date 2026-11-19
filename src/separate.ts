import { decodeAudio } from "./analyze";

export interface SeparationResult {
  vocals: Blob;
  instrumental: Blob;
}

export type SeparationStage =
  | "download"
  | "loading-model"
  | "demixing"
  | "writing-output";

export type SeparationUpdate =
  | SeparationResult
  | { stage: SeparationStage; fraction: number }
  | { error: string };

export class SeparationTask {
  private cancelCurrent?: () => void;

  run(
    file: Blob,
    onProgress: (stage: SeparationStage, fraction: number) => void,
  ): Promise<SeparationResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./separation-worker.ts", import.meta.url),
        { type: "module" },
      );
      const timeout = setTimeout(
        () => fail(new Error("處理逾時，請縮短歌曲後重試。")),
        60 * 60 * 1000,
      );
      const cleanup = () => {
        if (this.cancelCurrent !== cancel) return false;
        this.cancelCurrent = undefined;
        clearTimeout(timeout);
        worker.terminate();
        return true;
      };
      const fail = (error: unknown) => {
        if (cleanup()) reject(error);
      };
      const cancel = () => fail(new DOMException("已取消", "AbortError"));
      this.cancelCurrent = cancel;
      worker.onmessage = ({ data }: MessageEvent<SeparationUpdate>) => {
        if (this.cancelCurrent !== cancel) return;
        if ("stage" in data) onProgress(data.stage, data.fraction);
        else if ("error" in data) fail(new Error(data.error));
        else if (cleanup()) resolve(data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(new Error(event.message || "無法啟動人聲分離。"));
      };
      worker.onmessageerror = () => fail(new Error("無法讀取分離結果。"));

      void decodeAudio(file, 44100)
        .then((buffer) => {
          if (this.cancelCurrent !== cancel) return;
          const left = buffer.getChannelData(0);
          const right =
            buffer.numberOfChannels === 1
              ? new Float32Array(left)
              : buffer.getChannelData(1);
          worker.postMessage([left, right], [left.buffer, right.buffer]);
        })
        .catch(fail);
    });
  }

  cancel(): void {
    this.cancelCurrent?.();
  }
}
