"""Derive the model-ready hemibrain connectomes from data/cx_csr.npz: the measured wiring
(data/cx_model.npz) and its rotation-averaged ring (data/cx_averaged.npz).

Deterministic: no network, no token. Float geometry (SVD, arctan2) happens only
here; the saved ring placement is integer wedges, so neither the float model
nor a fixed-point port ever recomputes it. Every choice is recorded in the
output ("choices") and its content hash goes into the spec and goldens.

    ../.venv/Scripts/python derive_cx.py        (writes data/cx_model.*, data/cx_averaged.*, out/hemibrain_ring.png)

Choices (the user's decisions are marked *):
  classes   EPG = EPG + EPGt*; PEN_L / PEN_R = PEN_a(PEN1) + PEN_b(PEN2), split by protocerebral-bridge
            side (the L/R letter of the glomerulus in the instance name); D7 = Delta7.
  ring      plane = top two principal axes of the EPG ellipsoid-body input centroids. Orientation:
            counterclockwise is the direction left-bridge PENs project (the model's convention).
            16 equal wedges*; the angular offset puts EPG as close as possible to wedge centres.
  wedges    EPG: its ellipsoid-body input centroid. PEN: its home wedge, the synapse-weighted
            circular mean of the EPG that drive it. D7: -1.
  pathways* EPG->EPG, EPG->PEN, PEN->EPG, EPG->D7, D7->EPG, D7->D7, D7->PEN, PEN->PEN, one gain each*.
            PEN->D7 (31 synapses) is dropped.
  signs     EPG and PEN excitatory (cholinergic), D7 inhibitory (glutamatergic).
  weights*  W[pre, post] = sign * gain(pathway) * count / mean count per connection in that pathway
            (applied by connectome.load_csr; stored here as integer counts).

Averaged ring (cx_averaged.npz; the user's decision: the measured wiring pins the bump in a few resting
spots, so first a ring wired the same at every heading, then blend the measured wiring back in*):
  neurons   the same neurons, classes and counts; measured_index maps each row to its cx_model row.
  angles    EPG and PEN as above; D7: the synapse-weighted circular mean of the EPG that drive it.
  spacing   each class evenly spaced round the ring, in its measured angular order, rotated to the
            least displacement from the measured angles. Wedges from these angles (D7: -1).
  profiles  per (pre class, post class): the measured synapse count per pair (zeros included, no
            self-pairs) as a function of angle difference, smoothed by a circular Gaussian of
            SMOOTH_WEDGES wedges, evaluated at the even-spaced angle differences. Pairs under
            PRUNE_BELOW synapse are dropped* (the fixed-point port's cost scales with connections:
            -30% connections for 0.7% of the synapse mass).
  units     counts stored as integer thousandths of a synapse; pathway_mean holds the MEASURED mean
            count per connection in the same units, so a gain means the same in both files.
"""
import json
import os

import numpy as np

from connectome import content_hash

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
OUT = os.path.normpath(os.path.join(HERE, "..", "out"))
N_WEDGES = 16
SMOOTH_WEDGES = 0.75  # sd of the circular Gaussian that smooths the averaged profiles (0.5, 0.75 and 1.0 were
                      # tuned and compared; 0.75 gave the widest hold and rate margins at the tuned values)
MILLI = 1000         # averaged counts are stored in thousandths of a synapse
PRUNE_BELOW = 0.5    # averaged pairs below this many synapses are dropped (user decision)
CLASSES = ("EPG", "PEN_L", "PEN_R", "D7")
PATHWAYS = (  # (name, pre class group, post class group, gain parameter, sign)
    ("EPG->EPG", "EPG", "EPG", "w_ee", 1),
    ("EPG->PEN", "EPG", "PEN", "w_ep", 1),
    ("PEN->EPG", "PEN", "EPG", "w_pe", 1),
    ("EPG->D7", "EPG", "D7", "w_ed", 1),
    ("D7->EPG", "D7", "EPG", "w_de", -1),
    ("D7->D7", "D7", "D7", "w_dd", -1),
    ("D7->PEN", "D7", "PEN", "w_dp", -1),
    ("PEN->PEN", "PEN", "PEN", "w_pp", 1),
)


def group(cls):
    return "PEN" if cls.startswith("PEN") else cls


def classify(types, instances):
    out = []
    for t, inst in zip(types, instances):
        if t.startswith("EPG"):
            out.append("EPG")
        elif t.startswith("PEN"):
            side = inst.rsplit("_", 1)[-1][:1]  # e.g. PEN_a(PB06a)_L2 -> "L"
            if side not in "LR":
                raise ValueError(f"cannot tell the bridge side of {inst!r}")
            out.append(f"PEN_{side}")
        elif t.startswith("Delta7"):
            out.append("D7")
        else:
            raise ValueError(f"unexpected type {t!r}")
    return np.array(out)


