// The launcher scene: the fly at its desk typing trades into the computer. Plain three.js, driven
// imperatively from the Launcher component. Clicking the fly calls `onFlyClick`.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createFlyRig, type FlyRig } from "./flyRig";
import { createStandInComputer, type Computer } from "./computer";
import { TradingScreen } from "./tradingScreen";

export const FLY_URL = "/models/fly.glb";

export interface FlySceneEvents {
  onReady(): void;
  onError(message: string): void;
  onHover(over: boolean): void;
  onFlyClick(): void;
}

export interface FlyScene {
  /** Stop rendering (e.g. while the brain modal covers the page). */
  setPaused(paused: boolean): void;
  dispose(): void;
}

const BACKGROUND = new THREE.Color("#07090d");
const TARGET = new THREE.Vector3(0, 1.7, 2.4);
const VIEW_DIR = new THREE.Vector3(0.72, 0.4, -0.58).normalize(); // from the target toward the camera
const DISTANCE = 13;
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
  scene.fog = new THREE.Fog(BACKGROUND, 16, 34);
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
  key.shadow.camera.left = key.shadow.camera.bottom = -7;
  key.shadow.camera.right = key.shadow.camera.top = 7;
  key.shadow.camera.far = 30;
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
  let hovering = false;
  const parallax = new THREE.Vector2();       // smoothed pointer, drives a slight camera sway

  const toPointer = (e: PointerEvent | MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const flyUnderPointer = () => {
    if (!fly) return false;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(fly.meshes, false).length > 0;
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
    if (flyUnderPointer()) events.onFlyClick();
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
    // pull back on narrow screens so the fly and the screen both stay in frame
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
      const over = pointerInside && flyUnderPointer();
      if (over !== hovering) {
        hovering = over;
        fly?.setHighlight(over);
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
