"""Bake the 3D brain for the frontend's brain modal: meshes, synapses and an index, all in one space.

No token. Reads the files extract_3d.py wrote plus public data:
  spec (default spec/params_hemibrain_avg.json)  its connectome file's row order = model neuron index
  data/cx_model.npz          the measured connections the model keeps (its 8 pathways)
  data/cx_synapses.npz, data/context_neurons.json, data/rois/*.obj      (extract_3d.py)
  hemibrain v1.2 neuron meshes   public bucket MESHES, cached in data/mesh_cache/
  JRC2018F brain surface and the hemibrain -> JRC2018F transform        (flybrains; the transform is
                                 ~1.3 GB, fetched once into ~/flybrain-data)

    ../.venv/Scripts/python bake_3d.py          (from fly-brain/python)

Space: JRC2018F micrometres (the full-brain template the hemibrain is registered into), centred on
the brain surface and turned for three.js: x = template x, y = -template y (dorsal up), z = -template
z (anterior toward +z). Negating y and z is a 180-degree rotation about x, not a mirror.

Writes frontend/public/brain/:
  brain.glb     one node per mesh: n000..n133 simulated neurons (model index), c<bodyId> context
                neurons, roi_<name> neuropils, brain (outline)
  synapses.bin  little-endian: float32 xyz[S][3], then uint16 pre[S], then uint16 post[S] (model
                indices); each point is the midpoint of the synapse's T-bar and PSD
  brain.json    the index: neurons, context, rois, synapse layout, camera views, provenance
and out/brain3d_preview.png (front and top projections) to check the registration by eye.
"""
import argparse
import concurrent.futures
import datetime
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "out")
SITE = os.path.normpath(os.path.join(ROOT, "..", "frontend", "public", "brain"))
SPEC = os.path.join(ROOT, "spec", "params_hemibrain_avg.json")
MESHES = "precomputed://gs://neuroglancer-janelia-flyem-hemibrain/v1.2/segmentation"
MESH_CACHE = os.path.join(DATA, "mesh_cache", "hemibrain-v1.2")  # change with MESHES, or stale meshes are reused
MESH_LOD = 2            # of the multi-resolution meshes: ~86k faces for an EPG (lod 0 is ~3.8M)
CIRCUIT_FACES = 4000    # per simulated neuron after simplification
CONTEXT_FACES = 1500    # per greyed-out neuron
ROI_FACES = 6000
CONTEXT_TOP = 120       # user's choice: the strongest ~120 partners (plus every CONTEXT_TYPES neuron)
VOXEL_NM = 8.0          # hemibrain voxel size; synapses and ROI meshes come in voxels, neuron meshes in nm
POP_COLORS = {"EPG": "#2a78d6", "PEN_L": "#eb6834", "PEN_R": "#1baf7a", "D7": "#eda100"}  # web/style.css


def model_rows(spec_path):
    """(spec connectome block, npz arrays of the file whose row order the model uses)."""
    with open(spec_path) as f:
        source = json.load(f).get("connectome") or {}
    kind = source.get("source")
    if kind in ("hemibrain", "hemibrain_averaged"):
        path = source["file"]
    elif kind == "hemibrain_blend":
        path = source["averaged"]["file"]
    else:
        raise SystemExit(f"{spec_path}: needs a hemibrain connectome, not {kind!r}")
    with np.load(os.path.join(ROOT, path), allow_pickle=False) as f:
        return source, {k: f[k] for k in ("body_id", "type", "instance", "cls", "wedge")}


def kept_pairs():
    """(pre bodyId, post bodyId) of every connection the model keeps (cx_model.npz: its 8 pathways)."""
    with np.load(os.path.join(DATA, "cx_model.npz"), allow_pickle=False) as f:
        body, indptr, indices = f["body_id"], f["indptr"], f["indices"]
    rows = np.repeat(np.arange(len(body)), np.diff(indptr))
    return set(zip(body[rows].tolist(), body[indices].tolist()))