def wedge_of_angle(theta, offset):
    step = 2 * np.pi / N_WEDGES
    return np.floor(np.mod(theta - offset, 2 * np.pi) / step).astype(np.int64)


def derive(src):
    n = len(src["type"])
    counts = np.zeros((n, n), np.int64)
    rows = np.repeat(np.arange(n), np.diff(src["indptr"]))
    counts[rows, src["indices"]] = src["data"]
    cls = classify(src["type"], src["instance"])
    epg, pen = cls == "EPG", np.char.startswith(cls, "PEN")

    # ring plane and orientation
    pts = src["eb_post_centroid"][epg]
    centre = pts.mean(axis=0)
    _, sv, vt = np.linalg.svd(pts - centre)
    # SVD vector signs depend on the LAPACK build. Canonicalize (largest-magnitude entry positive) so
    # the same data derives to the same wedges everywhere: flipping one vector is a reflection (the PEN
    # orientation rule below would absorb it), but flipping both is a 180-degree rotation it would not.
    u, v = (x if x[np.argmax(np.abs(x))] > 0 else -x for x in (vt[0], vt[1]))

    def angle(x):
        d = x - centre
        return np.arctan2(d @ v, d @ u)

    theta = np.full(n, np.nan)
    theta[epg] = angle(src["eb_post_centroid"][epg])
    home = np.full(n, np.nan)
    shift = np.full(n, np.nan)
    for j in np.flatnonzero(pen):
        w_in = counts[epg, j].astype(float)
        w_out = counts[j, epg].astype(float)
        home[j] = np.angle(np.sum(w_in * np.exp(1j * theta[epg])))
        target = np.angle(np.sum(w_out * np.exp(1j * theta[epg])))
        shift[j] = np.angle(np.exp(1j * (target - home[j])))
    mean_shift_left = np.nanmean(shift[cls == "PEN_L"])
    mean_shift_right = np.nanmean(shift[cls == "PEN_R"])
    if np.sign(mean_shift_left) == np.sign(mean_shift_right):
        raise ValueError("left and right PENs shift the same way round the ring: no push-pull structure")
    flip = mean_shift_left < 0  # make left-bridge PENs project counterclockwise
    if flip:
        theta, home, shift = -theta, -home, -shift

    # angular offset: EPG as close as possible to wedge centres (grid search, deterministic)
    step = 2 * np.pi / N_WEDGES
    offsets = np.arange(256) * step / 256
    cost = [np.sum((np.mod(theta[epg] - o, step) - step / 2) ** 2) for o in offsets]
    offset = float(offsets[int(np.argmin(cost))])

    wedge = np.full(n, -1, np.int64)
    wedge[epg] = wedge_of_angle(theta[epg], offset)
    wedge[pen] = wedge_of_angle(home[pen], offset)
    per_wedge = np.bincount(wedge[epg], minlength=N_WEDGES)
    if per_wedge.min() == 0:
        raise ValueError(f"empty EPG wedge(s): {per_wedge.tolist()}")

    # row order: class block, then wedge, then bodyId
    rank = {c: i for i, c in enumerate(CLASSES)}
    order = np.array(sorted(range(n), key=lambda i: (rank[cls[i]], wedge[i], src["body_id"][i])))
    counts = counts[np.ix_(order, order)]
    cls, wedge = cls[order], wedge[order]

    # keep the 8 pathways; label each kept connection with its pathway index
    grp = np.array([group(c) for c in cls])
    path_of = {(pre, post): k for k, (_, pre, post, _, _) in enumerate(PATHWAYS)}
    pre_i, post_i = np.nonzero(counts)
    pathway = np.array([path_of.get((grp[a], grp[b]), -1) for a, b in zip(pre_i, post_i)], np.int64)
    dropped = int(counts[pre_i[pathway < 0], post_i[pathway < 0]].sum())
    keep = pathway >= 0
    pre_i, post_i, pathway = pre_i[keep], post_i[keep], pathway[keep]
    data = counts[pre_i, post_i]
    indptr = np.searchsorted(pre_i, np.arange(len(cls) + 1))

    model = {
        "body_id": src["body_id"][order],
        "type": src["type"][order],
        "instance": src["instance"][order],
        "cls": np.array(cls, dtype=str),
        "wedge": wedge,
        "n_wedges": np.int64(N_WEDGES),
        "indptr": indptr, "indices": post_i.astype(np.int64), "data": data.astype(np.int64),
        "pathway": pathway,
        "pathway_names": np.array([p[0] for p in PATHWAYS], dtype=str),
        "pathway_gains": np.array([p[3] for p in PATHWAYS], dtype=str),
        "pathway_signs": np.array([p[4] for p in PATHWAYS], np.int64),
    }
    info = {
        "angle_deg": np.degrees(np.where(np.isnan(theta), home, theta))[order],  # for plots only
        "theta": np.where(np.isnan(theta), home, theta)[order],  # radians; D7 nan
        "offset": offset,
        "sv": sv, "flip": flip, "offset_deg": np.degrees(offset),
        "shift_deg": np.degrees(shift)[order], "per_wedge_epg": per_wedge, "dropped_synapses": dropped,
        "mean_shift_deg": {"PEN_L": float(np.degrees(abs(mean_shift_left))),
                           "PEN_R": float(-np.degrees(abs(mean_shift_right)))},
    }
    return model, info


