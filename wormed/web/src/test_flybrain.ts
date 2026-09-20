// Run: npx tsx src/test_flybrain.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FlyBrain } from "./flybrain.js";
import type { FlyFeed } from "./flyfeed.js";

const assets = new URL("../../../frontend/public/brain/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("brain.json", assets), "utf8"));
const bytes = readFileSync(new URL("brain.glb", assets));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const loader = new GLTFLoader();
const original = await loader.parseAsync(buffer, "");
const triangles = (root: THREE.Object3D) => {
  let count = 0;
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) count += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
  return count;
};
const originalTriangles = triangles(original.scene);
const originalFetch = globalThis.fetch;
const originalLoad = GLTFLoader.prototype.loadAsync;
let loads = 0;
GLTFLoader.prototype.loadAsync = async () => { loads++; return loader.parseAsync(buffer.slice(0), ""); };
try {
  const brain = new FlyBrain(new THREE.Scene(), { frame: null } as FlyFeed);
  // The unavailable live model must not stop anatomical geometry loading.
  globalThis.fetch = async input => String(input).endsWith("brain.json")
    ? new Response(JSON.stringify(manifest)) : new Response(null, { status: 503 });
  await Promise.all([brain.load(), brain.load(), brain.load()]);
  assert.equal(loads, 1, "repeated clicks loaded duplicate brain models");
  assert.equal(brain.ready, true);
  assert.equal(brain.group.children.length, 1);
  assert.equal(triangles(brain.group), originalTriangles, "batching discarded anatomical geometry");
  let meshes = 0;
  brain.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const material = m.material as THREE.Material;
    if (material.side === THREE.DoubleSide) assert.ok(material.forceSinglePass, "shell renders twice");
  });
  assert.equal(meshes, manifest.neurons.length + 3, "static shells were not batched");
  for (const n of manifest.neurons) assert.ok(brain.group.getObjectByName(n.node), `lost neuron ${n.node}`);
  const size = new THREE.Box3().setFromObject(brain.group).getSize(new THREE.Vector3());
  assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 1) < 1e-5, "brain scale changed");
  for (let i = 0; i < 5; i++) {
    brain.setReveal(1); brain.tick(1 / 60);
    assert.equal(brain.group.visible, true);
    brain.setReveal(0); brain.tick(1 / 60);
    assert.equal(brain.group.visible, false);
    await brain.load();
  }
  assert.equal(loads, 1);
  assert.equal(brain.group.children.length, 1);
  console.log(`OK: ${originalTriangles} brain triangles preserved in ${meshes} meshes; repeated reveals reuse the model`);
} finally {
  GLTFLoader.prototype.loadAsync = originalLoad;
  globalThis.fetch = originalFetch;
}
