// The fly's brain, hanging over its head the way the worm's connectome hangs
// over the terrarium: the baked hemibrain central complex (frontend/public/
// brain, written by fly-brain/python/bake_3d.py) lit by the firing of the
// model that is actually running in fly-brain/python/server.py.
//
// The geometry and the model are two different builds of the same circuit —
// 134 traced hemibrain cells against the live model's smaller procedural ring
// — so the two are matched by POPULATION and by position within it. See
// mapToLive: that mapping is what makes the bump on screen the bump the model
// computed, rather than a light show.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FlyFeed } from "./flyfeed.js";

const ASSETS = "/brain";
/** Width of the hanging brain in scene units (worm body lengths). Big enough
 *  that the ring of cells is readable from the revealed camera, which is what
 *  the whole thing is for. */
const SPAN = 1.0;
/** Centre height above the fly's head, as a fraction of SPAN. */
const LIFT = 0.62;
// Glow ramp, taken from the same numbers the fly-brain viewer uses: dark at
// RATE_LOW_HZ, full at RATE_HIGH_HZ, so a heading bump at 200+ Hz stands out
// from the background firing instead of washing the whole ring out.
const RATE_LOW_HZ = 20;
const RATE_HIGH_HZ = 200;
/** Keep the revealed circuit readable even when the live model is offline. */
const IDLE_GLOW = 0.6;
/** Seconds a single spike's extra brightness takes to decay. */
const FLICKER_TAU = 0.11;
const OUTLINE_COLOR = 0x8fa3b8;
const CONTEXT_COLOR = 0x7c828a;

interface Manifest {
  spec: string;
  neurons: { index: number; node: string; body_id: number; pop: string }[];
  populations: Record<string, { color: string }>;
  context: { node: string }[];
  rois: { node: string }[];
  outline: { node: string };
}

/** What fly-brain/python/server.py reports about the model it is running. */
interface Network {
  neurons: { id: number; pop: string; wedge: number }[];
}

type Neuron = {
  material: THREE.MeshStandardMaterial;
  /** Index into the live model's rate array. See mapToLive. */
  live: number;
  flicker: number;
};

/**
 * Baked cell -> live model neuron, by population and by position within it.
 *
 * The bake has 50 EPG cells where the running model may have 16, and both are
 * rings ordered by wedge, so the k-th of n baked cells takes the k*m/n-th of
 * the m live ones. Same population ALWAYS, or the ring would light in the
 * wrong order and the bump would point the wrong way. A model built from the
 * same spec as the bake maps one to one and this costs nothing.
 */
function mapToLive(manifest: Manifest, network: Network | null): number[] {
  const out = new Array<number>(manifest.neurons.length).fill(-1);
  if (!network) return out;
  const livePops = new Map<string, number[]>();
  for (const n of network.neurons) {
    const list = livePops.get(n.pop) ?? [];
    list.push(n.id);
    livePops.set(n.pop, list);
  }
  for (const list of livePops.values()) list.sort((a, b) => a - b);

  const bakedPops = new Map<string, number[]>();
  for (const n of manifest.neurons) {
    const list = bakedPops.get(n.pop) ?? [];
    list.push(n.index);
    bakedPops.set(n.pop, list);
  }
  for (const [pop, baked] of bakedPops) {
    const live = livePops.get(pop);
    if (!live?.length) continue;      // the model has no such population
    baked.sort((a, b) => a - b);
    baked.forEach((index, k) => {
      out[index] = live[Math.min(live.length - 1, Math.floor((k * live.length) / baked.length))];
    });
  }
  return out;
}

export class FlyBrain {
  readonly group = new THREE.Group();
  private neurons: Neuron[] = [];
  /** Live model neuron -> the baked cells that stand for it. Built once: a
   *  scan per spike per frame is 134 comparisons times a few hundred spikes. */
  private readonly byLive = new Map<number, Neuron[]>();
  /** Shell materials with the opacity they were authored at. See setReveal. */
  private readonly shells = new Map<THREE.Material, number>();
  private loading: Promise<void> | null = null;
  private alpha = 0;
  private readonly head = new THREE.Vector3();

  constructor(scene: THREE.Object3D, private readonly feed: FlyFeed) {
    this.group.visible = false;
    scene.add(this.group);
  }

  get ready(): boolean { return this.neurons.length > 0; }

  /** 22 MB of bake. NOTHING waits on it until the fly is actually clicked. */
  load(): Promise<void> {
    this.loading ??= this.build().catch(e => {
      console.warn("fly brain failed to load", e);
      this.loading = null;
    });
    return this.loading;
  }

