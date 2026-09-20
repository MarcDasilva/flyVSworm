// The computer the fly types on. Until the real model (public/models/computer.glb) arrives this
// builds a stand-in from rounded boxes: a monitor showing the trading chart and a keyboard whose
// keys dip and light up when a leg strikes them.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export interface Computer {
  group: THREE.Group;
  /** World height of the key tops, where the fly's front legs rest. */
  keyTopY: number;
  /** A leg struck the keyboard at this world point. */
  press(at: THREE.Vector3): void;
  update(dt: number): void;
  dispose(): void;
}

const COLS = 14;
const ROWS = 5;
const PITCH = 0.3;            // key spacing
const KEY = 0.25;             // key cap size
const KEY_H = 0.06;
const BASE_H = 0.08;
const PRESS_DEPTH = 0.03;
const PRESS_SECONDS = 0.28;

const KEY_COLOR = new THREE.Color("#262b34");
const KEY_LIT = new THREE.Color("#5eead4");

/**
 * Keyboard centred under `keyboardCenter` (x, z on the desk at y = 0), monitor behind it facing -Z,
 * i.e. toward a fly that faces +Z.
 */
export function createStandInComputer(keyboardCenter: THREE.Vector3, screen: THREE.Texture): Computer {
  const group = new THREE.Group();
  group.position.set(keyboardCenter.x, 0, keyboardCenter.z);

  const shell = new THREE.MeshStandardMaterial({ color: "#1b1f27", roughness: 0.45, metalness: 0.35 });

  // keyboard
  const kbW = COLS * PITCH + 0.3;
  const kbD = ROWS * PITCH + 0.3;
  const base = new THREE.Mesh(new RoundedBoxGeometry(kbW, BASE_H, kbD, 3, 0.03), shell);
  base.position.y = BASE_H / 2;
  base.castShadow = base.receiveShadow = true;
  group.add(base);

  const keyGeo = new RoundedBoxGeometry(KEY, KEY_H, KEY, 2, 0.02);
  const keyMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, metalness: 0.1 });
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, COLS * ROWS);
  keys.castShadow = keys.receiveShadow = true;
  const keyPos: THREE.Vector3[] = [];
  const pressed = new Float32Array(COLS * ROWS); // seconds left on each key's press
  const m = new THREE.Matrix4();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      keyPos.push(new THREE.Vector3((c - (COLS - 1) / 2) * PITCH, BASE_H + KEY_H / 2, (r - (ROWS - 1) / 2) * PITCH));
      keys.setMatrixAt(i, m.makeTranslation(keyPos[i]));
      keys.setColorAt(i, KEY_COLOR);
    }
  }
  group.add(keys);

  // monitor: stand, neck, bezel, screen
  const screenW = 5.6;
  const screenH = 3.5;
  const monitorZ = kbD / 2 + 1.1;
  const screenY = 2.75;
  const standBase = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.08, 1.1, 3, 0.03), shell);
  standBase.position.set(0, 0.04, monitorZ + 0.25);
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.4, screenY, 0.14, 3, 0.05), shell);
  neck.position.set(0, screenY / 2, monitorZ + 0.3);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(screenW + 0.24, screenH + 0.24, 0.16, 4, 0.06), shell);
  bezel.position.set(0, screenY, monitorZ);
  for (const part of [standBase, neck, bezel]) {
    part.castShadow = part.receiveShadow = true;
    group.add(part);
  }
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }),
  );
  display.rotation.y = Math.PI; // face -Z, toward the fly
  display.position.set(0, screenY, monitorZ - 0.081);
  group.add(display);

  // the screen lights the fly
  const glow = new THREE.PointLight("#5eead4", 5, 0, 2);
  glow.position.set(0, screenY - 0.4, monitorZ - 1.2);
  group.add(glow);

  const local = new THREE.Vector3();
  const color = new THREE.Color();

  return {
    group,
    keyTopY: BASE_H + KEY_H,
    press(at) {
      group.worldToLocal(local.copy(at));
      let best = 0;
      let bestD = Infinity;
      keyPos.forEach((p, i) => {
        const d = (p.x - local.x) ** 2 + (p.z - local.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (bestD < PITCH * PITCH) pressed[best] = PRESS_SECONDS;
    },
    update(dt) {
      let changed = false;
      for (let i = 0; i < pressed.length; i++) {
        if (pressed[i] <= 0) continue;
        pressed[i] = Math.max(0, pressed[i] - dt);
        const k = pressed[i] / PRESS_SECONDS; // 1 at the strike, 0 when released
        m.makeTranslation(keyPos[i].x, keyPos[i].y - PRESS_DEPTH * Math.min(1, k * 2), keyPos[i].z);
        keys.setMatrixAt(i, m);
        keys.setColorAt(i, color.copy(KEY_COLOR).lerp(KEY_LIT, k));
        changed = true;
      }
      if (changed) {
        keys.instanceMatrix.needsUpdate = true;
        keys.instanceColor!.needsUpdate = true;
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      keys.dispose();
    },
  };
}
