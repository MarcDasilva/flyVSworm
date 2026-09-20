// The demo's signing half. The browser reads the chain directly (src/chain.ts
// subscribes to the node's event stream), but it must never hold the fee
// payer's key — so every transaction is submitted here, and this process is
// the ONLY thing in the demo that can spend.
//
// Run from wormed/web: `node relay.mjs`. vite proxies /api to it (vite.config.ts).
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { settleSynapses } from "./synapses.mjs";
import { settleFlySynapses, outgoingEdges, BATCH_MAX, FLY_PAYERS } from "./flysynapses.mjs";
import { openStore } from "./store.mjs";
import { loadEnv, speak, writeLine } from "./banter.mjs";

// Gemini's and ElevenLabs' keys, out of the repo's .env. Read before any request arrives so a
// missing key is a startup line rather than a puzzle mid-demo.
loadEnv();

const ROOT = fileURLToPath(new URL("../../", import.meta.url));   // repo root
const NAMES = new Set(JSON.parse(
  readFileSync(new URL("../data/names.json", import.meta.url), "utf8")));
const flyCfg = JSON.parse(readFileSync(new URL("../data/fly.json", import.meta.url), "utf8"));

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

// The exhibit's ledger — the standings the board prints and the transaction total over it.
// ponytail: an unopenable ledger must NOT take the exhibit down with it. The relay is the only
// thing that can drive the animals; it runs without a scoreboard, and the page falls back to
// what it has counted itself.
let store;
try {
  store = openStore();
} catch (e) {
  console.error(`relay: ledger unavailable (${e.message}); standings will not persist`);
  store = { countTransactions() {}, recordStanding: () => false,
            board: () => ({ transactions: 0, standings: [] }) };
}

/**
 * The relay's log, and the ONE place every transaction it makes is counted. Both paths pass
 * through here — chain() notes the worker's replies and settleSynapses notes one receipt per
 * event it submits — so counting anywhere else would miss half the exhibit's spend.
 */
