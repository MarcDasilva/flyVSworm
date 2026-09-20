import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, ChainClock, BEHAVIOR, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud, parseMorphology } from "./brain.js";
import { ChainFeed, type Behavior, type ChainConfig, type RelayStatus } from "./chain.js";
import { classifyBehavior, SynapticHeuristic } from "./classifier.js";
import { TransactionPlayback, TransactionList } from "./transactions.js";
import { WormPortfolio } from "./portfolio.js";
import { ARENA, STAND_TOP, LAPTOP_GAP, TANK_EDGE, addLeaderboard, addTVCounter, addTable, buildTerrarium, loadLaptop, loadTable } from "./props.js";
import { loadFlyDesk, type FlyDesk } from "./fly.js";
import { TradingScreen } from "./tradingScreen.js";
import { FlyFeed } from "./flyfeed.js";
import { FlyBrain } from "./flybrain.js";
import { FlyChain, flyNames } from "./flychain.js";
import { MONITOR_WIDTH } from "./computer.js";
import { createFlicker } from "./flicker.js";
import { ambience, duckAmbience, readMuted, setMuted } from "./ambience.js";
import { startBanter, type Banter } from "./banter.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
// Exponential, NOT linear. Real extinction is Beer-Lambert — every metre of air takes the same
// FRACTION of what is left — and linear fog fakes it with a ramp between two planes, which shows
// as a seam where the ramp starts and a wall of flat background where it ends. At this density a
// subject seven units out loses about 7% and the far edge of the grid loses near half, which is
// the room reading as air rather than as a curtain.
//
// The colour is the background exactly. Anything else and the grid fades to one colour while the
// void behind it stays another, and the horizon draws a line across the scene.
scene.fog = new THREE.FogExp2(0x0b0f14, 0.038);
// ---------------------------------------------------------------------------
// LIGHT. A dim room with two lit exhibits in it, not an evenly lit studio.
// The ambient and the key carry just enough to read the furniture by; each
// animal gets its own spot, and those spots are the ONLY shadow casters in
// the scene. Lit flat, the set read as a product shot of three grey boxes.
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const key = new THREE.DirectionalLight(0xffffff, 0.55);
key.position.set(2, 4, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7dd3fc, 0.22);
rim.position.set(-3, 2, -2);
scene.add(rim);

/** Both lamps hang at the same world height, regardless of their animals' height. */
const LAMP_HEIGHT = 6.4;
const BEAM_OPACITY = 0.17;
/** An exhibit lamp: warm, focused, shadowed. */
function exhibitSpot(drop: number, intensity: number, angle: number): THREE.SpotLight {
  const s = new THREE.SpotLight(0xfff1d8, intensity, 0, angle, 0.55, 2);
  s.castShadow = true;
  s.shadow.mapSize.set(1024, 1024);
  s.shadow.camera.near = 0.4;
  s.shadow.camera.far = drop * 3;
  // A near-flat lawn under a steep lamp is the case that acnes. normalBias
  // walks the sample along the SURFACE normal rather than toward the light,
  // which leaves the blades their own shading instead of striping them.
  s.shadow.bias = -0.0004;
  s.shadow.normalBias = 0.02;
  scene.add(s, s.target);
  return s;
}
const wormSpot = exhibitSpot(LAMP_HEIGHT, 136, 0.179188935625);
const flySpot = exhibitSpot(LAMP_HEIGHT, 136, 0.09);
const wormSpotIntensity = wormSpot.intensity;
const flySpotIntensity = flySpot.intensity;
const wormBeam = beamFor(wormSpot, LAMP_HEIGHT, 0.25);
const flyBeam = beamFor(flySpot, LAMP_HEIGHT);
const wormFlicker = createFlicker(), flyFlicker = createFlicker(), tvFlicker = createFlicker();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let tvBoard: ReturnType<typeof addLeaderboard> | undefined;
let setCounter: ((total?: number) => void) | undefined;
/** Scratch for the fly's head. NOT flyFocus — that one is the camera's aim and
 *  is lifted off the head later in the same frame. */
const spotAt = new THREE.Vector3();

/**
 * The beam you can SEE. three has no volumetric spotlight and a real one is a
 * raymarch through the fog; this is a cone of additive haze, bright at the
 * lamp and fading toward the floor. Black adds nothing under additive
 * blending, so the vertex gradient IS the falloff — no shader, no alpha sort,
 * and it survives the camera passing through it.
 */
