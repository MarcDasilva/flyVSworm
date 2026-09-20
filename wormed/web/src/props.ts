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
/** Margin from a table's near edge to the machine standing on it. Used on BOTH tables, which is
 *  what makes the two rectangles read as a matching pair rather than two different desks. */
export const LAPTOP_GAP = 0.18;
/** World z of the tank's outer +z face — where the tables start. Exported because main.ts sizes
 *  both of them from it, and re-deriving `ARENA.halfY + WALL_T` there would silently drift the
 *  moment either constant moves. */
export const TANK_EDGE = ARENA.halfY + WALL_T;
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

/** Lawn size in body lengths. Far bigger than the grid it replaces, and the
 *  size is set by the FOG, not by the set: the far plane is at 34, so an edge
 *  any closer than that is a horizon line drawn across the room. */
const LAWN = 70;
/** Photos of turf tile at roughly a metre. The patch's own UVs stretch ONE
 *  photo over the whole tile, so at the set's scale — the laptop is 1.1 body
 *  lengths across — that is a blade of grass the size of the animal unless the
 *  map is repeated. */
const GRASS_REPEAT = 20;
/** Tuft height. At the model's own proportions the blades stand 0.94 across a
 *  32-unit lawn, which is as tall as the worm is long and deep enough to
 *  swallow both tables to the knee. */
const GRASS_RELIEF = 0.07;
/** The patch as authored: 300 units square, tufts 11.783 tall, Z up — a 3ds
 *  Max export. Every scale below is measured against these, so a different
 *  patch means new numbers here and nowhere else. */
const PATCH_SPAN = 300, PATCH_HEIGHT = 11.783;

/**
 * The lawn, from wormed/data/grass.obj with wormed/data/textures/grass.jpg
 * over it. The shipped tile had a 2 px black rule on all four edges, cropped
 * out before it was committed — tiled twenty times it drew a grid of dark
 * lines across the floor.
 *
 * The same image drives colour and bump. The geometry's own relief is squashed
 * to almost nothing — see GRASS_RELIEF — so without the bump the floor reads
 * as a photograph of grass lying flat on the ground, which is exactly what it
 * would be.
 */
async function loadGrass(parent: THREE.Object3D): Promise<void> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const model = await new OBJLoader().loadAsync("/grass.obj");

  const tex = new THREE.TextureLoader().load("/textures/grass.jpg");
  // A photograph, NOT a data map: skip the sRGB decode and the lawn comes out
  // the colour of pond water.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GRASS_REPEAT, GRASS_REPEAT);
  tex.anisotropy = 8;
  const turf = new THREE.MeshStandardMaterial({
    map: tex, bumpMap: tex, bumpScale: 0.8, roughness: 1, metalness: 0 });
  // The .obj ships one group under one material; the traverse is what keeps
  // that an assumption the file can break without taking the floor with it.
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = turf;
    // Takes shadow, casts none. A near-flat sheet casting onto itself under a
    // steep lamp is acne and nothing a viewer would ever call a shadow.
    m.receiveShadow = true;
  });

  // Z up, so lie it down FIRST — the scale below is in the patch's own axes,
  // where z is the blade height and x,y are the ground.
  model.rotation.x = -Math.PI / 2;
  model.scale.set(LAWN / PATCH_SPAN, LAWN / PATCH_SPAN, GRASS_RELIEF / PATCH_HEIGHT);
  parent.add(model);
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
    // Shadow flags live where the mesh is MADE, here and in addPlinth and
    // loadGrass, never in a sweep over the scene from main.ts — the lawn
    // arrives whenever it arrives and a sweep would miss whatever is late.
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // The slab is sunk clear of the displaced surface above it — level with it
  // and the flat top would punch through every dip and z-fight.
  box(w * 2, SOIL_D, d * 2, 0, -SOIL_D / 2 - SOIL_RELIEF, 0, matte);
  // Soil surface at y = 0, the plane the body integrator works in. It takes
  // the worm's shadow but casts none of its own; it is the bottom of a pit.
  const surface = soilSurface(w, d, soil);
  surface.receiveShadow = true;
  group.add(surface);
  box(w * 2, WALL_H, WALL_T, 0, WALL_H / 2, -d + WALL_T / 2, matte);
  box(w * 2, WALL_H, WALL_T, 0, WALL_H / 2, d - WALL_T / 2, matte);
  box(WALL_T, WALL_H, d * 2, -w + WALL_T / 2, WALL_H / 2, 0, matte);
  box(WALL_T, WALL_H, d * 2, w - WALL_T / 2, WALL_H / 2, 0, matte);

  // The tables are NOT built here. Each one is sized to the machine that stands on it, and
  // neither model has loaded yet — see addPlinth and main.ts.
  void plinth;

  // The room: a lawn the whole set stands on, level with the underside of the
  // terrarium so nothing floats.
  //
  // What carries the name is this EMPTY group, NOT the grass. The patch is two
  // megabytes of geometry arriving whenever it arrives, and main.ts looks
  // "floor" up the moment the desks land — hang the name on the mesh and that
  // lookup finds nothing on a slow load and the floor never moves.
  const floor = new THREE.Group();
  floor.name = "floor";
  floor.position.y = FLOOR_Y;
  group.add(floor);
  void loadGrass(floor).catch(e => console.warn("grass failed to load", e));

  scene.add(group);
  return group;
}

