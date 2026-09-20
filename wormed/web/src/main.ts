import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, ChainClock, BEHAVIOR, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud, parseMorphology } from "./brain.js";
import { ChainFeed, type ChainConfig, type RelayStatus } from "./chain.js";
import { ARENA, STAND_TOP, LAPTOP_GAP, TANK_EDGE, addPlinth, buildTerrarium, loadLaptop } from "./props.js";
import { loadFlyDesk, type FlyDesk } from "./fly.js";
import { FlyFeed } from "./flyfeed.js";
import { FlyBrain } from "./flybrain.js";
import { MONITOR_WIDTH } from "./computer.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
// Far enough back to clear BOTH exhibits. At the old 6/16 the fly's desk and half the tank sat
// past the far plane in the wide shot and faded into the background entirely.
scene.fog = new THREE.Fog(0x0b0f14, 12, 34);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(2, 4, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7dd3fc, 0.35);
rim.position.set(-3, 2, -2);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
// The wide shot has to hold BOTH exhibits — the terrarium and the fly's desk behind it — so it
// sits back and off to the side rather than square in front of the tank. These are the composed
// angle and distance; the desk re-centres both on the fly's screen once it has loaded.
camera.position.set(5.5, 2.8, 4.6);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.2, 0.7, 1.4);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;   // stay above the agar
controls.update();

// ---------------------------------------------------------------------------
// THE REVEAL. The page loads as a terrarium and nothing else: no nervous
// system, no transaction feed, no explanation. Clicking the tank flies the
// camera down onto the worm and fades the rest in; clicking away from it puts
// everything back. One damped scalar drives all of it, so the camera, the
// brain and the panel can never disagree about how far open the scene is.
// ---------------------------------------------------------------------------
const WIDE_FOCUS = controls.target.clone();
const WIDE_RADIUS = camera.position.distanceTo(WIDE_FOCUS);
// Close enough to read the animal, far enough that the connectome hanging
// above it stays in frame — the reveal shows BOTH or it shows nothing.
const CLOSE_RADIUS = 3.8;
/** Headroom kept above the fly for its brain, in scene units: SPAN * LIFT of
 *  clearance plus half a brain. See flybrain.ts. */
const FLY_BRAIN_ROOM = 1.15;
/** The fly's desk is smaller than the terrarium, so its close shot is closer. */
const FLY_RADIUS = 2.6;
const FOCUS_LIFT = 0.62;        // aim between the worm and the brain above it
// The connectome is anchored over the middle of the tank while the animal
// wanders, so the camera follows the worm only PART of the way. Track it
// fully and the brain swings out of frame every time the worm hits a wall.
const TRACK = 0.65;
const REVEAL_RATE = 3.2;        // e-folds per second, both directions
/** Which exhibit is open. ONE at a time: the two are across the room from
 *  each other and no camera pose holds both close. */
type Side = "none" | "worm" | "fly";
let side: Side = "none";
let reveal = 0;
let wormAlpha = 0;
let flyAlpha = 0;
const wormFocus = new THREE.Vector3();
const flyFocus = new THREE.Vector3();
/** Where the camera is actually looking, damped. Clicking straight from one
 *  exhibit to the other moves it ACROSS the room rather than cutting. */
const focus = new THREE.Vector3();
const wantFocus = new THREE.Vector3();
const orbit = new THREE.Vector3();
focus.copy(WIDE_FOCUS);

// What counts as pointing at the worm: an INVISIBLE box around the tank, wide
// enough to forgive an approach and tall enough to cover the air the
// connectome hangs in. Raycasting one box beats raycasting the set — the soil
// is 4,000 triangles and the answer would be the same. The material is
// invisible rather than the object, because an invisible OBJECT is not
// guaranteed to be raycast.
const TRIGGER_MARGIN = 0.5;     // slack around the tank while the scene is shut
const TRIGGER_TIGHT = 0.12;     //   and once it is open — see the frame loop
const TRIGGER_TOP = 2.2;        // above the connectome at y = 1.05
const trigger = new THREE.Mesh(
  new THREE.BoxGeometry((ARENA.halfX + TRIGGER_MARGIN) * 2,
                        TRIGGER_TOP + 0.4,
                        (ARENA.halfY + TRIGGER_MARGIN) * 2),
  new THREE.MeshBasicMaterial({ visible: false }));