function beamFor(spot: THREE.SpotLight, drop: number, groundGlow = 0) {
  const geo = new THREE.ConeGeometry(Math.tan(spot.angle) * drop, drop, 40, 1, true);
  geo.translate(0, -drop / 2, 0);        // apex at the origin, cone hanging down
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const lamp = new THREE.Color(spot.color);
  for (let i = 0; i < pos.count; i++) {
    // Keep a little haze at the worm so its tall beam visibly reaches the soil.
    // Float32 vertices can fall just below -drop; clamp before the fractional power.
    const t = groundGlow + (1 - groundGlow) * Math.max(0, 1 + pos.getY(i) / drop) ** 2.2;
    col[i * 3] = lamp.r * t;
    col[i * 3 + 1] = lamp.g * t;
    col[i * 3 + 2] = lamp.b * t;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: BEAM_OPACITY,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  // Drawn after the set. Writing no depth, it still tests against it, so the
  // tank and the machines cut the cone where they should.
  beam.renderOrder = 2;
  scene.add(beam);
  return beam;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const beamDir = new THREE.Vector3();
/** Hangs the cone off the lamp and points it wherever the lamp is pointing. */
function aimBeam(beam: THREE.Mesh, spot: THREE.SpotLight): void {
  beam.position.copy(spot.position);
  beamDir.subVectors(spot.target.position, spot.position);
  // Match the cone's length and radius to the target's actual distance below the lamp.
  beam.scale.setScalar(beamDir.length() / (beam.geometry as THREE.ConeGeometry).parameters.height);
  beam.quaternion.setFromUnitVectors(DOWN, beamDir.normalize());
}

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
// ---------------------------------------------------------------------------
// THE OPENING SHOT — what the page shows before anything is clicked. This pair
// is exactly what the pose logger below prints, so a shot composed live with
// the arrow keys pastes straight back in here.
//
// A hand-composed pose MUST set OPENING_FIXED. The desk otherwise slides the
// whole shot onto the fly's screen once it loads, and a pose read off the
// running scene already includes that slide — left false it would be applied
// a second time and the paste would land somewhere else entirely.
// ---------------------------------------------------------------------------
const OPENING_FIXED = true;
camera.position.set(5.35, 2.94, 3.97);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
// Filmic response and a stop of headroom under it. A spot bright enough to
// read as a spot blows its pool to flat white under the linear default, and
// the emissive screens — laptop, trading chart, standings board — go with it.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1.62, 1.46, 1.72);   // az 59° polar 71° dist 4.60
// How far back the page opens. The pose above was composed AT this distance,
// so the normalise below is currently a no-op and is kept only so a future
// paste at some other distance still opens from here — the angle is preserved
// exactly, ONLY the distance is touched. It has to stay well clear of
// CLOSE_RADIUS and FLY_RADIUS below or the reveal has nowhere to fly in from.
const OPENING_RADIUS = 4.6;
camera.position.sub(controls.target).setLength(OPENING_RADIUS).add(controls.target);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;   // stay above the agar
controls.update();

// ---------------------------------------------------------------------------
// HAND-DRIVING. Arrow keys walk the camera so a shot can be composed in the
// running scene and pasted back into this file. Plain arrows pan, Shift or
// Cmd with an arrow swings the angle — OrbitControls already binds both, it
// simply is not listening by default. Panning is GROUND-PLANE, not screen
// space, or Up walks into the sky instead of forward.
// ---------------------------------------------------------------------------
controls.listenToKeyEvents(window);
controls.screenSpacePanning = false;
controls.keyPanSpeed = 14;
/** Hand-driving SUSPENDS the reveal's framing below, which writes target and
 *  distance every frame and would drag each arrow-key step straight back.
 *  Clicking an exhibit hands control back to it. */
let freeCam = false;
/** Vertical step, as a fraction of the orbit distance. A fixed world step reads
 *  as a crawl in the wide shot and a jump in close-up — the arrows already pan
 *  distance-scaled, and these have to match them. */
const LIFT = 0.015;
/** Escape, and the ESC button that stands in for it on a screen with no keyboard. */
function leaveExhibit(): void {
  closeClassifier();
  if (side === "none") return;     // nothing is open; do not yank a hand-driven camera
  side = "none";
  freeCam = false;                 // same as a click: ask for the composed shot back
}
const backBtn = document.getElementById("back") as HTMLButtonElement;
backBtn.addEventListener("click", leaveExhibit);
addEventListener("keydown", e => {
  // ESCAPE closes whichever exhibit is open. Clicking off the animal already
  // does it, but once the camera is in close there may be no "away" left to
  // click: the trigger box is deliberately sized to cover every pixel at that
  // range, so the pointer has nowhere to land that means "let me out".
  // ENTER opens the scene, the same as clicking the card's button.
  if (e.key === "Enter") {
    if (!(e.target instanceof HTMLElement && e.target.closest("button, a, summary"))) enterScene();
    return;
  }
  if (e.key === "Escape") { leaveExhibit(); return; }
  if (e.key.startsWith("Arrow")) freeCam = true;
  // Camera and target rise TOGETHER, so the shot keeps its angle and the
  // maxPolarAngle clamp above the agar is never touched.
  else if (e.key === "." || e.key === "/") {
    const step = camera.position.distanceTo(controls.target) * LIFT * (e.key === "." ? 1 : -1);
    camera.position.y += step;
    controls.target.y += step;
    freeCam = true;
    controls.update();          // fires "change", so the pose still prints
  }
});

// Printed once the move SETTLES, not every damped frame — the reveal and the
// damping both dirty the camera continuously and the log would be unreadable.
const deg = (r: number) => `${(r * 180 / Math.PI).toFixed(0)}\u00b0`;
const xyz = (v: THREE.Vector3) => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
let poseTimer: ReturnType<typeof setTimeout>;
controls.addEventListener("change", () => {
  clearTimeout(poseTimer);
  poseTimer = setTimeout(() => console.log(
    `camera.position.set(${xyz(camera.position)});\n`
    + `controls.target.set(${xyz(controls.target)});`
    + `   // az ${deg(controls.getAzimuthalAngle())} polar ${deg(controls.getPolarAngle())}`
    + ` dist ${camera.position.distanceTo(controls.target).toFixed(2)}`), 400);
});

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
 *  clearance plus half a brain, with a fifth over for the context shells that
 *  reach past the cells. See flybrain.ts. */
const FLY_BRAIN_ROOM = 1.6;
/** Set by the brain, not the desk: at SPAN 1.2 the hanging circuit needs this
 *  much distance to stay inside a 50° frame with the fly under it. */
const FLY_RADIUS = 3.2;
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
// Declared up here, not beside enterScene: pointermove is live during the
// top-level awaits below, and reading a `let` before its line runs throws.
let entered = false;
const sideAt = (e: MouseEvent): Side => {
  if (!entered) return "none";     // the title card owns the screen until ENTER
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects(flyTrigger.visible ? [trigger, flyTrigger] : [trigger], false);
  return hit.length === 0 ? "none" : hit[0].object === flyTrigger ? "fly" : "worm";
};

// CLICK opens and closes it, never the pointer alone: a hover that flies the
// camera in fires while the user is on their way somewhere else, and it
// cannot be held open while they read. Hover only offers the pointer cursor.
const canvas = renderer.domElement;
const classifier = document.getElementById("worm-classifier")!;
const marketPanel = document.getElementById("worm-market")!;
const readoutPart = (name: string) => document.getElementById(`classifier-${name}`)!;
/** ONE readout for both animals: they are never open at the same time, and
 *  two panels would be two copies of every field to keep in step. The labels
 *  that differ are swapped by drawClassifier; everything else is shared. Must
 *  run AFTER `side` is set — the touch row keys off it. */
function showClassifier(open: boolean): void {
  classifier.hidden = marketPanel.hidden = !open;
  readoutPart("touch").hidden = side !== "worm";
}

function closeClassifier(): void {
  // Focus left inside a hidden panel strands the keyboard user; there is no
  // opener button to hand it back to, so drop it and let Tab start over.
  if (classifier.contains(document.activeElement) || marketPanel.contains(document.activeElement))
    (document.activeElement as HTMLElement).blur();
  showClassifier(false);
}

readoutPart("close").onclick = closeClassifier;
canvas.addEventListener("pointermove", e => {
  canvas.style.cursor = e.pointerType === "touch" || sideAt(e) === "none" ? "" : "pointer";
});
canvas.addEventListener("pointerleave", () => { canvas.style.cursor = ""; });
canvas.addEventListener("pointercancel", () => { canvas.style.cursor = ""; });
let pressed: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", e => { pressed = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("click", e => {
  // An orbit drag ends in a click event too. Without this a user who spins
  // the camera and lets go off the tank closes the scene every time.
  if (!pressed || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) return;
  side = sideAt(e);
  showClassifier(side !== "none");
  freeCam = false;             // a click asks for the composed shot back
  if (side === "fly") openFly();
});

