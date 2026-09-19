import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const COLD = new THREE.Color(0x1d4ed8);   // -80 mV
const HOT = new THREE.Color(0xff4d3d);    // +20 mV
const EXCITATORY = new THREE.Color(0xfbbf24);
const INHIBITORY = new THREE.Color(0x60a5fa);

/** Nose-to-tail in world units. The morphology arrives normalised so the
 *  animal is exactly 1.0 long, and this is the ONLY factor applied to it —
 *  one scale for all three axes, or the traced angles stop being the traced
 *  angles. The worm is genuinely a thin thread; that is what it looks like. */
const SPAN = 1.9;
const HEIGHT = 1.05;   // hovers above the agar in body lengths
const SOMA_R = 0.011;
const PARTICLE_R = 0.010;
const PARTICLE_SPEED = 5.0;   // traversals per second
const MAX_PARTICLES = 1400;
const NEURITE_PX = 1.4;       // drawn width, screen pixels

/** Bins used to reconstruct the body's midline from the cell bodies. The
 *  traced animal is POSED IN A CURVE, so there is no straight axis to bow a
 *  transfer toward — see routing in controlPoint. */
const AXIS_BINS = 24;
/** How far a transfer's midpoint is pulled onto that midline. 0 draws chords
 *  that cut straight out through the cuticle and back; 1 drags every
 *  transfer onto the midline and they all overlap. */
const AXIS_PULL = 0.55;

const MAGIC = 0x48504d57;   // "WMPH" little-endian

export interface Morphology {
  segments: number;
  /** 6 floats per segment: both endpoints, in normalised body lengths. */
  verts: Float32Array;
  /** Per neuron, the [start, count) range it owns in the segment array. */
  range: Uint32Array;
}

/**
 * Reads data/morphology.bin (see pipeline/morphology.py for the writer).
 *
 * A short or mistyped buffer must fail HERE with a legible message. Left to
 * the GPU it becomes a blank screen or a spray of triangles through the
 * origin, and neither one names the file that is wrong.
 */
export function parseMorphology(buf: ArrayBuffer): Morphology {
  const head = new DataView(buf);
  if (buf.byteLength < 16 || head.getUint32(0, true) !== MAGIC)
    throw new Error("morphology.bin: bad magic — is /morphology.bin being served?");
  const version = head.getUint32(4, true);
  if (version !== 1) throw new Error(`morphology.bin: version ${version}, expected 1`);
  const neurons = head.getUint32(8, true);
  const segments = head.getUint32(12, true);

  const vertsOff = 16 + neurons * 8;
  const expected = vertsOff + segments * 24;
  if (buf.byteLength !== expected)
    throw new Error(`morphology.bin: ${buf.byteLength} bytes, header describes ${expected}`);

  return {
    segments,
    range: new Uint32Array(buf.slice(16, vertsOff)),
    verts: new Float32Array(buf, vertsOff, segments * 6),
  };
}

/**
 * The nervous system as it was actually traced: 302 neurons drawn as their
 * real arbors, tinted by the membrane voltage the chain reports for each one.
 *
 * The geometry is NOT a layout. It comes from the OpenWorm NeuroML2 cells
 * (public-domain VirtualWorm tracing of the White et al. EM series) and
 * nothing here may move a neuron — if the nerve ring looks like a ring it is
 * because the animal has one, and if the body looks bent it is because the
 * specimen was posed that way. Anterior is +x, matching the body below,
 * which starts out crawling toward +x.
 */
