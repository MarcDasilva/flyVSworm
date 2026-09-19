import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, BEHAVIOR, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud, parseMorphology } from "./brain.js";
import { ChainFeed, type Behavior, type ChainConfig, type RelayStatus } from "./chain.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 6, 16);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(2, 4, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7dd3fc, 0.35);
rim.position.set(-3, 2, -2);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 2.0, 1.9);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
// The worm is redrawn at the origin every frame (see WormMesh), so the orbit
// target is fixed and the camera NEVER chases a wandering animal.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.50, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;   // stay above the agar
controls.update();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  // LineMaterial measures neurite width in pixels, so it needs telling.
  brain.setResolution(innerWidth, innerHeight);
});

// data/ sits outside the vite root; vite.config.ts maps it onto the URL root,
// so these are /positions.json and NOT /data/positions.json.
const [positions, names, morphology] = await Promise.all([
  fetch("/positions.json").then(r => r.json()) as Promise<[number, number, number][]>,
  fetch("/names.json").then(r => r.json()) as Promise<string[]>,
  fetch("/morphology.bin").then(r => r.arrayBuffer()).then(parseMorphology),
]);

const body = new WormBody(24);
const worm = new WormMesh(scene);
const brain = new BrainCloud(scene, positions, names, morphology);
brain.setResolution(innerWidth, innerHeight);

// ---------------------------------------------------------------------------
// CHAIN DRIVER. Every number below is read off Thru: voltages and synaptic
// transfers from the program's own events, behavior from the behavior
// account. Nothing here invents motion — if the chain says PAUSE, the animal
// stands still.
// ---------------------------------------------------------------------------
const cfg = await (await fetch("/chain.json")).json() as ChainConfig;
const feed = new ChainFeed(cfg);
const stop = new AbortController();
addEventListener("beforeunload", () => stop.abort());

const n = names.length;
let behavior: BehaviorState = { state: BEHAVIOR.PAUSE, gain: 0 };
let chainBehavior: Behavior | undefined;
// A frame's mV is a VIEW over the received gRPC buffer (chain.ts), which
// TypeScript types as ArrayBufferLike — annotate or the first assignment
// from the chain will not fit a locally allocated Int16Array.
let voltages: Int16Array<ArrayBufferLike> = new Int16Array(n).fill(-70);
let status: RelayStatus | undefined;
let frameSig = "";
let lastFrameAt = 0;

// The particle pool holds 192 and a settlement moves ~340 junctions at once,
// so the strongest few per frame are drawn and the HUD reports the true
// count. Drawing all of them would evict each other within one frame anyway.
const PARTICLES_PER_FRAME = 110;

feed.onBehavior(b => { chainBehavior = b; behavior = { state: b.state, gain: b.gain }; });
feed.onStatus(s => { status = s; });
/** Playback state per transaction signature. Written in the SAME callback
 *  that fires the particles, which is what keeps the panel and the animation
 *  describing one event instead of two — a row's counters tick as its own
 *  transfers light up. */
type TxPlay = { frames: number; transfers: number; drawn: number; last: number };
const txPlay = new Map<string, TxPlay>();

/** Rolling rates, EMA. Raw per-frame counts are far too jumpy to read. */
let framesPerSec = 0, transfersPerSec = 0, txPerMin = 0;
let rateFrames = 0, rateTransfers = 0, rateTx = 0, rateAt = performance.now();
let tickCount = 0, tickRate = 0;
const seenSigs = new Set<string>();

feed.onFrame(f => {
  voltages = f.mV;
  frameSig = f.signature;
  lastFrameAt = performance.now();
  const strongest = f.transfers.length > PARTICLES_PER_FRAME
    ? [...f.transfers].sort((a, b) => b.amount - a.amount).slice(0, PARTICLES_PER_FRAME)
    : f.transfers;
  for (const t of strongest) brain.fireEdge(t.pre, t.post, true);

  let p = txPlay.get(f.signature);
  if (!p) {
    p = { frames: 0, transfers: 0, drawn: 0, last: 0 };
    txPlay.set(f.signature, p);
    // Bounded: the panel shows 30 rows and the relay log is shorter still.
    if (txPlay.size > 80) txPlay.delete(txPlay.keys().next().value!);
  }
  p.frames++;
  p.transfers += f.transfers.length;
  p.drawn += strongest.length;
  p.last = lastFrameAt;
  rateFrames++;
  rateTransfers += f.transfers.length;
  if (!seenSigs.has(f.signature)) { seenSigs.add(f.signature); rateTx++; }
});
feed.start(stop.signal);

const STATE_NAME = ["PAUSE", "FORWARD", "REVERSE", "OMEGA"];
const hud = document.getElementById("hud")!;
const log = document.getElementById("feed")!;
const stats = document.getElementById("txstats")!;
const clicks: string[] = [];

/** The stimulus amplitude belongs to the relay, so the label does NOT quote
 * a number that can drift away from the transaction it describes. */
async function touch(label: string, neuron: string): Promise<void> {
  clicks.unshift(`> ${label}  stimulate ${neuron}`);
  clicks.unshift(await feed.touch(neuron));
  clicks.length = Math.min(clicks.length, 6);
}
document.getElementById("touch-head")!.onclick = () => void touch("HEAD", "ALML");
document.getElementById("touch-tail")!.onclick = () => void touch("TAIL", "PLML");

/** Signatures and chain errors are remote strings going into innerHTML. */
const esc = (t: string) => t.replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Paused only freezes the DRAWING — the relay's log keeps filling, so
// resuming shows what happened meanwhile rather than a gap.
let logPaused = false;
const pauseBtn = document.getElementById("txpause") as HTMLButtonElement;
pauseBtn.onclick = () => {
  logPaused = !logPaused;
  pauseBtn.textContent = logPaused ? "RESUME" : "PAUSE";
  if (!logPaused) drawLog();
};

