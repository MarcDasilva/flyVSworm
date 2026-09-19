import * as THREE from "three";

const COLD = new THREE.Color(0x2b6cb0);   // -80 mV
const HOT = new THREE.Color(0xe53e3e);    // +20 mV
const EXCITATORY = new THREE.Color(0xfbbf24);
const INHIBITORY = new THREE.Color(0x60a5fa);

const SPAN = 1.9;      // anterior-posterior extent, ~2 worms wide so it reads
const HEIGHT = 1.05;   // hovers above the agar in body lengths
const GIRTH = 0.24;    // dorsoventral and left-right scale
const NODE_R = 0.016;
const PARTICLE_R = 0.013;
const PARTICLE_SPEED = 1.6;   // traversals per second
const MAX_PARTICLES = 192;

/**
 * 302 neurons at their real anatomical coordinates, with the strongest
 * chemical edges behind them.
 *
 * The layout is the ganglion map from the pipeline and must NEVER become a
 * force-directed graph: a spring layout of this connectome is a hairball that
 * tells a viewer nothing, while the anatomical one is instantly legible as a
 * worm — nerve ring at the head, ventral cord down the body, tail ganglia at
 * the back. Anterior is +x, matching the worm below, which starts out crawling
 * toward +x.
 */
export class BrainCloud {
  readonly group = new THREE.Group();
  private readonly nodes: THREE.InstancedMesh;
  private readonly colors: Float32Array;
  private readonly pos: THREE.Vector3[];
  private readonly particles: THREE.InstancedMesh;
  /** t >= 1 means the slot is free. Fixed pool — see fireEdge. */
  private readonly live: { t: number; a: number; b: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Vector3(0, 0, 0);
  private readonly scratch = new THREE.Color();

  constructor(scene: THREE.Scene,
              positions: [number, number, number][],
              private readonly names: string[],
              edges: [number, number][]) {
    // positions.json is [ap, dorsoventral, left-right] with ap = 0 at the NOSE,
    // so ap maps to -x to put the head forward.
    this.pos = positions.map(p => new THREE.Vector3(
      (0.5 - p[0]) * SPAN, HEIGHT + p[1] * GIRTH, p[2] * GIRTH));

    this.nodes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(NODE_R, 8, 8),
      // NEVER vertexColors here: that define makes the vertex shader multiply
      // by a `color` attribute this geometry does not have, WebGL supplies
      // zero, and all 302 neurons render BLACK. instanceColor alone is what
      // tints an InstancedMesh.
      new THREE.MeshBasicMaterial(),
      positions.length);
    this.colors = new Float32Array(positions.length * 3);
    this.pos.forEach((p, i) => {
      this.nodes.setMatrixAt(i, this.m.makeTranslation(p.x, p.y, p.z));
      COLD.toArray(this.colors, i * 3);
    });
    this.nodes.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.nodes.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.nodes);

    const line: THREE.Vector3[] = [];
    for (const [a, b] of edges) {
      if (!this.pos[a] || !this.pos[b]) continue;
      line.push(this.pos[a], this.pos[b]);
    }
    this.group.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(line),
      new THREE.LineBasicMaterial({
        color: 0x3f5f7a, transparent: true, opacity: 0.14 })));

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

  /** Membrane potential per neuron, index-aligned with names.json. */
  setVoltages(mV: Int16Array): void {
    const n = Math.min(mV.length, this.pos.length);
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, (mV[i] + 80) / 100));
      this.scratch.copy(COLD).lerp(HOT, t).toArray(this.colors, i * 3);
    }
    (this.nodes.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * One synaptic transfer, animated pre -> post. Indices come off the chain in
   * Task 15 and an out-of-range one must NEVER take the render loop down with
   * it, so a bad edge is dropped silently.
   */
  fireEdge(pre: number, post: number, excitatory = true): void {
    if (!this.pos[pre] || !this.pos[post]) return;
    let slot = -1, oldest = -1;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.live[i].t >= 1) { slot = i; break; }
      if (oldest < 0 || this.live[i].t > this.live[oldest].t) oldest = i;
    }
    if (slot < 0) slot = oldest;
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
      this.v.lerpVectors(this.pos[p.a], this.pos[p.b], p.t);
      this.particles.setMatrixAt(i, this.m.compose(this.v, this.q, this.one));
    }
    if (any) this.particles.instanceMatrix.needsUpdate = true;
  }

  /** Name -> index, the only way the UI addresses a specific cell. */
  labelIndex(name: string): number { return this.names.indexOf(name); }
}
