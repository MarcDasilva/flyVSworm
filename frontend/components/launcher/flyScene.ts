// The launcher scene: the fly at its desk typing trades into the computer, with the worm's
// terrarium across the desk from it. Plain three.js, driven imperatively from the Launcher
// component. Clicking either animal calls `onPick` with which one it was.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createFlyRig, type FlyRig } from "./flyRig";
import { createStandInComputer, type Computer } from "./computer";
import { createWormTank, type WormTank } from "./wormTank";
import { TradingScreen } from "./tradingScreen";

export const FLY_URL = "/models/fly.glb";

/** Which animal the pointer is on. Each one opens its own brain. */
export type Subject = "fly" | "worm";

export interface FlySceneEvents {
  onReady(): void;
  onError(message: string): void;
  onHover(subject: Subject | null): void;
  onPick(subject: Subject): void;
}

export interface FlyScene {
  /** Stop rendering (e.g. while the brain modal covers the page). */
  setPaused(paused: boolean): void;
  dispose(): void;
}

const BACKGROUND = new THREE.Color("#07090d");
// The fly is at z = 0 facing +Z and its monitor is at z ~ 4, so the tank goes on the far side of
// both: the fly types, and what it is looking past its screen at is the worm. Kept on x = 0 so the
// two animals are square to each other.
const TANK_AT = new THREE.Vector3(0, 0, 10.5);
const TARGET = new THREE.Vector3(0, 1.8, 5);
// Swung well round toward +X from the old head-on shot. Nearly side-on is what clears the monitor
// out of the tank's line of sight — head-on, the screen stands squarely in front of the worm. The
// residual -Z keeps the trading chart facing the camera enough to read.
const VIEW_DIR = new THREE.Vector3(0.82, 0.35, -0.46).normalize(); // from the target toward the camera
const DISTANCE = 19;
const ZERO = new THREE.Vector2();

export function createFlyScene(container: HTMLElement, events: FlySceneEvents): FlyScene {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch {
    events.onError("WebGL is not available in this browser.");
    return { setPaused() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = BACKGROUND;
  // Pushed back past the tank: the old 16 started fogging at the monitor, which put the worm
  // behind a haze the moment it moved to the far side of the desk.
  scene.fog = new THREE.Fog(BACKGROUND, 30, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  // lights: warm key from above-left, cool rim from behind, the screen glow comes with the computer
  scene.add(new THREE.HemisphereLight("#9fb6ff", "#0b0b0b", 0.45));
  const key = new THREE.DirectionalLight("#ffe6c7", 2.4);
  key.position.set(-5, 10, -4);
  key.target.position.set(0, 0, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  // Wide enough to reach the tank as well as the keyboard — sized to the set, not to the fly.
  key.shadow.camera.left = key.shadow.camera.bottom = -16;
  key.shadow.camera.right = key.shadow.camera.top = 16;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight("#7aa2ff", 1.2);
  rim.position.set(-6, 4, 9);
  scene.add(rim);

  // desk
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.4, 24),
    new THREE.MeshStandardMaterial({ color: "#14171c", roughness: 0.55, metalness: 0.1 }),
  );
  desk.position.set(0, -0.2, 2);
  desk.receiveShadow = true;
  scene.add(desk);

  const tank: WormTank = createWormTank(TANK_AT);
  scene.add(tank.group);

  const screen = new TradingScreen();
  screen.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  let fly: FlyRig | null = null;
  let computer: Computer | null = null;
  let disposed = false;

  new GLTFLoader().loadAsync(FLY_URL).then(
    (gltf) => {
      if (disposed) return;
      fly = createFlyRig(gltf.scene, (foot) => {
        computer?.press(foot);
        screen.keystroke();
      });
      scene.add(fly.root);
      const [right, left] = fly.feet();
      computer = createStandInComputer(right.clone().add(left).multiplyScalar(0.5), screen.texture);
      scene.add(computer.group);
      fly.restFeetAt(computer.keyTopY);
      renderer.compileAsync(scene, camera).then(() => {
        if (!disposed) events.onReady();
      });
    },
    (err: unknown) => {
      if (!disposed) events.onError(`Could not load ${FLY_URL}: ${err instanceof Error ? err.message : err}`);
    },
  );

  // picking: hover highlight + click
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerInside = false;
  let pointerMoved = false;
  let hovering: Subject | null = null;
  const parallax = new THREE.Vector2();       // smoothed pointer, drives a slight camera sway

  const toPointer = (e: PointerEvent | MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  // Nearest hit wins across both animals, so the answer stays right if the tank ever ends up in
  // front of the fly — comparing "did the fly hit" against "did the worm hit" would not.
  const underPointer = (): Subject | null => {
    raycaster.setFromCamera(pointer, camera);
    const flyHit = fly ? raycaster.intersectObjects(fly.meshes, false)[0] : undefined;
    const wormHit = raycaster.intersectObjects(tank.meshes, false)[0];
    if (!flyHit) return wormHit ? "worm" : null;
    if (!wormHit) return "fly";
    return wormHit.distance < flyHit.distance ? "worm" : "fly";
  };
  const onPointerMove = (e: PointerEvent) => {
    toPointer(e);
    pointerInside = true;
    pointerMoved = true;
  };
  const onPointerLeave = () => {
    pointerInside = false;
    pointerMoved = true;
  };
  const onClick = (e: MouseEvent) => {
    toPointer(e);
    const hit = underPointer();
    if (hit) events.onPick(hit);
  };
  const canvas = renderer.domElement;
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);

  let distance = DISTANCE;
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // pull back on narrow screens so the fly, the screen and the tank all stay in frame
    distance = DISTANCE * Math.max(1, 1.3 / camera.aspect);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const timer = new THREE.Timer();
  timer.connect(document);
  const eye = new THREE.Vector3();

  const frame = (time: number) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1); // no catch-up burst after a pause

    if (pointerMoved) {
      pointerMoved = false;
      const over = pointerInside ? underPointer() : null;
      if (over !== hovering) {
        hovering = over;
        fly?.setHighlight(over === "fly");
        tank.setHighlight(over === "worm");
        canvas.style.cursor = over ? "pointer" : "";
        events.onHover(over);
      }
    }

    parallax.lerp(pointerInside ? pointer : ZERO, 1 - Math.exp(-2 * dt));
    eye.copy(VIEW_DIR).multiplyScalar(distance).add(TARGET);
    eye.x += parallax.x * 0.8;
    eye.y += parallax.y * 0.5;
    camera.position.copy(eye);
    camera.lookAt(TARGET);

    fly?.update(dt);
    tank.update(dt);
    computer?.update(dt);
    screen.update(dt);
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  return {
    setPaused(paused) {
      if (disposed) return;
      renderer.setAnimationLoop(paused ? null : frame);
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      timer.dispose();
      fly?.dispose();
      tank.dispose();
      computer?.dispose();
      screen.dispose();
      desk.geometry.dispose();
      desk.material.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
