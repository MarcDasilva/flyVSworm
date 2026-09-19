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

const ROOT = fileURLToPath(new URL("../../", import.meta.url));   // repo root
const NAMES = new Set(JSON.parse(
  readFileSync(new URL("../data/names.json", import.meta.url), "utf8")));

const PORT = 8787;

// One burst of simulation, then one classification. 600 steps at dt=5ms is
// 3.0 s of worm life for ~3.0 s of wall clock. Bigger bursts buy a better
// real-time ratio and cost touch latency, because a click can only be served
// after the transaction already in flight.
//
// SETTLE_EVERY is the FRAME RATE KNOB, which is not obvious: a trace frame and
// a transfer event are emitted per SETTLEMENT, not per step, so 600/10 = 60
// frames from one transaction where 600/30 gave 20. Settlement is cheap
// (Task 11 measured +0.99% CU at settle_every=20 over 100 steps), so paying 3x
// for it is what buys a cloud that looks alive instead of one that ticks.
const STEP_N = 600;
const SETTLE_EVERY = 10;
const TOUCH_STEPS = 300;
const STIM_MV = 40.0;

// A viewer that has not polled /api/status for this long is gone; stepping
// for a closed tab spends real balance on nothing.
const VIEWER_TTL_MS = 15_000;
// R19 again, from the other side: an OPEN tab left overnight would drain the
// wallet at ~4,500 units/minute. The brain sleeps this long after the last
// touch and any touch wakes it.
const IDLE_MS = 180_000;

// --- idle motion -----------------------------------------------------------
// An untouched worm classifies as PAUSE and a paused worm stands still, which
// is the honest output and is also a frozen screen: a visitor who never
// clicks sees a dead animal. So the relay touches it on a timer while
// somebody is watching.
//
// This is a DEMO AFFORDANCE, and the log says so — the rows read `auto-stim`
// and `auto-rel`, never a plain `stimulate` — because the motion it produces
// is a response to a stimulus THIS PROCESS injected, not locomotion emerging
// from the connectome. Downstream nothing can tell an automatic touch from a
// clicked one, which is exactly why the label has to live here.
//
// A touch buys about 20 s of movement (reverse, omega, forward, then back to
// PAUSE), so this interval keeps the animal nearly always moving. It is not
// free: four extra transactions per touch, roughly 2,000 units/minute on top
// of the stepper's 4,500. Set to 0 to switch it off and go back to
// click-to-move.
const AUTO_TOUCH_MS = 22_000;
// Head touch drives reverse, tail touch drives forward. Alternating gives
// both, and an omega turn each time the stimulus is released.
const AUTO_NEURONS = ["ALML", "PLML"];

// Both are overwritten by the worker's first reply — deploy.py's
// BALANCE_FLOOR and FAUCET_REFILL are the one definition (R19).
let balance = Infinity;
let floor = 20_000;
let faucet = "thru faucet withdraw worm 10000";
let stepping = false;
let workerAlive = true;
let viewerSeen = 0;
let wakeAt = 0;
let autoAt = 0;
let autoIdx = 0;
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
// not only on click. A chain that only moves when clicked looks like a
// database; and the escape response itself needs steps AFTER the touch to
// play out — reversal, then the omega turn once the stimulus is released,
// then forward. The cost is real and bounded above: 400 units per cycle,
// ~4,500 units/minute, which the viewer gate and IDLE_MS cap.
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
  return workerAlive &&
         Date.now() - viewerSeen < VIEWER_TTL_MS &&
         Date.now() - wakeAt < IDLE_MS;
}

async function stepperLoop() {
  for (;;) {
    if (awake() && balance >= floor) {
      stepping = true;
      if (AUTO_TOUCH_MS > 0 && Date.now() - autoAt >= AUTO_TOUCH_MS) {
        autoAt = Date.now();
        // Guarded because this runs INSIDE the forever-loop: a throw here
        // escapes it and stepping stops for good, with the HUD still
        // claiming the relay is fine. chain() resolves rather than rejects
        // on a failed transaction, so this should never fire — which is
        // precisely why it would be invisible if it did.
        try {
          await touch(AUTO_NEURONS[autoIdx++ % AUTO_NEURONS.length], true);
        } catch (e) {
          note({ op: "auto-stim", error: String(e && e.message || e) });
        }
      } else {
        await stepperCycle();
      }
    } else {
      stepping = false;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// --- touches ---------------------------------------------------------------
// The stimulus is applied, stepped, classified, and then RELEASED. Releasing
// is not politeness: i_stim persists in account data until something clears
// it, and the classifier only leaves REVERSE for the omega turn once the
// reversal drive falls back under THRESH_OFF (worm.c do_classify). A touch
// that is never released leaves the animal reversing forever.
async function touch(neuron, auto = false) {
  await chain(auto ? "auto-stim" : "stimulate", { op: "stimulate", neuron, mV: STIM_MV });
  await chain("step", { op: "step", n: TOUCH_STEPS, settleEvery: SETTLE_EVERY });
  await chain("classify", { op: "classify" });
  await chain(auto ? "auto-rel" : "release", { op: "stimulate", neuron, mV: 0.0 });
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
    if (Date.now() - viewerSeen >= VIEWER_TTL_MS) wakeAt = Date.now();  // fresh viewer
    viewerSeen = Date.now();
    json(res, 200, {
      balance, floor, faucet, stepping, awake: awake(), workerAlive,
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
      wakeAt = Date.now();
      // A click restarts the idle timer: the worm is already about to move,
      // so an automatic touch on top would only spend for nothing.
      autoAt = Date.now();
      json(res, 202, { queued: neuron, balance });
      touch(neuron).catch(e => console.error("relay: touch failed", e));
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
  if (balance >= floor) await chain("reset", { op: "reset" });
  stepperLoop();
});
