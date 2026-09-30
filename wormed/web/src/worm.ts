import * as THREE from "three";
import type { Vec3 } from "./body.js";

// Real worms crawl in 2D on agar. Rendering them swimming through an empty
// void would be LESS accurate, not more — the 3D lives in the scene and the
// orbiting camera, NEVER in the locomotion. `points` arrive in the agar plane
// (x, y, 0) and are drawn as (x, up, y).
//
// Scene units are body lengths (ruling R16): 1.0 == one worm == ~1 mm.

const RINGS = 96;          // cross-sections along the body
const RADIAL = 10;         // vertices around each cross-section
const RADIUS = 0.034;      // adult hermaphrodite is ~68 um across a 1 mm body
const HEAD_EXP = 0.30;     // low exponent = blunt nose
const TAIL_EXP = 0.85;     // high exponent = long whip tail
const TRAIL_MAX = 800;     // samples; at TRAIL_STEP apart that is ~12 L of track
const TRAIL_STEP = 0.015;  // do not sample a nose that has not moved

/**
 * The worm and the track it has crawled, drawn in WORLD coordinates.
 *
 * An unbounded worm crawls 0.26 body lengths a second and is 30 L away after
 * two minutes, which is why this used to be a treadmill with the animal
 * pinned at the origin. The pen (props.ts ARENA, enforced in body.ts) is what
 * replaced it: the worm now stays in frame because it cannot leave, so the
 * ground and the terrarium around it are FIXED and the camera never moves.
 * The soil comes from props.ts — this class owns the animal, not the set.
 */
export class WormMesh {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly nrmAttr: THREE.BufferAttribute;
  private readonly curve = new THREE.CatmullRomCurve3([], false, "centripetal");
  private readonly rings: THREE.Vector3[] = [];
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly trail: THREE.Line;
  private readonly trailBuf: Float32Array;
  private trailCount = 0;

  constructor(scene: THREE.Scene) {
    this.trailBuf = new Float32Array(TRAIL_MAX * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailBuf, 3));
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: 0x4e7f6d, transparent: true, opacity: 0.7 }));
    // Trail vertices are WORLD coordinates appended in place, so any bounding
    // sphere three computes is stale one frame later and culls the track at
    // random camera angles.
    this.trail.frustumCulled = false;
    this.trail.position.y = 0.002;
    this.group.add(this.trail);

    this.cos = new Float32Array(RADIAL + 1);
    this.sin = new Float32Array(RADIAL + 1);
    for (let k = 0; k <= RADIAL; k++) {
      const th = (k / RADIAL) * Math.PI * 2;
      this.cos[k] = Math.cos(th);
      this.sin[k] = Math.sin(th);
    }
    for (let j = 0; j <= RINGS; j++) this.rings.push(new THREE.Vector3());

    // ONE geometry and ONE material for the life of the scene. Measured against
    // rebuilding a TubeGeometry and a MeshStandardMaterial every frame: 1.0-1.6
    // ms versus 0.03-0.16 ms, and the rebuild strands a material per frame
    // because only the geometry is ever disposed. Re-measure before undoing it.
    const verts = (RINGS + 1) * (RADIAL + 1);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.nrmAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("normal", this.nrmAttr);
    const idx: number[] = [];
    for (let j = 1; j <= RINGS; j++) {
      for (let k = 1; k <= RADIAL; k++) {
        const a = (RADIAL + 1) * (j - 1) + (k - 1);
        const b = (RADIAL + 1) * j + (k - 1);
        const c = (RADIAL + 1) * j + k;
        const d = (RADIAL + 1) * (j - 1) + k;
        idx.push(a, b, d, b, c, d);
      }
    }
    geo.setIndex(idx);
    // Pinned, NEVER computed: every position is rewritten each frame, so a
    // cached sphere would describe the previous pose. The worm roams the pen,
    // so the sphere has to cover the whole pen, not one body length.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xd8cfa8, roughness: 0.35, transparent: true, opacity: 0.94 }));
    this.mesh.position.y = RADIUS;   // the body rests ON the agar, not in it
    this.group.add(this.mesh);

    scene.add(this.group);
  }

  update(points: Vec3[]): void {
    const pts = this.curve.points;
    if (pts.length !== points.length) {
      pts.length = 0;
      for (let i = 0; i < points.length; i++) pts.push(new THREE.Vector3());
    }
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      pts[i].set(p[0], 0, p[1]);
    }
    for (let j = 0; j <= RINGS; j++) this.curve.getPoint(j / RINGS, this.rings[j]);
    this.writeTube();
    this.extendTrail(pts[0]);
  }

  /**
   * Taper is per RING, never per vertex. TubeGeometry lays vertices out
   * ring-by-ring at index j*(RADIAL+1)+k, so a taper indexed by raw vertex
   * number sawtooths eleven times inside every cross-section instead of
   * running nose to tail once.
   */
  private writeTube(): void {
    const pos = this.posAttr.array as Float32Array;
    const nrm = this.nrmAttr.array as Float32Array;
    let o = 0;
    for (let j = 0; j <= RINGS; j++) {
      const c = this.rings[j];
      const a = this.rings[j === 0 ? 0 : j - 1];
      const b = this.rings[j === RINGS ? RINGS : j + 1];
      let tx = b.x - a.x, tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len; tz /= len;
      // The body is PLANAR on agar, so the cross-section frame is the agar
      // normal and T x up exactly — no Frenet frame, no torsion, no twist
      // artefacts, and no curve evaluation beyond the ring centres.
      const sx = -tz, sz = tx;
      const t = j / RINGS;
      const r = RADIUS * Math.pow(Math.sin(Math.PI * t), t < 0.5 ? HEAD_EXP : TAIL_EXP);
      for (let k = 0; k <= RADIAL; k++) {
        const nx = this.sin[k] * sx, ny = this.cos[k], nz = this.sin[k] * sz;
        pos[o] = c.x + r * nx; pos[o + 1] = c.y + r * ny; pos[o + 2] = c.z + r * nz;
        nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
        o += 3;
      }
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }

  /** The crawl track, in world coordinates, newest sample last. */
  private extendTrail(nose: THREE.Vector3): void {
    const n = this.trailCount;
    const far = n === 0 || Math.hypot(
      nose.x - this.trailBuf[(n - 1) * 3], nose.z - this.trailBuf[(n - 1) * 3 + 2]
    ) > TRAIL_STEP;
    if (!far) return;
    if (n === TRAIL_MAX) {
      // Compact by a quarter rather than shifting one sample per frame —
      // amortised, and the draw range never has to wrap mid-line.
      const drop = TRAIL_MAX >> 2;
      this.trailBuf.copyWithin(0, drop * 3);
      this.trailCount -= drop;
    }
    const w = this.trailCount * 3;
    this.trailBuf[w] = nose.x; this.trailBuf[w + 1] = 0; this.trailBuf[w + 2] = nose.z;
    this.trailCount++;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
