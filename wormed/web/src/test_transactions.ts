import assert from "node:assert/strict";
import { TransactionPlayback } from "./transactions.js";
import { WormBody } from "./body.js";
import type { Synapse } from "./chain.js";

const receipt = (id: number): Synapse => ({ signature: `confirmed-${id}`, step: 10,
  pre: 1, post: 2, amount: id % 2 ? -3 : 4, chemical: !!(id % 2) });
const playback = new TransactionPlayback();
const body = new WormBody();
const played = new Set<string>();
let longestGap = 0, lastPlayed = 0;
for (let frame = 0; frame < 30 * 60; frame++) {
  const now = frame * 1000 / 60;
  if (frame % 360 === 0) {
    for (let i = 0; i < 2048; i++) assert.ok(playback.push(receipt(frame * 2048 + i), now));
  }
  const rows = playback.tick(now);
  if (rows.length) {
    longestGap = Math.max(longestGap, now - lastPlayed);
    lastPlayed = now;
  }
  for (const row of rows) {
    assert.ok(!played.has(row.signature), "a confirmed signature was displayed twice");
    played.add(row.signature);
  }
  assert.ok(playback.active(now), "motion stopped between healthy six-second bursts");
  const head = [...body.points[0]];
  body.update(playback.active(now) ? 1 / 60 : 0, { state: 1, gain: 1 });
  assert.ok(Math.hypot(...body.points[0].map((v, i) => v - head[i])) > 0,
    "continuous transaction activity left the worm stationary");
}
assert.ok(longestGap < 100, `log stalled ${longestGap} ms between bursts`);
assert.ok(played.size > 5000);
assert.ok(!playback.push(receipt(0), 39_000), "a replay refreshed liveness");
assert.ok(!playback.active(39_001), "a dead receipt feed kept the worm moving");
assert.deepEqual(playback.tick(60_000), [], "a hidden tab replayed expired receipts");
assert.equal(playback.pending, 0);
assert.ok(playback.push(receipt(999_999_999), 60_001));
assert.ok(playback.active(60_001), "new confirmations did not restore activity");
console.log("OK: confirmed bursts play continuously, signatures deduplicate, movement persists, and stalled feeds expire");
