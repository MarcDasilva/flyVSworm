export type BehaviorState = { state: 0 | 1 | 2 | 3; gain: number };
export type Vec3 = [number, number, number];

/** Behavior codes exactly as the on-chain classifier emits them (SPEC.md 3.2). */
export const BEHAVIOR = { PAUSE: 0, FORWARD: 1, REVERSE: 2, OMEGA: 3 } as const;
const { PAUSE, FORWARD, REVERSE, OMEGA } = BEHAVIOR;

// Published C. elegans crawling kinematics on agar. EVERY value here is a
// tuning knob — final numbers come from holding the render next to real worm
// video. A model this simple cannot predict what the eye catches.
//
// Two of them are coupled and MUST be tuned together. Follow-the-leader has no
// slip: the body curve IS the track the leading end laid, so the undulation
// wavelength is exactly SPEED / FREQ. Real crawling worms run ~0.65 body
// lengths per wave; halve it and the worm reads as a centipede, double it and
// it reads as an eel.
export const BODY_LENGTH_MM = 1.0;   // L
const FREQ_CRAWL = 0.40;             // Hz
const SPEED_FWD = 0.26;              // mm/s -> wavelength 0.65 L
const SPEED_REV = 0.22;              // reversals run a little slower
const SPEED_OMEGA = 0.45;            // the escape sweep is vigorous
const UNDULATION_RAD = 0.80;         // peak swing of the body tangent angle
const OMEGA_SECONDS = 1.0;           // one scripted turn, then plain forward
const OMEGA_YAW_RATE = 5.2;          // rad/s peak; x0.6 shape integral ~= pi
const OMEGA_WAVE_SUPPRESS = 0.6;     // the wave flattens inside the deep bend
const GAIN_MIN = 0.2, GAIN_MAX = 1.5;

// Arc kept behind the tail. The tail samples the path at (segments-1)*seg, so
// a path exactly one body long puts the last sample ON the end and any
// numerical shortfall clamps it to the final point — the tail bunches. This is
// also how far the tail must back through stale forward track before a
// reversal starts laying its own, so it buys headroom without stalling REVERSE.
const PATH_SLACK = 0.05;             // fraction of L

// The path resolves the body curve at one point per sub-step, so a slow frame
// would otherwise coarsen the worm's shape. Frame time comes from
// requestAnimationFrame and is NEVER a reliable 1/60.
const MAX_SUBSTEP = 1 / 60;

/** Trapezoid: ramp in, hold, ramp out. Integrates to 0.6 x OMEGA_SECONDS. */
function omegaShape(t: number): number {
  if (t < 0.4) return t / 0.4;
  if (t < 0.6) return 1;
  return Math.max(0, (1 - t) / 0.4);
}

/**
 * Follow-the-leader kinematics. The leading end lays a track and the whole body
 * samples that track at fixed arc length, which is what makes the worm
 * inextensible, gives the travelling wave for free, and makes turns look real.
 *
 * FORWARD the nose leads and the path grows at the front; REVERSE the TAIL
 * leads and the path grows at the back while the front is consumed. That
 * asymmetry is the whole point — a reversing worm backs away from what touched
 * its nose, and driving both states off the head would translate it the SAME
 * direction with only the wave running the other way.
 *
 * `points` is nose-first in scene units where 1.0 is ONE body length (~1 mm),
 * z always 0. Worms crawl in 2D on agar; the 3D belongs to the camera.
 */
export class WormBody {
  readonly points: Vec3[];
  /** Ordered nose-end first. path[0] is ALWAYS the nose, at arc length zero. */
  private readonly path: Vec3[] = [];
  private pathLen = 0;
  private phase = 0;
  private omegaT = 0;
  private readonly seg: number;
  private readonly bodySpan: number;
  private readonly keep: number;

