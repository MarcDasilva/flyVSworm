import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const COLD = new THREE.Color(0x1d4ed8);   // -80 mV
const HOT = new THREE.Color(0xff4d3d);    // +20 mV
const EXCITATORY = new THREE.Color(0xfbbf24);
const INHIBITORY = new THREE.Color(0x60a5fa);
/** Peak brightness of a firing connector. The material is ADDITIVE, so this
 *  is light added on top of the arbors, and overlapping connectors SUM. Set
 *  by measuring the accumulated value per pixel over a steady-state burst at
 *  the default camera: at 0.28 a typical lit pixel sits near a quarter
 *  brightness and under 3% of them reach white. Raising it much past 0.4
 *  starts blowing out the tracts, which is the anatomy the glow is meant to
 *  be read against. */
const FIRE_GAIN = 0.28;

/** Nose-to-tail in world units. The morphology arrives normalised so the
 *  animal is exactly 1.0 long, and this is the ONLY factor applied to it —
 *  one scale for all three axes, or the traced angles stop being the traced
 *  angles. The worm is genuinely a thin thread; that is what it looks like. */
const SPAN = 1.9;
const HEIGHT = 1.05;   // hovers above the agar in body lengths
const SOMA_R = 0.011;
const NEURITE_PX = 1.4;       // drawn width, screen pixels
const FIRE_PX = 2.2;          // a firing connector, screen pixels
/** Seconds a connector stays lit. Long enough to read as a flash at 20
 *  frames a second, short enough that a 110-transfer burst has faded before
 *  the next one lands. */
const FIRE_LIFETIME = 0.38;
/** Concurrent lit connectors. A burst is ~110 transfers and frames arrive
 *  around 20/s, so roughly 660 overlap at this lifetime. Sized with headroom
 *  over that: at the steady-state count the oldest slot gets recycled while
 *  still lit, which cuts flashes short and makes the decay look wrong. */
const MAX_FIRING = 1024;
/** Samples along a connector. 7 points = 6 segments is where the path stops
 *  looking like a staircase as it follows the body's bend. */
const FIRE_SAMPLES = 7;
const FIRE_SEGS = FIRE_SAMPLES - 1;

/** Bins used to reconstruct the body's midline. The traced animal is POSED
 *  IN A CURVE, so there is no straight axis to route along — see buildAxis
 *  and firingPath. */
const AXIS_BINS = 40;
/** Fraction of a connector spent leaving its cell body and merging onto the
 *  midline at each end. The middle runs ALONG the midline, which is what
 *  keeps the connector inside the animal: a single arc between two distant
 *  cell bodies chords straight across the body's bend and out through the
 *  cuticle, however hard its midpoint is pulled inward. */
const FIRE_MERGE = 0.3;
/** How far off the midline a connector may sit, as a fraction of the LOCAL
 *  body radius. Without it every connector runs down the exact same line,
 *  hundreds overlap pixel for pixel, and additive blending sums them into a
 *  solid bright core however dim each one is. Spreading them over the
 *  cross-section is also the truer picture — processes run in several
 *  distinct tracts, not one. */
