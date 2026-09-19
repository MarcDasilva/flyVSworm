import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, BEHAVIOR, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud } from "./brain.js";

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
// MOCK DRIVER. Task 15 deletes everything below the line and feeds the SAME
// three calls — behavior, setVoltages, fireEdge — from the chain stream. It is
// a plausible-looking animation and NOT a simulation; nothing here is a claim
// about the connectome.
// ---------------------------------------------------------------------------

type Beat = { state: BehaviorState["state"]; gain: number; secs: number };
let behavior: BehaviorState = { state: BEHAVIOR.FORWARD, gain: 1 };
let script: Beat[] = [];

/** Seconds left on the current beat. Infinity == hold this state forever. */
let hold = Infinity;

function play(beats: Beat[]): void {
  script = beats.slice();
  const first = script.shift();
  if (first) behavior = { state: first.state, gain: first.gain };
  hold = first ? first.secs : Infinity;
}

function advance(dt: number): void {
  if (!Number.isFinite(hold)) return;
  hold -= dt;
  if (hold > 0) return;
  const next = script.shift();
  behavior = next ? { state: next.state, gain: next.gain }
                  : { state: BEHAVIOR.FORWARD, gain: 1 };
  hold = next ? next.secs : Infinity;
}

const n = names.length;
const mV = new Int16Array(n);
const rest = new Float32Array(n);
const phase = new Float32Array(n);
const rate = new Float32Array(n);
for (let i = 0; i < n; i++) {
  rest[i] = -70 + (i * 7919 % 13);
  phase[i] = (i * 2654435761 % 1000) / 1000 * Math.PI * 2;
  rate[i] = 0.4 + (i * 104729 % 100) / 100 * 1.2;
}
const boost = new Float32Array(n);   // decaying depolarisation, per neuron
let arousal = 0.12;
let clock = 0;

const STATE_NAME = ["PAUSE", "FORWARD", "REVERSE", "OMEGA"];
const feed = document.getElementById("feed")!;
const lines: string[] = [];
let feedAt = 0;

function log(msg: string): void {
  lines.unshift(msg);
  if (lines.length > 22) lines.pop();
}

/** Lights the named neuron and animates the synapse, by name, as Task 15 will. */
function excite(pre: string, post: string): void {
  const a = brain.labelIndex(pre), b = brain.labelIndex(post);
  if (a < 0 || b < 0) return;
  boost[a] = 1; boost[b] = 1;
  brain.fireEdge(a, b, true);
}

document.getElementById("touch-head")!.onclick = () => {
  // The escape response: reverse away from the stimulus, sweep through an
  // omega turn, resume forward on a new heading. The named cells are the real
  // anterior touch circuit, so the cloud lights up where a biologist expects.
  play([{ state: BEHAVIOR.REVERSE, gain: 1.1, secs: 1.8 },
        { state: BEHAVIOR.OMEGA, gain: 1.0, secs: 1.0 }]);
  arousal = 1;
  for (const [a, b] of [["ALML", "AVDL"], ["ALMR", "AVDR"], ["AVM", "AVDL"],
                        ["AVDL", "AVAL"], ["AVDR", "AVAR"]]) excite(a, b);
  log("> HEAD  ALM/AVM -> AVD -> AVA");
};
document.getElementById("touch-tail")!.onclick = () => {
  play([{ state: BEHAVIOR.FORWARD, gain: 1.3, secs: 3.0 }]);
  arousal = 0.8;
  for (const [a, b] of [["PLML", "PVCL"], ["PLMR", "PVCR"],
                        ["PVCL", "AVBL"], ["PVCR", "AVBR"]]) excite(a, b);
  log("> TAIL  PLM -> PVC -> AVB");
};

let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.05;

  advance(dt);
  body.update(dt, behavior);
  worm.update(body.points);

  arousal += (0.12 - arousal) * Math.min(1, dt * 0.8);
  const decay = Math.min(1, dt * 1.1);
  const swing = 6 + 42 * arousal;
  for (let i = 0; i < n; i++) {
    boost[i] -= boost[i] * decay;
    mV[i] = Math.round(rest[i] + 55 * boost[i] +
      swing * (0.5 + 0.5 * Math.sin(clock * 2 * Math.PI * rate[i] + phase[i])));
  }
  brain.setVoltages(mV);

  let due = (3 + 90 * arousal) * dt;
  while (due > 0) {
    if (Math.random() < Math.min(1, due)) {
      const [pre, post] = edges[(Math.random() * edges.length) | 0];
      brain.fireEdge(pre, post, (pre + post) % 4 !== 0);
      if (Math.random() < 0.06) log(`${names[pre]} -> ${names[post]}`);
    }
    due -= 1;
  }
  brain.tick(dt);

  if (clock - feedAt > 0.2) {
    feedAt = clock;
    feed.textContent = [
      `state    ${STATE_NAME[behavior.state]}  gain ${behavior.gain.toFixed(2)}`,
      `neurons  ${n}   edges ${edges.length}`,
      `fps      ${fps.toFixed(0)}`,
      "",
      ...lines,
    ].join("\n");
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
