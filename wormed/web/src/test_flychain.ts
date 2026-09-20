// Run: npx tsx src/test_flychain.ts
//
// The failure this exists to catch: a fly receipt decoded at the wrong byte
// offset, or a weight scaled differently here than in web/flysynapses.mjs.
// Either one puts a number on the panel that the ledger never moved, and
// nothing else in the demo would notice.
import assert from "node:assert/strict";
import { decodeFlyReceipt, flyNames, outgoingEdges } from "./flychain.js";

// --- names are the model's index order, not a pretty list ---
const names = flyNames();
assert.equal(names.length, 56);
assert.equal(names[0], "EPG0");
assert.equal(names[15], "EPG15");
assert.equal(names[16], "PEN_L0");
assert.equal(names[32], "PEN_R0");
assert.equal(names[48], "D70");
assert.equal(names[55], "D77");

// --- the exact 24 bytes program/fly.c emits, built field by field ---
function receipt(tick: number, pre: number, post: number, amount: number, kind: number,
                 { tag = "FLY_SYNX", end = 0xa5, length = 24 } = {}): Uint8Array {
  const p = new Uint8Array(length);
  const d = new DataView(p.buffer);
  for (let i = 0; i < 8 && i < length; i++) p[i] = tag.charCodeAt(i);
  d.setUint32(8, tick, true);
  d.setUint16(12, pre, true);
  d.setUint16(14, post, true);
  d.setInt32(16, amount, true);
  p[20] = kind;
  p[23] = end;
  return p;
}

const decoded = decodeFlyReceipt(receipt(1234, 0, 17, 8, 0));
assert.deepEqual(decoded, { step: 1234, pre: 0, post: 17, amount: 8, chemical: false });
// This is the payload a real alphanet transaction carried (see the test
// transaction in wormed/pipeline/deploy_fly.py's header) with its tag back on.
assert.deepEqual(decodeFlyReceipt(Uint8Array.from(Buffer.from(
  "464c595f53594e58" + "d20400000000110008000000000000a5", "hex"))), decoded);
// Inhibition keeps its sign AND its kind — a decoder that dropped either
// would draw charge leaving the postsynaptic cell as charge arriving.
assert.deepEqual(decodeFlyReceipt(receipt(9, 50, 3, -17, 1)),
                 { step: 9, pre: 50, post: 3, amount: -17, chemical: true });

for (const bad of [
  receipt(1, 0, 1, 5, 0, { tag: "WORMSYNX" }),   // the worm's receipt, same length
  receipt(1, 0, 1, 5, 0, { end: 0 }),            // trailing zeros are trimmed on the wire
  receipt(1, 0, 1, 5, 0, { length: 23 }),
  receipt(1, 56, 1, 5, 0),                       // past the last fly neuron
  receipt(1, 0, 56, 5, 0),
  receipt(1, 0, 1, 0, 0),                        // a zero transfer is not an event
]) assert.equal(decodeFlyReceipt(bad), undefined, `accepted ${Buffer.from(bad).toString("hex")}`);

// --- weights to whole ledger units ---
const edges = outgoingEdges([
  [0, 17, 0.1643],    // w_pe
  [0, 18, 0.0001],    // rounds to zero units: can never be a transaction
  [0, 0, 0.5],        // self-edge: program/fly.c reverts on pre == post
  [48, 3, -0.1097],   // D7 -> EPG, negative by construction
]);
assert.deepEqual(edges.get(0), [{ post: 17, amount: 16 }]);
assert.deepEqual(edges.get(48), [{ post: 3, amount: -11 }]);
assert.equal(edges.has(18), false);

console.log("OK: fly receipts decode at the program's offsets, and weights scale to whole units");
