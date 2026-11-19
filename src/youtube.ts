export interface VideoInfo {
  id: string;
  title: string;
  artist: string;
}
export const LOCAL_URL = "http://127.0.0.1:3218/";
export const isLocalApp =
  globalThis.location?.origin === new URL(LOCAL_URL).origin;

// Formats supported by the original YouTubeURLValidator, with strict host and ID checks.
export function extractVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    let id: string | null = null;
    if (url.hostname === "youtu.be") id = url.pathname.split("/")[1];
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(url.hostname)
    ) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else
        id =
          /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ??
          null;
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  const data = await response.json().catch(() => ({}));
  throw new Error(
    data.error || `YouTube 處理失敗（HTTP ${response.status}）。`,
  );
}
export async function previewVideo(
  id: string,
  signal: AbortSignal,
): Promise<VideoInfo> {
  return (
    await check(await fetch(`/api/youtube/metadata/${id}`, { signal }))
  ).json();
}
export async function importVideo(
  id: string,
  signal: AbortSignal,
): Promise<Blob> {
  return (
    await check(
      await fetch(`/api/youtube/audio/${id}`, {
        method: "POST",
        headers: { "X-Intonavio-Action": "import" },
        signal,
      }),
    )
  ).blob();
}
