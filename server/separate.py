"""Windows CPU implementation of the MDX separation used by the web client.

MDX configuration and windowing based on web-audio-separation (Dan Kurtz, MIT).
"""

import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import onnxruntime as ort


RATE = 44100
FFT = 7680
HOP = 1024
FRAMES = 256
BINS = 3072
TRIM = FFT // 2
BLOCK = HOP * (FRAMES - 1)
STRIDE = BLOCK * 3 // 4
WINDOW = np.hanning(FFT + 1)[:-1].astype(np.float32)
FADE = np.hanning(BLOCK + 1)[:-1].astype(np.float32)
FRAME_WEIGHT = np.zeros(BLOCK + FFT, dtype=np.float32)
for offset in range(0, BLOCK + 1, HOP):
    FRAME_WEIGHT[offset:offset + FFT] += WINDOW ** 2


def progress(stage: str, fraction: float) -> None:
    print(json.dumps({"stage": stage, "fraction": fraction}), flush=True)


def load_audio(source: Path) -> np.ndarray:
    decoded = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
         "-i", str(source), "-map", "0:a:0", "-t", "480.6", "-vn", "-ac", "2",
         "-ar", str(RATE), "-f", "f32le", "pipe:1"],
        capture_output=True, check=True, timeout=120,
    ).stdout
    if len(decoded) < RATE or len(decoded) > RATE * 2 * 4 * 480.5:
        raise ValueError("音檔過短，或超過 8 分鐘的長度限制。")
    return np.frombuffer(decoded, dtype="<f4").reshape(-1, 2).T


def stft(chunk: np.ndarray) -> np.ndarray:
    centered = np.pad(chunk, ((0, 0), (TRIM, TRIM)), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(centered, FFT, axis=1)[:, ::HOP]
    spectrum = np.fft.rfft(frames * WINDOW, axis=-1)[..., :BINS].transpose(0, 2, 1)
    tensor = np.empty((1, 4, BINS, FRAMES), dtype=np.float32)
    tensor[0, 0::2] = spectrum.real
    tensor[0, 1::2] = spectrum.imag
    tensor[:, :, :3] = 0
    return tensor


def istft(tensor: np.ndarray) -> np.ndarray:
    complex_bins = tensor[0, 0::2] + 1j * tensor[0, 1::2]
    frames = np.fft.irfft(complex_bins.transpose(0, 2, 1), n=FFT, axis=-1) * WINDOW
    audio = np.zeros((2, BLOCK + FFT), dtype=np.float32)
    for frame_index in range(FRAMES):
        offset = frame_index * HOP
        audio[:, offset:offset + FFT] += frames[:, frame_index]
    return audio[:, TRIM:-TRIM] / np.maximum(FRAME_WEIGHT[TRIM:-TRIM], 1e-8)


def infer_vocals(mix: np.ndarray, model: Path) -> np.ndarray:
    progress("loading-model", 0)
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(8, os.cpu_count() or 1)
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    length = mix.shape[1]
    starts = range(0, length + TRIM, STRIDE)
    padded_length = starts[-1] + BLOCK
    result = np.zeros((2, padded_length), dtype=np.float32)
    weight = np.zeros(padded_length, dtype=np.float32)
    for index, start in enumerate(starts):
        first = max(start - TRIM, 0)
        last = min(start + BLOCK - TRIM, length)
        chunk = np.zeros((2, BLOCK), dtype=np.float32)
        if first < last:
            offset = first + TRIM - start
            chunk[:, offset:offset + last - first] = mix[:, first:last]
        model_input = stft(chunk)
        estimate = session.run(None, {input_name: model_input})[0]
        result[:, start:start + BLOCK] += istft(estimate) * FADE
        weight[start:start + BLOCK] += FADE
        progress("demixing", (index + 1) / len(starts))
    span = slice(TRIM, TRIM + length)
    return result[:, span] / np.maximum(weight[span], 1e-8)


def write_mp3(output: Path, samples: np.ndarray) -> None:
    samples = np.nan_to_num(samples, copy=False)
    peak = float(np.max(np.abs(samples)))
    if peak > 0.98:
        samples *= 0.98 / peak
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE),
         "-ac", "2", "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "192k", str(output)],
        input=samples.T.astype("<f4", copy=False).tobytes(), check=True, timeout=120,
    )


def main() -> None:
    input_file, model, folder = map(Path, sys.argv[1:])
    mix = load_audio(input_file)
    gain = max(1.0, float(np.max(np.abs(mix))) / 0.95)
    vocals = infer_vocals(mix / gain, model) * (1.021 * gain)
    progress("writing-output", 0)
    write_mp3(folder / "vocals.mp3", vocals.copy())
    write_mp3(folder / "instrumental.mp3", mix - vocals)
    print(json.dumps({"duration": mix.shape[1] / RATE}), flush=True)


if __name__ == "__main__":
    main()