/**
 * One machine's table, spanning `zNear` to `zFar`.
 *
 * TWO of these, not one slab under both. The tables stand OUTSIDE the tank rim — inside it the
 * worm would crawl into a pillar the body integrator knows nothing about — and the caller sizes
 * each to its own machine, because neither model's depth is known until it has loaded.
 */
export function addPlinth(scene: THREE.Scene, zNear: number, zFar: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(STAND_W, STAND_TOP + SOIL_D, zFar - zNear),
    // Lifted a shade off the tank black: on the same black the laptop's own dark body
    // disappears into the table it stands on.
    new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.9, metalness: 0 }));
  m.position.set(0, (STAND_TOP - SOIL_D) / 2, (zNear + zFar) / 2);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
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

/** The board's face, drawn once. No ticker, no animation: this is a sheet
 *  posted on a wall, and a board that redraws invites someone to ask what the
 *  numbers mean. */
function leaderboardFace(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const mono = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
  /** Column anchors, as fractions of the width. NUMBER and PROFIT are the
   *  RIGHT edge of their column: figures line up on the decimal or the board
   *  stops reading as a results table and starts reading as a poster. */
  const COL = { rank: 0.04, specimen: 0.19, number: 0.685, profit: 0.955 };
  const INK = "#23262b";
  const FAINT = "#6c7178";
  const GAIN = "#1d6b43";
  const LOSS = "#a8322e";

  // Paper, not a screen. The scene's own lights fall on it and the panel's
  // emission is low (see addLeaderboard), so it reads as a printed sheet in a
  // dim room rather than another display competing with the two machines.
  g.fillStyle = "#a4a199";
  g.fillRect(0, 0, w, h);
  g.textBaseline = "middle";

  // Letterhead: a line of type and a rule. No colour band — the point is that
  // someone in the building runs this and nobody is excited about it.
  g.fillStyle = INK;
  g.font = `600 ${h * 0.07}px ${mono}`;
  g.fillText("TRADING RESULTS", w * COL.rank, h * 0.08);
  g.fillStyle = FAINT;
  g.font = `500 ${h * 0.04}px ${mono}`;
  g.textAlign = "right";
  g.fillText("POSTED WEEKLY \u00b7 PERIOD 37", w * COL.profit, h * 0.082);
  g.textAlign = "left";
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.03, h * 0.155);
  g.lineTo(w * 0.97, h * 0.155);
  g.stroke();

  // Column headers, then the rule under them.
  const headY = h * 0.255;
  g.fillStyle = FAINT;
  g.font = `600 ${h * 0.05}px ${mono}`;
  g.fillText("RANK", w * COL.rank, headY);
  g.fillText("SPECIMEN", w * COL.specimen, headY);
  g.textAlign = "right";
  g.fillText("NUMBER", w * COL.number, headY);
  g.fillText("PROFIT", w * COL.profit, headY);
  g.textAlign = "left";
  g.strokeStyle = "#8d8a82";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.03, h * 0.305);
  g.lineTo(w * 0.97, h * 0.305);
  g.stroke();

  // NUMBER is the animal's accession in the facility's register — the number
  // written on the tank and on the desk, nothing to do with what it trades.
  // The legend at the foot says so; without it the column reads as a score.
  const rows: { rank: string; name: string; species: string; number: string;
                profit: string; gain: boolean }[] = [
    { rank: "1", name: "FLY", species: "Drosophila melanogaster",
      number: "004117", profit: "+1,284.60", gain: true },
    { rank: "2", name: "WORM", species: "Caenorhabditis elegans",
      number: "004118", profit: "-212.40", gain: false },
  ];
  const top = h * 0.33, rowH = h * 0.245;
  rows.forEach((r, i) => {
    const y = top + rowH * (i + 0.5);
    if (i % 2 === 0) {
      g.fillStyle = "rgba(0,0,0,0.045)";
      g.fillRect(w * 0.03, top + rowH * i, w * 0.94, rowH);
    }
    g.fillStyle = INK;
    g.font = `500 ${h * 0.115}px ${mono}`;
    g.fillText(r.rank, w * COL.rank, y);
    g.font = `600 ${h * 0.115}px ${mono}`;
    g.fillText(r.name, w * COL.specimen, y - h * 0.028);
    g.fillStyle = FAINT;
    g.font = `italic ${h * 0.046}px ${mono}`;
    g.fillText(r.species, w * COL.specimen, y + h * 0.055);
    g.textAlign = "right";
    g.fillStyle = INK;
    g.font = `500 ${h * 0.09}px ${mono}`;
    g.fillText(r.number, w * COL.number, y);
    // The one column that carries colour, and it is print colour rather than
    // screen colour: a figure in red on a posted sheet is a loss, which is
    // the oldest and dullest use of the two inks there is.
    g.fillStyle = r.gain ? GAIN : LOSS;
    g.font = `600 ${h * 0.085}px ${mono}`;
    g.fillText(r.profit, w * COL.profit, y);
    g.textAlign = "left";
  });

  // Foot: the legend, and the one line that keeps the column honest.
  g.strokeStyle = "#8d8a82";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.03, h * 0.875);
  g.lineTo(w * 0.97, h * 0.875);
  g.stroke();
  g.fillStyle = FAINT;
  g.font = `500 ${h * 0.043}px ${mono}`;
  g.fillText("NUMBER = SPECIMEN ACCESSION", w * COL.rank, h * 0.935);
  g.textAlign = "right";
  g.fillText("USD \u00b7 SETTLED ON THRU \u00b7 UNAUDITED", w * COL.profit, h * 0.935);
  g.textAlign = "left";
  return c;
}