def context_neurons():
    with open(os.path.join(DATA, "context_neurons.json")) as f:
        d = json.load(f)
    pool = d["neurons"]
    total = lambda n: n["synapses_onto_circuit"] + n["synapses_from_circuit"]
    top = sorted((n for n in pool if n["why"] == "partner"), key=lambda n: (-total(n), n["body_id"]))[:CONTEXT_TOP]
    chosen = {n["body_id"]: n for n in top}
    chosen.update({n["body_id"]: n for n in pool if n["why"] == "type"})
    return sorted(chosen.values(), key=lambda n: (-total(n), n["body_id"])), d["meta"]


def fetch_meshes(ids):
    """{bodyId: (vertices nm float32 [V,3], faces int32 [F,3])}, cached per body in MESH_CACHE (git-ignored)."""
    from cloudvolume import CloudVolume
    cache = MESH_CACHE
    os.makedirs(cache, exist_ok=True)
    with open(os.path.join(os.path.dirname(cache), ".gitignore"), "w") as f:
        f.write("# downloaded meshes (bake_3d.py); regenerated on demand\n*\n")
    cv = CloudVolume(MESHES, use_https=True, progress=False)

    def one(b):
        path = os.path.join(cache, f"{b}_lod{MESH_LOD}.npz")
        if not os.path.exists(path):
            m = cv.mesh.get(int(b), lod=MESH_LOD)
            m = m[int(b)] if isinstance(m, dict) else m
            np.savez_compressed(path, vertices=np.asarray(m.vertices, np.float32), faces=np.asarray(m.faces, np.int32))
        with np.load(path) as f:
            return b, (f["vertices"], f["faces"])

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        return dict(ex.map(one, ids))


def simplify(vertices, faces, target):
    """Weld duplicate vertices, then quadric decimation to ~target faces. The multi-resolution meshes
    come as ~1000 chunk fragments per neuron; at the default aggressiveness (7) the simplifier stalls
    near 30k faces on their open edges, so it runs at the maximum (10)."""
    import fast_simplification
    import trimesh
    m = trimesh.Trimesh(vertices, faces, process=True)  # merges identical vertices, drops degenerate faces
    if len(m.faces) <= target:
        return np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32)
    v, f = fast_simplification.simplify(np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int64),
                                        1.0 - target / len(m.faces), agg=10)
    return v.astype(np.float32), f.astype(np.int32)


def to_template(points_nm):
    """hemibrain nm -> JRC2018F micrometres (flybrains H5 transform; ~0.02 ms per point)."""
    import flybrains
    import navis
    flybrains.register_transforms()
    out = np.asarray(navis.xform_brain(np.asarray(points_nm, np.float64), source="JRCFIB2018F", target="JRC2018F"))
    bad = ~np.isfinite(out).all(axis=1)
    if bad.any():
        raise ValueError(f"{int(bad.sum())} points fell outside the hemibrain -> JRC2018F transform")
    return out


def load_roi(name):
    import trimesh
    m = trimesh.load(os.path.join(DATA, "rois", f"{name}.obj"), force="mesh")
    return np.asarray(m.vertices, np.float64) * VOXEL_NM, np.asarray(m.faces, np.int32)


