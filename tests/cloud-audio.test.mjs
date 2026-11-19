import assert from "node:assert/strict";
import { once } from "node:events";
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