/** Emission of the board's face. See addLeaderboard: this is a backlight
 *  behind a sheet, so it is flat across the whole panel and dim enough that
 *  the two machines' displays stay the brightest things in the room. */
const BACKLIGHT = 0.26;
/** How far the backlight's bleed stands proud of the panel, in scene units. */
const HALO = 0.16;
/** Lamps spread along the board's width, and what each one is worth. Spread
 *  the total over more of them and the wash stays even as the board grows. */
const SPILLS = 3;
const SPILL_WATTS = 7;
/** Board height, floor to top edge. Tall enough to clear both machines from
 *  the wide shot and still sit under the connectome hanging over the tank. */
const BOARD_H = 2.4;
/** How far behind the tables the board stands. It backs BOTH exhibits, so it
 *  runs along the pair's long axis rather than across either end. */
const BOARD_BACK = STAND_W / 2 + 2.4;

/**
 * The scoreboard behind the pair, facing the wide shot's camera.
 *
 * `zCentre` and `width` come from the PLACED tables, not from constants here:
 * the fly's desk is sized by measurement at load time, so how long the set
 * turns out to be is not known until it has landed. See main.ts.
 * Returns a brightness setter that keeps the face, halo and room spill in sync.
 */
export function addLeaderboard(scene: THREE.Scene, zCentre: number, width: number): (brightness: number) => void {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, BOARD_H + 0.18, width + 0.18),
    new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.9, metalness: 0.05 }));
  shell.position.set(-BOARD_BACK, FLOOR_Y + (BOARD_H + 0.18) / 2, zCentre);
  group.add(shell);

  const face = leaderboardFace(1536, Math.round(1536 * BOARD_H / width));
  const tex = new THREE.CanvasTexture(face);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(width, BOARD_H),
    // Backlit, not printed: the sheet is behind glass in a lit box, so the
    // whole face carries an even emission rather than waiting for the room's
    // lights to find it. Dim on purpose — a display this size at the wattage
    // of the two machines' screens would be the brightest thing in the scene
    // and the animals would be reading by it.
    new THREE.MeshStandardMaterial({
      // Roughness stays HIGH. Gloss on a panel this size hands the key light
      // one broad specular sheen across the face, which reads as a wash over
      // the type, not as glass.
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: BACKLIGHT,
      roughness: 0.8, metalness: 0 }));
  // Rotated to face +x, which puts the panel's own left-to-right along world
  // -z — the wide shot's screen-right, so the text reads the right way round.
  panel.rotation.y = Math.PI / 2;
  panel.position.set(-BOARD_BACK + 0.07, FLOOR_Y + BOARD_H / 2 + 0.09, zCentre);
  group.add(panel);

  // The bleed around the bezel. A backlight that stops dead at the frame is a
  // poster with a lamp on it; the halo sits BEHIND the panel and proud of it
  // on every side, so the frame is rimmed by its own light. Additive and
  // depth-write off, or it would punch a hole in the shell behind it.
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width + HALO, BOARD_H + HALO),
    new THREE.MeshBasicMaterial({
      color: 0xa8c8ff, transparent: true, opacity: 0.05, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  halo.rotation.y = Math.PI / 2;
  halo.position.set(-BOARD_BACK + 0.065, panel.position.y, zCentre);
  group.add(halo);

  // And the light it throws into the room. Cool where the desk lamps are warm,
  // short-range, and NOT shadow casters: they exist so the tables have a rim
  // from the screen behind them, not to relight the set.
  //
  // A ROW of them, not one. A single lamp at the middle of a board this wide
  // pools in the centre and leaves both ends dark, which reads as something
  // standing in front of the board rather than as the board itself giving
  // light. Each is stood well off the panel: closer, and its own falloff
  // paints a bright blob on the face it is supposed to be lighting away from.
  const spills: THREE.PointLight[] = [];
  for (let i = 0; i < SPILLS; i++) {
    const across = ((i + 0.5) / SPILLS - 0.5) * width;
    const spill = new THREE.PointLight(0xbcd6ff, SPILL_WATTS, 9, 2);
    spill.position.set(-BOARD_BACK + 1.4, panel.position.y, zCentre + across);
    group.add(spill);
    spills.push(spill);
  }

  scene.add(group);
  return brightness => {
    panel.material.color.setScalar(brightness);
    panel.material.emissiveIntensity = BACKLIGHT * brightness;
    halo.material.opacity = 0.05 * brightness;
    for (const spill of spills) spill.intensity = SPILL_WATTS * brightness;
  };
}