/** The six numbers worth watching while it runs. */
function drawStats(): void {
  const low = status !== undefined && status.balance < status.floor;
  const tile = (k: string, v: string, warn = false) =>
    `<div><div class="k">${k}</div><div class="v${warn ? " warn" : ""}">${esc(v)}</div></div>`;
  stats.innerHTML = [
    tile("TX / MIN", txPerMin.toFixed(1)),
    tile("FRAMES / S", framesPerSec.toFixed(1)),
    tile("TRANSFERS / S", Math.round(transfersPerSec).toLocaleString()),
    tile("SIM CLOCK", `${(feed.stats.lastStep * cfg.dtMs / 1000).toFixed(1)}s`),
    tile("QUEUE", String(feed.stats.lag), feed.stats.lag > 100),
    tile("FEE PAYER", status ? status.balance.toLocaleString() : "?", low),
  ].join("");
}

/** The relay's transaction log, newest first, each linking to the explorer.
 *  A row carries its own playback state, so the highlighted row is literally
 *  the transaction whose transfers are on screen right now. */
function drawLog(): void {
  if (logPaused) return;
  const rows: string[] = clicks.slice(0, 3).map(c => `<div class="row dim">${esc(c)}</div>`);
  for (const e of status?.log ?? []) {
    const ms = e.ms === undefined ? "" : `${(e.ms / 1000).toFixed(1)}s`;
    const op = esc(e.op).padEnd(9);
    // A chain error arrives as a multi-line JSON dump; one line of it is
    // what a human standing at the screen can read.
    if (e.error) {
      rows.push(`<div class="row fail">${op} FAILED ${esc(e.error.replace(/\s+/g, " ")).slice(0, 52)}…</div>`);
    } else if (e.sig) {
      const play = txPlay.get(e.sig);
      const live = e.sig === frameSig && performance.now() - lastFrameAt < 1500;
      const link = `<a href="${esc(cfg.explorer + e.sig)}" target="_blank" rel="noreferrer">${esc(e.sig.slice(0, 18))}…</a>`;
      const tail = play
        ? `  <span class="dim">${String(play.frames).padStart(2)}f</span> ${play.transfers.toLocaleString().padStart(6)} xfer`
        : `  <span class="dim">queued</span>`;
      rows.push(`<div class="row${live ? " live" : ""}">${live ? "\u25b8" : " "} ${op} ${ms.padStart(5)}  ${link}${tail}</div>`);
    } else {
      rows.push(`<div class="row dim">  ${op} ${ms.padStart(5)}</div>`);
    }
    if (rows.length > 26) break;
  }
  log.innerHTML = rows.join("");
}

/** EMA over a ~1 s window. Called from the render loop, not a timer, so it
 *  cannot drift out of step with what is on screen. */
function integrateRates(now: number): void {
  const span = (now - rateAt) / 1000;
  if (span < 1) return;
  rateAt = now;
  tickRate += (tickCount / span - tickRate) * 0.4;
  tickCount = 0;
  framesPerSec += (rateFrames / span - framesPerSec) * 0.4;
  transfersPerSec += (rateTransfers / span - transfersPerSec) * 0.4;
  txPerMin += (rateTx * 60 / span - txPerMin) * 0.4;
  rateFrames = rateTransfers = rateTx = 0;
}

let last = performance.now();
let lastHud = 0;
let fps = 60;

function frame(now: number): void {
  const real = (now - last) / 1000;
  // dt is CLAMPED so one slow frame cannot teleport the body; fps must be
  // measured from the UNCLAMPED time or it reports 20 on a 1 fps renderer.
  const dt = Math.min(0.05, real);
  last = now;
  if (real > 0) fps += (1 / real - fps) * 0.05;

  feed.tick();                       // paces the chain's frames onto the scene
  tickCount++;
  body.update(dt, behavior);
  worm.update(body.points);
  brain.setVoltages(voltages);
  brain.tick(dt);

  integrateRates(now);
  if (now - lastHud > 100) {
    lastHud = now;
    const b = chainBehavior;
    const age = lastFrameAt ? (Math.max(0, now - lastFrameAt) / 1000).toFixed(1) : "--";
    hud.textContent = [
      `state    ${STATE_NAME[behavior.state]}  gain ${behavior.gain.toFixed(2)}`,
      `drive    fwd ${(b?.driveFwd ?? 0).toFixed(3)}  rev ${(b?.driveRev ?? 0).toFixed(3)}`,
      `sim step ${feed.stats.lastStep}  (${(feed.stats.lastStep * cfg.dtMs / 1000).toFixed(1)}s of worm)`,
      `frames   ${feed.stats.frames} played, ${feed.stats.lag} queued, last ${age}s ago`,
      `events   ${feed.stats.events} from the node, ${feed.stats.transfers} transfers`,
      `frame tx ${frameSig ? frameSig.slice(0, 22) + "…" : "waiting"}`,
      `brain    ${status ? (status.stepping ? "stepping" : status.awake ? "waking" : "idle — touch to wake") : "relay offline"}`,
      `fee payer ${status ? status.balance.toLocaleString() : "?"} units` +
        (status && status.balance < status.floor ? `  LOW: ${status.faucet}` : ""),
      `pacing   burst ${feed.stats.burstMs}ms  interval ${feed.stats.interval}ms  ticks/s ${tickRate.toFixed(0)}`,
      `neurons  ${n}   neurites ${brain.segments}   fps ${fps.toFixed(0)}`,
    ].join("\n");
    drawLog();
    drawStats();
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
