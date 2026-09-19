import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, ChainClock, BEHAVIOR, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud, parseMorphology } from "./brain.js";
import { ChainFeed, type Behavior, type ChainConfig, type RelayStatus } from "./chain.js";
import { ARENA, buildTerrarium, loadLaptop } from "./props.js";

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
camera.position.set(0, 2.8, 4.2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
// The worm cannot leave the pen (props.ts ARENA, enforced in body.ts), so the
// orbit target is the pen itself and the camera NEVER chases the animal.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
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

const body = new WormBody(24, ARENA);
// The body advances on worm-time the chain delivered, never on wall clock.
// See ChainClock: without it the animal keeps crawling off a stale behaviour
// byte when the chain stops, which is a moving picture of nothing.
const clock = new ChainClock();
const worm = new WormMesh(scene);
const brain = new BrainCloud(scene, positions, names, morphology);
buildTerrarium(scene);
// The desk prop is 1.5 MB and nothing waits on it — the worm runs while it loads.
void loadLaptop(scene).catch(e => console.warn("laptop model failed to load", e));
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

// A settlement moves ~340 junctions at once, so the strongest few per frame
// are drawn and the HUD reports the true count. Drawing all of them would
// recycle each other's pool slots within one frame anyway.
const FIRING_PER_FRAME = 110;

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
  clock.deliver(f.step, cfg.dtMs);
  const strongest = f.transfers.length > FIRING_PER_FRAME
    ? [...f.transfers].sort((a, b) => b.amount - a.amount).slice(0, FIRING_PER_FRAME)
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

// Pause freezes the WHOLE panel — rows and stat tiles together. Freezing
// only the rows left the six counters ticking above a frozen list, which
// reads as a half-broken button rather than a deliberate hold. The relay
// keeps collecting either way, so resuming jumps to current instead of
// replaying the gap.
let panelPaused = false;
const pauseBtn = document.getElementById("txpause") as HTMLButtonElement;
pauseBtn.onclick = () => {
  panelPaused = !panelPaused;
  pauseBtn.textContent = panelPaused ? "RESUME" : "PAUSE";
  // Repaint once in BOTH directions, bypassing the pause gate in the render
  // loop. Entering matters most: the frozen rows would otherwise keep the
  // live marker on whichever transaction was firing at the instant of the
  // click, and that marker means "these synapses are on screen NOW" — left
  // frozen it asserts something false for as long as the hold lasts.
  drawStats();
  drawLog();
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
      const live = !panelPaused && e.sig === frameSig && performance.now() - lastFrameAt < 1500;
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
  // dt drives the LOOK of things — the connector fade — so it runs on the
  // wall clock and is clamped against one slow frame. The body does not use
  // it; that comes off the ChainClock below. fps must be measured from the
  // UNCLAMPED time or it reports 20 on a 1 fps renderer.
  const dt = Math.min(0.05, real);
  last = now;
  if (real > 0) fps += (1 / real - fps) * 0.05;

  feed.tick();                       // paces the chain's frames onto the scene
  tickCount++;
  // dt is the RENDER frame; what the body actually animates is however much
  // simulated time the chain has handed over. No frames, no movement.
  body.update(clock.take(real), behavior);
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
    if (!panelPaused) {
      drawLog();
      drawStats();
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
