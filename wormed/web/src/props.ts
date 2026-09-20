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
/** Plinth top, a hair above the rim. Exported: it is the table BOTH machines stand on. */
export const STAND_TOP = 0.45;
const STAND_W = 1.7;       // plinth footprint; must stay wider than the laptop
/** Deep enough for the laptop AND the fly's desk standing back to back behind it. The laptop is
 *  pinned to the plinth's tank edge, so every unit here becomes room on the far side — shrink it
 *  and the fly ends up off the end of the table. */
const STAND_D = 2.9;
const LAPTOP_GAP = 0.18;   // tank rim to the laptop's own near edge
const LAPTOP_SCALE = 0.33; // the .obj ships ~3.46 units wide; this is ~1.14
const SOIL_RELIEF = 0.012; // surface bumps; MUST stay under the worm radius
/** The room's floor: the plane the terrarium's slab and the grid both sit on. Anything else
 *  standing in the room stands HERE, not on the soil surface at y = 0. */
export const FLOOR_Y = -SOIL_D - SOIL_RELIEF;

/** Random grey lattice, upscaled by the canvas's own bilinear filter. */
function octave(size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Dirt without an image file. Per-pixel noise alone reads as sandpaper at any
 * distance because real soil clumps at EVERY scale — so this stacks six
 * octaves of smoothed noise, coarse to fine, then scatters grit and pits on
 * top. The same canvas drives colour and bump, which is what makes the grit
 * catch the key light instead of sitting there as a flat stain.
 */
function dirt(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#33210f";
  g.fillRect(0, 0, S, S);

  // The coarsest octaves are left OUT: a 4- or 8-pixel lattice stretched over
  // half a metre of wall bilinears into wood grain, which is exactly what the
  // soil must not look like.
  g.globalCompositeOperation = "overlay";
  for (const [size, alpha] of [[16, 0.55], [32, 0.5], [64, 0.4],
                               [128, 0.32], [256, 0.25]] as const) {
    g.globalAlpha = alpha;
    g.drawImage(octave(size), 0, 0, S, S);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  // Grit, then pits. Pits are drawn last and darkest: a soil surface reads as
  // loose because of its shadows, not its highlights.
  for (let k = 0; k < 4000; k++) {
    const r = 0.4 + Math.random() * 2.2;
    const t = Math.random();
    g.fillStyle = t < 0.45 ? `rgba(88,63,38,${0.12 + Math.random() * 0.3})`
      : t < 0.8 ? `rgba(46,30,16,${0.2 + Math.random() * 0.4})`
      : `rgba(124,98,68,${0.06 + Math.random() * 0.18})`;
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, r, r * (0.5 + Math.random()),
              Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(12,7,3,${0.25 + Math.random() * 0.55})`;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 0.4 + Math.random() * 1.6, 0, Math.PI * 2);
    g.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * The soil surface the worm crawls on. Flat geometry gives the rim a
 * ruler-straight edge that no texture can rescue, so the top is a displaced
 * plane. Relief stays under the worm's radius — deeper and the animal
 * disappears into its own ground.
 */
function soilSurface(w: number, d: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w * 2, d * 2, 72, 56);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    // Three incommensurable ripples: cheap, deterministic, and no seam at the
    // tile edges because nothing here repeats.
    const h = Math.sin(x * 5.3 + 1.7) * Math.cos(y * 4.1)
      + 0.5 * Math.sin(x * 11.7 + 0.4) * Math.cos(y * 9.3 + 2.1)
      + 0.25 * Math.sin(x * 23.1) * Math.cos(y * 19.7 + 0.9);
    p.setZ(i, h * SOIL_RELIEF * 0.55);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Soil slab, four rim walls, and the plinth. ONE texture for all of it. */
export function buildTerrarium(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  const tex = dirt();
  tex.repeat.set(4, 4);
  // The palette lives in the texture, so the tint stays near-neutral: crush
  // it darker here and the octaves flatten back into mud.
  const soil = new THREE.MeshStandardMaterial({
    color: 0xa08b74, map: tex, bumpMap: tex, bumpScale: 1.4, roughness: 1,
  });
  // Structure — tank and plinth — is matte black and UNTEXTURED, so the only
  // thing in the terrarium carrying grain is the soil itself.
  const matte = new THREE.MeshStandardMaterial({
    color: 0x111315, roughness: 0.96, metalness: 0,
  });
  // The plinth is lifted a shade off the tank black: on the same black the
  // laptop's own dark body disappears into the table it stands on.
  const plinth = new THREE.MeshStandardMaterial({
    color: 0x23272b, roughness: 0.9, metalness: 0,
  });

  const w = ARENA.halfX + WALL_T, d = ARENA.halfY + WALL_T;
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number,
               mat: THREE.Material = soil) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // The slab is sunk clear of the displaced surface above it — level with it
  // and the flat top would punch through every dip and z-fight.
  box(w * 2, SOIL_D, d * 2, 0, -SOIL_D / 2 - SOIL_RELIEF, 0, matte);
  // Soil surface at y = 0, the plane the body integrator works in.
  group.add(soilSurface(w, d, soil));
  box(w * 2, WALL_H, WALL_T, 0, WALL_H / 2, -d + WALL_T / 2, matte);
  box(w * 2, WALL_H, WALL_T, 0, WALL_H / 2, d - WALL_T / 2, matte);
  box(WALL_T, WALL_H, d * 2, -w + WALL_T / 2, WALL_H / 2, 0, matte);
  box(WALL_T, WALL_H, d * 2, w - WALL_T / 2, WALL_H / 2, 0, matte);

  // The plinth stands OUTSIDE the rim: inside it, the worm would crawl into a
  // pillar the body integrator knows nothing about. Its near face is placed
  // flush against the rim rather than at a fixed offset, so resizing it
  // cannot push it into the terrarium wall.
  box(STAND_W, STAND_TOP + SOIL_D, STAND_D,
      0, (STAND_TOP - SOIL_D) / 2, d + STAND_D / 2, plinth);

  // The room: a grey grid the whole set stands on, level with the underside
  // of the terrarium so nothing floats.
  const grid = new THREE.GridHelper(24, 96, 0x5a5f66, 0x2b2f34);
  // Named so the host can slide the floor's centre under whatever the shot is built around. The
  // grid's centre lines are the only origin anyone can SEE, so moving them is the same picture as
  // moving every other object the other way — and one object instead of twenty.
  grid.name = "floor";
  grid.position.y = -SOIL_D - SOIL_RELIEF;
  group.add(grid);

  scene.add(group);
  return group;
}

/** The laptop, and the lid box the fly's monitor is sized and squared up against. */
export type Laptop = {
  group: THREE.Group;
  /** World bounds of the OPEN LID — the display panel and its shell, not the base. */
  lid: THREE.Box3;
};

/**
 * The laptop: geometry and UVs from wormed/data/MacBookPro.obj, textures from
 * wormed/data/textures (unpacked out of the .blend by
 * wormed/pipeline/unpack_blend_textures.py).
 *
 * The .obj ships no .mtl and the .dae's materials are all Blender defaults, so
 * neither file says what anything is made of. OBJLoader does keep the `usemtl`
 * name on each material, and THAT is what the finish below is keyed on —
 * rename a group in the model and it falls back to bare aluminium.
 */
export async function loadLaptop(scene: THREE.Scene): Promise<Laptop> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const model = await new OBJLoader().loadAsync("/MacBookPro.obj");

  const loader = new THREE.TextureLoader();
  const image = (file: string) => {
    const t = loader.load(`/textures/${file}`);
    // These are photographs, NOT data maps: skip the sRGB decode and the
    // wallpaper comes out washed grey.
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const wallpaper = image("macScreen.jpg");

  const aluminium = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad, roughness: 0.38, metalness: 0.72 });
  const plastic = new THREE.MeshStandardMaterial({
    color: 0x14171a, roughness: 0.65, metalness: 0.1 });
  // The display is its own light source, so the wallpaper is bound twice:
  // once as colour and once as emission. Colour alone leaves it dead black in
  // this scene's lighting.
  const glass = new THREE.MeshStandardMaterial({
    map: wallpaper, emissiveMap: wallpaper, emissive: 0xffffff,
    emissiveIntensity: 0.85, roughness: 0.16, metalness: 0.1 });
  const keys = new THREE.MeshStandardMaterial({
    map: image("KeyB.jpg"), roughness: 0.6, metalness: 0.1 });
  const topline = new THREE.MeshStandardMaterial({
    map: image("TopLine.jpg"), roughness: 0.5, metalness: 0.3 });
  const finish: Record<string, THREE.Material> = {
    Screen: glass, Emission: glass,
    KeysMain: keys, KeysBottom: keys, TopLine: topline,
    Black: plastic, DarkGrey: plastic, Outline: plastic, Text: plastic,
    Camera: plastic, Camera1: plastic,
    CameraGreen: new THREE.MeshStandardMaterial({
      color: 0x1d3a26, emissive: 0x2f7a49, emissiveIntensity: 0.6 }),
  };

  const group = new THREE.Group();
  for (const child of [...model.children]) {
    // The .obj carries a 96-unit backdrop plane with the machine. Dropping it
    // is what keeps the bounds below honest — it would swamp them.
    if (child.name === "Plane") continue;
    child.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // An object with several `usemtl` groups arrives with an ARRAY of
      // materials, one per geometry group. Reading `.name` off the array
      // yields undefined and paints the whole machine in the fallback — which
      // is how the screen and the keys lost their textures the first time.
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(m => finish[m.name] ?? aluminium)
        : finish[(mesh.material as THREE.Material).name] ?? aluminium;
    });
    group.add(child);
  }

  group.scale.setScalar(LAPTOP_SCALE);
  // Square to the tank: the display faces the worm, so the camera gets the
  // lid and the keyboard. Math.PI turns the wallpaper back towards the viewer.
  group.rotation.y = 0;

  // Sit it ON the table rather than trusting the model's origin: this one is
  // authored a long way off-centre, so the bounds decide where it goes. Drop
  // the feet onto STAND_TOP and pull the machine up against the plinth's TANK
  // edge — not its centre — so the rest of the table is free for the fly.
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const mid = bounds.getCenter(new THREE.Vector3());
  group.position.set(-mid.x, STAND_TOP - bounds.min.y,
                     ARENA.halfY + WALL_T + LAPTOP_GAP - bounds.min.z);

  scene.add(group);
  group.updateMatrixWorld(true);
  // The lid is its own object in the .obj. Measuring the whole model instead would hand back the
  // base's footprint, and the fly's monitor would come out sized to a keyboard.
  const lidPart = group.getObjectByName("macBook_TopPart_Cube.004") ?? group;
  return { group, lid: new THREE.Box3().setFromObject(lidPart) };
}
