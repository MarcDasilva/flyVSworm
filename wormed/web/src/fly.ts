// The fly at its own desk (data/fly.glb: "Fly" by victorberdugo1, CC BY 4.0), copied from the
// launcher app's flyRig together with the computer it types on. It is its OWN setup, at its own
// scale: it does not use the worm's MacBook and nothing about it is derived from the terrarium.
//
// The model has no skeleton or animation clips, but it keeps its 3ds node hierarchy: every leg is
// a chain of 8 segment nodes whose origins sit on the joints (front legs FLYPAT09 right, FLYPAT41
// left; head FLYCAB). Typing = rotating the hip and knee of each front leg, driven by a
// burst/pause keystroke rhythm.

import * as THREE from "three";
import { createStandInComputer, MONITOR_BACK, type Computer } from "./computer.js";
import { TradingScreen } from "./tradingScreen.js";

/** Model units to scene units, unchanged from the launcher. Scene units here are worm body
 *  lengths, so this makes the insect several worms long — which is the point. The two animals are
 *  separate exhibits facing each other, NOT one scene at one scale. */
const SCALE = 0.001;
const FRONT_LEGS = ["FLYPAT09", "FLYPAT41"] as const;
const KNEE = 2;                       // chain index of the femur-tibia joint
const UP = new THREE.Vector3(0, 1, 0);

const LIFT = THREE.MathUtils.degToRad(7);     // hip lift at the top of a tap
const CURL = THREE.MathUtils.degToRad(9);     // knee lift at the top of a tap
const REACH = THREE.MathUtils.degToRad(5);    // sideways aim, re-picked every tap

/** A node that rotates about fixed axes (given in world space at rest) on top of its rest pose. */
class Joint {
  private readonly rest: THREE.Quaternion;
  private readonly q = new THREE.Quaternion();

  constructor(readonly node: THREE.Object3D) {
    this.rest = node.quaternion.clone();
  }

  /** `worldAxis` expressed in the node's parent frame, the frame its quaternion lives in. */
  axis(worldAxis: THREE.Vector3): THREE.Vector3 {
    const parentQ = this.node.parent!.getWorldQuaternion(new THREE.Quaternion());
    return worldAxis.clone().applyQuaternion(parentQ.invert()).normalize();
  }

  set(...turns: [axis: THREE.Vector3, angle: number][]) {
    this.node.quaternion.copy(this.rest);
    for (const [axis, angle] of turns) this.node.quaternion.premultiply(this.q.setFromAxisAngle(axis, angle));
  }
}

class Leg {
  readonly hip: Joint;
  readonly knee: Joint;
  readonly foot: THREE.Object3D;
  private readonly hipLift: THREE.Vector3;
  private readonly hipYaw: THREE.Vector3;
  private readonly kneeLift: THREE.Vector3;
  rest = 0;                   // hip lift that puts the foot on the keys
  yawFrom = 0;
  yawTo = 0;
  tapStart = 0;
  tapEnd = 0;
  struck = true;              // the current tap has come down

  constructor(root: THREE.Object3D) {
    const chain: THREE.Object3D[] = [root];
    for (;;) {
      const next = chain[chain.length - 1].children.find(c => c.name.startsWith("FLYPAT"));
      if (!next) break;
      chain.push(next);
    }
    this.hip = new Joint(chain[0]);
    this.knee = new Joint(chain[KNEE]);
    this.foot = chain[chain.length - 1];

    // Lifting axis: perpendicular to the joint->foot direction and to up, signed so + raises the foot.
    const liftAxis = (joint: THREE.Object3D) => {
      const from = joint.getWorldPosition(new THREE.Vector3());
      const toFoot = this.foot.getWorldPosition(new THREE.Vector3()).sub(from);
      return new THREE.Vector3().crossVectors(toFoot, UP).normalize();
    };
    this.hipLift = this.hip.axis(liftAxis(chain[0]));
    this.hipYaw = this.hip.axis(UP);
    this.kneeLift = this.knee.axis(liftAxis(chain[KNEE]));
  }

  /** `tap` 0..1 is how far up the leg is; `yaw` aims it across the keyboard. */
  pose(tap: number, yaw: number) {
    this.hip.set([this.hipLift, this.rest + LIFT * tap], [this.hipYaw, yaw]);
    this.knee.set([this.kneeLift, CURL * tap]);
  }

  footBottom(root: THREE.Object3D): number {
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(this.foot, true).min.y;
  }
}

export interface FlyDesk {
  /** Fly, keyboard and monitor together. Position and rotate THIS — the pieces inside are placed
   *  relative to each other and must not be moved apart. */
  readonly group: THREE.Group;
  /** Desk-local z of the back of the monitor, stand included. NOT computer.ts's MONITOR_BACK:
   *  the computer is offset to wherever the fly's feet landed, so the constant is short by that
   *  offset and anything squared up against it ends up inside the machine. */
  readonly monitorBack: number;
  /** Resize the whole desk. Use this rather than `group.scale`: a point light's range and falloff
   *  are WORLD units and a parent scale does not touch them, so scaling the group alone drags the
   *  lamps in close at full strength and burns the exhibit out. */
  setScale(s: number): void;
  update(dt: number): void;
}

/**
 * Loads the fly, builds its computer under its front feet, and starts it typing. The whole desk
 * stands on y = 0 in its own group facing +Z; the caller turns it to face the terrarium.
 */
