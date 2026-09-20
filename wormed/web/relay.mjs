// The demo's signing half. The browser reads the chain directly (src/chain.ts
// subscribes to the node's event stream), but it must never hold the fee
// payer's key — so every transaction is submitted here, and this process is
// the ONLY thing in the demo that can spend.
//
// Run from wormed/web: `node relay.mjs`. vite proxies /api to it (vite.config.ts).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { settleSynapses } from "./synapses.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));   // repo root
const NAMES = new Set(JSON.parse(
  readFileSync(new URL("../data/names.json", import.meta.url), "utf8")));

const PORT = 8787;

// Preserve the 10-step settlement cadence. Each batch fits every chemical
// and electrical event in the on-chain outbox; no next batch until it drains.
const STEP_N = 100;
const SETTLE_EVERY = 10;
const TOUCH_STEPS = 100;
const STIM_MV = 40.0;

// A viewer that has not polled /api/status for this long is gone; stepping
// for a closed tab spends real balance on nothing.
const VIEWER_TTL_MS = 15_000;

// Hold one on-chain sensory input between direction changes. Releasing it
// immediately lets the network settle to PAUSE after a single step batch.
// These are injected inputs, logged as auto-stim/auto-rel, not spontaneous
// locomotion. Start forward; alternate head/tail every 22 seconds.
const AUTO_TOUCH_MS = 22_000;

// Both are overwritten by the worker's first reply — deploy.py's
// BALANCE_FLOOR and FAUCET_REFILL are the one definition (R19).
let balance = Infinity;
let floor = 20_000;
let faucet = "thru faucet withdraw worm 10000";
let stepping = false;
let workerAlive = true;
let viewerSeen = 0;
/** Slow poll so a halted relay notices a top-up without needing a click. */
const BALANCE_RECHECK_MS = 15_000;
let lastBalanceAt = 0;
let autoAt = 0;
let drivenNeuron;
const touches = [];
let pendingSynapses = false;
let needsReset = true;
const log = [];

function note(entry) {
  log.unshift({ t: Date.now(), ...entry });
  log.length = Math.min(log.length, 60);
}

// --- the worker ------------------------------------------------------------
// Commands are serialised: transactions from one fee payer are nonce-ordered,
// so two in flight is a race the chain settles by rejecting one of them.
const worker = spawn("python3", ["-m", "wormed.pipeline.relay_worker"], {
  cwd: ROOT, stdio: ["pipe", "pipe", "inherit"],
});
worker.on("exit", (code) => {
  workerAlive = false;
  note({ op: "worker", error: `chain worker exited with code ${code}` });
});

const pending = new Map();
let nextId = 1;
createInterface({ input: worker.stdout }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { console.error("relay: junk from worker:", line); return; }
  const slot = pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  slot(msg);
});

let tail = Promise.resolve();
/** Enqueue one chain operation. Resolves with the worker's reply. */
function send(cmd) {
  const run = () => new Promise((resolve) => {
    if (!workerAlive) { resolve({ ok: false, error: "chain worker is dead" }); return; }
    const id = nextId++;
    pending.set(id, resolve);
    worker.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
  });
  const queued = tail.then(run);
  tail = queued.then(() => undefined, () => undefined);
  return queued;
}

async function chain(op, cmd) {
  const t0 = Date.now();
  const r = await send(cmd);
  if (r.pending) pendingSynapses = true;
  note({ op, sig: r.sig, ms: Date.now() - t0, error: r.ok ? undefined : r.error });
  if (!r.ok) console.error(`relay: ${op} failed: ${r.error}`);
  return r;
}

// --- R19 preflight ---------------------------------------------------------
// The fee payer running dry surfaces as vm_error -509 inside a JSON dump that
// looks exactly like a program fault. Naming it — and the faucet command that
// fixes it — BEFORE the transaction is the whole point.
async function affordable() {
  const r = await send({ op: "balance" });
  if (r.ok) ({ balance, floor, faucet } = r);
  return balance >= floor;
}

function brokeError() {
  return {
    error: `fee payer is down to ${balance} units (floor ${floor}). ` +
           `Top up before touching anything: ${faucet}`,
    balance, floor, faucet,
  };
}

// --- the stepper -----------------------------------------------------------
// DECISION (Task 15): the brain steps continuously while someone is watching,
// not only on click. Held inputs keep driving the classifier between
// direction changes. Each nonzero synapse event costs its own transaction;
// throughput controls simulation speed. Viewer presence bounds the work.
async function stepperCycle() {
  if (!await affordable()) {
    note({ op: "halt", error: brokeError().error });
    stepping = false;
    return;
  }
  await chain("step", { op: "step", n: STEP_N, settleEvery: SETTLE_EVERY });
  await chain("classify", { op: "classify" });
}

function awake() {
  return workerAlive && Date.now() - viewerSeen < VIEWER_TTL_MS;
}

