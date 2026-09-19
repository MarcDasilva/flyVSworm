// The live 3D fly brain: hemibrain neurons in a full-brain outline, glowing with their firing, and
// the circuit's measured synapses lit by their presynaptic neuron's spikes. Plain three.js; the
// React wrapper (BrainCanvas) only mounts and disposes it. Assets come from fly-brain/python/bake_3d.py.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { SpikeBlock } from "@/lib/chainEvent";
import { connectLocalFeed, type BrainInfo } from "@/lib/chainFeed";

export type ScenePhase = "loading" | "connecting" | "live" | "offline" | "error";
export interface SceneStatus { phase: ScenePhase; message?: string }

const ASSETS = "/brain";
const RATE_TAU_MS = 60;       // spike trace time constant: trace / tau = the neuron's recent firing rate
const RATE_LOW_HZ = 20;       // glow ramps from dark at RATE_LOW_HZ to full at RATE_HIGH_HZ, so the heading
const RATE_HIGH_HZ = 200;     // bump (EPG at 200+ Hz) stands out from background firing
const FLICKER_TAU_MS = 12;    // each spike adds a brief flicker on top of the rate glow
const BUFFER_BLOCKS = 2;      // blocks held before playback starts: absorbs network (later: block) jitter
const MAX_LAG_BLOCKS = 6;     // if playback falls further behind than this, it skips ahead
const FOV = 35;
const BACKGROUND = 0x07080b;
const OUTLINE_COLOR = 0x8fa3b8;
const CONTEXT_COLOR = 0x7c828a;

interface Manifest {
  spec: string;
  neurons: { index: number; node: string; body_id: number; pop: string }[];
  populations: Record<string, { color: string }>;
  context: { node: string }[];
  rois: { node: string }[];
  outline: { node: string };
  synapses: { file: string; count: number };
  views: Record<"brain" | "cx", { target: number[]; radius: number }>;
}

const SYNAPSE_VERTEX = /* glsl */ `
  uniform sampler2D uNeurons;  // per presynaptic neuron: rgb = population colour, a = activity (0..1)
  uniform float uN;
  uniform float uScale;        // pixels per world unit at depth 1
  attribute float aPre;
  varying vec3 vColor;
  varying float vFlash;
  void main() {
    vec4 nd = texture2D(uNeurons, vec2((aPre + 0.5) / uN, 0.5));
    vColor = nd.rgb;
    vFlash = nd.a;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uScale * (0.7 + 1.3 * vFlash) / -mv.z, 1.0, 12.0);
  }`;