export async function loadFlyDesk(scene: THREE.Scene): Promise<FlyDesk> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync("/fly.glb");

  const group = new THREE.Group();
  const screen = new TradingScreen();
  const root = new THREE.Group();
  root.add(gltf.scene);
  root.scale.setScalar(SCALE);
  root.updateMatrixWorld(true);

  const legs = FRONT_LEGS.map(name => new Leg(root.getObjectByName(name)!));
  const hips = legs.map(l => l.hip.node.getWorldPosition(new THREE.Vector3()));
  const box = new THREE.Box3().setFromObject(root, true);
  root.position.set(-(hips[0].x + hips[1].x) / 2, -box.min.y, 0);
  group.add(root);
  scene.add(group);
  group.updateMatrixWorld(true);

  // The keyboard goes where the feet ALREADY are, rather than the fly being moved onto a keyboard
  // placed first — that is what keeps the hands on the keys at any scale.
  const feet = legs.map(l => l.foot.getWorldPosition(new THREE.Vector3()));
  const computer: Computer = createStandInComputer(
    feet[0].clone().add(feet[1]).multiplyScalar(0.5), screen.texture);
  group.add(computer.group);

  // The exhibit brings its OWN light. The terrarium's key is aimed at the tank and falls off to
  // nothing this far out, and raising it instead would blow out the soil to light the insect.
  // Point lights, not directionals: a directional would spill back over the whole room.
  const lamp = new THREE.PointLight(0xffe6c7, 90, 26, 2);
  lamp.position.set(-2.6, 7.5, -1.5);
  const fill = new THREE.PointLight(0x9fb6ff, 35, 24, 2);
  fill.position.set(3.5, 3.5, 4.5);
  group.add(lamp, fill);
  const lampWatts = [lamp.intensity, fill.intensity];
  const lampRange = [lamp.distance, fill.distance];

  const head = new Joint(root.getObjectByName("FLYCAB")!);
  const headYaw = head.axis(UP);
  const headPitch = head.axis(new THREE.Vector3(1, 0, 0));

  // keystroke rhythm: bursts of 5-12 strokes, mostly alternating legs, then a pause to "think"
  let t = 0;
  let nextStrokeAt = 0.6;
  let burstLeft = 0;
  let lastLeg = 0;
  let headDip = 0;
  const footPos = new THREE.Vector3();

  const schedule = () => {
    if (t - nextStrokeAt > 0.5) nextStrokeAt = t; // resumed after a pause: don't replay missed strokes
    while (nextStrokeAt <= t) {
      if (burstLeft <= 0) {
        burstLeft = 5 + Math.floor(Math.random() * 8);
        nextStrokeAt += 0.4 + Math.random() * 0.8;
        continue;
      }
      const preferred = Math.random() < 0.75 ? 1 - lastLeg : lastLeg;
      const legIndex = legs[preferred].struck ? preferred : 1 - preferred;
      const leg = legs[legIndex];
      if (!leg.struck) {
        nextStrokeAt = Math.min(...legs.map(l => l.tapEnd)) + 0.01; // both legs mid-tap
        continue;
      }
      leg.tapStart = nextStrokeAt;
      leg.tapEnd = nextStrokeAt + 0.13 + Math.random() * 0.05;
      leg.struck = false;
      leg.yawFrom = leg.yawTo;
      leg.yawTo = (Math.random() * 2 - 1) * REACH;
      lastLeg = legIndex;
      burstLeft--;
      nextStrokeAt += 0.1 + Math.random() * 0.1;
    }
  };

  // Key tops are in the desk's own frame, and so is the bisection below — the desk has not been
  // turned or moved yet, so local and world agree. Seat the legs BEFORE the caller places it.
  for (const leg of legs) {
    let lo = 0;
    let hi = THREE.MathUtils.degToRad(30);
    for (let i = 0; i < 24; i++) {
      leg.rest = (lo + hi) / 2;
      leg.pose(0, 0);
      if (leg.footBottom(root) < computer.keyTopY) lo = leg.rest;
      else hi = leg.rest;
    }
    leg.rest = hi;
    leg.pose(0, 0);
  }

  return {
    group,
    monitorBack: computer.group.position.z + MONITOR_BACK,
    setScale(s) {
      group.scale.setScalar(s);
      // Inverse-square: the lamp ends up s times nearer, so it needs s^2 less power to land the
      // same brightness on the animal. Range is a plain world length and scales straight.
      [lamp, fill].forEach((l, i) => {
        l.intensity = lampWatts[i] * s * s;
        l.distance = lampRange[i] * s;
      });
      computer.setScale(s);   // its screen glow is a point light too

    },
    update(dt) {
      t += Math.min(dt, 0.1);
      for (const leg of legs) {
        if (leg.struck || t < leg.tapStart) {
          leg.pose(0, leg.struck ? leg.yawTo : leg.yawFrom);
        } else if (t < leg.tapEnd) {
          const k = (t - leg.tapStart) / (leg.tapEnd - leg.tapStart);
          leg.pose(Math.sin(Math.PI * k),
                   THREE.MathUtils.lerp(leg.yawFrom, leg.yawTo, THREE.MathUtils.smoothstep(k, 0, 0.5)));
        } else {
          leg.struck = true;
          leg.pose(0, leg.yawTo);
          root.updateMatrixWorld(true);
          computer.press(leg.foot.getWorldPosition(footPos));
          screen.keystroke();
        }
      }
      schedule(); // after the loop above, so every leg whose tap has ended counts as free
      // the head drifts across the screen, dipping a little toward the keys during a burst
      headDip = THREE.MathUtils.damp(headDip, burstLeft > 0 ? 0.05 : 0, 3, dt);
      head.set(
        [headYaw, 0.08 * Math.sin(t * 0.7) + 0.04 * Math.sin(t * 1.9)],
        [headPitch, 0.03 * Math.sin(t * 1.3) + headDip],
      );
      computer.update(dt);
      screen.update(dt);
    },
  };
}