  constructor(private readonly segments = 24) {
    this.seg = BODY_LENGTH_MM / segments;
    this.bodySpan = (segments - 1) * this.seg;
    this.keep = this.bodySpan + PATH_SLACK * BODY_LENGTH_MM;
    const n = segments * 8;
    const ds = this.keep / (n - 1);
    for (let k = 0; k < n; k++) this.path.push([-k * ds, 0, 0]);
    this.pathLen = this.keep;
    this.points = Array.from({ length: segments }, (_, k) =>
      [-k * this.seg, 0, 0] as Vec3);
  }

  update(dt: number, b: BehaviorState): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, b);
    for (let k = 0; k < this.segments; k++) {
      this.points[k] = this.pointAtArcLength(k * this.seg);
    }
  }

  private step(dt: number, b: BehaviorState): void {
    if (b.state !== OMEGA) this.omegaT = 0;
    if (b.state === PAUSE) return;

    const raw = Number.isFinite(b.gain) ? b.gain : GAIN_MIN;
    const gain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, raw));
    const omega = 2 * Math.PI * FREQ_CRAWL * gain;
    this.phase += omega * dt;

    // Curvature first, position second. Integrating a yaw rate into the track
    // is what holds the body inextensible; a y = A*sin(x) centreline does not.
    // heading(t) = UNDULATION_RAD * sin(phase), so the constant IS the peak
    // tangent angle in radians and can be read straight off worm video.
    let wave = 1;
    let yaw = 0;
    if (b.state === OMEGA) {
      this.omegaT = Math.min(this.omegaT + dt, OMEGA_SECONDS);
      const s = omegaShape(this.omegaT / OMEGA_SECONDS);
      yaw += OMEGA_YAW_RATE * s;
      wave -= OMEGA_WAVE_SUPPRESS * s;
    }
    yaw += wave * UNDULATION_RAD * omega * Math.cos(this.phase);

    const reverse = b.state === REVERSE;
    const speed = b.state === FORWARD ? SPEED_FWD
      : b.state === REVERSE ? SPEED_REV : SPEED_OMEGA;
    const d = speed * dt;

    // The leading end's heading is the track's own tangent there, so switching
    // direction needs no stored heading to go stale and kink the body.
    const n = this.path.length;
    const tip = reverse ? this.path[n - 1] : this.path[0];
    const prev = reverse ? this.path[n - 2] : this.path[1];
    const heading = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]) + yaw * dt;
    const next: Vec3 = [tip[0] + Math.cos(heading) * d, tip[1] + Math.sin(heading) * d, 0];

    if (reverse) {
      this.path.push(next);
      this.pathLen += d;
      this.consumeFront(d);
    } else {
      this.path.unshift(next);
      this.pathLen += d;
      this.trimBack();
    }
  }

  /** REVERSE only: the nose retreats along the track, so drop that arc. */
  private consumeFront(amount: number): void {
    let rem = amount;
    while (rem > 0 && this.path.length > 2) {
      const a = this.path[0], b = this.path[1];
      const s = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (s <= rem) {
        this.path.shift();
        this.pathLen -= s;
        rem -= s;
      } else {
        const t = rem / s;
        this.path[0] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
        this.pathLen -= rem;
        rem = 0;
      }
    }
  }

  /** Never pops below `keep` — the tail must always have track under it. */
  private trimBack(): void {
    while (this.path.length > 2) {
      const a = this.path[this.path.length - 2], b = this.path[this.path.length - 1];
      const s = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (this.pathLen - s < this.keep) return;
      this.path.pop();
      this.pathLen -= s;
    }
  }

  // Linear scan per segment, 24 scans a frame. Measured at 94 us/frame over
  // the ~234-point path this model holds — 0.57% of a 60 fps budget, so it is
  // NOT worth an arc-length index. Re-measure before optimising.
  private pointAtArcLength(target: number): Vec3 {
    let acc = 0;
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1], b = this.path[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (acc + d >= target) {
        const t = d === 0 ? 0 : (target - acc) / d;
        return [a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t,
                a[2] + (b[2] - a[2]) * t];
      }
      acc += d;
    }
    return [...this.path[this.path.length - 1]] as Vec3;
  }
}
