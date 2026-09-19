// Run: npx tsx src/test_body.ts
import { strict as assert } from "node:assert";
import { WormBody, BODY_LENGTH_MM, type BehaviorState } from "./body.js";

const SEGMENTS = 24;
const SEG = BODY_LENGTH_MM / SEGMENTS;
const FWD: BehaviorState = { state: 1, gain: 1 };
const REV: BehaviorState = { state: 2, gain: 1 };
const PAUSE: BehaviorState = { state: 0, gain: 0 };
const OMEGA: BehaviorState = { state: 3, gain: 1 };
const DT = 1 / 60;

type V = readonly number[];
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V) => { const m = Math.hypot(a[0], a[1], a[2]); return [a[0] / m, a[1] / m, a[2] / m]; };
const angleBetween = (a: V, b: V) =>
  Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));

function run(w: WormBody, frames: number, b: BehaviorState, dt = DT) {
  for (let i = 0; i < frames; i++) w.update(dt, b);
}

// A worm modelled as y = A*sin(x) stretches as it oscillates, and a stretching
// worm reads as wrong instantly. Checked on EVERY frame, not just the last —
// a seed path only one body long clamps the tail on frame one and heals
// itself by frame two, which an end-state-only assert cannot see.
function assertInextensible(w: WormBody, where: string) {
  assert.equal(w.points.length, SEGMENTS, `${where}: wrong segment count`);
  for (let k = 1; k < w.points.length; k++) {
    const d = dist(w.points[k - 1], w.points[k]);
    assert.ok(Number.isFinite(d), `${where}: segment ${k} is not finite`);
    assert.ok(Math.abs(d - SEG) < SEG * 0.05,
      `${where}: segment ${k} length ${d} drifted from ${SEG} — body is stretching`);
  }
}

// THE invariant, under every state including the tight omega bend.
{
  for (const [name, b] of [["forward", FWD], ["reverse", REV], ["omega", OMEGA]] as const) {
    const w = new WormBody(SEGMENTS);
    assertInextensible(w, `${name} frame 0`);
    for (let i = 0; i < 2000; i++) {
      w.update(DT, b);
      assertInextensible(w, `${name} frame ${i + 1}`);
    }
  }
  // Direction changes must not tear the body either.
  const w = new WormBody(SEGMENTS);
  const script: BehaviorState[] = [FWD, REV, OMEGA, PAUSE, REV, FWD, OMEGA, FWD];
  for (const b of script) {
    for (let i = 0; i < 200; i++) { w.update(DT, b); assertInextensible(w, `script ${b.state}`); }
  }
}

// FORWARD and REVERSE must translate the worm in OPPOSITE directions along its
// own axis. Asserting only that the two head positions differ passes on the
// undulation phase alone, and would not catch a "reverse" that crawls forward
// with the body wave running backwards — the single most visible front-end
// failure, since head touch is supposed to make the worm back away.
{
  const f = new WormBody(SEGMENTS);
  run(f, 600, FWD);
  const fwdTravel = sub(f.points[0], [0, 0, 0]);
  assert.ok(Math.hypot(...fwdTravel) > 0.02, `forward barely moved: ${fwdTravel}`);
  assert.ok(fwdTravel[0] > 0.5, `forward did not travel along +x: ${fwdTravel[0]}`);
  // Travel is nose-first: the displacement agrees with the body's own axis.
  assert.ok(dot(fwdTravel, sub(f.points[0], f.points[SEGMENTS - 1])) > 0,
    "forward travel does not point nose-first along the body axis");

  const r = new WormBody(SEGMENTS);
  run(r, 600, REV);
  const revTravel = sub(r.points[0], [0, 0, 0]);
  assert.ok(Math.hypot(...revTravel) > 0.02, `reverse barely moved: ${revTravel}`);
  assert.ok(revTravel[0] < -0.3, `reverse did not travel along -x: ${revTravel[0]}`);
  // Travel is tail-first: the displacement OPPOSES the body's own axis.
  assert.ok(dot(revTravel, sub(r.points[0], r.points[SEGMENTS - 1])) < 0,
    "reverse travel is not tail-first — the worm is crawling forwards");

  assert.ok(Math.sign(fwdTravel[0]) !== Math.sign(revTravel[0]),
    "forward and reverse translate the same way");
  assert.ok(angleBetween(fwdTravel, revTravel) > 2.5,
    `forward and reverse are not opposed: ${angleBetween(fwdTravel, revTravel)} rad`);
}

