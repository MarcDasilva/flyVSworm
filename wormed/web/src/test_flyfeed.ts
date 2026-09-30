// Run: npx tsx src/test_flyfeed.ts
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mock } from "node:test";

Object.defineProperty(globalThis, "location", { value: { protocol: "http:", host: "localhost" }, configurable: true });
const { FlyFeed } = await import("./flyfeed.js");
class Socket {
  static all: Socket[] = [];
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor() { Socket.all.push(this); }
  close() { if (!this.closed) { this.closed = true; this.onclose?.(); } }
}
const realSocket = globalThis.WebSocket;
globalThis.WebSocket = Socket as unknown as typeof WebSocket;
mock.timers.enable({ apis: ["setTimeout"] });
try {
  const feed = new FlyFeed("ws://localhost/fly/ws");
  const controller = new AbortController();
  feed.connect(controller.signal);
  for (let i = 0; i < 5; i++) feed.connect(controller.signal);
  assert.equal(Socket.all.length, 1, "repeated clicks opened extra sockets");
  Socket.all.at(-1)!.close();
  for (let i = 0; i < 5; i++) feed.connect(controller.signal);
  assert.equal(Socket.all.length, 1, "clicking during reconnect bypassed the pending retry");
  mock.timers.tick(2000);
  assert.equal(Socket.all.length, 2);
  assert.equal(Socket.all.filter(s => !s.closed).length, 1);
  for (let i = 0; i < 20; i++) {
    Socket.all.at(-1)!.close();
    mock.timers.tick(2000);
    assert.equal(Socket.all.filter(s => !s.closed).length, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1, "abort listeners accumulated");
  }
  const socket = Socket.all.at(-1)!;
  socket.onmessage?.({ data: JSON.stringify({ type: "frame", rates: [10, 200], spikes: [[1, 1]] }) });
  assert.deepEqual([...feed.frame!.rates], [10, 200]);
  socket.close();
  controller.abort();
  const attempts = Socket.all.length;
  mock.timers.tick(10000);
  assert.equal(Socket.all.length, attempts, "aborted feed reconnected");
  assert.equal(feed.frame, null);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const reopened = new AbortController();
  feed.connect(reopened.signal);
  const lastSocket = Socket.all.at(-1)!;
  feed.disconnect();
  lastSocket.onmessage?.({ data: JSON.stringify({ type: "frame", rates: [999] }) });
  assert.equal(lastSocket.closed, true);
  assert.equal(feed.frame, null, "a late message revived a closed feed");
  assert.equal(getEventListeners(reopened.signal, "abort").length, 0);
  feed.connect(reopened.signal);
  Socket.all.at(-1)!.close();
  feed.disconnect();
  const closedAttempts = Socket.all.length;
  mock.timers.tick(10000);
  assert.equal(Socket.all.length, closedAttempts, "closing the brain left a retry running");
  feed.connect(reopened.signal);
  reopened.abort();
  assert.ok(Socket.all.every(s => s.closed), "abort left a socket open");
  console.log("OK: fly feed keeps one socket, one retry, and one abort listener");
} finally {
  mock.timers.reset();
  globalThis.WebSocket = realSocket;
}
