// Run: npx tsx src/test_chain.ts
//
// The wire format between worm.c and the scene. Everything here is a decode
// bug that would show as "the demo is just quiet" rather than as an error:
// a silent stream, a frozen cloud, or particles between the wrong cells.
// The live half (that the node really delivers these bytes) cannot be tested
// offline and is verified by running the stack.
import { strict as assert } from "node:assert";
import { decodeEvent } from "./chain.js";

const N = 302;
const TRACE_BYTES = 8 + N * 2 + 8;
const END = 0xa5;

// Each new receipt is one independently signed electrical/chemical event.
for (const offset of [0, 1, 3]) {
  const bytes = new Uint8Array(new ArrayBuffer(24 + offset), offset, 24);
  const data = new DataView(bytes.buffer, offset, 24);
  bytes.set(new TextEncoder().encode("WORMSYNX"));
  data.setUint32(8, 123, true);
  data.setUint16(12, 4, true);
  data.setUint16(14, 7, true);
  data.setInt32(16, -9, true);
  bytes[20] = 1; bytes[23] = END;
  assert.deepEqual(decodeEvent(bytes), { kind: "synapse", step: 123, pre: 4, post: 7, amount: -9, chemical: true });
  assert.equal(decodeEvent(bytes.subarray(0, 23)), undefined);
  bytes[20] = 2;
  assert.equal(decodeEvent(bytes), undefined);
}

function tag(into: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < 8; i++) into[at + i] = text.charCodeAt(i);
}

/** worm_trace_event_t, laid out exactly as worm.h declares it. */
function traceEvent(mV: number[], step: number, state: number, offset: number): Uint8Array {
  const buf = new ArrayBuffer(offset + TRACE_BYTES);
  const p = new Uint8Array(buf, offset, TRACE_BYTES);
  const d = new DataView(buf, offset, TRACE_BYTES);
  tag(p, 0, "WORMTRCE");
  for (let i = 0; i < N; i++) d.setInt16(8 + i * 2, mV[i] ?? -70, true);
  d.setUint32(8 + N * 2, step, true);
  d.setUint8(8 + N * 2 + 4, state);
  d.setUint8(TRACE_BYTES - 1, END);
  return p;
}

/** worm_xfer_event_t: tag, step, count, count triples, terminator. */
function xferEvent(triples: [number, number, number][], step: number): Uint8Array {
  const size = 8 + 4 + 4 + triples.length * 8 + 1;
  const p = new Uint8Array(size);
  const d = new DataView(p.buffer);
  tag(p, 0, "WORMGAPX");
  d.setUint32(8, step, true);
  d.setUint32(12, triples.length, true);
  triples.forEach(([pre, post, amt], k) => {
    d.setUint16(16 + k * 8, pre, true);
    d.setUint16(18 + k * 8, post, true);
    d.setInt32(20 + k * 8, amt, true);
  });
  d.setUint8(size - 1, END);
  return p;
}

// A frame whose voltages are read from the wrong offset paints the whole
// brain with its neighbour's colour and nothing anywhere complains.
{
  const mV = Array.from({ length: N }, (_, i) => -70 + (i % 40));
  const ev = decodeEvent(traceEvent(mV, 1234, 2, 0));
  assert.ok(ev && ev.kind === "trace", "a real trace event did not decode");
  assert.equal(ev.step, 1234);
  assert.equal(ev.state, 2);
  assert.equal(ev.mV.length, N);
  assert.equal(ev.mV[0], -70);
  assert.equal(ev.mV[1], -69);
  assert.equal(ev.mV[N - 1], mV[N - 1]);
}

// THE TRAP: protobuf-es hands out a subarray of a shared read buffer, so the
// payload can start at an ODD byte. new Int16Array(buffer, odd) throws
// RangeError, and a throw inside the stream loop kills the feed for the rest
// of the session with nothing on screen to say so.
{
  const mV = Array.from({ length: N }, (_, i) => -60 - (i % 7));
  for (const offset of [0, 1, 2, 3, 7]) {
    const p = traceEvent(mV, 99, 1, offset);
    assert.equal(p.byteOffset, offset, "fixture did not land at the offset under test");
    const ev = decodeEvent(p);
    assert.ok(ev && ev.kind === "trace", `offset ${offset} failed to decode`);
    assert.equal(ev.mV[0], mV[0], `offset ${offset} decoded the wrong first voltage`);
    assert.equal(ev.mV[N - 1], mV[N - 1], `offset ${offset} decoded the wrong last voltage`);
  }
}

// Transfers carry direction in WHICH index is pre and which is post; swap
// them and every particle runs backwards down a real synapse.
{
  const ev = decodeEvent(xferEvent([[3, 7, 12], [301, 0, 1], [150, 151, -4]], 60));
  assert.ok(ev && ev.kind === "xfer", "a real transfer event did not decode");
  assert.equal(ev.step, 60);
  assert.deepEqual(ev.transfers, [
    { pre: 3, post: 7, amount: 12 },
    { pre: 301, post: 0, amount: 1 },
    { pre: 150, post: 151, amount: -4 },
  ]);
}

// The terminator byte must never be read as a fourth triple.
{
  const ev = decodeEvent(xferEvent([], 8));
  assert.ok(ev && ev.kind === "xfer");
  assert.equal(ev.transfers.length, 0, "an empty settlement invented a transfer");
}

// A payload that declares more transfers than it carries must yield fewer
// particles, NOT a RangeError that takes the stream down.
{
  const full = xferEvent([[1, 2, 3], [4, 5, 6]], 20);
  const short = full.slice(0, full.byteLength - 8);
  new DataView(short.buffer).setUint32(12, 2, true);
  const ev = decodeEvent(short);
  assert.ok(ev && ev.kind === "xfer", "a truncated transfer event threw instead of degrading");
  assert.equal(ev.transfers.length, 1);
}

// DISCRIMINATION IS BY TAG, NEVER BY LENGTH. alphanet carries other
// programs' events on the same subscription; one of them landing on 612
// bytes must not be painted onto the brain.
{
  const impostor = traceEvent([], 1, 1, 0);
  tag(impostor, 0, "NOTAWORM");
  assert.equal(decodeEvent(impostor), undefined, "a foreign event decoded as a frame");
  const short = traceEvent([], 1, 1, 0).slice(0, TRACE_BYTES - 2);
  assert.equal(decodeEvent(short), undefined, "a short trace decoded anyway");
  assert.equal(decodeEvent(new Uint8Array(4)), undefined, "a runt payload decoded anyway");
}

console.log("OK: chain event decode holds at every byte offset, tag and truncation");
