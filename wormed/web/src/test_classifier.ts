import assert from "node:assert/strict";
import { classifyBehavior, BEHAVIOR_STALE_MS, SynapticHeuristic } from "./classifier.js";
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

const neural = new SynapticHeuristic(["AVBL", "AVAL", "OTHER"]);
const event = { signature: "confirmed", step: 10, pre: 2, post: 0, amount: 20, chemical: true };
const baseline = .4;
const initial = neural.value(0, baseline, true);
neural.observe(event, 100);
const excitation = neural.value(100, baseline, true);
assert.ok(excitation > initial + .4, "forward current did not change a held heuristic");
neural.observe({ ...event, amount: -60 }, 200);
assert.ok(neural.value(200, baseline, true) < 0, "inhibition did not reverse the current contribution");
assert.equal(neural.value(201, baseline, false), 0, "inactive playback invented a trade");
assert.ok(Math.abs(neural.value(10_000, baseline, true) - initial) < .001, "old impulses never decayed");
const gap = new SynapticHeuristic(["AVBL", "AVAL", "OTHER"]);
gap.observe({ ...event, pre: 0, post: 2, chemical: false }, 0);
assert.ok(gap.value(0, 0, true) < 0, "gap donor current had the wrong sign");
const unrelated = new SynapticHeuristic(["AVBL", "AVAL", "OTHER"]);
unrelated.observe({ ...event, post: 2 }, 0);
assert.equal(unrelated.value(0, 0, true), 0, "unrelated cells generated a tilt");
console.log("OK: live currents change a constant baseline, preserve inhibition and donor signs, and decay without random input");
