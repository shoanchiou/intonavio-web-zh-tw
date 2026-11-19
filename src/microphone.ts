import type { Detection } from "./types";

export class Microphone {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private generation = 0;
  active = false;

  async start(onDetection: (detection: Detection) => void): Promise<void> {
    this.stop();
    const generation = this.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "此瀏覽器未提供麥克風存取，請使用 HTTPS 下的 Chrome 或 Edge。",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.context = new AudioContext({ latencyHint: "interactive" });
      await this.context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}worklets/pitch-processor.js`,
      );
      if (generation !== this.generation) return;
      this.source = this.context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(this.context, "intonavio-pitch");
      this.node.port.onmessage = (event: MessageEvent<Detection>) => {
        if (event.data.error) {
          this.stop();
          onDetection(event.data);
          return;
        }
        onDetection(event.data);
      };
      this.node.onprocessorerror = () => {
        this.stop();
        onDetection({
          hz: null,
          confidence: 0,
          rms: 0,
          error: "音高偵測中斷，請重新開啟麥克風。",
        });
      };
      this.source.connect(this.node);
      // The processor emits zeroes, so the microphone is never played back.
      this.node.connect(this.context.destination);
      await this.context.resume();
      this.active = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  stop(): void {
    this.generation++;
    this.active = false;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed")
      void this.context.close();
    this.context = undefined;
    this.stream = undefined;
    this.source = undefined;
    this.node = undefined;
  }
}
