import assert from "node:assert/strict";
import { createThruClient } from "@thru/sdk";
import { decodeOutbox, settleInstruction, nativeSigningKey, signSynapse, confirmSynapses } from "./synapses.mjs";

const bytes = Buffer.alloc(16 + 3 * 16);
bytes.writeUInt32LE(0x53594e50);
bytes.writeUInt32LE(3, 4);
bytes.writeUInt32LE(2, 8);
bytes.writeUInt32LE(7, 12);
for (let i = 0; i < 3; i++) {
  const at = 16 + i * 16;
  bytes.writeUInt32LE(10, at);
  bytes.writeUInt16LE(i, at + 4);
  bytes.writeUInt16LE(i + 1, at + 6);
  bytes.writeInt32LE(i === 2 ? -3 : 4, at + 8);
  bytes[at + 12] = i ? 1 : 0;
}
bytes[16 + 16 + 13] = 1; // A confirmed transaction must not be sent again after restart.
const outbox = decodeOutbox(bytes);
assert.equal(outbox.generation, 7);
assert.deepEqual(outbox.entries.map(e => e.index), [0, 2]);
assert.equal(outbox.entries[1].amount, -3);
assert.throws(() => decodeOutbox(bytes.subarray(0, -1)), /Invalid/);
bytes.writeUInt32LE(3, 8);
assert.throws(() => decodeOutbox(bytes), /count mismatch/);
assert.equal(settleInstruction(7, 2, 4, 2, 3).toString("hex"),
  "0800000007000000020000000400020003000000");
console.log("OK: persisted synapses resume without replay, preserve inhibition, and reject corrupt queues");

// All header fields supplied: this builds and signs locally, without RPC.
const thru = createThruClient({ baseUrl: "http://unused.invalid" });
const privateKey = new Uint8Array(32).fill(1);
const publicKey = await thru.keys.fromPrivateKey(privateKey);
const transaction = await thru.transactions.build({
  feePayer: { publicKey }, program: publicKey,
  header: { fee: 1n, nonce: 0n, startSlot: 0n, chainId: 1 },
  instructionData: settleInstruction(7, 2, 4, 2, 3),
});
const expected = await transaction.sign(privateKey);
const native = signSynapse(transaction, nativeSigningKey(privateKey));
assert.equal(native.signature.toThruFmt(), expected.toThruFmt());
assert.deepEqual(native.rawTransaction, transaction.toWire());
console.log("OK: native signatures match the SDK byte-for-byte");

// A disconnected stream recovers receipts across pages, ignores unrelated
// signatures, and never treats RPC acceptance or a failed execution as success.
const sig = native.signature.toThruFmt();
const confirmed = new Set();
let pages = 0, queries = 0;
const rpc = {
  events: { list: async ({ page }) => {
    pages++;
    if (!page.pageToken) return { events: [], page: { nextPageToken: "next" } };
    return { events: [{ transactionSignature: native.signature.toBytes() }] };
  } },
  transactions: { get: async () => {
    queries++;
    return { executionResult: { vmError: -511, executionResult: 0n, eventsCount: 0 } };
  } },
};
await confirmSynapses(rpc, publicKey, [sig], confirmed, 0n);
assert.equal(pages, 2);
assert.equal(queries, 0);
assert.ok(confirmed.has(sig));
rpc.events.list = async () => ({ events: [] });
await assert.rejects(confirmSynapses(rpc, publicKey, [sig], new Set(), 0n), /VM -511/);
rpc.transactions.get = async () => ({ executionResult: { vmError: 0, executionResult: 0n, eventsCount: 1 } });
const recovered = new Set();
await confirmSynapses(rpc, publicKey, [sig], recovered, 0n);
assert.ok(recovered.has(sig));
console.log("OK: missed confirmations paginate, recover from the transaction index, and reject failed transactions");
