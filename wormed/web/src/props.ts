import * as THREE from "three";
import type { Arena } from "./body.js";

/**
 * The terrarium the animal lives in, and the desk prop in front of it.
 *
 * ARENA is the SAME rectangle the body integrator clamps against — pass it to
 * WormBody or the worm will crawl straight through the dirt walls. Body
 * coordinates are (x, y) on the agar plane and the scene draws them as
 * (x, up, y), so `halfY` is the scene's z.
 */
export const ARENA: Arena = { halfX: 1.4, halfY: 0.95 };

const WALL_H = 0.42;       // rim height in body lengths; the worm is 1.0 long
const WALL_T = 0.11;       // rim thickness
const SOIL_D = 0.35;       // soil depth below the floor
const STAND_TOP = 0.45;    // plinth top, a hair above the rim
const STAND_W = 1.7;       // plinth footprint; must stay wider than the laptop
const STAND_D = 1.15;      //   or the machine overhangs its own table
const LAPTOP_SCALE = 0.24; // the .abc ships ~4.45 units wide; this is ~1.1

/**
 * Dirt without an image file: white noise for grain, dark blobs for grit. The
 * SAME texture drives the bump map, so the grit reads as relief under the key
 * light instead of as a flat stain.
 */
function dirt(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 0.5 + Math.random() * 0.55;
    img.data[i] = 86 * v;
    img.data[i + 1] = 60 * v;
    img.data[i + 2] = 40 * v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 1400; k++) {
    const r = 0.6 + Math.random() * 2.6;
    g.fillStyle = Math.random() < 0.5
      ? `rgba(38,26,17,${0.2 + Math.random() * 0.5})`
      : `rgba(139,110,78,${0.15 + Math.random() * 0.35})`;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Soil slab, four rim walls, and the plinth. ONE texture for all of it. */
export function buildTerrarium(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  const tex = dirt();
  tex.repeat.set(6, 6);
  // The texture is tinted DOWN here rather than at the pixels, so the grain
  // and the grit blobs keep their contrast against each other instead of
  // being crushed together into flat mud.
  const soil = new THREE.MeshStandardMaterial({
    color: 0x6b5744, map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 1,
  });
  // The plinth stays darker still than the soil, or the laptop sits on
  // camouflage.
  const stone = new THREE.MeshStandardMaterial({
    color: 0x3d372f, map: tex, bumpMap: tex, bumpScale: 0.4, roughness: 0.9,
  });

  const w = ARENA.halfX + WALL_T, d = ARENA.halfY + WALL_T;
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number,
               mat: THREE.Material = soil) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // Floor top sits exactly at y = 0 — the plane the body integrator works in.
  box(w * 2, SOIL_D, d * 2, 0, -SOIL_D / 2, 0);
  box(w * 2, WALL_H, WALL_T, 0, WALL_H / 2, -d + WALL_T / 2);
  box(w * 2, WALL_H, WALL_T, 0, WALL_H / 2, d - WALL_T / 2);
  box(WALL_T, WALL_H, d * 2, -w + WALL_T / 2, WALL_H / 2, 0);
  box(WALL_T, WALL_H, d * 2, w - WALL_T / 2, WALL_H / 2, 0);

  // The plinth stands OUTSIDE the rim: inside it, the worm would crawl into a
  // pillar the body integrator knows nothing about. Its near face is placed
  // flush against the rim rather than at a fixed offset, so resizing it
  // cannot push it into the terrarium wall.
  box(STAND_W, STAND_TOP + SOIL_D, STAND_D,
      0, (STAND_TOP - SOIL_D) / 2, d + STAND_D / 2, stone);

  scene.add(group);
  return group;
}

type Model = { parts: number[]; names: string[] };

/**
 * The laptop, decoded from wormed/data/laptop.bin — a flat triangle soup with
 * a JSON header, written by wormed/pipeline/abc_to_bin.py. Normals are
 * computed here and the soup is unwelded, so the facets stay crisp.
 */
export async function loadLaptop(scene: THREE.Scene): Promise<THREE.Group> {
  const buf = await (await fetch("/laptop.bin")).arrayBuffer();
  const headLen = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 4, headLen))) as Model;
  const verts = new Float32Array(buf, 4 + headLen);

  const shell = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad, roughness: 0.42, metalness: 0.65 });
  const screen = new THREE.MeshStandardMaterial({
    color: 0x090f14, roughness: 0.22, emissive: 0x10283a, emissiveIntensity: 0.45 });

  const group = new THREE.Group();
  let at = 0;
  head.parts.forEach((tris, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(
      verts.subarray(at, at + tris * 9), 3));
    geo.computeVertexNormals();
    at += tris * 9;
    group.add(new THREE.Mesh(geo, head.names[i] === "monitor" ? screen : shell));
  });

  group.scale.setScalar(LAPTOP_SCALE);
  // Square to the table, screen towards the terrarium — the worm's side.
  group.rotation.y = Math.PI;

  // Sit it ON the table rather than trusting the model's origin to be at its
  // feet: the origin is wherever the .abc author left it, so at any other
  // scale a fixed y either sinks the machine into the plinth or floats it.
  // Measure the rotated, scaled bounds and drop the base onto STAND_TOP.
  group.position.set(0, 0, ARENA.halfY + WALL_T + STAND_D / 2);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  group.position.y = STAND_TOP - bounds.min.y;
  scene.add(group);
  return group;
}