  private async build(): Promise<void> {
    const [manifest, gltf, network] = await Promise.all([
      fetch(`${ASSETS}/brain.json`).then(r => r.json() as Promise<Manifest>),
      new GLTFLoader().loadAsync(`${ASSETS}/brain.glb`),
      // The model's own account of itself. Without it the bake still draws,
      // it just cannot be lit — see mapToLive.
      fetch("/fly/api/network").then(r => r.ok ? r.json() as Promise<Network> : null)
        .catch(() => null),
    ]);

    const byName = new Map<string, THREE.Mesh>();
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) byName.set(o.name, o as THREE.Mesh); });
    const mesh = (node: string): THREE.Mesh => {
      const found = byName.get(node);
      if (!found) throw new Error(`brain.glb has no node ${node}`);
      return found;
    };

    const shell = (color: number, opacity: number): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        color, transparent: true, opacity, depthWrite: false, roughness: 1,
        emissive: color, emissiveIntensity: 0.25,
        side: THREE.DoubleSide, forceSinglePass: true,
      });
      this.shells.set(m, opacity);
      return m;
    };
    // The static shells share materials. Merge their baked geometry instead of
    // issuing 128 separate draw calls (and a second pass for every shell).
    const mergeShells = (nodes: { node: string }[], material: THREE.Material) => {
      const parts = nodes.map(n => mesh(n.node));
      const geometries = parts.map(part => {
        part.updateWorldMatrix(true, false);
        return part.geometry.clone().applyMatrix4(part.matrixWorld);
      });
      const geometry = mergeGeometries(geometries);
      for (const g of geometries) g.dispose();
      if (!geometry) throw new Error("fly brain shell geometries cannot be merged");
      gltf.scene.add(new THREE.Mesh(geometry, material));
      for (const part of parts) {
        part.removeFromParent();
        part.geometry.dispose();
      }
    };
    mesh(manifest.outline.node).material = shell(OUTLINE_COLOR, 0.06);
    const roi = shell(OUTLINE_COLOR, 0.1);
    mergeShells(manifest.rois, roi);
    const context = shell(CONTEXT_COLOR, 0.28);
    mergeShells(manifest.context, context);

    const live = mapToLive(manifest, network);
    this.neurons = new Array(manifest.neurons.length);
    for (const n of manifest.neurons) {
      const color = new THREE.Color(manifest.populations[n.pop].color);
      const material = new THREE.MeshStandardMaterial({
        // The cell's own colour is held DOWN and the firing is carried by
        // emission: lit at full strength by the room's lights, a silent cell
        // and a cell at 200 Hz look nearly the same and the bump disappears.
        // A steady base glow keeps the revealed circuit readable offline.
        color: color.clone().multiplyScalar(0.3), emissive: color,
        emissiveIntensity: IDLE_GLOW, roughness: 0.55,
        transparent: true, opacity: 1,
      });
      mesh(n.node).material = material;
      const neuron = { material, live: live[n.index], flicker: 0 };
      this.neurons[n.index] = neuron;
      const sharing = this.byLive.get(neuron.live) ?? [];
      sharing.push(neuron);
      this.byLive.set(neuron.live, sharing);
    }

    // The bake is in hemibrain microns and the scene is in worm body lengths,
    // so the brain is fitted to SPAN and re-centred on its own middle — its
    // authored origin is the template's, nowhere near the cells.
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const scale = SPAN / Math.max(size.x, size.y, size.z);
    gltf.scene.scale.setScalar(scale);
    gltf.scene.position.copy(centre).multiplyScalar(-scale);
    this.group.add(gltf.scene);
    this.group.visible = this.alpha > 0.01;
    this.setReveal(this.alpha);
  }

  /** Hang it over the head node, which sways as the fly types. */
  follow(headNode: THREE.Object3D): void {
    headNode.getWorldPosition(this.head);
    this.group.position.set(this.head.x, this.head.y + SPAN * LIFT, this.head.z);
  }

  /** Fade in and out, 0 to 1, against each material's authored opacity. */
  setReveal(alpha: number): void {
    this.alpha = alpha;
    this.group.visible = alpha > 0.01 && this.neurons.length > 0;
    if (!this.group.visible) return;
    for (const [material, base] of this.shells) material.opacity = base * alpha;
    for (const n of this.neurons) n.material.opacity = alpha;
  }

  /**
   * Paint the firing. Glow is the model's own rate through the ramp; a spike
   * adds a short flash on top, which is what makes the bump read as moving
   * rather than as a static bright patch.
   */
  tick(dt: number): void {
    if (!this.group.visible) return;
    const frame = this.feed.frame;
    const decay = Math.exp(-dt / FLICKER_TAU);
    if (frame) {
      for (const i of frame.spiked) {
        for (const n of this.byLive.get(i) ?? []) n.flicker = 1;
      }
    }
    for (const n of this.neurons) {
      n.flicker *= decay;
      const hz = frame && n.live >= 0 ? frame.rates[n.live] ?? 0 : 0;
      const glow = THREE.MathUtils.smoothstep(hz, RATE_LOW_HZ, RATE_HIGH_HZ);
      n.material.emissiveIntensity = IDLE_GLOW + 2.6 * glow + 0.6 * n.flicker;
    }
  }
}