def average(model, info):
    """The rotation-averaged ring: same neurons, evenly spaced per class, measured profiles by angle.
    Returns (averaged model, summary info). See "Averaged ring" in the module docstring."""
    cls = model["cls"]
    n = len(cls)
    rows = np.repeat(np.arange(n), np.diff(model["indptr"]))
    count = np.zeros((n, n))
    count[rows, model["indices"]] = model["data"]
    path = np.full((n, n), -1, np.int64)
    path[rows, model["indices"]] = model["pathway"]
    theta = info["theta"].copy()
    epg = cls == "EPG"
    for j in np.flatnonzero(cls == "D7"):
        theta[j] = np.angle(np.sum(count[epg, j] * np.exp(1j * theta[epg])))
    even = np.empty(n)
    for c in CLASSES:
        ids = np.flatnonzero(cls == c)
        ids = ids[np.argsort(np.mod(theta[ids], 2 * np.pi), kind="stable")]
        base = 2 * np.pi * np.arange(len(ids)) / len(ids)
        even[ids] = base + np.angle(np.sum(np.exp(1j * (theta[ids] - base))))
    s = SMOOTH_WEDGES * 2 * np.pi / N_WEDGES
    path_of = {(pre, post): k for k, (_, pre, post, _, _) in enumerate(PATHWAYS)}
    expected = np.zeros((n, n))
    pw = np.full((n, n), -1, np.int64)
    for a in CLASSES:
        for b in CLASSES:
            k = path_of.get((group(a), group(b)))
            if k is None:
                continue
            pre, post = np.flatnonzero(cls == a), np.flatnonzero(cls == b)
            other = pre[:, None] != post[None, :]
            d = np.angle(np.exp(1j * (theta[post][None, :] - theta[pre][:, None])))[other]
            y = np.where(path[np.ix_(pre, post)] == k, count[np.ix_(pre, post)], 0.0)[other]
            de = np.angle(np.exp(1j * (even[post][None, :] - even[pre][:, None])))
            w = np.exp((np.cos(de[..., None] - d) - 1) / s ** 2)
            prof = (w * y).sum(axis=-1) / w.sum(axis=-1)
            expected[np.ix_(pre, post)] = np.where(other, prof, 0.0)
            pw[np.ix_(pre, post)] = k
    wedge = np.full(n, -1, np.int64)
    ring = cls != "D7"
    wedge[ring] = wedge_of_angle(even[ring], info["offset"])
    rank = {c: i for i, c in enumerate(CLASSES)}
    ang = np.mod(even - info["offset"], 2 * np.pi)
    order = np.array(sorted(range(n), key=lambda i: (rank[cls[i]], wedge[i], ang[i], i)))
    milli = np.rint(expected[np.ix_(order, order)] * MILLI).astype(np.int64)
    pw = pw[np.ix_(order, order)]
    pre_i, post_i = np.nonzero((milli >= round(PRUNE_BELOW * MILLI)) & (pw >= 0))
    mean = np.array([model["data"][model["pathway"] == k].sum() * MILLI / np.count_nonzero(model["pathway"] == k)
                     for k in range(len(PATHWAYS))])
    avg = {
        "body_id": model["body_id"][order], "type": model["type"][order], "instance": model["instance"][order],
        "cls": cls[order], "wedge": wedge[order], "n_wedges": model["n_wedges"],
        "indptr": np.searchsorted(pre_i, np.arange(n + 1)), "indices": post_i.astype(np.int64),
        "data": milli[pre_i, post_i], "pathway": pw[pre_i, post_i],
        "pathway_names": model["pathway_names"], "pathway_gains": model["pathway_gains"],
        "pathway_signs": model["pathway_signs"],
        "pathway_mean": mean,
        "measured_index": order.astype(np.int64),
    }
    disp = np.degrees(np.abs(np.angle(np.exp(1j * (even - theta)))))
    summary = {
        "epg_per_wedge": np.bincount(avg["wedge"][avg["cls"] == "EPG"], minlength=N_WEDGES).tolist(),
        "displacement_deg": {"median": round(float(np.median(disp)), 2), "max": round(float(disp.max()), 2)},
        "pathway_synapses": {str(name): round(float(avg["data"][avg["pathway"] == k].sum()) / MILLI, 1)
                             for k, name in enumerate(model["pathway_names"])},
    }
    return avg, summary