export class BrainCloud {
  readonly group = new THREE.Group();
  readonly segments: number;
  private readonly neurites: LineSegments2;
  private readonly material: LineMaterial;
  /** Interleaved rgb for both endpoints of every segment, 6 floats each. */
  private readonly wireColor: Float32Array;
  private readonly range: Uint32Array;
  private readonly somas: THREE.InstancedMesh;
  private readonly somaColor: Float32Array;
  private readonly pos: THREE.Vector3[];
  private readonly particles: THREE.InstancedMesh;
  /** t >= 1 means the slot is free. Fixed pool — see fireEdge. */
  private readonly live: { t: number; a: number; b: number }[] = [];
  /** Midline of the posed animal, sampled along x. See AXIS_BINS. */
  private readonly axis: THREE.Vector3[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Vector3(0, 0, 0);
  private readonly scratch = new THREE.Color();
  private readonly ctrl = new THREE.Vector3();
  /** Round-robin so firing is O(1): a linear free-list scan at 1400 slots and
   *  ~100 spikes a frame is 140k comparisons per frame, for nothing. */
  private cursor = 0;

  constructor(scene: THREE.Scene,
              positions: [number, number, number][],
              private readonly names: string[],
              morphology: Morphology) {
    if (morphology.range.length !== positions.length * 2)
      throw new Error(`morphology covers ${morphology.range.length / 2} neurons, ` +
        `positions.json has ${positions.length}`);

    this.segments = morphology.segments;
    this.range = morphology.range;
    this.pos = positions.map(p => new THREE.Vector3(
      p[0] * SPAN, HEIGHT + p[1] * SPAN, p[2] * SPAN));
    this.buildAxis();

    // --- The arbors. One draw call for all 9,429 traced neurites. ---
    const world = new Float32Array(morphology.verts.length);
    for (let i = 0; i < world.length; i += 3) {
      world[i] = morphology.verts[i] * SPAN;
      world[i + 1] = HEIGHT + morphology.verts[i + 1] * SPAN;
      world[i + 2] = morphology.verts[i + 2] * SPAN;
    }
    this.wireColor = new Float32Array(morphology.segments * 6);
    for (let i = 0; i < morphology.segments * 2; i++) COLD.toArray(this.wireColor, i * 3);

    const geom = new LineSegmentsGeometry();
    geom.setPositions(world);
    geom.setColors(this.wireColor);
    // NEVER additive here. The arbors bundle tightly — the ventral cord
    // alone stacks dozens of processes within a micrometre — so additive
    // blending sums them past 1.0 and every dense tract saturates to WHITE,
    // which is precisely where the voltage colour most needs to be readable.
    // Normal blending with depthWrite off keeps the tint true and still lets
    // the arbors behind show through.
    this.material = new LineMaterial({
      vertexColors: true, linewidth: NEURITE_PX,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.neurites = new LineSegments2(geom, this.material);
    // A neurite can sit anywhere in the animal and the default bounding
    // sphere of an instanced line geometry is unreliable; culling this away
    // blanks the entire nervous system at certain camera angles.
    this.neurites.frustumCulled = false;
    this.group.add(this.neurites);

    // --- Cell bodies, sitting on their own arbors by construction. ---
    this.somas = new THREE.InstancedMesh(
      new THREE.SphereGeometry(SOMA_R, 8, 8),
      // NEVER vertexColors here: that define makes the vertex shader multiply
      // by a `color` attribute this geometry does not have, WebGL supplies
      // zero, and all 302 neurons render BLACK. instanceColor alone is what
      // tints an InstancedMesh.
      new THREE.MeshBasicMaterial(),
      positions.length);
    this.somaColor = new Float32Array(positions.length * 3);
    this.pos.forEach((p, i) => {
      this.somas.setMatrixAt(i, this.m.makeTranslation(p.x, p.y, p.z));
      COLD.toArray(this.somaColor, i * 3);
    });
    this.somas.instanceColor = new THREE.InstancedBufferAttribute(this.somaColor, 3);
    this.somas.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.somas);

    // ONE instanced mesh, never per-spike allocation. A synapse-per-Mesh pool
    // leaks its material on every retire and grows without bound the moment
    // the chain replays a burst; here a burst just recycles the oldest slot.
    this.particles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(PARTICLE_R, 6, 6),
      new THREE.MeshBasicMaterial(),
      MAX_PARTICLES);
    this.particles.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PARTICLES * 3), 3);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.live.push({ t: 1, a: 0, b: 0 });
      this.particles.setMatrixAt(i, this.m.compose(this.zero, this.q, this.zero));
    }
    this.group.add(this.particles);

    scene.add(this.group);
  }

  /** LineMaterial sizes its quads in PIXELS, so it needs the drawing buffer
   *  size. Miss the resize and the neurites keep the old width — wrong by the
   *  ratio of the two viewports, which on a maximise is very visible. */
  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height);
  }

  /** Membrane potential per neuron, index-aligned with names.json. Paints the
   *  cell body AND every neurite belonging to it, so a spike is visible
   *  travelling the wires rather than only lighting a dot. */
  setVoltages(mV: Int16Array): void {
    const n = Math.min(mV.length, this.pos.length);
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, (mV[i] + 80) / 100));
      this.scratch.copy(COLD).lerp(HOT, t);
      this.scratch.toArray(this.somaColor, i * 3);
      const start = this.range[i * 2], count = this.range[i * 2 + 1];
      for (let s = start; s < start + count; s++) {
        // Both endpoints of the segment, so the wire is a flat colour rather
        // than a gradient to whatever the neighbouring cell is doing.
        this.scratch.toArray(this.wireColor, s * 6);
        this.scratch.toArray(this.wireColor, s * 6 + 3);
      }
    }
    (this.somas.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    const attr = this.neurites.geometry.getAttribute("instanceColorStart") as THREE.InterleavedBufferAttribute;
    attr.data.needsUpdate = true;
  }

  /**
   * One synaptic transfer, animated pre -> post. Indices come off the chain in
   * Task 15 and an out-of-range one must NEVER take the render loop down with
   * it, so a bad edge is dropped silently.
   */
  fireEdge(pre: number, post: number, excitatory = true): void {
    if (!this.pos[pre] || !this.pos[post]) return;
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    const p = this.live[slot];
    p.t = 0; p.a = pre; p.b = post;
    (excitatory ? EXCITATORY : INHIBITORY)
      .toArray((this.particles.instanceColor as THREE.InstancedBufferAttribute).array, slot * 3);
    (this.particles.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  tick(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.live[i];
      if (p.t >= 1) continue;
      p.t += dt * PARTICLE_SPEED;
      any = true;
      if (p.t >= 1) {
        this.particles.setMatrixAt(i, this.m.compose(this.zero, this.q, this.zero));
        continue;
      }
      this.controlPoint(this.pos[p.a], this.pos[p.b], this.ctrl);
      this.bezier(this.pos[p.a], this.ctrl, this.pos[p.b], p.t, this.v);
      this.particles.setMatrixAt(i, this.m.compose(this.v, this.q, this.one));
    }
    if (any) this.particles.instanceMatrix.needsUpdate = true;
  }

  /** Mean cell-body position in each of AXIS_BINS slices along the body.
   *  Empty slices inherit the last filled one, so the table is total. */
  private buildAxis(): void {
    const lo = Math.min(...this.pos.map(p => p.x));
    const hi = Math.max(...this.pos.map(p => p.x));
    const sum = Array.from({ length: AXIS_BINS }, () => new THREE.Vector3());
    const count = new Array(AXIS_BINS).fill(0);
    for (const p of this.pos) {
      const b = Math.min(AXIS_BINS - 1,
        Math.floor((p.x - lo) / (hi - lo + 1e-9) * AXIS_BINS));
      sum[b].add(p);
      count[b]++;
    }
    let last = new THREE.Vector3(lo, HEIGHT, 0);
    for (let b = 0; b < AXIS_BINS; b++) {
      if (count[b] > 0) last = sum[b].divideScalar(count[b]);
      this.axis.push(last.clone());
    }
  }

  /** Midpoint pulled onto the body's midline, so a transfer arcs THROUGH the
   *  animal instead of chording out through the cuticle. The midline has to
   *  be looked up per-x rather than assumed straight: this specimen was
   *  traced in a crawling posture and its axis swings about a fifth of a body
   *  length off centre. */
  private controlPoint(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): void {
    const mx = (a.x + b.x) / 2;
    const lo = this.axis[0].x, hi = this.axis[this.axis.length - 1].x;
    const bin = Math.min(this.axis.length - 1, Math.max(0,
      Math.round((mx - lo) / (hi - lo + 1e-9) * (this.axis.length - 1))));
    const on = this.axis[bin];
    out.set(mx,
            (a.y + b.y) / 2 + (on.y - (a.y + b.y) / 2) * AXIS_PULL,
            (a.z + b.z) / 2 + (on.z - (a.z + b.z) / 2) * AXIS_PULL);
  }

  /** Quadratic Bezier. */
  private bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3,
                 t: number, out: THREE.Vector3): void {
    const u = 1 - t;
    out.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x,
            u * u * a.y + 2 * u * t * c.y + t * t * b.y,
            u * u * a.z + 2 * u * t * c.z + t * t * b.z);
  }

  /** Name -> index, the only way the UI addresses a specific cell. */
  labelIndex(name: string): number { return this.names.indexOf(name); }
}
