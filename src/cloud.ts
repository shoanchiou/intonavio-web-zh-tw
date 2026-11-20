/// <reference types="vite/client" />
import { t } from "./i18n";

export const googleSessionKey = "intonavio-google-entry";
export const publishedRenderUrl =
  location.origin === "https://shoanchiou.github.io"
    ? "https://intonavio-audio.onrender.com"
    : "";
export const cloudUrl = (
  import.meta.env.VITE_INTONAVIO_CLOUD_URL ?? publishedRenderUrl
)
  .trim()
  .replace(/\/+$/, "");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CloudAudioUnavailableError extends Error {
  constructor() {
    super(t("cloudNoAudio"));
  }
}

export async function waitForAudioService(
  base: string,
  signal: AbortSignal,
): Promise<boolean> {
  const wakeDeadline = AbortSignal.timeout(125000);
  while (!wakeDeadline.aborted) {
    signal.throwIfAborted();
    try {
      const response = await fetch(base + "/health", {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          signal,
          wakeDeadline,
          AbortSignal.timeout(12000),
        ]),
      });
      if (
        response.ok &&
        (await response.json()).service === "intonavio-cloud-audio"
      )
        return true;
    } catch {
      signal.throwIfAborted();
    }
    await wait(2000);
  }
  return false;
}

export async function fetchCloudAudio(
  videoId: string,
  signal: AbortSignal,
  onStatus: (message: string) => void,
): Promise<Blob> {
  const idToken = sessionStorage.getItem(googleSessionKey);
  if (!idToken) throw new Error(t("cloudSignInRequired"));
  onStatus(t("cloudWaking"));
  if (!(await waitForAudioService(cloudUrl, signal)))
    throw new Error(t("cloudWakeTimeout"));

  onStatus(t("cloudFetching"));
  let response;
  try {
    response = await fetch(
      cloudUrl + "/api/audio/" + encodeURIComponent(videoId),
      {
        method: "POST",
        headers: { Authorization: "Bearer " + idToken },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(155000)]),
      },
    );
  } catch {
    signal.throwIfAborted();
    throw new Error(t("cloudConnection"));
  }
  if (response.status === 401) throw new Error(t("cloudSignInRequired"));
  if (response.status === 409 || response.status === 429)
    throw new Error(t("cloudBusy"));
  if (response.status === 502) {
    const body: { error?: string } | null = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (body?.error === "unavailable") throw new CloudAudioUnavailableError();
  }
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("audio/mpeg")
  )
    throw new Error(t("cloudNoAudio"));
  return response.blob();
}
