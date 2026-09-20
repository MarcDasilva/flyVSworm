// The terrarium on the far side of the desk, with the worm crawling in it. The tank, the body
// integrator and the animal's mesh are the standalone worm app's own modules (../../wormed/web/src,
// aliased @worm/*) — this file only stands them on the fly's desk and picks the gait.

import * as THREE from "three";
import { WormBody, BEHAVIOR, type BehaviorState } from "@worm/body";
import { WormMesh } from "@worm/worm";
import { ARENA, SOIL_D, buildTerrarium } from "@worm/props";

/** Tank units are body lengths and the worm is 1.0 long; the fly is ~4 wide with its legs, so at
 *  this scale a 1 mm worm reads about a third of a 3 mm fly — which is the real ratio. */
const SCALE = 2.2;

export interface WormTank {
  group: THREE.Group;
  /** Raycast targets for hover and click. */
  meshes: THREE.Mesh[];
  setHighlight(on: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

// ponytail: the launcher gait is LOCAL, not the chain's. The standalone app's ChainFeed
// (@worm/chain) reads events straight from the Thru node with no relay in the path, so wiring it
// here is a constructor and one onBehavior callback — do that before this scene claims on-chain
// anything, and keep Launcher's "demo gait" caption honest until then.
const BURST_SECONDS = 9;       // forward run before the worm reconsiders
const TURN_SECONDS = 1.2;      // one omega turn, matching body.ts's OMEGA_SECONDS budget
const PAUSE_SECONDS = 1.6;

/** Stands the tank at `position`, sunk so its slab rests ON the desk plane (y = 0). */
export function createWormTank(position: THREE.Vector3): WormTank {
  const group = new THREE.Group();
  buildTerrarium(group, { plinth: false, grid: false });
  group.scale.setScalar(SCALE);
  // The slab hangs SOIL_D below the soil surface, and it is the soil surface that sits at the
  // group's origin — so the lift is the slab depth, scaled, or the tank sinks into the desk.
  group.position.set(position.x, position.y + SOIL_D * SCALE, position.z);

  const body = new WormBody(24, ARENA);
  const worm = new WormMesh(group as unknown as THREE.Scene);

  const meshes: THREE.Mesh[] = [];
  const materials = new Set<THREE.MeshStandardMaterial>();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = o.receiveShadow = true;
  });
  // Only the ANIMAL is clickable. Hovering the dirt and being told you can see a brain is a lie
  // about what is under the pointer.
  worm.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes.push(o);
    for (const m of [o.material].flat()) if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
  });
  const baseEmissive = new Map([...materials].map((m) => [m, m.emissive.clone()]));
  const hoverEmissive = new THREE.Color("#12383a");

  let t = 0;
  let phaseEnds = BURST_SECONDS;
  let behavior: BehaviorState = { state: BEHAVIOR.FORWARD, gain: 1 };

  return {
    group,
    meshes,
    setHighlight(on) {
      for (const [m, base] of baseEmissive) m.emissive.copy(on ? hoverEmissive : base);
    },
    update(dt) {
      t += dt;
      if (t >= phaseEnds) {
        if (behavior.state === BEHAVIOR.FORWARD) {
          behavior = { state: BEHAVIOR.OMEGA, gain: 0.8 + Math.random() * 0.5 };
          phaseEnds = t + TURN_SECONDS;
        } else if (behavior.state === BEHAVIOR.OMEGA) {
          behavior = { state: BEHAVIOR.PAUSE, gain: 0 };
          phaseEnds = t + PAUSE_SECONDS;
        } else {
          behavior = { state: BEHAVIOR.FORWARD, gain: 0.8 + Math.random() * 0.4 };
          phaseEnds = t + BURST_SECONDS * (0.6 + Math.random() * 0.8);
        }
      }
      body.update(dt, behavior);
      worm.update(body.points);
    },
    dispose() {
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Line)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat() as THREE.Material[]) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