def bake(spec_path):
    import flybrains
    import trimesh

    source, rows = model_rows(spec_path)
    n = len(rows["body_id"])
    index = {int(b): i for i, b in enumerate(rows["body_id"])}
    ctx, ctx_meta = context_neurons()
    ctx_ids = [n_["body_id"] for n_ in ctx]
    if set(ctx_ids) & set(index):
        raise ValueError("a context neuron is also a simulated neuron")

    # meshes, simplified in hemibrain nm; each keeps (name, vertices, faces)
    raw = fetch_meshes([int(b) for b in rows["body_id"]] + ctx_ids)
    parts = []
    for i, b in enumerate(rows["body_id"]):
        parts.append((f"n{i:03d}", *simplify(*raw[int(b)], CIRCUIT_FACES)))
    for b in ctx_ids:
        parts.append((f"c{b}", *simplify(*raw[b], CONTEXT_FACES)))
    with open(os.path.join(DATA, "context_neurons.json")) as f:
        rois = json.load(f)["meta"]["rois"]
    for r in rois:
        parts.append((f"roi_{r}", *simplify(*load_roi(r), ROI_FACES)))

    # synapses the model keeps, as T-bar/PSD midpoints in nm
    with np.load(os.path.join(DATA, "cx_synapses.npz"), allow_pickle=False) as f:
        syn = {k: f[k] for k in ("pre_body", "post_body", "pre_xyz", "post_xyz")}
    keep_pairs = kept_pairs()
    keep = np.array([(a, b) in keep_pairs for a, b in zip(syn["pre_body"].tolist(), syn["post_body"].tolist())])
    pre = np.array([index[b] for b in syn["pre_body"][keep].tolist()], np.uint16)
    post = np.array([index[b] for b in syn["post_body"][keep].tolist()], np.uint16)
    mid_nm = (syn["pre_xyz"][keep].astype(np.float64) + syn["post_xyz"][keep]) / 2 * VOXEL_NM
    order = np.lexsort((post, pre))
    pre, post, mid_nm = pre[order], post[order], mid_nm[order]

    # one transform call for every point
    counts = [len(v) for _, v, _ in parts]
    moved = to_template(np.concatenate([v for _, v, _ in parts] + [mid_nm]))
    brain = flybrains.JRC2018F.mesh
    bv, bf = np.asarray(brain.vertices, np.float64), np.asarray(brain.faces, np.int32)
    centre = (bv.min(axis=0) + bv.max(axis=0)) / 2
    turn = lambda p: ((p - centre) * np.array([1.0, -1.0, -1.0])).astype(np.float32)

    scene = trimesh.Scene()
    start, placed = 0, {}
    for (name, _, faces), c in zip(parts, counts):
        v = turn(moved[start:start + c])
        start += c
        placed[name] = v
        scene.add_geometry(trimesh.Trimesh(v, faces, process=False), node_name=name, geom_name=name)
    syn_xyz = turn(moved[start:])
    scene.add_geometry(trimesh.Trimesh(turn(bv), bf, process=False), node_name="brain", geom_name="brain")

    os.makedirs(SITE, exist_ok=True)
    glb = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    with open(os.path.join(SITE, "brain.glb"), "wb") as f:
        f.write(glb)
    with open(os.path.join(SITE, "synapses.bin"), "wb") as f:
        f.write(syn_xyz.astype("<f4").tobytes() + pre.astype("<u2").tobytes() + post.astype("<u2").tobytes())

    def sphere(names):
        pts = np.concatenate([placed[k] for k in names])
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        return {"target": ((lo + hi) / 2).round(2).tolist(), "radius": round(float(np.linalg.norm(hi - lo) / 2), 2)}

    tb = turn(bv)
    faces_total = sum(len(f) for _, _, f in parts) + len(bf)
    manifest = {
        "version": 1,
        "spec": os.path.relpath(spec_path, ROOT).replace(os.sep, "/"),
        "connectome": source,
        "anatomy_vs_simulation": "meshes and synapses are the measured hemibrain anatomy (cx_model.npz wiring); "
                                 "the simulation runs the spec's connectome, which for hemibrain_averaged is a "
                                 "smoothed ring wired the same at every heading. A synapse lights when its "
                                 "presynaptic neuron spikes in the simulation.",
        "units": "micrometres, JRC2018F template, centred; x = template x, y = -template y (dorsal up), "
                 "z = -template z (anterior toward +z)",
        "neurons": [{"index": i, "node": f"n{i:03d}", "body_id": int(b), "pop": str(rows["cls"][i]),
                     "wedge": int(rows["wedge"][i]), "type": str(rows["type"][i]), "instance": str(rows["instance"][i])}
                    for i, b in enumerate(rows["body_id"])],
        "populations": {p: {"color": c} for p, c in POP_COLORS.items()},
        "context": [{"node": f"c{c['body_id']}", "body_id": c["body_id"], "type": c["type"], "instance": c["instance"],
                     "synapses_with_circuit": c["synapses_onto_circuit"] + c["synapses_from_circuit"], "why": c["why"]}
                    for c in ctx],
        "rois": [{"node": f"roi_{r}", "name": r} for r in rois],
        "outline": {"node": "brain", "source": "flybrains JRC2018F template surface"},
        "synapses": {"file": "synapses.bin", "count": int(len(pre)),
                     "layout": "float32 xyz[count][3], uint16 pre[count], uint16 post[count]; little-endian",
                     "dropped_not_in_model": int((~keep).sum())},
        "views": {"brain": {"target": [0.0, 0.0, 0.0], "radius": round(float(np.linalg.norm(tb.max(0) - tb.min(0)) / 2), 2)},
                  "cx": sphere([f"roi_{r}" for r in rois])},
        "faces": {"total": int(faces_total), "per_simulated_neuron": CIRCUIT_FACES, "per_context_neuron": CONTEXT_FACES},
        "provenance": {"baked_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                       "meshes": f"{MESHES} (lod {MESH_LOD}, simplified)", "synapses": ctx_meta,
                       "transform": "navis.xform_brain JRCFIB2018F -> JRC2018F (flybrains, Saalfeld lab H5)",
                       "context_rule": f"top {CONTEXT_TOP} partners by synapses with the circuit, plus every "
                                       f"{', '.join(ctx_meta['context_types'])}",
                       "credits": "Hemibrain v1.2.1 (Scheffer et al. 2020, Janelia FlyEM); JRC2018 templates "
                                  "(Bogovic et al. 2020); bridging transforms by the Saalfeld lab"},
    }
    with open(os.path.join(SITE, "brain.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    preview(manifest, placed, tb, syn_xyz, pre, rows["cls"])
    print(json.dumps({"glb_mb": round(len(glb) / 1e6, 1), "faces": faces_total, "simulated": n,
                      "context": len(ctx), "synapses": int(len(pre)), "dropped_synapses": int((~keep).sum()),
                      "views": manifest["views"]}, indent=1))


def preview(manifest, placed, outline, syn_xyz, pre, cls):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(14, 5.2))
    for ax, (a, b, title) in zip(axes, ((0, 1, "front (x, y)"), (0, 2, "top (x, z)"))):
        ax.scatter(outline[::3, a], outline[::3, b], s=0.2, color="#c4c3be")
        for c in manifest["context"]:
            v = placed[c["node"]]
            ax.scatter(v[::4, a], v[::4, b], s=0.2, color="#8a8984")
        for nr in manifest["neurons"]:
            v = placed[nr["node"]]
            ax.scatter(v[::6, a], v[::6, b], s=0.2, color=POP_COLORS[nr["pop"]])
        k = slice(None, None, 25)
        ax.scatter(syn_xyz[k, a], syn_xyz[k, b], s=0.3, color="#0b0b0b")
        ax.set_aspect("equal")
        ax.set_title(title, fontsize=10, loc="left")
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle("brain3d bake: JRC2018F outline (light), context neurons (grey), circuit by population, synapses (black)",
                 fontsize=10, x=0.01, ha="left")
    os.makedirs(OUT, exist_ok=True)
    fig.savefig(os.path.join(OUT, "brain3d_preview.png"), dpi=110, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="bake the 3D brain for the frontend")
    ap.add_argument("--spec", default=SPEC, help="a hemibrain spec (default spec/params_hemibrain_avg.json)")
    bake(os.path.abspath(ap.parse_args().spec))
