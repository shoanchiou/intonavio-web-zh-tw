import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { createAudioServer } from "../server/cloud-audio.mjs";

test("the cloud server warms up publicly and accepts audio requests only with a code", async (context) => {
  const token = "local-test-code-without-production-access";
  const origin = "https://practice.example";
  const headers = { Origin: origin, Authorization: "Bearer " + token };
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const server = createAudioServer({
    token,
    origin,
    verifyGoogle: async (credential) => credential === "verified.google.token",
    async fetchAudio(id, _scratch, _signal, options) {
      assert.equal(id, "HOfdboHvshg");
      assert.equal(options.runtime, "node");
      assert.equal(options.maxBytes, 20 * 1024 * 1024);
      started.resolve();
      await finish.promise;
      return Buffer.from("fake test mp3");
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    finish.resolve();
    server.closeAllConnections();
    server.close();
  });
  const url = "http://127.0.0.1:" + server.address().port;
  const route = url + "/api/audio/HOfdboHvshg";
  const health = await fetch(url + "/health", { headers: { Origin: origin } });
  assert.equal(health.headers.get("access-control-allow-origin"), origin);
  assert.equal((await health.json()).service, "intonavio-cloud-audio");
  const signIn = (credential) =>
    fetch(url + "/api/auth/google", {
      method: "POST",
      headers: { Origin: origin, Authorization: "Bearer " + credential },
    });
  assert.equal((await signIn(token)).status, 401);
  assert.equal((await signIn("fake.google.token")).status, 401);
  const signedIn = await signIn("verified.google.token");
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), { signedIn: true });
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: {
          Origin: origin,
          Authorization: "Bearer verified.google.token",
        },
      })
    ).status,
    401,
  );
  const preflight = await fetch(route, {
    method: "OPTIONS",
    headers: { Origin: origin },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-headers"),
    "Authorization",
  );
  assert.equal((await fetch(route, { method: "POST" })).status, 401);
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: { ...headers, Origin: "https://different.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(url + "/api/audio/arbitrary", { method: "POST", headers }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(route, { method: "POST", headers, body: "unsupported" }))
      .status,
    400,
  );
  const response = fetch(route, { method: "POST", headers });
  await started.promise;
  assert.equal((await fetch(route, { method: "POST", headers })).status, 409);
  finish.resolve();
  const ready = await response;
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("content-type"), "audio/mpeg");
  assert.equal(await ready.text(), "fake test mp3");
});

test("Render downloads use a private cookie copy and sanitize login errors", {
  skip: process.platform === "win32",
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "intonavio-render-test-"));
  const scratch = join(directory, "jobs");
  const cookiesFile = join(directory, "render-secret.txt");
  const cookieValue = "synthetic-cookie-for-tests";
  const cookies = `# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tTEST\t${cookieValue}\n`;
  const originalPath = process.env.PATH;
  const logs = [];
  const token = "local-test-code-without-production-access";
  const server = createAudioServer({ token, scratch, cookiesFile });
  context.after(async () => {
    process.env.PATH = originalPath;
    server.closeAllConnections();
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(cookiesFile, cookies, { mode: 0o400 });
  await writeFile(join(directory, "yt-dlp"), `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.at(-1).endsWith('NoCookie001')) {
  assert.ok(!args.includes('--cookies'));
  fs.writeFileSync('FULL.mp3', 'test audio');
  process.exit();
}
const copy = args[args.indexOf('--cookies') + 1];
assert.equal(copy, require('node:path').join(process.cwd(), 'cookies.txt'));
assert.equal(fs.statSync(copy).mode & 0o777, 0o600);
assert.equal(fs.readFileSync(copy, 'utf8'), ${JSON.stringify(cookies)});
assert.ok(args.includes('--no-cache-dir'));
fs.appendFileSync(copy, '# rewrite from yt-dlp\\n');
if (args.at(-1).endsWith('SignInTest1')) {
  console.error('Sign in to confirm: ${cookieValue}');
  process.exit(1);
}
fs.writeFileSync('FULL.mp3', 'test audio');
`, { mode: 0o700 });
  process.env.PATH = [directory, originalPath].join(delimiter);
  context.mock.method(console, "error", (...messages) => logs.push(messages.join(" ")));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = (id) => fetch(`http://127.0.0.1:${server.address().port}/api/audio/${id}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });

  const result = await request("HOfdboHvshg");
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "test audio");
  assert.deepEqual(await readdir(scratch), []);
  assert.equal(await readFile(cookiesFile, "utf8"), cookies);
  const rejected = await request("SignInTest1");
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: "unavailable" });
  assert.deepEqual(await readdir(scratch), []);
  assert.match(logs.join("\n"), /設定或更新 cookies\.txt/);
  assert.ok(!logs.join("\n").includes(cookieValue));
  await rm(cookiesFile);
  const anonymous = await request("NoCookie001");
  assert.equal(anonymous.status, 200);
  assert.equal(await anonymous.text(), "test audio");
});
