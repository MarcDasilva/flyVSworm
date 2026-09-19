import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, BEHAVIOR, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud } from "./brain.js";
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
});

// data/ sits outside the vite root; vite.config.ts maps it onto the URL root,
// so these are /positions.json and NOT /data/positions.json.
const [positions, names, edges] = await Promise.all([
  fetch("/positions.json").then(r => r.json()) as Promise<[number, number, number][]>,
  fetch("/names.json").then(r => r.json()) as Promise<string[]>,
  fetch("/edges.json").then(r => r.json()) as Promise<[number, number][]>,
]);

const body = new WormBody(24);
const worm = new WormMesh(scene);
const brain = new BrainCloud(scene, positions, names, edges);

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
feed.onFrame(f => {
  voltages = f.mV;
  frameSig = f.signature;
  lastFrameAt = performance.now();
  const strongest = f.transfers.length > PARTICLES_PER_FRAME
    ? [...f.transfers].sort((a, b) => b.amount - a.amount).slice(0, PARTICLES_PER_FRAME)
    : f.transfers;
  for (const t of strongest) brain.fireEdge(t.pre, t.post, true);
});
feed.start(stop.signal);

const STATE_NAME = ["PAUSE", "FORWARD", "REVERSE", "OMEGA"];
const hud = document.getElementById("hud")!;
const log = document.getElementById("feed")!;
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

/** The relay's transaction log, newest first, each linking to the explorer. */
function drawLog(): void {
  const rows: string[] = clicks.slice(0, 3).map(esc);
  for (const e of status?.log ?? []) {
    const ms = e.ms === undefined ? "" : `${(e.ms / 1000).toFixed(1)}s`;
    const op = esc(e.op).padEnd(10);
    // A chain error arrives as a multi-line JSON dump; one line of it is
    // what a human standing at the screen can read.
    if (e.error) rows.push(`${op} FAILED ${esc(e.error.replace(/\s+/g, " ")).slice(0, 60)}…`);
    else if (e.sig) rows.push(`${op} ${ms.padStart(5)}  <a href="${esc(cfg.explorer + e.sig)}" target="_blank" rel="noreferrer">${esc(e.sig.slice(0, 22))}…</a>`);
    else rows.push(`${op} ${ms.padStart(5)}`);
    if (rows.length > 30) break;
  }
  log.innerHTML = rows.join("<br>");
}

let last = performance.now();
let lastHud = 0;
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.05;

  feed.tick();                       // paces the chain's frames onto the scene
  body.update(dt, behavior);
  worm.update(body.points);
  brain.setVoltages(voltages);
  brain.tick(dt);

  if (now - lastHud > 250) {
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
      `neurons  ${n}   edges ${edges.length}   fps ${fps.toFixed(0)}`,
    ].join("\n");
    drawLog();
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
