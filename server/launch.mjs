import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const url = "http://127.0.0.1:3218/";
async function ready() {
  try {
    const response = await fetch(`${url}api/health`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok && (await response.json()).service === "intonavio-local";
  } catch {
    return false;
  }
}
function openBrowser() {
  if (process.argv.includes("--no-browser")) return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  // The URL is constant and only points to the service on this machine.
  const browser = spawn(command, args, {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });
  browser.on("error", () => process.stderr.write(`請開啟 ${url}\n`));
  browser.unref();
}
if (await ready()) openBrowser();
else {
  const server = spawn(
    process.execPath,
    [fileURLToPath(new URL("./start.mjs", import.meta.url))],
    { stdio: "inherit", windowsHide: true },
  );
  // Keep the service tied to the launcher window. Ctrl+C stops the service.
  process.once("SIGTERM", () => server.kill());
  server.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  server.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  for (
    let apiCheck = 0;
    apiCheck < 20 && server.exitCode === null;
    apiCheck++
  ) {
    if (await ready()) {
      openBrowser();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
