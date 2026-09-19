// Run: npx tsx src/test_scene.ts
//
// The scene has no unit tests in the plan and "it looks right" is not a result.
// This drives the REAL data through the REAL classes headlessly — no renderer,
// because every class here is pure geometry until something draws it — and
// pins the three properties that silently rot: the instance count, the
// per-frame allocation behaviour, and the treadmill that keeps the worm inside
// the camera frustum forever.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { WormBody, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud, parseMorphology } from "./brain.js";

const DATA = new URL("../../data/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));

const positions: [number, number, number][] = read("positions.json");
const names: string[] = read("names.json");
const edges: [number, number][] = read("edges.json");
const raw = readFileSync(new URL("morphology.bin", DATA));
const morphology = parseMorphology(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);

assert.equal(positions.length, 302, "positions.json is not 302 neurons");
assert.equal(names.length, 302, "names.json is not 302 neurons");
assert.ok(edges.length > 0, "edges.json is empty");
assert.equal(morphology.range.length, 604, "morphology.bin is not 302 neurons");
assert.ok(morphology.segments > 5000, "morphology.bin has too few neurites to be a tracing");

// Every neuron must own a stretch of the vertex buffer, and the stretches
// must tile it exactly. A neuron with zero segments renders as a bare dot and
// a gap between ranges is geometry that no voltage will ever repaint.
let cursor = 0;
for (let i = 0; i < 302; i++) {
  assert.equal(morphology.range[i * 2], cursor, `${names[i]}: segment range is not contiguous`);
  assert.ok(morphology.range[i * 2 + 1] > 0, `${names[i]}: no traced neurites`);
  cursor += morphology.range[i * 2 + 1];
}
assert.equal(cursor, morphology.segments, "segment ranges do not tile the buffer");

// Corrupt input must name the file, not blank the screen. The header lies
// about the segment count here, which is exactly the failure a silent
// truncation during deploy produces.
const bad = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
new DataView(bad).setUint32(12, 99999, true);
assert.throws(() => parseMorphology(bad), /morphology\.bin/);
assert.throws(() => parseMorphology(new ArrayBuffer(8)), /morphology\.bin/);

const FWD: BehaviorState = { state: 1, gain: 1 };
const REV: BehaviorState = { state: 2, gain: 1 };
const OMEGA: BehaviorState = { state: 3, gain: 1 };
const DT = 1 / 60;

function census(root: THREE.Object3D) {
  let objects = 0;
  const geometries = new Set<string>();
  const materials = new Set<string>();
  root.traverse(o => {
    objects++;
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry.uuid);
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => materials.add(x.uuid));
    else if (mat) materials.add(mat.uuid);
  });
  return { objects, geometries: geometries.size, materials: materials.size };
}

function instanced(root: THREE.Object3D): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  root.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh); });
  return out;
}

const scene = new THREE.Scene();
const body = new WormBody(24);
const worm = new WormMesh(scene);
const brain = new BrainCloud(scene, positions, names, morphology);

// One account per neuron on chain, one instance per neuron here. A mismatch
// means setVoltages would paint the wrong cells.
const nodes = instanced(scene).find(m => m.count === 302);
assert.ok(nodes, "no InstancedMesh with 302 instances — the neuron cloud is wrong");
assert.ok(nodes.instanceColor, "neuron instances carry no colour buffer");

// Every cell body must sit ON its own traced arbor. Reading the soma from a
// different source than the neurites is the mistake that leaves 302 dots
// hovering beside the wires, and it looks almost right until you zoom.
const verts = morphology.verts;
for (const name of ["AVAL", "PLML", "IL1DL", "VD6", "PHAL"]) {
  const i = names.indexOf(name);
  const start = morphology.range[i * 2], count = morphology.range[i * 2 + 1];
  let best = Infinity;
  for (let s = start; s < start + count; s++) {
    for (const o of [0, 3]) {
      const d = (verts[s * 6 + o] - positions[i][0]) ** 2
              + (verts[s * 6 + o + 1] - positions[i][1]) ** 2
              + (verts[s * 6 + o + 2] - positions[i][2]) ** 2;
      if (d < best) best = d;
    }
  }
  assert.ok(best < 1e-9, `${name}: soma is not on its own arbor (d2=${best})`);
}