def plot_ring(model, info, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    colors = {"EPG": "#2a78d6", "PEN_L": "#eb6834", "PEN_R": "#1baf7a"}
    fig, ax = plt.subplots(figsize=(6.5, 6.5), subplot_kw={"projection": "polar"})
    for c, col in colors.items():
        m = model["cls"] == c
        r = {"EPG": 1.0, "PEN_L": 0.8, "PEN_R": 0.7}[c]
        ax.scatter(np.radians(info["angle_deg"][m]), np.full(m.sum(), r), s=28, color=col, label=f"{c} ({m.sum()})",
                   edgecolor="white", linewidth=0.8, zorder=3)
    step = 360 / N_WEDGES
    for k in range(N_WEDGES):
        ax.axvline(np.radians(info["offset_deg"] + k * step), color="#c4c3be", lw=0.6)
        ax.text(np.radians(info["offset_deg"] + (k + 0.5) * step), 1.18, str(k), ha="center", va="center",
                fontsize=8, color="#52514e")
    ax.set_ylim(0, 1.25)
    ax.set_yticks([])
    ax.set_xticks([])
    ax.set_title("Hemibrain ring placement: EPG by ellipsoid-body position,\nPEN at the home wedge of the EPG that drive them",
                 fontsize=10, loc="left")
    ax.legend(loc="lower left", bbox_to_anchor=(-0.05, -0.08), frameon=False, fontsize=8, ncols=3)
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def main():
    src_path = os.path.join(DATA, "cx_csr.npz")
    with np.load(src_path, allow_pickle=False) as f:
        src = {k: f[k] for k in f.files}
    src_meta = json.loads(str(src["meta"]))
    if content_hash(src) != src_meta["content_sha256"]:
        raise ValueError(f"{src_path}: content hash does not match its metadata")
    model, info = derive(src)
    summary = {
        "source": {"file": "data/cx_csr.npz", "content_sha256": src_meta["content_sha256"], "dataset": src_meta["dataset"]},
        "content_sha256": content_hash(model),
        "neurons": {c: int((model["cls"] == c).sum()) for c in CLASSES},
        "n_wedges": N_WEDGES,
        "epg_per_wedge": info["per_wedge_epg"].tolist(),
        "pathway_synapses": {name: int(model["data"][model["pathway"] == k].sum())
                             for k, name in enumerate(model["pathway_names"])},
        "dropped_synapses": info["dropped_synapses"],
        "ring": {"singular_values": [round(float(s), 1) for s in info["sv"]], "orientation_flipped": bool(info["flip"]),
                 "wedge_offset_deg": round(info["offset_deg"], 3), "mean_pen_shift_deg": info["mean_shift_deg"]},
        "choices": __doc__.split("Choices", 1)[1].split("Averaged ring", 1)[0].strip(),
    }
    np.savez_compressed(os.path.join(DATA, "cx_model.npz"), meta=json.dumps(summary), **model)
    with open(os.path.join(DATA, "cx_model.json"), "w") as f:
        json.dump(summary, f, indent=2)
    avg, avg_info = average(model, info)
    avg_summary = {
        "source": {"file": "data/cx_model.npz", "content_sha256": summary["content_sha256"]},
        "content_sha256": content_hash(avg),
        "neurons": summary["neurons"],
        "n_wedges": N_WEDGES,
        "smooth_wedges": SMOOTH_WEDGES,
        "units": f"counts in 1/{MILLI} synapse; pathway_mean = measured mean count per connection, same units",
        **avg_info,
        "choices": "Averaged ring" + __doc__.split("Averaged ring", 1)[1].rstrip(),
    }
    np.savez_compressed(os.path.join(DATA, "cx_averaged.npz"), meta=json.dumps(avg_summary), **avg)
    with open(os.path.join(DATA, "cx_averaged.json"), "w") as f:
        json.dump(avg_summary, f, indent=2)
    os.makedirs(OUT, exist_ok=True)
    plot_ring(model, info, os.path.join(OUT, "hemibrain_ring.png"))
    print(json.dumps({k: summary[k] for k in ("content_sha256", "neurons", "epg_per_wedge", "pathway_synapses",
                                              "dropped_synapses", "ring")}, indent=1))
    print("averaged ring:", json.dumps({k: avg_summary[k] for k in ("content_sha256", "epg_per_wedge",
                                                                   "displacement_deg", "pathway_synapses")}, indent=1))


if __name__ == "__main__":
    main()