// PAUSE must stop translation but keep the body coherent.
{
  const w = new WormBody(SEGMENTS);
  run(w, 300, FWD);
  const before = [...w.points[0]];
  const bodyBefore = w.points.map((p) => [...p]);
  run(w, 300, PAUSE);
  assert.ok(dist(w.points[0], before) < 0.005, "PAUSE still translating");
  for (let k = 0; k < SEGMENTS; k++) {
    assert.ok(dist(w.points[k], bodyBefore[k]) < 1e-12, `PAUSE moved segment ${k}`);
  }
  assertInextensible(w, "paused");
}

// An OMEGA turn must reverse the direction of travel, or the escape response
// is invisible on screen. Travel is sampled over a whole undulation period so
// the body wave averages out of the measurement.
{
  const PERIOD_FRAMES = Math.round(60 / 0.4);
  const w = new WormBody(SEGMENTS);
  run(w, 300, FWD);
  const a0 = [...w.points[0]];
  run(w, PERIOD_FRAMES, FWD);
  const dirBefore = sub(w.points[0], a0);

  run(w, 60, OMEGA);

  const a1 = [...w.points[0]];
  run(w, PERIOD_FRAMES, FWD);
  const dirAfter = sub(w.points[0], a1);

  assert.ok(angleBetween(dirBefore, dirAfter) > 2.0,
    `omega turned only ${angleBetween(dirBefore, dirAfter)} rad — escape turn is invisible`);
}

// A crawling worm is a deep S, not a wiggling rod. If the end-to-end chord is
// close to the arc length the undulation amplitude is too small to read as a
// worm; if it collapses the body has curled into a knot.
{
  const w = new WormBody(SEGMENTS);
  const span = (SEGMENTS - 1) * SEG;
  let minChord = Infinity, maxChord = 0;
  for (let i = 0; i < 1200; i++) {
    w.update(DT, FWD);
    if (i < 300) continue;
    const c = dist(w.points[0], w.points[SEGMENTS - 1]);
    minChord = Math.min(minChord, c);
    maxChord = Math.max(maxChord, c);
  }
  assert.ok(maxChord < span * 0.92, `body is a straight rod: chord ${maxChord} of span ${span}`);
  assert.ok(minChord > span * 0.45, `body curled into a knot: chord ${minChord} of span ${span}`);
}

// Replays must line up: identical input gives bit-identical output, so a
// recorded chain trace redraws the same worm every time.
{
  const script: BehaviorState[] = [FWD, OMEGA, REV, PAUSE, FWD, REV];
  const a = new WormBody(SEGMENTS), b = new WormBody(SEGMENTS);
  for (const s of script) { run(a, 137, s); run(b, 137, s); }
  for (let k = 0; k < SEGMENTS; k++) {
    assert.deepEqual(a.points[k], b.points[k], `replay diverged at segment ${k}`);
  }
}

// Frame time comes from requestAnimationFrame, NEVER a fixed 1/60. Laying one
// path point per frame makes the body curve as coarse as the frame rate, and
// the omega bend is where that first tears the body — a dropped-frame worm
// must not stretch. Measured: one point per frame breaks the 5% bound at 8 fps.
{
  for (const fps of [60, 30, 12, 8]) {
    const w = new WormBody(SEGMENTS);
    const frames = Math.round(fps * 5);
    for (let i = 0; i < frames; i++) { w.update(1 / fps, FWD); assertInextensible(w, `${fps} fps forward`); }
    for (let i = 0; i < fps; i++) { w.update(1 / fps, OMEGA); assertInextensible(w, `${fps} fps omega`); }
  }
  const fast = new WormBody(SEGMENTS), slow = new WormBody(SEGMENTS);
  run(fast, 600, FWD, 1 / 60);
  run(slow, 80, FWD, 1 / 8);
  const df = dist(fast.points[0], [0, 0, 0]), ds = dist(slow.points[0], [0, 0, 0]);
  assert.ok(Math.abs(df - ds) < df * 0.005,
    `frame rate changed the distance travelled: ${df} vs ${ds}`);
}

// Garbage from the classifier must not produce NaN geometry — the renderer
// would silently draw nothing.
{
  const w = new WormBody(SEGMENTS);
  for (const g of [0, -5, 1e6, NaN]) {
    for (let i = 0; i < 120; i++) w.update(DT, { state: 1, gain: g });
  }
  for (const dt of [0, -1, NaN]) w.update(dt, FWD);
  assertInextensible(w, "hostile input");
}

console.log("OK: body kinematics invariants hold");
