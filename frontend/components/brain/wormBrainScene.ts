// The worm's brain, maximized: all 302 neurons with their traced arbors, from the standalone worm
// app's own BrainCloud (@worm/brain) and the same data files it serves. Plain three.js; the React
// wrapper (WormBrainCanvas) only mounts and disposes it.
//
// The geometry is the OpenWorm NeuroML2 tracing, NOT a layout — see brain.ts. Nothing here may
// move a neuron.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BrainCloud, parseMorphology } from "@worm/brain";

export type ScenePhase = "loading" | "anatomy" | "error";
export interface WormSceneStatus { phase: ScenePhase; message?: string }

const ASSETS = "/worm";
const BACKGROUND = 0x07080b;
const FOV = 35;

export function createWormBrainScene(
  container: HTMLElement,
  onStatus: (s: WormSceneStatus) => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(BACKGROUND);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;

  let brain: BrainCloud | null = null;
  let disposed = false;
  const size = new THREE.Vector3();
  const EYE = new THREE.Vector3(0.1, 0.55, 1).normalize();   // three-quarters from above
  const MARGIN = 1.3;   // the box is fitted head-on; autoRotate swings the animal wider than that

  /**
   * Fits the animal's BOX, not its bounding sphere. The worm is ~5x longer than it is deep, and a
   * sphere fitted to the vertical FOV leaves it a thread across the middle of the screen; the box
   * is what puts its length across the width. Re-run on resize because the horizontal FOV, and so
   * the answer, depends on the aspect.
   */
  const place = () => {
    if (!brain) return;
    brain.bounds.getSize(size);
    const vFov = (FOV * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = MARGIN * Math.max(
      Math.max(size.x, size.z) / 2 / Math.tan(hFov / 2),
      size.y / 2 / Math.tan(vFov / 2),
    );
    camera.position.copy(controls.target).addScaledVector(EYE, dist);
    controls.update();
  };

  // LineMaterial measures neurite width in PIXELS, so it has to be told the canvas size — miss
  // this and every arbor renders as a hairline that vanishes on a high-DPI screen.
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    brain?.setResolution(w, h);
    place();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  onStatus({ phase: "loading" });
  Promise.all([
    fetch(`${ASSETS}/positions.json`).then((r) => r.json()) as Promise<[number, number, number][]>,
    fetch(`${ASSETS}/names.json`).then((r) => r.json()) as Promise<string[]>,
    fetch(`${ASSETS}/morphology.bin`).then((r) => r.arrayBuffer()).then(parseMorphology),
  ]).then(
    ([positions, names, morphology]) => {
      if (disposed) return;
      brain = new BrainCloud(scene, positions, names, morphology);
      // brain.bounds, NEVER Box3.setFromObject(brain.group) — the firing pool's unused slots sit
      // at the origin and would frame the camera on empty agar instead of on the animal.
      brain.bounds.getCenter(controls.target);
      resize();
      onStatus({ phase: "anatomy" });
    },
    (err: unknown) => {
      if (!disposed) onStatus({ phase: "error", message: `Could not load the worm's brain: ${err instanceof Error ? err.message : err}` });
    },
  );

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    // No chain feed in this app yet, so no voltages and no firing connectors — tick still runs so
    // the decay is correct the moment one is wired in. See wormTank.ts's ponytail note.
    brain?.tick(Math.min(timer.getDelta(), 0.1));
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      timer.dispose();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        for (const mat of [m.material].flat() as THREE.Material[]) mat?.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