trigger.position.y = TRIGGER_TOP / 2 - 0.2;
scene.add(trigger);

// The fly gets the same treatment, sized off its desk once that has loaded and
// been scaled — the rig is authored in millimetres and placed by measurement,
// so nothing here may guess at where it ended up.
const flyTrigger = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
flyTrigger.visible = false;     // no desk yet: nothing to click at
scene.add(flyTrigger);

const pointer = new THREE.Vector2();
const ray = new THREE.Raycaster();
/** Which exhibit the pointer is over, if any. The NEAREST one wins: the two
 *  boxes touch where the tank meets the desk, and picking by order instead
 *  hands every click in the overlap to the same animal. */
const sideAt = (e: MouseEvent): Side => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects(flyTrigger.visible ? [trigger, flyTrigger] : [trigger], false);
  return hit.length === 0 ? "none" : hit[0].object === flyTrigger ? "fly" : "worm";
};

// CLICK opens and closes it, never the pointer alone: a hover that flies the
// camera in fires while the user is on their way somewhere else, and it
// cannot be held open while they read. Hover only offers the cursor, so the
// tank still says it can be clicked.
const canvas = renderer.domElement;
canvas.addEventListener("pointermove", e => {
  canvas.style.cursor = sideAt(e) === "none" ? "" : "pointer";
});
let pressed: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", e => { pressed = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("click", e => {
  // An orbit drag ends in a click event too. Without this a user who spins
  // the camera and lets go off the tank closes the scene every time.
  if (!pressed || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) return;
  side = sideAt(e);
  // The fly's brain is 22 MB of bake and its model is a socket to a process
  // that may not be running. Both are only ever wanted here.
  if (side === "fly") {
    void flyBrain.load();
    flyFeed.connect(stop.signal);
  }
});

// ESCAPE closes whichever exhibit is open. Clicking off the animal already does
// it, but once the camera is in close there may be no "away" left to click: the
// trigger box is deliberately sized to cover EVERY pixel at that range, so at
// the one moment the viewer most wants out, the pointer has nowhere to land
// that means "let me out".
addEventListener("keydown", e => {
  // Only ever a way OUT. With nothing open there is nothing to minimise, and
  // acting anyway would snatch a camera the viewer is hand-driving.
  if (e.key !== "Escape" || side === "none") return;
  side = "none";
});

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
const terrarium = buildTerrarium(scene);
// The two machines stand back to back on TWO tables, one each, with DESK_GAP of floor between
// them. The laptop's display faces the tank, the fly's faces the fly, and the gap falls where the
// two shells used to meet. Each animal looks at its own screen and, through it, at the other
// animal.
//
// The fly's desk is scaled so its monitor is exactly as wide as the laptop's lid, measured — not
// guessed — and the fly rides that scale, which is the only way its feet stay on its own keys.
// Neither model is 1.5 MB of nothing, and the worm runs while both load.
let fly: FlyDesk | undefined;
let flyHead: THREE.Object3D | undefined;
// The fly's activity comes from the fly's own model, not from this scene. The
// socket is opened on the first click of the fly, along with the bake.
const flyFeed = new FlyFeed();
const flyBrain = new FlyBrain(scene, flyFeed);
/** Floor between the two tables, measured between the monitors that face each other across it.
 *  The pair is mirror-symmetric about the middle of this gap, and that is where the visible
 *  origin goes — see the floor slide below. */