// Frame 1 warms every lazily-allocated buffer, so the census is only stable
// from frame 2 on — compare against that, not against the constructor.
body.update(DT, FWD);
worm.update(body.points);
brain.setVoltages(new Int16Array(302).fill(-70));
brain.tick(DT);
const base = census(scene);

const mV = new Int16Array(302);
let peak = base;
for (let f = 0; f < 120; f++) {
  const b = f < 40 ? FWD : f < 80 ? REV : OMEGA;
  body.update(DT, b);
  worm.update(body.points);
  for (let i = 0; i < 302; i++) mV[i] = -70 + ((f * 3 + i) % 90);
  brain.setVoltages(mV);
  // Far more spikes per frame than the chain will ever deliver — a per-spike
  // Mesh pool would be 600 objects and 600 orphaned materials by now.
  for (let k = 0; k < 5; k++) {
    const [pre, post] = edges[(f * 5 + k) % edges.length];
    brain.fireEdge(pre, post, k % 2 === 0);
  }
  brain.tick(DT);
  const c = census(scene);
  peak = {
    objects: Math.max(peak.objects, c.objects),
    geometries: Math.max(peak.geometries, c.geometries),
    materials: Math.max(peak.materials, c.materials),
  };
}
const after = census(scene);
assert.deepEqual(after, base,
  `scene grew across 120 frames: ${JSON.stringify(base)} -> ${JSON.stringify(after)}`);
assert.deepEqual(peak, base,
  `scene grew mid-run and shrank back: peak ${JSON.stringify(peak)}`);

// A material rebuilt per frame is the leak the plan's WormMesh shipped: the
// geometry was disposed, the material never was.
assert.equal(base.materials, base.geometries,
  "object/material bookkeeping drifted; every drawn object should own exactly one of each");

