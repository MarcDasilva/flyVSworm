// Run: node test_relay.mjs. Fake worker and clock; never submits to the chain.
import assert from "node:assert/strict";
import http from "node:http";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { mock } from "node:test";

let handleRequest;
let balance = 100_000;
const commands = [];
const stimuli = new Map();
const stepInputs = [];
const worker = new EventEmitter();
worker.stdout = new PassThrough();
worker.stdin = {
  write(line) {
    const cmd = JSON.parse(line);
    commands.push(cmd);
    // Yield between transactions so the real stepper loop can be observed.
    setTimeout(() => {
      if (cmd.op === "reset") stimuli.clear();
      if (cmd.op === "stimulate") {
        if (cmd.mV) stimuli.set(cmd.neuron, cmd.mV);
        else stimuli.delete(cmd.neuron);
      }
      if (cmd.op === "step") stepInputs.push([...stimuli.keys()]);
      worker.stdout.write(JSON.stringify({
        id: cmd.id, ok: true, balance, floor: 20_000, faucet: "test faucet",
        sig: `test-${cmd.id}`,
      }) + "\n");
    }, 1);
  },
};
mock.method(childProcess, "spawn", () => worker);
mock.method(http, "createServer", handler => {
  handleRequest = handler;
  return { listen(_port, ready) { void ready(); } };
});
syncBuiltinESMExports();
mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });

function status() {
  let result;
  handleRequest({ method: "GET", url: "/api/status" }, {
    writeHead(code) { assert.equal(code, 200); },
    end(body) { result = JSON.parse(body); },
  });
  return result;
}

async function advance(ms, watching = true) {
  for (let elapsed = 0; elapsed < ms; elapsed += 500) {
    if (watching) status();
    mock.timers.tick(500);
    await setImmediate();
  }
}

const stepCount = () => commands.filter(cmd => cmd.op === "step").length;
try {
  await import("./relay.mjs");
  await advance(180_000);
  const before = stepCount();
  await advance(60_000);
  assert.ok(status().awake, "watching without poking put the worm to sleep");
  assert.ok(stepCount() > before, "step transactions stopped after three minutes");
  assert.deepEqual(stepInputs[0], ["PLML"], "worm did not start crawling forward");
  assert.ok(stepInputs.some(inputs => inputs[0] === "ALML"), "worm never reversed");
  assert.ok(stepInputs.every(inputs => inputs.length === 1),
    "a simulation batch had no movement input or competing head/tail inputs");

  // Two quick pokes must be served as complete sequences, in request order.
  const at = stepInputs.length;
  const replies = [];
  for (const neuron of ["ALML", "PLML"]) {
    const request = Object.assign(new EventEmitter(), { method: "POST", url: "/api/touch" });
    handleRequest(request, {
      writeHead(code) { assert.equal(code, 202); },
      end(body) { replies.push(JSON.parse(body).queued); },
    });
    request.emit("data", JSON.stringify({ neuron }));
    request.emit("end");
  }
  await advance(15_000);
  assert.deepEqual(replies, ["ALML", "PLML"]);
  const duringPokes = stepInputs.slice(at);
  const head = duringPokes.findIndex(inputs => inputs[0] === "ALML");
  assert.ok(head >= 0 && duringPokes.slice(head + 1).some(inputs => inputs[0] === "PLML"),
    "queued head/tail pokes did not change direction in order");
  assert.ok(duringPokes.every(inputs => inputs.length === 1), "touch sequences interleaved");

  // Closing the viewer must still stop spending after in-flight work drains.
  await advance(30_000, false);
  const stopped = commands.length;
  const stoppedSteps = stepCount();
  await advance(10_000, false);
  assert.equal(commands.length, stopped, "relay kept spending without a viewer");
  await advance(20_000);
  assert.ok(stepCount() > stoppedSteps, "returning viewer did not resume simulation");
  assert.ok(commands.length > stopped, "returning viewer submitted no transactions");

  balance = 0;
  await advance(30_000);
  const broke = stepCount();
  await advance(20_000);
  assert.equal(stepCount(), broke, "low balance did not halt stepping");
  balance = 100_000;
  await advance(30_000);
  assert.ok(stepCount() > broke, "top-up did not resume stepping without a poke");
  console.log("OK: sustained movement input, queued pokes, viewer expiry, and balance recovery");
} finally {
  mock.timers.reset();
  mock.restoreAll();
  syncBuiltinESMExports();
  worker.stdout.destroy();
}