// Additive: overlapping synapses add up, so the per-point alpha stays low to keep dense neuropil
// (tens of thousands of synapses in the ellipsoid body) from saturating to white.
const SYNAPSE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vFlash;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    float soft = 1.0 - 4.0 * r;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.25 * vFlash) * soft, (0.02 + 0.33 * vFlash) * soft);
  }`;

export function createBrainScene(container: HTMLElement, onStatus: (s: SceneStatus) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));  // integrated graphics: cap the fill cost
  renderer.setClearColor(BACKGROUND);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.addEventListener("start", () => { controls.autoRotate = false; });
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(300, 500, 700);
  scene.add(sun);

  let disposed = false;
  let manifest: Manifest | null = null;
  let feed: { close(): void } | null = null;
  let neuronMaterials: THREE.MeshStandardMaterial[] = [];
  let neuronData: Float32Array | null = null;
  let neuronTexture: THREE.DataTexture | null = null;
  let synapseMaterial: THREE.ShaderMaterial | null = null;
  let lastSpike = new Float64Array(0);   // tick of each neuron's latest spike
  let trace = new Float64Array(0);       // spike trace at traceTick: +1 per spike, decays with RATE_TAU_MS
  let traceTick = new Float64Array(0);
  const queue: SpikeBlock[] = [];
  let cursor = 0;          // next spike of queue[0] to apply
  let clock = -1;          // brain tick on screen (1 tick = 1 ms); -1 until playback starts
  let blockTicks = 100;
  let tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null;
  let view: "brain" | "cx" = "brain";

  const viewPose = (name: "brain" | "cx") => {
    const v = manifest!.views[name];
    const target = new THREE.Vector3(...(v.target as [number, number, number]));
    const dist = (v.radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 0.95;
    const dir = new THREE.Vector3(0.28, 0.18, 1).normalize();  // from the front, a little above and to the side
    return { target, position: target.clone().addScaledVector(dir, dist) };
  };

  const flyTo = (name: "brain" | "cx") => {
    const pose = viewPose(name);
    tween = { from: camera.position.clone(), to: pose.position, fromT: controls.target.clone(), toT: pose.target, t: 0 };
    view = name;
  };

  const resize = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (synapseMaterial) {
      synapseMaterial.uniforms.uScale.value =
        renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const onDoubleClick = () => { if (manifest) flyTo(view === "brain" ? "cx" : "brain"); };
  renderer.domElement.addEventListener("dblclick", onDoubleClick);

  function onBrain(info: BrainInfo) {
    const m = manifest!;
    const same = info.n_neurons === m.neurons.length && m.neurons.every((n, i) => n.body_id === info.body_id[i]);
    if (!same) {
      onStatus({ phase: "error", message: `The fly runs ${info.spec}, but the baked brain is for ${m.spec}: re-run bake_3d.py.` });
      feed?.close();
      return;
    }
    blockTicks = info.ticks_per_block;
  }

  function onBlock(b: SpikeBlock) {
    if (b.nNeurons !== lastSpike.length) {
      onStatus({ phase: "error", message: `The fly sent ${b.nNeurons} neurons; the baked brain has ${lastSpike.length}.` });
      feed?.close();
      return;
    }
    const last = queue[queue.length - 1];
    if ((last && b.firstTick < last.firstTick) || (clock >= 0 && b.firstTick + b.nTicks <= clock)) {
      queue.length = 0;  // a new fly (the connection restarted): start over
      cursor = 0;
      clock = -1;
      lastSpike.fill(-1e9);
      trace.fill(0);
      traceTick.fill(0);
    }
    queue.push(b);
  }

  // Move the playback clock and apply every spike up to it.
  function advance(dtMs: number) {
    if (clock < 0) {
      if (queue.length < BUFFER_BLOCKS) return;
      clock = queue[0].firstTick;
    }
    const tail = queue[queue.length - 1];
    const end = tail ? tail.firstTick + tail.nTicks : clock;
    if (end - clock > MAX_LAG_BLOCKS * blockTicks) clock = end - BUFFER_BLOCKS * blockTicks;
    clock = Math.min(clock + dtMs, end);  // stall, rather than run ahead, if the feed is late
    while (queue.length) {
      const b = queue[0];
      while (cursor < b.spikeTick.length && b.spikeTick[cursor] <= clock) {
        const i = b.spikeNeuron[cursor], t = b.spikeTick[cursor];
        trace[i] = trace[i] * Math.exp(-(t - traceTick[i]) / RATE_TAU_MS) + 1;
        traceTick[i] = t;
        lastSpike[i] = t;
        cursor++;
      }
      if (cursor < b.spikeTick.length || clock < b.firstTick + b.nTicks) break;
      queue.shift();
      cursor = 0;
    }
  }

  // Neuron glow = recent firing rate through a ramp; synapses = that plus a flicker per presynaptic spike.
  function paint() {
    if (!neuronData || !neuronTexture) return;
    for (let i = 0; i < neuronMaterials.length; i++) {
      const live = clock >= 0;
      const hz = live ? (trace[i] * Math.exp(-(clock - traceTick[i]) / RATE_TAU_MS)) * (1000 / RATE_TAU_MS) : 0;
      const glow = THREE.MathUtils.smoothstep(hz, RATE_LOW_HZ, RATE_HIGH_HZ);
      const flicker = live ? Math.exp(-(clock - lastSpike[i]) / FLICKER_TAU_MS) : 0;
      neuronMaterials[i].emissiveIntensity = 0.04 + 1.3 * glow + 0.25 * flicker;
      neuronData[4 * i + 3] = Math.min(1, 0.8 * glow + 0.35 * flicker);
    }
    neuronTexture.needsUpdate = true;
  }

  async function load() {
    onStatus({ phase: "loading" });
    const [m, gltf, synBuf] = await Promise.all([
      fetch(`${ASSETS}/brain.json`).then((r) => r.json() as Promise<Manifest>),
      new GLTFLoader().loadAsync(`${ASSETS}/brain.glb`),
      fetch(`${ASSETS}/synapses.bin`).then((r) => r.arrayBuffer()),
    ]);
    if (disposed) {  // closed while loading: free what arrived
      gltf.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      return;
    }
    manifest = m;
    const n = m.neurons.length;
    lastSpike = new Float64Array(n).fill(-1e9);
    trace = new Float64Array(n);
    traceTick = new Float64Array(n);

    const byName = new Map<string, THREE.Mesh>();
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) byName.set(o.name, o as THREE.Mesh); });
    const mesh = (node: string) => {
      const found = byName.get(node);
      if (!found) throw new Error(`brain.glb has no node ${node}`);
      return found;
    };

    const shell = (opacity: number) => new THREE.MeshStandardMaterial({
      color: OUTLINE_COLOR, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
    mesh(m.outline.node).material = shell(0.06);
    mesh(m.outline.node).renderOrder = 3;
    for (const r of m.rois) { mesh(r.node).material = shell(0.1); mesh(r.node).renderOrder = 2; }
    const contextMaterial = new THREE.MeshStandardMaterial({
      color: CONTEXT_COLOR, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.9 });
    for (const c of m.context) { mesh(c.node).material = contextMaterial; mesh(c.node).renderOrder = 1; }

    neuronData = new Float32Array(4 * n);
    neuronMaterials = new Array(n);
    for (const nr of m.neurons) {  // indexed by model neuron index, the index spikes carry
      if (!(nr.index >= 0 && nr.index < n) || neuronMaterials[nr.index]) throw new Error(`bad neuron index ${nr.index}`);
      const color = new THREE.Color(m.populations[nr.pop].color);
      neuronData.set([color.r, color.g, color.b, 0], 4 * nr.index);
      neuronMaterials[nr.index] = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.35), emissive: color, emissiveIntensity: 0.04, roughness: 0.55 });
      mesh(nr.node).material = neuronMaterials[nr.index];
    }
    neuronTexture = new THREE.DataTexture(neuronData, n, 1, THREE.RGBAFormat, THREE.FloatType);
    neuronTexture.minFilter = neuronTexture.magFilter = THREE.NearestFilter;
    neuronTexture.needsUpdate = true;
    scene.add(gltf.scene);

    const count = m.synapses.count;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(synBuf, 0, 3 * count), 3));
    geometry.setAttribute("aPre", new THREE.BufferAttribute(new Uint16Array(synBuf, 12 * count, count), 1));
    synapseMaterial = new THREE.ShaderMaterial({
      uniforms: { uNeurons: { value: neuronTexture }, uN: { value: n }, uScale: { value: 1 } },
      vertexShader: SYNAPSE_VERTEX, fragmentShader: SYNAPSE_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geometry, synapseMaterial);
    points.renderOrder = 4;
    scene.add(points);

    const pose = viewPose("brain");
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    resize();
    flyTo("cx");  // open on the whole brain, then settle on the central complex

    onStatus({ phase: "connecting" });
    let feedError = false;  // a bad event stays on screen until the next (re)connect, not just one frame
    feed = connectLocalFeed({
      onBrain,
      onBlock,
      onStatus: (s) => {
        if (s === "connecting") feedError = false;
        if (!disposed && !(feedError && s === "live")) onStatus({ phase: s });
      },
      onError: (message) => {
        feedError = true;
        if (!disposed) onStatus({ phase: "error", message });
      },
    });
  }

  let previous = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(100, now - previous);  // a hidden tab or a slow frame never jumps the brain ahead
    previous = now;
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 1600);
      const k = tween.t * tween.t * (3 - 2 * tween.t);
      camera.position.lerpVectors(tween.from, tween.to, k);
      controls.target.lerpVectors(tween.fromT, tween.toT, k);
      if (tween.t >= 1) tween = null;
    }
    advance(dt);
    paint();
    controls.update();
    renderer.render(scene, camera);
  });

  load().catch((e) => { if (!disposed) onStatus({ phase: "error", message: String(e?.message ?? e) }); });

  return {
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      feed?.close();
      observer.disconnect();
      renderer.domElement.removeEventListener("dblclick", onDoubleClick);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      neuronTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