// setVoltages must actually repaint. Cold and hot ends of the scale differ.
const colours = (nodes.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
brain.setVoltages(new Int16Array(302).fill(-80));
const cold = Float32Array.from(colours);
brain.setVoltages(new Int16Array(302).fill(20));
let moved = 0;
for (let i = 0; i < cold.length; i++) if (Math.abs(cold[i] - colours[i]) > 1e-6) moved++;
assert.ok(moved > cold.length / 2, "setVoltages did not repaint the cloud");

// THE POINT OF THE TRACED ANATOMY: a spike must light the neuron's WIRES,
// not just its cell body. Painting only the 302 somas leaves 9,429 neurites
// frozen at the resting colour and the render is a dot cloud again.
const wires = scene.getObjectByName("neurites") as THREE.Mesh | undefined;
assert.ok(wires, "no object named \"neurites\" — the arbors are not drawn");
const wireBuf = (wires.geometry.getAttribute("instanceColorStart") as THREE.InterleavedBufferAttribute)
  .data.array as Float32Array;
assert.equal(wireBuf.length, morphology.segments * 6,
  "neurite colour buffer does not cover every segment endpoint");

brain.setVoltages(new Int16Array(302).fill(-80));
const wireCold = Float32Array.from(wireBuf);
brain.setVoltages(new Int16Array(302).fill(20));
let wiresMoved = 0;
for (let i = 0; i < wireCold.length; i++) if (Math.abs(wireCold[i] - wireBuf[i]) > 1e-6) wiresMoved++;
assert.ok(wiresMoved > wireCold.length / 2,
  `only ${wiresMoved}/${wireCold.length} neurite colour floats moved between -80 mV and +20 mV`);

// Depolarising ONE cell must light that cell's arbor and leave its
// neighbours alone. A range table that is off by one paints the wrong
// neuron, which no whole-buffer check above can see.
const solo = new Int16Array(302).fill(-80);
const target = names.indexOf("AVAL");
solo[target] = 20;
brain.setVoltages(solo);
const lit = (i: number) => {
  const start = morphology.range[i * 2], count = morphology.range[i * 2 + 1];
  let moved = 0;
  for (let s = start; s < start + count; s++)
    if (Math.abs(wireBuf[s * 6] - wireCold[s * 6]) > 1e-6) moved++;
  return moved / count;
};
assert.equal(lit(target), 1, "AVAL's own arbor did not light up");
for (const other of ["AVAR", "PLML", "IL1DL"])
  assert.equal(lit(names.indexOf(other)), 0, `${other} lit up when only AVAL fired`);
brain.setVoltages(new Int16Array(302).fill(-70));

// A FIRING CONNECTOR MUST STAY INSIDE THE ANIMAL. The specimen is traced in
// a crawling curve, so a straight chord between two distant cell bodies
// leaves the body for most of its length — it has to be routed along the
// midline instead. Rebuild the body's own radius per slice from the traced
// points, then fire head-to-tail pairs and check every drawn vertex lands
// inside it. Nothing else in this file would notice a connector cutting
// through open agar.
const glow = scene.getObjectByName("firing") as THREE.Mesh | undefined;
assert.ok(glow, "no object named \"firing\" — synaptic transfers are not drawn");
const glowPos = (glow.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute)
  .data.array as Float32Array;

const SPAN = 1.9, HEIGHT = 1.05, BINS = 40;
const wx = (i: number) => morphology.verts[i] * SPAN;
const wy = (i: number) => HEIGHT + morphology.verts[i + 1] * SPAN;
const wz = (i: number) => morphology.verts[i + 2] * SPAN;
let axLo = Infinity, axHi = -Infinity;
for (let i = 0; i < morphology.verts.length; i += 3) {
  axLo = Math.min(axLo, wx(i)); axHi = Math.max(axHi, wx(i));
}
const binOf = (x: number) => Math.min(BINS - 1, Math.max(0,
  Math.floor((x - axLo) / (axHi - axLo + 1e-9) * BINS)));
const cy = new Float64Array(BINS), cz = new Float64Array(BINS), cn = new Float64Array(BINS);
for (let i = 0; i < morphology.verts.length; i += 3) {
  const b = binOf(wx(i)); cy[b] += wy(i); cz[b] += wz(i); cn[b]++;
}
for (let b = 0; b < BINS; b++) if (cn[b]) { cy[b] /= cn[b]; cz[b] /= cn[b]; }
const radius = new Float64Array(BINS);
for (let i = 0; i < morphology.verts.length; i += 3) {
  const b = binOf(wx(i));
  radius[b] = Math.max(radius[b], Math.hypot(wy(i) - cy[b], wz(i) - cz[b]));
}
// Neighbour-max, so a connector crossing a bin boundary is not failed by a
// slice that happens to hold only the thin part of the cord.
const bodyR = radius.map((_, b) =>
  Math.max(radius[Math.max(0, b - 1)], radius[b], radius[Math.min(BINS - 1, b + 1)]));

const spans: [string, string][] = [["ALML", "PVCL"], ["IL1DL", "PHAL"], ["AVAL", "VA12"],
                                 ["PLMR", "AVBR"], ["ASEL", "DA9"], ["RMED", "PQR"]];
let worst = 0, worstAt = "";
for (const [from, to] of spans) {
  const i = names.indexOf(from), j = names.indexOf(to);
  assert.ok(i >= 0 && j >= 0, `${from}/${to} missing from names.json`);
  brain.fireEdge(i, j, true);
  // fireEdge bakes the path on write and hands out slots round-robin, so the
  // one just written is the slot before the cursor.
  for (let slot = 0; slot < glowPos.length / 6; slot++) {
    // Only look at the segments written this call: find them by matching the
    // first vertex to the presynaptic cell body.
    const o = slot * 6;
    if (Math.abs(glowPos[o] - positions[i][0] * SPAN) > 1e-5) continue;
    if (Math.abs(glowPos[o + 1] - (HEIGHT + positions[i][1] * SPAN)) > 1e-5) continue;
    for (let seg = 0; seg < 6; seg++) {
      for (const half of [0, 3]) {
        const q = o + seg * 6 + half;
        if (q + 2 >= glowPos.length) continue;
        const b = binOf(glowPos[q]);
        const d = Math.hypot(glowPos[q + 1] - cy[b], glowPos[q + 2] - cz[b]);
        if (d / (bodyR[b] || 1) > worst) { worst = d / (bodyR[b] || 1); worstAt = `${from}->${to}`; }
      }
    }
    break;
  }
}
assert.ok(worst > 0, "no firing connector geometry was written");
assert.ok(worst <= 1.02,
  `a firing connector reaches ${worst.toFixed(2)}x the body radius at ${worstAt} — ` +
  "it is cutting outside the animal instead of following the midline");

// A connector fades to nothing and frees its slot. If the decay stops short
// of zero the pool saturates and the whole nervous system stays washed out.
const glowCol = (glow.geometry.getAttribute("instanceColorStart") as THREE.InterleavedBufferAttribute)
  .data.array as Float32Array;
brain.fireEdge(names.indexOf("AVAL"), names.indexOf("AVBL"), true);
brain.tick(0.01);
let litPeak = 0;
for (let i = 0; i < glowCol.length; i++) litPeak = Math.max(litPeak, glowCol[i]);
assert.ok(litPeak > 0.05, `a fired connector never lit up (peak ${litPeak})`);
assert.ok(litPeak < 0.5, `a connector at ${litPeak} is not the dim glow it should be`);
for (let f = 0; f < 60; f++) brain.tick(1 / 60);
let stillLit = 0;
for (let i = 0; i < glowCol.length; i++) stillLit = Math.max(stillLit, glowCol[i]);
assert.equal(stillLit, 0, `connectors still lit at ${stillLit} a second after firing`);

// Chain indices are not trusted input; a bad edge must be dropped, not thrown.
brain.fireEdge(-1, 5);
brain.fireEdge(5, 9999);
brain.fireEdge(NaN, 3);
brain.tick(DT);
assert.deepEqual(census(scene), base, "a rejected edge still touched the scene");

// The touch circuits are addressed BY NAME from the UI, so a renamed or
// dropped cell must fail here and not as a silently dead button.
for (const cell of ["ALML", "ALMR", "AVM", "AVDL", "AVDR", "AVAL", "AVAR",
                    "PLML", "PLMR", "PVCL", "PVCR", "AVBL", "AVBR"]) {
  assert.ok(brain.labelIndex(cell) >= 0, `${cell} is missing from names.json`);
}
assert.equal(brain.labelIndex("NOSUCHCELL"), -1);

// THE TREADMILL. Ten seconds of forward crawl is 2.6 body lengths — off the
// plan's 6x6 plate in half a minute and out of a fixed frustum sooner. The
// worm is redrawn at the origin every frame, so its geometry must stay inside
// the pinned bounding sphere no matter how far it has travelled.
for (let f = 0; f < 600; f++) {
  body.update(DT, FWD);
  worm.update(body.points);
}
const travelled = Math.hypot(body.points[0][0], body.points[0][1]);
assert.ok(travelled > 2, `worm only travelled ${travelled} L in 10 s — body model stalled`);

const tube = scene.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;
let far = 0;
let finite = true;
scene.traverse(o => {
  const m = o as THREE.Mesh;
  if (!m.geometry || m.geometry.boundingSphere?.radius !== 0.8) return;
  const p = m.geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i])) finite = false;
    far = Math.max(far, Math.abs(p[i]));
  }
});
assert.ok(tube, "no worm mesh in the scene");
assert.ok(finite, "worm geometry contains NaN");
assert.ok(far > 0.1, "worm geometry is degenerate");
assert.ok(far < 0.8,
  `worm geometry reaches ${far} from the origin after ${travelled.toFixed(2)} L of crawl — ` +
  "the recentring is broken and the worm will leave the frame");

console.log(`OK: scene holds ${base.objects} objects, ${base.materials} materials ` +
  `across 120 frames; worm crawled ${travelled.toFixed(2)} L and stayed within ` +
  `${far.toFixed(3)} of the origin`);
