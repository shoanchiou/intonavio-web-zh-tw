import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadAudio } from "./youtube.mjs";

const productionOrigin = "https://shoanchiou.github.io";
const windowMs = 15 * 60 * 1000;
const requestsPerWindow = 6;

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function createAudioServer({
  token,
  origin = productionOrigin,
  scratch = join(tmpdir(), "intonavio-audio"),
  fetchAudio = downloadAudio,
  cookiesFile,
  verifyGoogle,
}) {
  if (!token || token.length < 24)
    throw new Error(
      "Set INTONAVIO_CLOUD_TOKEN to a strong random access code.",
    );
  const authorized = digest("Bearer " + token);
  const recent = [];
  let active = false;

  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Origin");
    if (req.headers.origin && req.headers.origin !== origin)
      return json(res, 403, { error: "origin" });
    if (req.headers.origin === origin)
      res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.method === "GET" && req.url === "/health")
      return json(res, 200, { service: "intonavio-cloud-audio" });

    const googleSignIn =
      Boolean(verifyGoogle) && req.url === "/api/auth/google";
    const match = /^\/api\/audio\/([A-Za-z0-9_-]{11})$/.exec(req.url);
    if (!match && !googleSignIn) return json(res, 404, { error: "path" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Authorization",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }
    if (req.method !== "POST") return json(res, 405, { error: "method" });
    if (googleSignIn) {
      const idToken =
        /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
          req.headers.authorization ?? "",
        )?.[1];
      if (!idToken || idToken.length > 4096)
        return json(res, 401, { error: "auth" });
      try {
        if (await verifyGoogle(idToken))
          return json(res, 200, { signedIn: true });
      } catch {
        // Token details must not be written to logs.
      }
      return json(res, 401, { error: "auth" });
    }
    if (!timingSafeEqual(digest(req.headers.authorization ?? ""), authorized))
      return json(res, 401, { error: "access" });
    if (
      (req.headers["content-length"] !== undefined &&
        req.headers["content-length"] !== "0") ||
      req.headers["transfer-encoding"]
    )
      return json(res, 400, { error: "body" });
    if (active) return json(res, 409, { error: "busy" });

    const now = Date.now();
    while (recent.length && now - recent[0] >= windowMs) recent.shift();
    if (recent.length >= requestsPerWindow) {
      res.setHeader(
        "Retry-After",
        Math.ceil((recent[0] + windowMs - now) / 1000),
      );
      return json(res, 429, { error: "quota" });
    }
    recent.push(now);

    active = true;
    const abort = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      const audio = await fetchAudio(
        match[1],
        scratch,
        AbortSignal.any([abort.signal, AbortSignal.timeout(145000)]),
        { runtime: "node", maxBytes: 20 * 1024 * 1024, cookiesFile },
      );
      if (res.destroyed) return;
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length,
      });
      res.end(audio);
    } catch (error) {
      if (res.destroyed) return;
      console.error("YouTube audio retrieval failed:", error.message);
      json(res, 502, { error: "unavailable" });
    } finally {
      active = false;
    }
  });
}

if (import.meta.main) {
  const clientId = process.env.INTONAVIO_GOOGLE_CLIENT_ID;
  const verifyGoogle = clientId
    ? (await import("../cloud/google-auth.mjs")).googleVerifier(clientId)
    : undefined;
  const server = createAudioServer({
    verifyGoogle,
    token: process.env.INTONAVIO_CLOUD_TOKEN,
    origin: process.env.INTONAVIO_WEB_ORIGIN,
    cookiesFile: process.env.INTONAVIO_YOUTUBE_COOKIES_FILE,
  });
  server.listen(Number(process.env.PORT || 10000), "0.0.0.0");
}