const DESK_GAP = 0.35;
void Promise.all([loadLaptop(scene), loadFlyDesk(scene)])
  .then(([laptop, desk]) => {
    const scale = (laptop.lid.max.x - laptop.lid.min.x) / MONITOR_WIDTH;
    desk.setScale(scale);
    // Turned to face the laptop's back. The rig is authored looking +z with its monitor in front
    // of it, so a half turn puts the monitor between the fly and the laptop, screen still on the
    // fly's side.
    desk.group.rotation.y = Math.PI;

    // Both tables get the SAME depth, so the pair is mirror-symmetric about the gap. That depth
    // is whichever machine needs more room, never the laptop's alone: size it to the laptop and
    // the fly's keyboard hangs off the back of its own desk.
    desk.group.position.set(0, STAND_TOP, 0);
    desk.group.updateMatrixWorld(true);
    const deskAtZero = new THREE.Box3().setFromObject(desk.group);
    const lapBox = new THREE.Box3().setFromObject(laptop.group);
    const depth = Math.max(lapBox.max.z - TANK_EDGE,
                           deskAtZero.max.z - deskAtZero.min.z) + LAPTOP_GAP;
    const wormFar = TANK_EDGE + depth;
    const flyNear = wormFar + DESK_GAP;
    addPlinth(scene, TANK_EDGE, wormFar);
    addPlinth(scene, flyNear, flyNear + depth);

    // Slide the desk back onto its OWN table, seated by its measured near edge so it keeps the
    // same margin from the table lip that the laptop keeps from the tank.
    desk.group.position.z = flyNear + LAPTOP_GAP - deskAtZero.min.z;
    fly = desk;
    // FLYCAB is the head node of data/fly.glb (see fly.ts), and it is what the
    // brain hangs over — it sways as the animal types, so the brain does too.
    flyHead = desk.group.getObjectByName("FLYCAB");

    // The fly's premises: its desk, plus the air above the head where the
    // brain appears. Measured off the placed desk rather than declared, since
    // the desk's scale is itself measured from the laptop.
    desk.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(desk.group);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const headY = flyHead ? flyHead.getWorldPosition(new THREE.Vector3()).y : bounds.max.y;
    const top = Math.max(bounds.max.y, headY + FLY_BRAIN_ROOM);
    flyTrigger.scale.set(size.x + 0.6, top - bounds.min.y, size.z + 0.6);
    flyTrigger.position.set(centre.x, (top + bounds.min.y) / 2, centre.z);
    flyTrigger.visible = true;

    // Re-centre the wide shot on the fly's SCREEN, now that there is one to measure. Camera and
    // target move by the same vector, so the angle and distance the shot was composed at survive
    // — and WIDE_FOCUS moves with them, or the reveal's first frame would snap the scene back to
    // wherever the target started.
    const screen = desk.monitorAt(new THREE.Vector3());
    const shift = screen.clone().sub(controls.target);
    controls.target.add(shift);
    camera.position.add(shift);
    WIDE_FOCUS.copy(controls.target);
    focus.copy(controls.target);   // or the first damped frame drags the shot back
    controls.update();

    // And the floor's origin goes under that screen too. Only the grid moves: its centre lines
    // are the one origin on screen, so sliding them is the same image as shifting every other
    // object the opposite way, and it leaves the body integrator's arena on the world axes where
    // body.ts clamps against it.
    // And the floor's origin goes to the middle of the GAP. With both tables the same depth that
    // is the centre of the pair, so the visible origin is the thing they are symmetric about. x
    // is the tables' own centre line, NOT the screen's: the fly's monitor sits wherever its feet
    // landed, a few centimetres off centre, and centring the grid on that would leave the
    // rectangles visibly lopsided about their own origin.
    const floor = terrarium.getObjectByName("floor");
    if (floor) floor.position.set(0, floor.position.y, wormFar + DESK_GAP / 2);
  })
  .catch(e => console.warn("desk models failed to load", e));
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

feed.onBehavior(b => { behavior = { state: b.state, gain: b.gain }; });
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

const txpanel = document.getElementById("txpanel")!;
// Hidden BEFORE the first paint — set from the frame loop it would flash once.
txpanel.style.opacity = "0";
txpanel.style.pointerEvents = "none";
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
  framesPerSec += (rateFrames / span - framesPerSec) * 0.4;
  transfersPerSec += (rateTransfers / span - transfersPerSec) * 0.4;
  txPerMin += (rateTx * 60 / span - txPerMin) * 0.4;
  rateFrames = rateTransfers = rateTx = 0;
}