/** The fly's brain is 22 MB of bake, its model is a socket to a process that
 *  may not be running, and its chain half signs real transactions. NONE of
 *  the three is wanted until someone actually looks at the fly. */
function openFly(): void {
  void flyBrain.load();
  flyFeed.connect(stop.signal);
  void flyChain.start(stop.signal);
}

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
// Legacy batch playback follows simulated time. Individual receipts sustain
// a continuous gait from the latest confirmed motor state while activity is fresh.
const clock = new ChainClock();
const transactions = new TransactionPlayback();
const neuralTilt = new SynapticHeuristic(names);
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
/** Floor between the two tables, measured between the monitors that face each other across it.
 *  The pair is mirror-symmetric about the middle of this gap, and that is where the visible
 *  origin goes — see the floor slide below. */
const DESK_GAP = 0.35;
// The fly's activity comes from the fly's own model, not from this scene. The
// socket is opened on the first click of the fly, along with the bake.
const flyFeed = new FlyFeed();
const flyBrain = new FlyBrain(scene, flyFeed);
// The fly's chain half. Its events are DERIVED from the model's spikes and
// weights rather than produced on chain the way the worm's are — flychain.ts
// says exactly what that does and does not claim, and the panel's caption
// repeats it on screen.
const flyChain = new FlyChain();
/** Paced like the worm's receipts: the fly's land two dozen at a time every
 *  couple of seconds, and dumping each batch into the list at once reads as a
 *  stutter rather than a stream. */
const flyTransactions = new TransactionPlayback();
flyChain.onSynapse(s => { flyTransactions.push(s, performance.now()); flyRateTx++; });
// ONE market for the whole room: the fly's monitor, the worm's laptop lid and the left half of
// the board all show it, so no two displays can disagree about the price. The desks get the
// trader's view and the board gets the price feed — orders belong to the animal that typed them,
// not to the wall. The fly types into it; the clock below is the only thing that advances it.
const market = new TradingScreen();
const wormPortfolio = new WormPortfolio();
// The same paper-trading model for the fly, so the two animals are ranked on one basis: equity
// against the same stake, priced off the same candles. Its tilt is the fly's OWN position, which
// is the book it types on its screen — see TradingScreen.
// ponytail: the model is long-only, so the fly's short side scores as flat. Give the portfolio
// a short leg if the board is ever meant to reward the fly for selling a falling market.
const flyPortfolio = new WormPortfolio();
let tradedCandle = -1;
let chartCandle = -1;
const props = Promise.all([loadLaptop(scene, market.texture), loadFlyDesk(scene, market), loadTable()])
  .then(([laptop, desk, table]) => {
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
    addTable(scene, table, TANK_EDGE, wormFar, laptop.group.rotation.y);
    addTable(scene, table, flyNear, flyNear + depth, desk.group.rotation.y);
    // Backs the WHOLE set, tank included, so it is measured from the far end of the fly's table
    // to the far wall of the terrarium and not from either table alone.
    const setNear = -TANK_EDGE, setFar = flyNear + depth;
    tvBoard = addLeaderboard(scene, (setNear + setFar) / 2, setFar - setNear + 0.6,
                             market.marketTexture);
    setCounter = addTVCounter(scene, (setNear + setFar) / 2);

    // Slide the desk back onto its OWN table, seated by its measured near edge so it keeps the
    // same margin from the table lip that the laptop keeps from the tank.
    desk.group.position.z = flyNear + LAPTOP_GAP - deskAtZero.min.z;
    fly = desk;
    // The connectome is deliberately NOT in here: 302 spheres through two
    // shadow passes buys a speckle of dots on the soil and nothing else.
    for (const root of [laptop.group, desk.group, worm.group]) {
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
    }
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
    // OPENING_FIXED means the authored shot is the shot — do not measure, do
    // not slide, do not touch WIDE_FOCUS. The desk can finish loading AFTER
    // the viewer has pressed ENTER, and recentring here would snap the camera
    // back to the title pose mid-flight.
    if (!OPENING_FIXED) {
      const screen = desk.monitorAt(new THREE.Vector3());
      const shift = screen.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      WIDE_FOCUS.copy(controls.target);
      focus.copy(controls.target);   // or the first damped frame drags the shot back
      controls.update();
    }

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
let behaviorSample: Behavior | undefined;
let behaviorAdvancedAt = 0;
let reading = classifyBehavior(undefined, 0, false);
let tradingTilt = 0;
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

feed.onBehavior(b => {
  behavior = b;
  if (!behaviorSample || b.step !== behaviorSample.step) behaviorAdvancedAt = performance.now();
  behaviorSample = b;
});
/** Set once the relay's board has been read. Nothing is posted before it: a page that reported
 *  its opening balance first would wipe the standing it is about to resume from. */
let ledgerSeeded = false;
feed.onStatus(s => {
  status = s;
  if (s.fly) Object.assign(flyChain.stats, { submitted: s.fly.submitted, balance: s.fly.balance, error: s.fly.error });
  // The ledger rides the heartbeat: the relay answers /api/status with its own board, so the
  // page needs no second poll. Both fall back when an older relay, or one whose database would
  // not open, leaves them out.
  tvBoard?.standings(s.standings ?? []);
  ledgerTotal = s.transactions;
  if (!ledgerSeeded && s.standings) {
    // The board is ALL TIME, so a reload resumes the animals' books where the last session left
    // them instead of posting a fresh zero over them. Cash carries the standing P&L and the
    // position starts flat, which is the truth about a page that has just opened.
    // ponytail: last writer wins, so two tabs would trade the same book twice over. One screen
    // is the exhibit; give the store an owner token if that ever stops being true.
    for (const row of s.standings) {
      const book = row.specimen === "fly" ? flyPortfolio
        : row.specimen === "worm" ? wormPortfolio : undefined;
      if (!book) continue;
      book.cash = Math.max(0, book.startingBalance + row.profit);
      book.shares = 0;
      book.trades = row.trades;
    }
    ledgerSeeded = true;
  }
});


/** How often the page tells the relay what its animals are worth. Slow on purpose: these are
 *  two rows on a printed sheet, and the ledger is written to disk on every post. */
const STANDING_MS = 5000;
/** The stake each animal starts with, and the figure the board's PROFIT column is measured
 *  against — it lives in the portfolio, so a change there cannot desync the sheet. */
const postStandings = () => {
  if (!ledgerSeeded) return;
  const price = market.snapshot.price;
  for (const [specimen, book] of [["fly", flyPortfolio], ["worm", wormPortfolio]] as const)
    void fetch("/api/standing", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ specimen, profit: book.equity(price) - book.startingBalance,
                             trades: book.trades }),
      signal: stop.signal,
    }).catch(() => undefined);   // a relay that is down must not throw into the console every 5 s
};
const standingTimer = setInterval(postStandings, STANDING_MS);
stop.signal.addEventListener("abort", () => clearInterval(standingTimer), { once: true });
/** Playback state per transaction signature. Written in the SAME callback
 *  that fires the particles, which is what keeps the panel and the animation
 *  describing one event instead of two — a row's counters tick as its own
 *  transfers light up. */
