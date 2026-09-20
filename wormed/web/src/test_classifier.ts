import assert from "node:assert/strict";
import { classifyBehavior, BEHAVIOR_STALE_MS } from "./classifier.js";
import { BEHAVIOR } from "./body.js";
import type { Behavior } from "./chain.js";

const forward: Behavior = { state: BEHAVIOR.FORWARD, gain: 0.8, driveFwd: 0.8, driveRev: 0.2, step: 100 };
const reverse: Behavior = { ...forward, state: BEHAVIOR.REVERSE, driveFwd: 0.2, driveRev: 0.8 };
const read = (sample: Behavior | undefined, age = 0, playing = true) => classifyBehavior(sample, age, playing);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10);

close(read(forward).signal, 0.6);
close(read(reverse).signal, -0.6);
assert.equal(read(forward).label, "Forward run");
assert.equal(read(reverse).label, "Reversal");
for (const state of [BEHAVIOR.PAUSE, BEHAVIOR.OMEGA]) {
  assert.equal(read({ ...forward, state }).signal, 0, "a pause or turn invented a directional trade");
  assert.equal(read({ ...reverse, state }).signal, 0);
}
assert.equal(read({ ...reverse, state: BEHAVIOR.FORWARD }).signal, 0, "held forward state produced Sell");
assert.equal(read({ ...forward, state: BEHAVIOR.REVERSE }).signal, 0, "held reverse state produced Buy");
assert.equal(read({ ...forward, driveRev: forward.driveFwd }).signal, 0, "equal drives must be neutral");
assert.equal(read({ ...forward, driveFwd: 1, driveRev: 0 }).signal, 1);
assert.equal(read({ ...reverse, driveFwd: 0, driveRev: 1 }).signal, -1);
assert.ok(read({ ...forward, driveFwd: 0.9 }).signal > read(forward).signal);

assert.equal(read(undefined).state, null, "missing data was classified as biological Pause");
assert.equal(read(undefined).signal, 0);
assert.equal(read(forward, 0, false).status, "buffering");
assert.equal(read(forward, 0, false).signal, 0, "a frozen body retained a Buy signal");
assert.equal(read(forward, 0, false).state, BEHAVIOR.FORWARD, "waiting erased the last observed state");
assert.equal(read(forward, BEHAVIOR_STALE_MS).status, "live");
assert.equal(read(forward, BEHAVIOR_STALE_MS + 1).status, "stale");
assert.equal(read(forward, BEHAVIOR_STALE_MS + 1).signal, 0);
assert.equal(read(reverse, BEHAVIOR_STALE_MS + 1).signal, 0);
assert.equal(read(reverse, 0).status, "live", "fresh data did not recover after a stall");

for (const field of ["driveFwd", "driveRev", "step", "state"] as const) {
  for (const value of [NaN, Infinity, -1]) {
    const bad = { ...forward, [field]: value } as Behavior;
    assert.equal(read(bad).status, "invalid");
    assert.equal(read(bad).signal, 0);
  }
}
for (const bad of [
  { ...forward, driveFwd: 1.1 }, { ...forward, driveRev: 1.1 },
  { ...forward, state: 4 } as unknown as Behavior,
  { ...forward, state: 1.5 } as unknown as Behavior, { ...forward, step: 0.5 },
]) assert.equal(read(bad).status, "invalid");
for (const age of [NaN, Infinity, -1]) assert.equal(read(forward, age).signal, 0);
assert.equal(read({ ...forward, step: 0 }).status, "live", "step zero is valid after a reset");
console.log("OK: behavior meanings, Buy/Sell direction, drive strength, missing/stale playback and malformed samples");
