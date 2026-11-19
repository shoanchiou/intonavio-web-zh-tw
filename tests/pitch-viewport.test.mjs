import assert from "node:assert/strict";
import test from "node:test";
import { PitchViewport } from "../src/pitch-viewport.ts";

test("pitch moves within the chart without moving the scale", () => {
  const view = new PitchViewport();
  view.update(60, 0);
  for (let note = 55; note <= 65; note++)
    assert.equal(view.update(note, (note - 54) * 100), 60);
});

test("a brief leap or silence does not move the scale", () => {
  const view = new PitchViewport();
  view.update(60, 0);
  assert.equal(view.update(72, 100), 60);
  assert.equal(view.update(72, 200), 60);
  assert.equal(view.update(null, 250), 60);
  assert.equal(view.update(72, 300), 60);
  assert.equal(view.update(64, 400), 60);
});

test("sustained climbs and descents move smoothly and keep a margin", () => {
  for (const direction of [1, -1]) {
    const view = new PitchViewport();
    view.update(60, 0);
    const target = 60 + direction * 10;
    let previous = 60;
    for (let now = 20; now <= 760; now += 20) {
      const center = view.update(target, now);
      assert.ok((center - previous) * direction >= 0);
      assert.ok(Math.abs(center - previous) <= 0.321);
      if (now <= 160) assert.equal(center, 60);
      previous = center;
    }
    assert.equal(view.center, target - direction * 3);
  }
});

test("resuming after a long frame pause cannot jump, and seeking can re-anchor", () => {
  const view = new PitchViewport();
  view.update(60, 0);
  view.update(72, 20);
  assert.equal(view.update(72, 2000), 60);
  view.reset();
  assert.equal(view.update(72.1, 2020), 72);
});
