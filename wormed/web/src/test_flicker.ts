import { strict as assert } from "node:assert";
import { createFlicker } from "./flicker.js";

const random = Math.random;
try {
  Math.random = () => 0;
  const flicker = createFlicker();
  assert.equal(flicker(0), 1);
  assert.equal(flicker(4999), 1, "steady between dips");
  assert.equal(flicker(5000), 1, "dip starts without a brightness jump");
  assert.ok(Math.abs(flicker(5045) - 0.7) < 1e-9, "brief dip reaches its depth");
  assert.equal(flicker(5090), 1, "restores full brightness");
  assert.equal(flicker(10089), 1, "waits before the next dip");
  assert.ok(flicker(10135) < 1, "continues flickering without timers");
  assert.equal(flicker(60000), 1, "skips missed dips after a paused tab");
  assert.equal(flicker(64999), 1, "resumes with a quiet interval");

  Math.random = () => 0.999;
  const slow = createFlicker();
  assert.equal(slow(0), 1);
  assert.equal(slow(15000), 1, "intervals vary with randomness");
  for (let now = 15989; now <= 16229; now++) {
    const light = slow(now);
    assert.ok(light >= 0.25 && light <= 1, "never blacks out or flashes brighter");
  }
  assert.equal(slow(16229), 1);
} finally {
  Math.random = random;
}
console.log("OK: flicker timing, brightness bounds, recovery and paused-tab handling");