function note(entry) {
  if (entry.sig) store.countTransactions();
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

// --- the fly ------------------------------------------------------------
// The fly's model runs beside the relay (wormed/serve.sh), so its spikes are read HERE and
// settled HERE, the way the worm's outbox is — NOT derived in the browser. A page that cannot
// reach the model's WebSocket still sees the fly trade, and two open pages cannot submit the
// same spike twice. The page reads the receipts back off the chain (src/flychain.ts).
const FLY_MODEL = "http://127.0.0.1:8000";
/** The pool: one settle loop per payer, each paced by its own batch landing (flysynapses.mjs
 *  says why one payer tops out near 100/s). Between batches a loop pauses this long so a payer
 *  whose batch was refused does not spin. The model makes ~14,000 events a second, so what
 *  settles is a uniform SAMPLE of the window — the page says so. */
const FLY_PAUSE_MS = 200;
/** About a second of the model's output, so a sample spans the whole window. */
const FLY_QUEUE_MAX = 16_384;
let flyEdges = new Map();
let flyQueue = [];
/** What the page's fly panel prints. Balance is the POOL's — every fly payer, none of the
 *  worm's (flysynapses.mjs). */
const flyStats = { model: "offline", frames: 0, submitted: 0, balance: undefined, error: "",
                   payers: Object.fromEntries(FLY_PAYERS.map(p => [p, undefined])),
                   reservoir: undefined };

async function flyModelLoop() {
  for (;;) {
    try {
      if (!flyEdges.size) {
        const { synapses } = await (await fetch(`${FLY_MODEL}/api/network`)).json();
        flyEdges = outgoingEdges(synapses);
      }
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${FLY_MODEL.replace("http", "ws")}/ws`);
        ws.onopen = () => { flyStats.model = "live"; };
        ws.onmessage = ({ data }) => {
          let msg;
          try { msg = JSON.parse(data); } catch { return; }
          if (msg.type !== "frame" || !Array.isArray(msg.spikes)) return;
          flyStats.frames++;
          for (const [, pre] of msg.spikes)
            for (const edge of flyEdges.get(pre) ?? [])
              flyQueue.push({ tick: msg.t >>> 0, pre, post: edge.post, amount: edge.amount });
          // Bounded, and the NEWEST kept: a backlog the chain can never catch up with would
          // have the panel showing firing that is minutes old.
          if (flyQueue.length > FLY_QUEUE_MAX) flyQueue.splice(0, flyQueue.length - FLY_QUEUE_MAX);
        };
        ws.onerror = () => reject(Error("fly model unreachable"));
        ws.onclose = () => resolve();
      });
    } catch (e) {
      flyStats.error = String(e?.message ?? e).slice(0, 120);
    }
    flyStats.model = "offline";
    flyQueue = [];
    await new Promise(r => setTimeout(r, 2000));
  }
}

/**
 * Keeps the fly's reservoir funded. program/fly.c conserves charge between the reservoir and
 * the 56 cells, but charge pools in cells that receive more than they fire, so the reservoir
 * drains at ~0.1 unit per event and every event reverts once it is empty — measured: the
 * original 10,000 lasted ~100,000 events. The faucet pays it straight, with the spare `fly`
 * key as fee payer (its OWN nonce sequence, so no pool signer is disturbed); that key is
 * refilled from the faucet too when it runs low. One CLI call each per check.
 */
const RESERVOIR_REFILL_AT = 10_000;
const RESERVOIR_CHECK_MS = 15_000;
const RESERVOIR_PAYER = "fly";
/** One `thru --json` call, resolved with its parsed output. spawn rather than execFile so the
 *  relay test's spawn mock covers it — promisify(execFile) is Node's own promisified variant
 *  and slips past a mock, which had the test querying alphanet for real. */
function cli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn("thru", ["--json", ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", c => { out += c; });
    child.on("error", reject);
    child.on("exit", code => {
      if (code !== 0) { reject(Error(`thru ${args.join(" ")} exited ${code}`)); return; }
      try { resolve(JSON.parse(out.slice(0, out.indexOf("}\n{") + 1 || undefined))); }
      catch (e) { reject(e); }
    });
  });
}
async function flyReservoirLoop() {
  const balance = async (who) => Number((await cli("getbalance", who)).balance.balance);
  for (;;) {
    await new Promise(r => setTimeout(r, RESERVOIR_CHECK_MS));
    if (!awake()) continue;
    try {
      if (await balance(RESERVOIR_PAYER) < 2_000)
        await cli("faucet", "withdraw", "--fee-payer", RESERVOIR_PAYER, RESERVOIR_PAYER, "10000");
      const have = await balance(flyCfg.reservoirAccount);
      flyStats.reservoir = have;
      if (have < RESERVOIR_REFILL_AT) {
        await cli("faucet", "withdraw", "--fee-payer", RESERVOIR_PAYER, flyCfg.reservoirAccount, "10000");
        console.error(`fly reservoir: at ${have}, refilled from the faucet`);
      }
    } catch (e) {
      note({ op: "fly-reservoir", error: String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200) });
    }
  }
}

async function flySettleLoop(payer) {
  for (;;) {
    await new Promise(r => setTimeout(r, FLY_PAUSE_MS));
    // Same rule as the worm: no viewer, no spend. The model keeps running; only settlement stops.
    if (!awake() || !flyQueue.length) continue;
    // A uniform sample of the queue, which the other loops are drawing from too.
    const events = [];
    for (let i = 0; i < BATCH_MAX && flyQueue.length; i++)
      events.push(...flyQueue.splice(Math.floor(Math.random() * flyQueue.length), 1));
    try {
      const out = await settleFlySynapses(events, payer);
      flyStats.submitted += out.submitted;
      if (out.balance !== undefined) {
        flyStats.payers[payer] = out.balance;
        flyStats.balance = Object.values(flyStats.payers).reduce((a, b) => a + (b ?? 0), 0);
      }
      flyStats.error = "";
      // Counted like the worm's synapses — one row per signature — so the board's total covers
      // both animals. Only the first is logged; 24 rows a batch would drown the worm's log.
      if (out.submitted) {
        note({ op: "fly-synapse", sig: out.signatures[0], n: out.submitted });
        store.countTransactions(out.submitted - 1);
      }
    } catch (error) {
      flyStats.error = `${payer}: ${String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 180)}`;
      note({ op: "fly-synapse", error: flyStats.error });
    }
  }
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

// The fly model (fly-brain/python/server.py) sits behind the relay when hosted, so the exhibit
// is ONE public port: a shared Fly.io IPv4 serves only 80/443, and Vercel rewrites /fly here.
// vite.config.ts does the same job in development.
// ponytail: hand-rolled proxy, no hop-by-hop header hygiene; the only client is our own page.
const FLY = { host: "127.0.0.1", port: 8000 };
function proxyFly(req, res) {
  const up = httpRequest({ ...FLY, path: req.url.slice(4), method: req.method, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", () => json(res, 502, { error: "fly model offline" }));
  req.pipe(up);
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/status") {
    viewerSeen = Date.now();
    // The board rides the heartbeat the page already makes. A second poll for two numbers that
    // change as slowly as the standings do would be a second thing to keep alive.
    json(res, 200, {
      balance, floor, faucet, stepping, awake: awake(), workerAlive, pendingSynapses,
      stepN: STEP_N, settleEvery: SETTLE_EVERY, log, fly: flyStats, ...store.board(),
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
  if (req.method === "POST" && url.pathname === "/api/standing") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on("end", () => {
      let posted;
      try { posted = JSON.parse(body); } catch { json(res, 400, { error: "bad json" }); return; }
      // TRUST BOUNDARY. The page measures its own animals' books, so this accepts figures it
      // cannot verify — the store bounds them and names the two specimens that exist, which is
      // what keeps a POST from writing a screenful of digits onto the wall.
      if (!store.recordStanding(posted.specimen, posted.profit, posted.trades)) {
        json(res, 400, { error: "bad standing" });
        return;
      }
      viewerSeen = Date.now();
      json(res, 200, store.board());
    });
    return;
  }
  // --- the two animals talking ---------------------------------------------
  // The page asks for one line at a time and plays it before asking for the next, so there is no
  // streaming here and no state: the argument so far comes back up with every request.
  if (req.method === "POST" && url.pathname === "/api/banter") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", async () => {
      let posted;
      try { posted = JSON.parse(body); } catch { json(res, 400, { error: "bad json" }); return; }
      // TRUST BOUNDARY. Both fields go into a prompt, so the speaker is narrowed to the two
      // animals that exist and the history is capped and stringified -- a page that posts a novel
      // gets a short argument, not a large bill.
      const speaker = posted.speaker === "worm" ? "worm" : "fly";
      const history = (Array.isArray(posted.history) ? posted.history : []).slice(-6)
        .map(t => ({ speaker: t?.speaker === "worm" ? "worm" : "fly", text: String(t?.text ?? "").slice(0, 300) }));
      viewerSeen = Date.now();
      try {
        json(res, 200, { speaker, text: await writeLine(speaker, history, store.board()) });
      } catch (e) {
        json(res, 502, { error: String(e?.message ?? e) });
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/speak") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", async () => {
      let posted;
      try { posted = JSON.parse(body); } catch { json(res, 400, { error: "bad json" }); return; }
      // TRUST BOUNDARY. The text is spoken, not executed, but it is still billed by the character.
      const speaker = posted.speaker === "worm" ? "worm" : "fly";
      const text = String(posted.text ?? "").trim().slice(0, 300);
      if (!text) { json(res, 400, { error: "nothing to say" }); return; }
      viewerSeen = Date.now();
      try {
        const upstream = await speak(speaker, text);
        res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
        // Web stream off fetch, node stream on the wire: hand the chunks over as they land so the
        // scene is not holding a silence while a whole mp3 buffers here.
        for await (const chunk of upstream.body) res.write(chunk);
        res.end();
      } catch (e) {
        if (!res.headersSent) json(res, 502, { error: String(e?.message ?? e) });
        else res.end();
      }
    });
    return;
  }
  if (url.pathname.startsWith("/fly/")) { proxyFly(req, res); return; }
  json(res, 404, { error: "not found" });
}).on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/fly/")) { socket.destroy(); return; }
  const up = httpRequest({ ...FLY, path: req.url.slice(4), method: "GET", headers: req.headers });
  up.on("upgrade", (r, upSocket, upHead) => {
    const lines = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines}\r\n\r\n`);
    if (upHead.length) socket.write(upHead);
    upSocket.pipe(socket).pipe(upSocket);
  });
  up.on("error", () => socket.destroy());
  up.end(head);
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
  void flyModelLoop();
  for (const payer of FLY_PAYERS) void flySettleLoop(payer);
  void flyReservoirLoop();
});