async function stepperLoop() {
  for (;;) {
    if (awake() && balance > floor) {
      stepping = true;
      if (pendingSynapses) {
        try {
          const settled = await settleSynapses({ floor, onReceipt: note });
          pendingSynapses = settled.remaining > 0;
          balance = settled.balance;
        } catch (e) {
          note({ op: "synapse", error: String(e.message ?? e) });
          await new Promise(r => setTimeout(r, 1000));
        }
      } else if (needsReset) {
        const reset = await chain("reset", { op: "reset" });
        needsReset = !reset.ok;
      } else if (touches.length) {
        autoAt = Date.now();
        await touch(touches.shift());
      } else if (AUTO_TOUCH_MS > 0 && Date.now() - autoAt >= AUTO_TOUCH_MS) {
        autoAt = Date.now();
        // Guarded because this runs INSIDE the forever-loop: a throw here
        // escapes it and stepping stops for good, with the HUD still
        // claiming the relay is fine. chain() resolves rather than rejects
        // on a failed transaction, so this should never fire — which is
        // precisely why it would be invisible if it did.
        try {
          await touch(drivenNeuron === "PLML" ? "ALML" : "PLML", true);
        } catch (e) {
          note({ op: "auto-stim", error: String(e && e.message || e) });
        }
      } else {
        await stepperCycle();
      }
    } else {
      stepping = false;
      await new Promise(r => setTimeout(r, 500));
      // `balance` is ONLY refreshed by affordable(), which only runs inside
      // stepperCycle() — which this gate blocks whenever balance < floor. So
      // a halted relay can never observe its own top-up and sits there with a
      // funded wallet reporting the stale figure that halted it, until
      // something hits /api/touch. Re-read on a slow cadence so it heals
      // itself; the cost is one balance RPC a few times a minute while idle.
      if (balance <= floor && Date.now() - lastBalanceAt >= BALANCE_RECHECK_MS) {
        lastBalanceAt = Date.now();
        if (await affordable() && balance > floor) note({ op: "resume", ms: 0 });
        else if (awake()) {
          const refill = await chain("faucet", { op: "refill" });
          if (refill.ok) ({ balance, floor, faucet } = refill);
        }
      }
    }
  }
}

// --- touches ---------------------------------------------------------------
// Release the previous input BEFORE applying the next: competing head/tail
// currents otherwise mask the requested direction. The stepper also serves
// manual touches, so their multi-transaction sequences cannot interleave.
async function touch(neuron, auto = false) {
  if (!await affordable()) return;
  if (drivenNeuron && drivenNeuron !== neuron) {
    const released = await chain(auto ? "auto-rel" : "release",
      { op: "stimulate", neuron: drivenNeuron, mV: 0 });
    if (!released.ok) return;
    drivenNeuron = undefined;
  }
  const applied = await chain(auto ? "auto-stim" : "stimulate",
    { op: "stimulate", neuron, mV: STIM_MV });
  if (!applied.ok) return;
  drivenNeuron = neuron;
  await chain("step", { op: "step", n: TOUCH_STEPS, settleEvery: SETTLE_EVERY });
  await chain("classify", { op: "classify" });
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json",
                        "content-length": Buffer.byteLength(text) });
  res.end(text);
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/status") {
    viewerSeen = Date.now();
    json(res, 200, {
      balance, floor, faucet, stepping, awake: awake(), workerAlive, pendingSynapses,
      stepN: STEP_N, settleEvery: SETTLE_EVERY, log,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/touch") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on("end", async () => {
      let neuron;
      try { neuron = JSON.parse(body).neuron; } catch { json(res, 400, { error: "bad json" }); return; }
      // TRUST BOUNDARY. `neuron` reaches a subprocess, so it is checked
      // against the 302 names the chain actually has rather than a pattern
      // that merely looks like a neuron name — membership admits nothing to
      // escape with, and a typo fails here instead of on chain.
      if (typeof neuron !== "string" || !NAMES.has(neuron)) {
        json(res, 400, { error: `unknown neuron ${JSON.stringify(neuron)}` });
        return;
      }
      if (!await affordable()) { json(res, 503, brokeError()); return; }
      viewerSeen = Date.now();
      touches.push(neuron);
      json(res, 202, { queued: neuron, balance });
    });
    return;
  }
  json(res, 404, { error: "not found" });
}).listen(PORT, async () => {
  console.log(`relay on :${PORT} (repo root ${ROOT})`);
  const warm = await chain("warm", { op: "warm" });
  if (warm.ok) ({ balance, floor, faucet } = warm);
  if (balance < floor) {
    console.error(`relay: FEE PAYER LOW — ${balance} units, floor ${floor}\n` +
                  `relay: top up with: ${faucet}`);
  }
  // A leftover i_stim from the last session would have the worm reversing
  // before anyone touches it — reset_sim clears stimulus and voltage both.
  // It is two transactions, so it waits behind the same preflight as
  // everything else: spending below the floor is what R19 forbids.
  // Finish persisted events before resetting after a restart.
  if (balance >= floor && !pendingSynapses) {
    const reset = await chain("reset", { op: "reset" });
    needsReset = !reset.ok;
  }
  stepperLoop();
});
