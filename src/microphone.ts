import type { Detection } from "./types";

export class Microphone {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private generation = 0;
  private manualGain = 1;
  private automaticGain = false;
  private gain = 1;
  active = false;

  get currentGain(): number {
    return this.gain;
  }

  setGain(gain: number): void {
    this.manualGain = gain;
    if (!this.automaticGain) this.applyGain(gain);
  }

  setAutomaticGain(enabled: boolean): void {
    this.automaticGain = enabled;
    this.applyGain(enabled ? 1 : this.manualGain);
  }

  private applyGain(gain: number): void {
    this.gain = gain;
    const parameter = this.node?.parameters.get("gain");
    if (parameter && this.context)
      parameter.setTargetAtTime(gain, this.context.currentTime, 0.01);
  }

  private adjustGain(inputPeak: number): void {
    // Ignore background noise and reduce loud peaks faster than boosting soft sounds.
    if (inputPeak < 0.025) return;
    const target = Math.max(0.25, Math.min(2, 0.55 / inputPeak));
    const rate = target < this.gain ? 0.7 : 0.12;
    if (Math.abs(target - this.gain) > 0.003)
      this.applyGain(this.gain + (target - this.gain) * rate);
  }

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
        `${import.meta.env.BASE_URL}worklets/pitch-processor.js?v=3`,
      );
      if (generation !== this.generation) return;
      this.source = this.context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(this.context, "intonavio-pitch", {
        parameterData: { gain: this.gain },
      });
      this.node.port.onmessage = (event: MessageEvent<Detection>) => {
        const detection = event.data;
        if (detection.error) {
          this.stop();
        } else if (this.automaticGain && detection.inputPeak !== undefined) {
          this.adjustGain(detection.inputPeak);
        }
        onDetection(detection);
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
      if (generation === this.generation) this.active = true;
    } catch (error) {
      if (generation !== this.generation) return;
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
    this.gain = this.automaticGain ? 1 : this.manualGain;
  }
}
