// The fly at the laptop (data/fly.glb: "Fly" by victorberdugo1, CC BY 4.0). Copied from the
// launcher app's flyRig and re-scaled for this scene, where 1.0 is one worm.
//
// The model has no skeleton or animation clips, but it keeps its 3ds node hierarchy: every leg is
// a chain of 8 segment nodes whose origins sit on the joints (front legs FLYPAT09 right, FLYPAT41
// left; head FLYCAB). Typing = rotating the hip and knee of each front leg, driven by a
// burst/pause keystroke rhythm.

import * as THREE from "three";

/**
 * Model units to scene units. NOT the animal's real size: a 3 mm fly next to a 1 mm worm would be
 * three body lengths of insect and would swallow the laptop it is meant to be using. This is the
 * size that sits at the machine — the joke only works if the fly fits the keyboard.
 */
const SCALE = 0.00011;
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

export interface Fly {
  /** The perch the rig hangs off. Position and rotate THIS, never `root`, which carries the
   *  model's own centring offset. */
  readonly perch: THREE.Group;
  /** Raise the front legs until the feet rest at world height `y`. */
  restFeetAt(y: number): void;
  update(dt: number): void;
}

/**
 * Loads the fly, stands it on y = 0 in its perch facing +Z, and starts typing. The perch is added
 * to `scene` at the origin; the caller seats it at the laptop.
 */
export async function loadFly(scene: THREE.Scene): Promise<Fly> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync("/fly.glb");

  const root = new THREE.Group();
  root.add(gltf.scene);
  root.scale.setScalar(SCALE);
  root.updateMatrixWorld(true);

  const legs = FRONT_LEGS.map(name => new Leg(root.getObjectByName(name)!));
  const hips = legs.map(l => l.hip.node.getWorldPosition(new THREE.Vector3()));
  const box = new THREE.Box3().setFromObject(root, true);
  root.position.set(-(hips[0].x + hips[1].x) / 2, -box.min.y, 0);

  const perch = new THREE.Group();
  perch.add(root);
  scene.add(perch);
  perch.updateMatrixWorld(true);

  const head = new Joint(root.getObjectByName("FLYCAB")!);
  const headYaw = head.axis(UP);
  const headPitch = head.axis(new THREE.Vector3(1, 0, 0));

  // keystroke rhythm: bursts of 5-12 strokes, mostly alternating legs, then a pause to "think"
  let t = 0;
  let nextStrokeAt = 0.6;
  let burstLeft = 0;
  let lastLeg = 0;
  let headDip = 0;

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

  return {
    perch,
    restFeetAt(y) {
      // World height, so the perch's own transform has to be current before the bisection reads
      // any foot position back out of it.
      perch.updateMatrixWorld(true);
      for (const leg of legs) {
        let lo = 0;
        let hi = THREE.MathUtils.degToRad(30);
        for (let i = 0; i < 24; i++) {
          leg.rest = (lo + hi) / 2;
          leg.pose(0, 0);
          if (leg.footBottom(root) < y) lo = leg.rest;
          else hi = leg.rest;
        }
        leg.rest = hi;
        leg.pose(0, 0);
      }
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
        }
      }
      schedule(); // after the loop above, so every leg whose tap has ended counts as free
      // the head drifts across the screen, dipping a little toward the keys during a burst
      headDip = THREE.MathUtils.damp(headDip, burstLeft > 0 ? 0.05 : 0, 3, dt);
      head.set(
        [headYaw, 0.08 * Math.sin(t * 0.7) + 0.04 * Math.sin(t * 1.9)],
        [headPitch, 0.03 * Math.sin(t * 1.3) + headDip],
      );
    },
  };
}