type TxPlay = { frames: number; transfers: number; drawn: number; last: number };
const txPlay = new Map<string, TxPlay>();

/** Rolling rates, EMA. Raw per-frame counts are far too jumpy to read. */
let framesPerSec = 0, transfersPerSec = 0, txPerMin = 0;
let rateFrames = 0, rateTransfers = 0, rateTx = 0, rateAt = performance.now();
// The fly's panel shows the SAME six numbers as the worm's, so the two read
// as one exhibit. A fly receipt is ONE synaptic event, so its transfers/s and
// tx/min count the same thing.
let flyFramesPerSec = 0, flyTransfersPerSec = 0, flyTxPerMin = 0;
let flyRateTx = 0, flyFramesSeen = 0;
/** What the RELAY's ledger says: every transaction the exhibit has ever made. UNDEFINED until
 *  the first heartbeat answers — the board shows nothing rather than a count of this page's own
 *  session, which is not the number the room is being told. */
let ledgerTotal: number | undefined;
const seenSigs = new Set<string>();

feed.onFrame(f => {
  voltages = f.mV;
  frameSig = f.signature;
  lastFrameAt = performance.now();
  if (!cfg.synapseTransactions) clock.deliver(f.step, cfg.dtMs);
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
feed.onSynapse(s => {
  if (!transactions.push(s, performance.now())) return;
  rateTransfers++;
  rateTx++;
});
feed.start(stop.signal);

const txpanel = document.getElementById("txpanel")!;
// Hidden BEFORE the first paint — set from the frame loop it would flash once.
txpanel.style.opacity = "0";
txpanel.style.pointerEvents = "none";
const log = document.getElementById("feed")!;
const stats = document.getElementById("txstats")!;
const transactionList = cfg.synapseTransactions
  ? new TransactionList(log, document.getElementById("txlatest") as HTMLButtonElement, names, cfg.explorer)
  : undefined;
/** The fly's rows, over the SAME panel: one exhibit is open at a time, and a
 *  second panel would be a second copy of every rule about scrolling, pausing
 *  and trimming. Built on the first click of the fly. */
let flyList: TransactionList | undefined;
/** Whose rows are currently mounted in the panel. */
let panelSide: Side = "none";
const clicks: string[] = [];

/** The stimulus amplitude belongs to the relay, so the label does NOT quote
 * a number that can drift away from the transaction it describes. */
async function touch(label: string, neuron: string): Promise<void> {
  clicks.unshift(`> ${label}  stimulate ${neuron}`);
  clicks.unshift(await feed.touch(neuron));
  clicks.length = Math.min(clicks.length, 6);
}
// ---------------------------------------------------------------------------
// THE TITLE CARD. The page opens on a shot composed for the card, and ENTER
// walks it over to the one composed for the exhibits. The two poses share an
// angle and a distance exactly, so the difference is a pure TRANSLATION —
// which is why this needs no tween of its own: moving WIDE_FOCUS is enough,
// and the reveal's own damped focus below carries target and camera together.
// ---------------------------------------------------------------------------
const ENTER_FOCUS = new THREE.Vector3(0.88, 0.98, 2.95);
// The black screen lifts once the props have settled — loaded OR failed, a
// broken desk is not a reason to hold the viewer on the logo forever.
const loading = document.getElementById("loading")!;
void Promise.allSettled([props, (loading.querySelector("img") as HTMLImageElement).decode()])
  .then(() => {
    loading.classList.add("gone");
    // Preload the fly brain now, AFTER the room is up so it never delays the
    // first frame. It stays invisible until the reveal (setReveal), so the
    // click on the fly finds it already built instead of 22 MB away.
    void flyBrain.load().then(() => flyBrain.warm(renderer, scene, camera));
  });
const intro = document.getElementById("intro")!;
function enterScene(): void {
  if (entered) return;             // ENTER is a one-way door; re-arming it would fight a click
  entered = true;
  intro.classList.add("gone");
  freeCam = false;                 // hand-driving suspends the move that is about to run
  WIDE_FOCUS.copy(ENTER_FOCUS);
  ambience("/sfx/fly.mp3", 0.25, sfxCaption("fly", FLY_NOISES));
  ambience("/sfx/dirt.mp3", 0.2, sfxCaption("worm", WORM_NOISES));
  translateBtn.disabled = false;
}
document.getElementById("enter")!.addEventListener("click", enterScene);

// --- bed subtitles ------------------------------------------------------------
// One caption per bed, shown for exactly the swell the bed is making, so a muted visitor still
// knows which animal the room is hearing. The variants are picked fresh per swell. Same
// transcript as the translation (speaker label, then the line): the beds ARE the animals
// talking, before the translator is switched on.
const FLY_NOISES = [
  "Bizz... bizzzz bizzz...",
  "Bzzzzzz... bzz. bzz.",
  "bzzzzZZZZZzzzz...",
  "Bizz bizz... bzzzzzzzz",
  "*wings blur* bzzzZZzzz...",
  "Bzzt. Bzzzzz... bizz.",
];
const WORM_NOISES = [
  "*dirt shifting*",
  "*damp soil crumbling*",
  "*wet wriggling through dirt*",
  "*loam settling*",
  "*a slow squelch underground*",
  "*grains of dirt trickling*",
];
const sfxLine = document.getElementById("sfx") as HTMLParagraphElement;
function sfxCaption(who: "fly" | "worm", variants: string[]): (on: boolean) => void {
  const span = sfxLine.appendChild(document.createElement("span"));
  return (on) => {
    span.innerHTML = on
      ? `<span class="who ${who}">${who.toUpperCase()}</span>${esc(variants[Math.floor(Math.random() * variants.length)]!)}`
      : "";
  };
}

document.getElementById("touch-head")!.onclick = () => void touch("HEAD", "ALML");
document.getElementById("touch-tail")!.onclick = () => void touch("TAIL", "PLML");

// Applied BEFORE enter: the beds read the flag when they are created, so a
// returning muted visitor never hears the first swell.
const muteBtn = document.getElementById("mute") as HTMLButtonElement;
let muted = readMuted();
const paintMute = () => {
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
};
setMuted(muted);
paintMute();
muteBtn.onclick = () => { muted = !muted; setMuted(muted); paintMute(); };

// --- translate --------------------------------------------------------------
// The beds say the fly buzzes and the worm moves; this says what they are arguing about. Gated on
// ENTER for the same reason the beds are: the press is the gesture that lets audio play at all.
const translateBtn = document.getElementById("translate") as HTMLButtonElement;
const banterLine = document.getElementById("banter") as HTMLParagraphElement;
let banter: Banter | null = null;
translateBtn.disabled = true;

function showBanter(who: string, what: string, cls = who): void {
  banterLine.hidden = false;
  banterLine.innerHTML = `<span class="who ${esc(cls)}">${esc(who)}</span>${esc(what)}`;
}

function paintTranslate(): void {
  translateBtn.setAttribute("aria-pressed", String(!!banter));
  translateBtn.textContent = banter ? "STOP" : "TRANSLATE";
}

/** Stop talking and leave the last line up. The beds and their captions come back either way. */
function stopBanter(): void {
  banter?.stop();
  banter = null;
  duckAmbience(false);
  sfxLine.hidden = false;
  paintTranslate();
}

translateBtn.onclick = () => {
  if (banter) { stopBanter(); return; }
  banterLine.hidden = false;
  showBanter("", "listening in…", "who");
  // Translating REPLACES the beds, it does not talk over them: the buzz and the dirt are the
  // animals' untranslated voices, so they and their captions go quiet for the whole session,
  // not just for each spoken line.
  duckAmbience(true);
  sfxLine.hidden = true;
  banter = startBanter({
    onLine: (turn) => showBanter(turn.speaker, turn.text),
    onSpeaking: () => {},
    onError: (message) => showBanter("", message, "oops"),
    onDone: () => { banter = null; duckAmbience(false); sfxLine.hidden = false; paintTranslate(); },
  });
  paintTranslate();
};

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
  const caption = document.getElementById("txcaption")!;
  if (panelSide === "fly") {
    const frame = flyFeed.frame;
    stats.innerHTML = [
      tile("TX / MIN", flyTxPerMin.toFixed(1)),
      tile("FRAMES / S", flyFramesPerSec.toFixed(1)),
      tile("TRANSFERS / S", Math.round(flyTransfersPerSec).toLocaleString()),
      // The model steps at 1000 ticks/s (flychain.ts), so ticks are ms.
      tile("SIM CLOCK", frame ? `${(frame.tick / 1000).toFixed(1)}s` : "—"),
      tile("BUFFERED TX", String(flyTransactions.pending)),
      // The FLY's payer, which is a different account from the worm's — the
      // worm's balance here would be a number this panel never spends.
      tile("FEE PAYER", flyChain.stats.balance?.toLocaleString() ?? "?",
           flyChain.stats.balance !== undefined && flyChain.stats.balance < 5_000),
    ].join("");
    // The honest caption. The model spikes at 1000 ticks/s and the chain
    // confirms in seconds, so this list is a SAMPLE — saying "every synapse"
    // here would be the one false claim in the room.
    caption.title = flyChain.stats.error;
    caption.textContent = flyChain.stats.error ? "Retrying · sampled synaptic events, one transaction each"
      : flyFeed.status === "live" ? "Sampled synaptic events · one transaction each · latest 500"
      : "Fly model offline · start fly-brain/python/server.py";
    return;
  }
  stats.innerHTML = [
    tile("TX / MIN", txPerMin.toFixed(1)),
    tile("FRAMES / S", framesPerSec.toFixed(1)),
    tile("TRANSFERS / S", Math.round(transfersPerSec).toLocaleString()),
    tile("SIM CLOCK", `${((behaviorSample?.step ?? feed.stats.lastStep) * cfg.dtMs / 1000).toFixed(1)}s`),
    tile(cfg.synapseTransactions ? "BUFFERED TX" : "QUEUE",
      String(cfg.synapseTransactions ? transactions.pending : feed.stats.lag)),
    tile("FEE PAYER", status ? status.balance.toLocaleString() : "?", low),
  ].join("");
  const error = status?.log[0]?.error;
  caption.title = error ?? "";
  caption.textContent = error ? "Retrying chain confirmation · playing confirmed receipts"
    : transactions.active(performance.now()) ? "Confirmed receipts · paced playback · latest 500"
    : "Waiting for confirmed transactions · latest 500";
}

/** The relay's transaction log, newest first, each linking to the explorer.
 *  A row carries its own playback state, so the highlighted row is literally
 *  the transaction whose transfers are on screen right now. */
function drawLog(): void {
  if (panelSide === "fly") { flyList?.render(panelPaused); return; }
  if (transactionList) { transactionList.render(panelPaused); return; }
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
  const flyFrames = flyFeed.frames - flyFramesSeen;
  flyFramesSeen = flyFeed.frames;
  flyFramesPerSec += (flyFrames / span - flyFramesPerSec) * 0.4;
  flyTransfersPerSec += (flyRateTx / span - flyTransfersPerSec) * 0.4;
  flyTxPerMin += (flyRateTx * 60 / span - flyTxPerMin) * 0.4;
  flyRateTx = 0;
}

let last = performance.now();
/** The transaction panel redraws at 10 Hz, not once per frame. */
let lastPanel = 0;

/** The model's threshold current, v_thresh / tau from fly-brain/spec/params.json.
 *  The drives are quoted as a FRACTION of it, because a bare 0.069 means
 *  nothing on a wall and "90% of threshold" is the thing the tuning was
 *  scored on. Re-tuning the spec changes this number — they are one fact. */
const FLY_THRESHOLD_CURRENT = 1.0 / 12.97;

/** The fly's readout, in the worm's panel. Every field is the model's own:
 *  the bump the ring is holding, the push-pull drive turning it, and the
 *  momentum signal it trades on. Nothing here is generated by this page. */
/** The fly may read the market ONLY once its brain is on screen and the chain is confirming its
 *  synapses — the same bar the worm clears through reading.status. Before that the model's
 *  frames still arrive, but nothing on screen backs them. */
const flyLive = (now: number) => flyBrain.ready && flyTransactions.active(now);

function drawFlyClassifier(now: number): void {
  const text = (name: string, value: string) => {
    const node = readoutPart(name);
    if (node.textContent !== value) node.textContent = value;
  };
  text("title", "FLY HEADING / D. MELANOGASTER");
  text("heading-label", "Bump heading");
  text("forward-label", "PEN_L drive");
  text("reverse-label", "PEN_R drive");
  text("book-label", "FLY PAPER ACCOUNT · START $10,000");
  text("signal-note", "Bump heading + the model's momentum signal · not a market forecast");
  // Frames arrive before the brain is on screen and before a single receipt has confirmed, and
  // a readout that already claims "bump held · 16% buy tilt" over 0% drives is a reading with
  // nothing behind it. The frame is dropped until BOTH halves are up — see flyLive.
  const f = flyLive(now) ? flyFeed.frame : undefined;
  classifier.dataset.status = f ? "live" : "waiting";
  text("status", flyFeed.status === "live" ? "Playing"
    : flyFeed.status === "connecting" ? "Connecting" : "Model offline");
  text("age", f ? `${((now - f.at) / 1000).toFixed(1)} s` : "—");
  if (!f) {
    text("state", "Awaiting activity");
    text("meaning", !flyFeed.frame ? "The readout starts when fly-brain/python/server.py sends a frame."
      : !flyBrain.ready ? "Loading the fly brain."
      : "Waiting for the first confirmed synaptic transaction.");
  } else if (f.phase === "boot") {
    text("state", "Forming the bump");
    text("meaning", "A landmark is driving EPG. The ring has not settled into a single bump yet.");
  } else if (f.bumps === 1) {
    text("state", "Heading bump held");
    text("meaning", "One bump on the EPG ring. Push-pull drive onto PEN_L/PEN_R is what turns it.");
  } else {
    text("state", f.bumps === 0 ? "No bump" : `${f.bumps} bumps`);
    text("meaning", "The ring is not holding a single heading — the circuit is outside the regime it was tuned for.");
  }
  const degrees = f ? (f.heading * 180 / Math.PI + 360) % 360 : 0;
  text("heading", f ? `${Math.round(degrees) % 360}°` : "—");
  readoutPart("heading-plot").setAttribute("transform", `rotate(${degrees} 100 100)`);
  // Push-pull means the two drives are one number with opposite signs, so at
  // most one wedge is ever up — the same reading as the worm's forward and
  // reverse, which also never both fire.
  for (const [name, drive] of [["forward", f?.driveL ?? 0], ["reverse", f?.driveR ?? 0]] as const) {
    const fraction = Math.max(0, Math.min(1, drive / FLY_THRESHOLD_CURRENT));
    text(`${name}-value`, f ? `${Math.round(fraction * 100)}%` : "—");
    const r = fraction * 72, y = 100 - r * Math.cos(Math.PI / 6);
    readoutPart(name).setAttribute("d", r === 0 ? ""
      : `M100 100 L${100 - r / 2} ${y} A${r} ${r} 0 0 1 ${100 + r / 2} ${y} Z`);
  }
  const signal = f ? Math.max(-1, Math.min(1, f.signal)) : 0;
  const tilt = Math.round(signal * 100);
  const label = tilt === 0 ? "Neutral" : `${Math.abs(tilt)}% ${tilt > 0 ? "Buy" : "Sell"} tilt`;
  text("tilt", label);
  readoutPart("needle").style.left = `${50 + signal * 50}%`;
  readoutPart("meter").setAttribute("aria-valuenow", String(tilt));
  readoutPart("meter").setAttribute("aria-valuetext", label);
  drawMarket(flyPortfolio);
}

function drawClassifier(now: number): void {
  if (classifier.hidden) return;
  if (side === "fly") { drawFlyClassifier(now); return; }
  const age = now - behaviorAdvancedAt;
  classifier.dataset.status = reading.status;
  const text = (name: string, value: string) => {
    const node = readoutPart(name);
    if (node.textContent !== value) node.textContent = value;
  };
  // The panel is shared with the fly, so every label it swaps has to be put
  // back — a field left reading "Bump heading" over the worm's numbers is
  // worse than no label at all.
  text("title", "WORM BEHAVIOR / C. ELEGANS");
  text("heading-label", "Head heading");
  text("forward-label", "Forward drive");
  text("reverse-label", "Reverse drive");
  text("book-label", "WORM PAPER ACCOUNT · START $10,000");
  text("signal-note", "Motor state + recent synaptic currents · not a market forecast");
  text("state", reading.label);
  text("meaning", reading.meaning);
  text("status", reading.status === "live" ? "Playing"
    : reading.status === "buffering" ? "Waiting"
    : reading.status === "stale" ? "Signal stale" : "Awaiting signal");
  text("age", behaviorSample ? `${(age / 1000).toFixed(1)} s` : "—");
  const nose = body.points[0], neck = body.points[3];
  const heading = (Math.atan2(nose[1] - neck[1], nose[0] - neck[0]) * 180 / Math.PI + 360) % 360;
  text("heading", `${Math.round(heading) % 360}°`);
  readoutPart("heading-plot").setAttribute("transform", `rotate(${heading + 90} 100 100)`);
  for (const [name, drive] of [["forward", reading.forward], ["reverse", reading.reverse]] as const) {
    text(`${name}-value`, reading.state === null ? "—" : `${Math.round(drive * 100)}%`);
    const r = drive * 72, y = 100 - r * Math.cos(Math.PI / 6);
    readoutPart(name).setAttribute("d", r === 0 ? ""
      : `M100 100 L${100 - r / 2} ${y} A${r} ${r} 0 0 1 ${100 + r / 2} ${y} Z`);
  }
  const tilt = Math.round(tradingTilt * 100);
  const label = tilt === 0 ? "Neutral" : `${Math.abs(tilt)}% ${tilt > 0 ? "Buy" : "Sell"} tilt`;
  text("tilt", label);
  readoutPart("needle").style.left = `${50 + tradingTilt * 50}%`;
  readoutPart("meter").setAttribute("aria-valuenow", String(tilt));
  readoutPart("meter").setAttribute("aria-valuetext", label);
  drawMarket(wormPortfolio);
}

/** ONE market, whichever animal is open — the chart is the room's shared
 *  price feed and only the book over it changes. */
function drawMarket(book: WormPortfolio): void {
  const { price, candles, sequence } = market.snapshot;
  const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const equity = book.equity(price), pnl = equity - book.startingBalance;
  readoutPart("equity").textContent = money(equity);
  const profit = readoutPart("pnl");
  profit.textContent = `${pnl >= 0 ? "+" : "−"}${money(Math.abs(pnl))} (${(pnl / book.startingBalance * 100).toFixed(2)}%)`;
  profit.dataset.direction = pnl >= 0 ? "up" : "down";
  readoutPart("cash").textContent = money(book.cash);
  readoutPart("position").textContent = `${book.shares.toFixed(2)} shares`;
  readoutPart("trades").textContent = `${book.trades} paper fills`;
  if (chartCandle === sequence) return;
  chartCandle = sequence;
  readoutPart("price").textContent = money(price);
  const change = (price / candles[0].open - 1) * 100;
  const changeText = readoutPart("change");
  changeText.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  changeText.dataset.direction = change >= 0 ? "up" : "down";
  const low = Math.min(...candles.map(c => c.low));
  const high = Math.max(...candles.map(c => c.high));
  const pad = Math.max(.05, (high - low) * .08);
  // The plot runs 60..140 in the SVG's own units and the viewBox is cropped to match — the
  // grid lines and labels in index.html sit on the SAME three y's, so a change here moves them
  // too or the candles float off the rules.
  const y = (value: number) => 140 - (value - low + pad) / (high - low + 2 * pad) * 80;
  let upWicks = "", downWicks = "", upBodies = "", downBodies = "";
  candles.forEach((c, i) => {
    const x = 8 + i * 7;
    const wick = `M${x},${y(c.high)}V${y(c.low)}`;
    const body = `M${x},${y(c.open)}V${y(c.close) + (c.close === c.open ? .5 : 0)}`;
    if (c.close >= c.open) { upWicks += wick; upBodies += body; }
    else { downWicks += wick; downBodies += body; }
  });
  for (const [id, path] of [["up-wicks", upWicks], ["down-wicks", downWicks], ["up-bodies", upBodies], ["down-bodies", downBodies]])
    readoutPart(id).setAttribute("d", path);
  readoutPart("chart-high").textContent = (high + pad).toFixed(2);
  readoutPart("chart-low").textContent = (low - pad).toFixed(2);
  readoutPart("chart-mid").textContent = ((high + low) / 2).toFixed(2);
  readoutPart("chart").setAttribute("aria-label", `Shared demo market, price ${money(price)}, ${change.toFixed(2)} percent over the visible window`);
}

function frame(now: number): void {
  const real = (now - last) / 1000;
  // Clamp rendering time so returning to a hidden tab never jumps the animal.
  const dt = Math.min(0.05, real);
  last = now;

  feed.tick();                       // paces the chain's frames onto the scene
  for (const receipt of transactions.tick(now)) {
    brain.fireEdge(receipt.pre, receipt.post, receipt.amount > 0);
    neuralTilt.observe(receipt, now);
    transactionList?.add(receipt);
  }
  // Rendering the classified gait is continuous between settlements. This
  // does not advance the neural simulation clock or create transactions.
  // A real PAUSE still stops the body; a silent receipt feed stops it in 15 s.
  const movement = cfg.synapseTransactions ? (transactions.active(now) ? dt : 0) : clock.take(real);
  const activityAge = cfg.synapseTransactions
    ? Math.min(now - behaviorAdvancedAt, transactions.age(now)) : now - behaviorAdvancedAt;
  reading = classifyBehavior(behaviorSample, activityAge, movement > 0);
  tradingTilt = cfg.synapseTransactions
    ? neuralTilt.value(now, reading.signal, reading.status === "live" &&
      (reading.state === BEHAVIOR.FORWARD || reading.state === BEHAVIOR.REVERSE))
    : reading.signal;
  body.update(movement, behavior);
  // The fly's half of the same loop: the relay derives and signs its events
  // (relay.mjs); this only plays the confirmed receipts back off the chain.
  const flyFrame = flyFeed.frame;
  for (const receipt of flyTransactions.tick(now)) flyList?.add(receipt);
  // The panel belongs to whichever exhibit is open. Mounting is the ONE thing
  // that must not run every frame — it re-parents the whole list.
  if (side !== "none" && side !== panelSide) {
    panelSide = side;
    if (side === "fly") {
      flyList ??= new TransactionList(log, document.getElementById("txlatest") as HTMLButtonElement,
                                      flyNames(), flyChain.cfg?.explorer ?? cfg.explorer,
                                      ["excitatory", "inhibitory"]);
      flyList.attach();
    } else transactionList?.attach();
  }
  if (panelSide === "fly") flyList?.render(panelPaused);
  else transactionList?.render(panelPaused);
  worm.update(body.points);
  // The typist and the market run on the WALL clock: they are scenery, not simulation, and
  // freezing them whenever the chain stalls would read as the page having crashed. The market
  // ticks even before the desk loads — the board is showing it either way.
  fly?.update(dt);
  market.update(dt);
  const quote = market.snapshot;
  if (quote.sequence !== tradedCandle) {
    tradedCandle = quote.sequence;
    if (reading.status === "live") wormPortfolio.rebalance(quote.price, tradingTilt);
    // The fly trades on the model's position ONLY while flyLive holds — the same gate the worm
    // has on reading.status, so neither book moves on a reading nothing backs. The typist keeps
    // typing either way: that is scenery, and a desk that froze would read as the fly having
    // stopped work.
    if (flyLive(now) && flyFrame) flyPortfolio.rebalance(quote.price, flyFrame.position);
  }
  brain.setVoltages(voltages);
  brain.tick(dt);

  integrateRates(now);
  if (now - lastPanel > 100) {
    lastPanel = now;
    drawClassifier(now);
    if (!panelPaused) {
      drawLog();
      drawStats();
    }
  }

  // Independent ambience, unaffected by hover or brain selection. Only change
  // brightness: hiding lights would trigger new shader variants.
  const wormLight = reducedMotion.matches ? 1 : wormFlicker(now);
  const flyLight = reducedMotion.matches ? 1 : flyFlicker(now);
  wormSpot.intensity = wormSpotIntensity * wormLight;
  flySpot.intensity = flySpotIntensity * flyLight;
  wormBeam.material.opacity = BEAM_OPACITY * wormLight;
  flyBeam.material.opacity = BEAM_OPACITY * flyLight;
  tvBoard?.brightness(reducedMotion.matches ? 1 : tvFlicker(now));
  setCounter?.(ledgerTotal);

  // --- The reveal, see WIDE_FOCUS above. ---
  const opening = side === "none" ? 0 : 1;
  backBtn.hidden = side === "none";
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
  // Closing, Escape, and switching to the worm all stop the fly's background work.
  if (side !== "fly") flyFeed.disconnect();
  if (flyHead) flyBrain.follow(flyHead);
  flyBrain.tick(dt);
  // The premises are generous while the scene is shut, so the tank is easy to
  // find from the wide shot, and tight once it is open: at close range a box
  // half a body length proud of the tank covers EVERY pixel, and then nothing
  // the pointer does can end the reveal. Height is left alone — the column
  // reaches the connectome, which is part of what the click is aimed at.
  const slack = THREE.MathUtils.lerp(TRIGGER_MARGIN, TRIGGER_TIGHT, wormAlpha);
  trigger.scale.set((ARENA.halfX + slack) / (ARENA.halfX + TRIGGER_MARGIN), 1,
                    (ARENA.halfY + slack) / (ARENA.halfY + TRIGGER_MARGIN));
  // Both exhibits share the panels, so they follow whichever one is revealed.
  // Tied to wormAlpha alone the fly's readout would open at zero opacity.
  const panelAlpha = Math.max(wormAlpha, flyAlpha);
  classifier.style.opacity = marketPanel.style.opacity = txpanel.style.opacity = panelAlpha.toFixed(3);
  classifier.style.pointerEvents = marketPanel.style.pointerEvents =
    txpanel.style.pointerEvents = panelAlpha > 0.6 ? "auto" : "none";

  // Recentre by moving target and camera TOGETHER: whatever angle the user
  // orbited to survives the flight, and the worm stays framed as it crawls.
  const mid = body.points[body.points.length >> 1];
  wormFocus.set(mid[0] * TRACK, FOCUS_LIFT, mid[1] * TRACK);
  // The fly is looked at where its brain is, not where its feet are.
  if (flyHead) {
    flyHead.getWorldPosition(flyFocus);
    flyFocus.y += FLY_BRAIN_ROOM * 0.55;   // the brain, not the feet
  }
  if (freeCam) {
    // Follow the hand-driven target, so handing framing back starts from
    // wherever the user left the camera rather than snapping across the room.
    focus.copy(controls.target);
  } else {
    // Keep the worm's light centred on the enclosure; the fly's follows its head.
  wormSpot.position.set(0, LAMP_HEIGHT, 0);
  wormSpot.target.position.set(0, 0, 0);
  if (flyHead) {
    flyHead.getWorldPosition(spotAt);
    flySpot.position.set(spotAt.x, LAMP_HEIGHT, spotAt.z + 0.3);
    flySpot.target.position.copy(spotAt);
  }
  aimBeam(wormBeam, wormSpot);
  aimBeam(flyBeam, flySpot);

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
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
