import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupVideo } from "./youtube.mjs";
import { handleJob } from "./jobs.mjs";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(appRoot, "dist");
const port = Number(process.env.INTONAVIO_TEST_PORT || 3218);
const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;
const videoId = /^[a-zA-Z0-9_-]{11}$/;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
};

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, path, url) {
  if (
    req.headers["sec-fetch-site"] === "cross-site" ||
    req.headers["sec-fetch-site"] === "same-site"
  )
    return json(res, 403, { error: "請在本機 Intonavio 網頁操作。" });
  if (req.method === "GET" && path === "/api/health")
    return json(res, 200, { service: "intonavio-local", backgroundJobs: true });
  if (path.startsWith("/api/jobs/"))
    return handleJob(req, res, url, origin, json);
  const match = /^\/api\/youtube\/metadata\/([^/]+)$/.exec(path);
  if (!match || !videoId.test(match[1]))
    return json(res, 400, { error: "YouTube 影片 ID 格式不正確。" });
  if (req.method !== "GET")
    return json(res, 405, { error: "不支援這個方法。" });
  return json(res, 200, await lookupVideo(match[1]));
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== host)
      return json(res, 403, { error: "僅限本機位址。" });
    const url = new URL(req.url, origin);
    const path = decodeURIComponent(url.pathname);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (path.startsWith("/api/")) return await handleApi(req, res, path, url);
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "不支援這個方法。" });
    const file = resolve(dist, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(dist + sep))
      return json(res, 404, { error: "找不到頁面。" });
    const content = await readFile(file).catch(() => undefined);
    if (!content)
      return json(res, 404, {
        error: "找不到網頁檔，請先執行 npm run build。",
      });
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (!res.destroyed && !res.headersSent)
      json(res, 502, {
        error: error instanceof Error ? error.message : "歌曲處理失敗。",
      });
  }
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Intonavio 本機服務 ${origin}\n`),
);
