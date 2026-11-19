import type { PitchFrame } from "./types";

export type JobStage =
  | "fetching"
  | "setup-engine"
  | "download"
  | "loading-model"
  | "demixing"
  | "writing-output"
  | "analyzing";
export interface PendingJob {
  id: string;
  songId: string;
  title: string;
  videoId?: string;
  artist?: string;
}
interface JobStatus {
  state: "running" | "ready" | "failed" | "cancelled";
  stage: JobStage;
  fraction: number;
  duration?: number;
  error?: string;
}

export class JobError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const key = "intonavio-active-compute-v1";
const headers = { "X-Intonavio-Action": "compute" };
const path = (job: PendingJob) => `/api/jobs/${job.id}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function restoreJob(): PendingJob | undefined {
  try {
    const job = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      job &&
      typeof job.id === "string" &&
      typeof job.title === "string" &&
      typeof job.songId === "string"
    )
      return job;
  } catch {
    /* Older or unavailable local storage has no saved job. */
  }
}
export function rememberJob(job?: PendingJob): void {
  if (job) localStorage.setItem(key, JSON.stringify(job));
  else localStorage.removeItem(key);
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const data = await response.json().catch(() => ({}));
  throw new JobError(data.error ?? `HTTP ${response.status}`, response.status);
}
export async function submitJob(
  job: PendingJob,
  body: Blob | undefined,
  signal: AbortSignal,
): Promise<void> {
  const target =
    job.videoId && !body
      ? `${path(job)}?v=${encodeURIComponent(job.videoId)}`
      : path(job);
  await checked(await fetch(target, { method: "POST", headers, body, signal }));
}
export async function cancelJob(job: PendingJob): Promise<void> {
  await checked(
    await fetch(path(job), {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(6000),
    }),
  );
}

async function readResult(
  job: PendingJob,
  duration: number,
  signal: AbortSignal,
) {
  const files = [
    "original.mp3",
    "vocals.mp3",
    "instrumental.mp3",
    "reference.json",
  ];
  const [original, vocals, instrumental, reference] = await Promise.all(
    files.map(async (file) =>
      checked(
        await fetch(`${path(job)}/${file}`, { cache: "no-store", signal }),
      ),
    ),
  );
  const [main, voice, backing, frames] = await Promise.all([
    original.blob(),
    vocals.blob(),
    instrumental.blob(),
    reference.json(),
  ]);
  return {
    original: main,
    vocals: voice,
    instrumental: backing,
    reference: frames as PitchFrame[],
    duration,
  };
}

export async function watchJob(
  job: PendingJob,
  signal: AbortSignal,
  onProgress: (stage: JobStage, fraction: number) => void,
  onDisconnected: () => void,
) {
  while (true) {
    signal.throwIfAborted();
    const exchange = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    try {
      const status: JobStatus = await (
        await checked(
          await fetch(path(job), { cache: "no-store", signal: exchange }),
        )
      ).json();
      if (status.state === "failed")
        throw new JobError(status.error ?? "本機運算失敗。", 422);
      if (status.state === "cancelled")
        throw new JobError(status.error ?? "已取消工作。", 410);
      if (status.state === "ready" && status.duration)
        return await readResult(job, status.duration, exchange);
      onProgress(status.stage, status.fraction);
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof JobError &&
        error.status !== 502 &&
        error.status !== 503
      )
        throw error;
      onDisconnected();
    }
    await wait(1400);
  }
}