let last = performance.now();
/** The transaction panel redraws at 10 Hz, not once per frame. */
let lastPanel = 0;

function frame(now: number): void {
  const real = (now - last) / 1000;
  // dt drives the LOOK of things — the connector fade — so it runs on the
  // wall clock and is clamped against one slow frame. The body does not use
  // it; that comes off the ChainClock below.
  const dt = Math.min(0.05, real);
  last = now;

  feed.tick();                       // paces the chain's frames onto the scene
  // dt is the RENDER frame; what the body actually animates is however much
  // simulated time the chain has handed over. No frames, no movement.
  body.update(clock.take(real), behavior);
  worm.update(body.points);
  // The typist runs on the WALL clock: it is scenery, not simulation, and freezing it whenever the
  // chain stalls would read as the page having crashed.
  fly?.update(dt);
  brain.setVoltages(voltages);
  brain.tick(dt);

  integrateRates(now);
  if (now - lastPanel > 100) {
    lastPanel = now;
    if (!panelPaused) {
      drawLog();
      drawStats();
    }
  }

  // --- The reveal, see WIDE_FOCUS above. ---
  const opening = side === "none" ? 0 : 1;
  const settled = Math.abs(reveal - opening) < 0.002;
  reveal = settled ? opening
    : THREE.MathUtils.damp(reveal, opening, REVEAL_RATE, dt);
  const eased = reveal * reveal * (3 - 2 * reveal);
  // Each exhibit fades on its own, so clicking straight from one to the other
  // crosses over instead of shutting the scene and opening it again.
  wormAlpha = THREE.MathUtils.damp(wormAlpha, side === "worm" ? eased : 0, REVEAL_RATE, dt);
  flyAlpha = THREE.MathUtils.damp(flyAlpha, side === "fly" ? eased : 0, REVEAL_RATE, dt);
  brain.setReveal(wormAlpha);
  flyBrain.setReveal(flyAlpha);
  if (flyHead) flyBrain.follow(flyHead);
  flyBrain.tick(dt);
  // The premises are generous while the scene is shut, so the tank is easy to
  // find from the wide shot, and tight once it is open: at close range a box
  // half a body length proud of the tank covers EVERY pixel, and then nothing
  // the pointer does can end the reveal. Height is left alone — the column
  // reaches the connectome, which is part of what the hover is pointing at.
  const slack = THREE.MathUtils.lerp(TRIGGER_MARGIN, TRIGGER_TIGHT, wormAlpha);
  trigger.scale.set((ARENA.halfX + slack) / (ARENA.halfX + TRIGGER_MARGIN), 1,
                    (ARENA.halfY + slack) / (ARENA.halfY + TRIGGER_MARGIN));
  txpanel.style.opacity = wormAlpha.toFixed(3);
  txpanel.style.pointerEvents = wormAlpha > 0.6 ? "auto" : "none";

  // Recentre by moving target and camera TOGETHER: whatever angle the user
  // orbited to survives the flight, and the worm stays framed as it crawls.
  const mid = body.points[body.points.length >> 1];
  wormFocus.set(mid[0] * TRACK, FOCUS_LIFT, mid[1] * TRACK);
  // The fly is looked at where its brain is, not where its feet are.
  if (flyHead) {
    flyHead.getWorldPosition(flyFocus);
    flyFocus.y += FLY_BRAIN_ROOM * 0.55;   // the brain, not the feet
  }
  wantFocus.lerpVectors(WIDE_FOCUS, side === "fly" ? flyFocus : wormFocus, eased);
  focus.lerp(wantFocus, 1 - Math.exp(-REVEAL_RATE * dt));
  wantFocus.copy(focus).sub(controls.target);
  controls.target.add(wantFocus);
  camera.position.add(wantFocus);
  // Distance is forced only while the scene is still opening or closing —
  // once it has settled the user's own zoom is the authority.
  if (!settled) {
    orbit.subVectors(camera.position, controls.target)
      .setLength(THREE.MathUtils.lerp(
        WIDE_RADIUS, side === "fly" ? FLY_RADIUS : CLOSE_RADIUS, eased));
    camera.position.copy(controls.target).add(orbit);
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
