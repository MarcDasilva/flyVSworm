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
import { BrainCloud } from "./brain.js";

const DATA = new URL("../../data/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));

const positions: [number, number, number][] = read("positions.json");
const names: string[] = read("names.json");
const edges: [number, number][] = read("edges.json");

assert.equal(positions.length, 302, "positions.json is not 302 neurons");
assert.equal(names.length, 302, "names.json is not 302 neurons");
assert.ok(edges.length > 0, "edges.json is empty");

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
const brain = new BrainCloud(scene, positions, names, edges);

// One account per neuron on chain, one instance per neuron here. A mismatch
// means setVoltages would paint the wrong cells.
const nodes = instanced(scene).find(m => m.count === 302);
assert.ok(nodes, "no InstancedMesh with 302 instances — the neuron cloud is wrong");
assert.ok(nodes.instanceColor, "neuron instances carry no colour buffer");

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