const FIRE_SPREAD = 0.55;

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
  private readonly firing: LineSegments2;
  private readonly fireMaterial: LineMaterial;
  /** Interleaved rgb for both ends of every connector segment in the pool. */
  private readonly fireColor: Float32Array;
  private readonly firePos: Float32Array;
  /** Seconds elapsed per slot; >= FIRE_LIFETIME means free. See fireEdge. */
  private readonly fireAge = new Float32Array(MAX_FIRING).fill(FIRE_LIFETIME);
  private readonly fireTint = new Float32Array(MAX_FIRING * 3);
  /** Midline of the posed animal, sampled along x. See AXIS_BINS. */
  private readonly axis: THREE.Vector3[] = [];
  /** Body radius at each of those samples, so a connector offset off the
   *  midline still narrows with the animal and stays inside it. */
  private readonly axisR: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly scratch = new THREE.Color();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly cur = new THREE.Vector3();
  /** Round-robin so firing is O(1): a linear free-list scan at 768 slots and
   *  ~100 spikes a frame is 77k comparisons per frame, for nothing. */
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

    // --- The arbors. One draw call for all 9,429 traced neurites. ---
    const world = new Float32Array(morphology.verts.length);
    for (let i = 0; i < world.length; i += 3) {
      world[i] = morphology.verts[i] * SPAN;
      world[i + 1] = HEIGHT + morphology.verts[i + 1] * SPAN;
      world[i + 2] = morphology.verts[i + 2] * SPAN;
    }
    // Built from EVERY traced point, not from the cell bodies. The somas sit
    // in ganglia off to one side of the body; their mean is not the body's
    // axis, and routing a connector along it would push the connector out
    // through the cuticle on the opposite side.
    this.buildAxis(world);
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
    this.neurites.name = "neurites";
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

    // --- Firing connectors. ONE draw call, fixed pool, never a per-spike
    // allocation: a mesh-per-synapse pool leaks its material on every retire
    // and grows without bound the moment the chain replays a burst. Here a
    // burst just recycles the oldest slot. ---
    this.firePos = new Float32Array(MAX_FIRING * FIRE_SEGS * 6);
    this.fireColor = new Float32Array(MAX_FIRING * FIRE_SEGS * 6);
    const fireGeom = new LineSegmentsGeometry();
    fireGeom.setPositions(this.firePos);
    fireGeom.setColors(this.fireColor);
    // Additive IS right here, unlike the arbors: a connector is light laid
    // over the anatomy, and a dead slot is left in the buffer at pure black,
    // which additive blending renders as nothing at all. That is what lets
    // the pool be a fixed array instead of a rebuilt geometry every frame.
    this.fireMaterial = new LineMaterial({
      vertexColors: true, linewidth: FIRE_PX,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.firing = new LineSegments2(fireGeom, this.fireMaterial);
    this.firing.name = "firing";
    this.firing.frustumCulled = false;
    this.group.add(this.firing);

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
   * One synaptic transfer: the connector between the two cells lights up and
   * fades. Indices come off the chain in Task 15 and an out-of-range one must
   * NEVER take the render loop down with it, so a bad edge is dropped
   * silently.
   */
  fireEdge(pre: number, post: number, excitatory = true): void {
    if (!this.pos[pre] || !this.pos[post]) return;
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_FIRING;
    this.fireAge[slot] = 0;
    (excitatory ? EXCITATORY : INHIBITORY).toArray(this.fireTint, slot * 3);

    // The path is baked ONCE, here, not re-evaluated per frame: the geometry
    // does not move over a connector's life, only its brightness does.
    // Deterministic per pair, so the SAME synapse always takes the same
    // route — a connector that jitters between firings reads as noise
    // rather than as one event happening again.
    const h = Math.imul(pre + 1, 73856093) ^ Math.imul(post + 1, 19349663);
    const angle = ((h >>> 8) % 1024) / 1024 * Math.PI * 2;
    const spread = FIRE_SPREAD * (0.35 + 0.65 * ((h >>> 20) % 256) / 256);
    const offY = Math.cos(angle) * spread, offZ = Math.sin(angle) * spread;

    const base = slot * FIRE_SEGS * 6;
    this.firingPath(this.pos[pre], this.pos[post], 0, offY, offZ, this.a);
    for (let k = 1; k <= FIRE_SEGS; k++) {
      this.firingPath(this.pos[pre], this.pos[post], k / FIRE_SEGS, offY, offZ, this.b);
      const o = base + (k - 1) * 6;
      this.firePos[o] = this.a.x; this.firePos[o + 1] = this.a.y; this.firePos[o + 2] = this.a.z;
      this.firePos[o + 3] = this.b.x; this.firePos[o + 4] = this.b.y; this.firePos[o + 5] = this.b.z;
      this.a.copy(this.b);
    }
    const pos = this.firing.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
    pos.data.needsUpdate = true;
  }

  tick(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX_FIRING; i++) {
      const age = this.fireAge[i];
      if (age >= FIRE_LIFETIME) continue;
      const next = age + dt;
      this.fireAge[i] = next;
      any = true;
      // Squared falloff, so the flash reads as a decay rather than a linear
      // dimmer. A dead slot is written to pure black exactly once and then
      // skipped — additive blending draws black as nothing.
      const k = next >= FIRE_LIFETIME ? 0 : (1 - next / FIRE_LIFETIME) ** 2 * FIRE_GAIN;
      const base = i * FIRE_SEGS * 6;
      const r = this.fireTint[i * 3] * k;
      const g = this.fireTint[i * 3 + 1] * k;
      const b = this.fireTint[i * 3 + 2] * k;
      for (let o = base; o < base + FIRE_SEGS * 6; o += 3) {
        this.fireColor[o] = r; this.fireColor[o + 1] = g; this.fireColor[o + 2] = b;
      }
    }
    if (any) {
      const col = this.firing.geometry.getAttribute("instanceColorStart") as THREE.InterleavedBufferAttribute;
      col.data.needsUpdate = true;
    }
  }

  /** Mean traced point in each of AXIS_BINS slices along the body — the
   *  animal's own midline. Empty slices inherit the last filled one, so the
   *  table is total. */
  private buildAxis(world: Float32Array): void {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < world.length; i += 3) {
      if (world[i] < lo) lo = world[i];
      if (world[i] > hi) hi = world[i];
    }
    const sum = Array.from({ length: AXIS_BINS }, () => new THREE.Vector3());
    const count = new Array(AXIS_BINS).fill(0);
    for (let i = 0; i < world.length; i += 3) {
      const bin = Math.min(AXIS_BINS - 1,
        Math.floor((world[i] - lo) / (hi - lo + 1e-9) * AXIS_BINS));
      sum[bin].x += world[i]; sum[bin].y += world[i + 1]; sum[bin].z += world[i + 2];
      count[bin]++;
    }
    let last = new THREE.Vector3(lo, HEIGHT, 0);
    for (let b = 0; b < AXIS_BINS; b++) {
      if (count[b] > 0) last = sum[b].divideScalar(count[b]);
      this.axis.push(last.clone());
    }

    // Second pass for body radius per slice: furthest traced point from that
    // slice's own midline. Needs the midline finished first, hence two passes.
    const rad = new Array(AXIS_BINS).fill(0);
    for (let i = 0; i < world.length; i += 3) {
      const bin = Math.min(AXIS_BINS - 1,
        Math.floor((world[i] - lo) / (hi - lo + 1e-9) * AXIS_BINS));
      const c = this.axis[bin];
      rad[bin] = Math.max(rad[bin], Math.hypot(world[i + 1] - c.y, world[i + 2] - c.z));
    }
    let lastR = 0;
    for (let b = 0; b < AXIS_BINS; b++) {
      if (rad[b] > 0) lastR = rad[b];
      this.axisR.push(lastR);
    }
  }

  /** Body radius at a given x, interpolated between slices. */
  private radiusAt(x: number): number {
    const lo = this.axis[0].x, hi = this.axis[this.axis.length - 1].x;
    const f = Math.min(this.axisR.length - 1, Math.max(0,
      (x - lo) / (hi - lo + 1e-9) * (this.axisR.length - 1)));
    const i = Math.min(this.axisR.length - 2, Math.floor(f));
    return this.axisR[i] + (this.axisR[i + 1] - this.axisR[i]) * (f - i);
  }

  /** The midline at a given x, linearly interpolated between bins. */
  private midline(x: number, out: THREE.Vector3): void {
    const lo = this.axis[0].x, hi = this.axis[this.axis.length - 1].x;
    const f = Math.min(this.axis.length - 1, Math.max(0,
      (x - lo) / (hi - lo + 1e-9) * (this.axis.length - 1)));
    const i = Math.min(this.axis.length - 2, Math.floor(f));
    out.copy(this.axis[i]).lerp(this.axis[i + 1], f - i);
  }

  /**
   * A point at parameter t along the connector from cell a to cell b.
   *
   * The connector leaves a's cell body, merges onto the body's midline,
   * RUNS ALONG IT, and leaves again at b — which is both what a real process
   * does and the only shape that stays inside the animal. A single arc
   * between two distant cell bodies cannot: the body is posed in a curve, so
   * the straight chord between head and tail passes outside the cuticle for
   * most of its length no matter where the control point is placed.
   */
  private firingPath(a: THREE.Vector3, b: THREE.Vector3, t: number,
                     offY: number, offZ: number, out: THREE.Vector3): void {
    const x = a.x + (b.x - a.x) * t;
    this.midline(x, out);
    // midline() yields a sampled BIN, whose x is the mean of the points in
    // it, not the x asked for. Overwrite it or the connector snaps to bin
    // centres and its two ends miss their own cell bodies.
    out.x = x;

    // Offsets are measured from the midline AT EACH CELL BODY, so the two
    // ends land exactly on their somas rather than near them.
    const wa = BrainCloud.ease(Math.max(0, 1 - t / FIRE_MERGE));
    const wb = BrainCloud.ease(Math.max(0, (t - (1 - FIRE_MERGE)) / FIRE_MERGE));
    if (wa > 0) {
      this.midline(a.x, this.cur);
      out.y += (a.y - this.cur.y) * wa;
      out.z += (a.z - this.cur.z) * wa;
    }
    if (wb > 0) {
      this.midline(b.x, this.cur);
      out.y += (b.y - this.cur.y) * wb;
      out.z += (b.z - this.cur.z) * wb;
    }

    // The offset applies ONLY where the connector is on the midline, tapering
    // to nothing at both ends so the tips still land exactly on their cell
    // bodies. Scaled by the local radius, so it narrows into the tail with
    // the animal and never crosses the cuticle.
    const mid = Math.max(0, 1 - wa - wb);
    if (mid > 0) {
      const r = this.radiusAt(x) * mid;
      out.y += offY * r;
      out.z += offZ * r;
    }
  }

  /** Smoothstep, so a connector eases onto the midline instead of kinking. */
  private static ease(s: number): number { return s * s * (3 - 2 * s); }

  /** Name -> index, the only way the UI addresses a specific cell. */
  labelIndex(name: string): number { return this.names.indexOf(name); }
}
