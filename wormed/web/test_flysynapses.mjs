// Run: node test_flysynapses.mjs
//
// The failure this exists to catch: instruction bytes that do not line up with
// program/fly.c's do_synapse. Every field is read by offset on chain, so a
// shifted amount settles a different number of units than the receipt reports
// and the transaction still succeeds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { synapseInstruction, validEvent, outgoingEdges, UNITS, BATCH_MAX } from "./flysynapses.mjs";

const cfg = JSON.parse(readFileSync(new URL("../data/fly.json", import.meta.url)));
assert.equal(cfg.accounts.length, 56, "fly.json must carry one account per model neuron");

const slots = new Map([[cfg.reservoirAccount, 2], [cfg.accounts[0], 3], [cfg.accounts[17], 4]]);
const data = synapseInstruction(a => slots.get(a), { tick: 1234, pre: 0, post: 17, amount: 8 });
assert.equal(data.length, 24, "do_synapse reverts on any size but 20... 24 bytes");
assert.equal(data.readUInt32LE(0), 2, "FLY_INSTR_SYNAPSE");
assert.equal(data.readUInt32LE(4), 1234);
assert.equal(data.readUInt16LE(8), 2, "reservoir slot");
assert.equal(data.readUInt16LE(10), 3, "pre slot");
assert.equal(data.readUInt16LE(12), 4, "post slot");
assert.equal(data.readUInt16LE(14), 0, "pre neuron index");
assert.equal(data.readUInt16LE(16), 17, "post neuron index");
assert.equal(data.readInt32LE(18), 8);
assert.equal(data.readUInt8(22), 0, "excitatory");

// Sign is what tells the program which way charge moves. A negative weight
// must arrive as kind 1, or inhibition would credit the postsynaptic cell.
const inhibitory = synapseInstruction(a => slots.get(a), { tick: 1, pre: 0, post: 17, amount: -11 });
assert.equal(inhibitory.readInt32LE(18), -11);
assert.equal(inhibitory.readUInt8(22), 1, "inhibitory");

// Rejected here, BEFORE a fee is paid. Each of these reverts on chain.
assert.equal(validEvent({ tick: 0, pre: 0, post: 17, amount: 8 }), true);
for (const bad of [
  { tick: 0, pre: 0, post: 0, amount: 8 },       // pre == post
  { tick: 0, pre: -1, post: 3, amount: 8 },
  { tick: 0, pre: 0, post: 56, amount: 8 },      // past the last account
  { tick: 0, pre: 0, post: 3, amount: 0 },       // a zero transfer is not an event
  { tick: -1, pre: 0, post: 3, amount: 8 },
  { tick: 0, pre: 0, post: 3, amount: 1.5 },
  undefined,
]) assert.equal(validEvent(bad), false, `accepted ${JSON.stringify(bad)}`);

// These two are the fly's whole spend. A batch is submitted every second and the faucet
// refills 10,000 per 15 s at most (refillFlyPayer), so a batch above ~650 outruns the refill
// and the payer drains to the floor mid-demo.
assert.equal(UNITS, 100);
assert.ok(BATCH_MAX <= 600, "one batch a second must stay under the faucet's 10,000 per 15 s");

console.log("OK: fly instruction bytes match the program's offsets and bad events cost no fee");

// --- weights to whole ledger units ---
// A zero-unit edge or a self-edge that reached the chain would cost a fee and revert.
const edges = outgoingEdges([
  [0, 17, 0.1643],    // w_pe
  [0, 18, 0.0001],    // rounds to zero units: can never be a transaction
  [0, 0, 0.5],        // self-edge: program/fly.c reverts on pre == post
  [48, 3, -0.1097],   // D7 -> EPG, negative by construction
]);
assert.deepEqual(edges.get(0), [{ post: 17, amount: 16 }]);
assert.deepEqual(edges.get(48), [{ post: 3, amount: -11 }]);
assert.equal(edges.has(18), false);
