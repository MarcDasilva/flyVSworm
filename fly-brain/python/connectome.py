"""Weight-matrix construction for the central-complex heading circuit.

This is the ONLY size-aware module. Everything downstream reads the neuron
count, wedge count and population index ranges from the Connectome object;
nothing outside this file may assume a particular N or wedge count.

Scale A (procedural, built here): 16-wedge idealization, 56 neurons, ordered
    EPG 0-15, PEN_L 16-31, PEN_R 32-47, D7 48-55.
The protocerebral bridge's 18 glomeruli reduce to 16 computational units for
EPG and 8 for D7 (Hulse et al. 2021).
Scale B (hemibrain, load_csr): 134 measured neurons from data/cx_model.npz
(see derive_cx.py), same four populations in the same block order, several
EPG per wedge. Its rotation-averaged ring (data/cx_averaged.npz: the same neurons,
evenly spaced, with the measured wiring profiles) and blends of the two load the
same way. build(params, source) picks one from the spec's "connectome".

Pathway gains (Params fields): w_ee EPG->EPG, w_ep EPG->PEN, w_pe PEN->EPG,
w_ed EPG->D7, w_de D7->EPG, w_dd D7->D7, w_dp D7->PEN, w_pp PEN->PEN. The
procedural model has only the first five; the last three must be 0 there.

Conventions
-----------
W[pre, post]: row = presynaptic, column = postsynaptic. Input to the network is
therefore W.T @ spikes.

Sign lives in the weight. D7 rows are negative by construction; there is no
separate excitatory/inhibitory mask anywhere.

Direction: counterclockwise = INCREASING wedge index. PEN_L projects one wedge
CCW (PEN_L_i -> EPG_{i+1}); PEN_R projects one wedge CW (PEN_R_i -> EPG_{i-1}).
Which DRIVE turns the bump which way is a property of the dynamics, not of this
wiring alone: see the model_float docstring (push-pull drive turns CCW).
"""
import hashlib
import os
from dataclasses import dataclass

import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
N_WEDGES = 16  # EPG computational units
N_D7 = 8       # D7 computational units
LANDMARK_OFFSETS = (-2, -1, 0, 1, 2)  # landmark footprint in wedges, profile cos(pi*d/5)


@dataclass
class Connectome:
    W: np.ndarray          # (N,N) signed, W[pre,post]
    N: int
    n_wedges: int
    idx: dict              # {"EPG": slice, "PEN_L": slice, "PEN_R": slice, "D7": slice}
    wedge_of: np.ndarray   # (N,) angular unit per neuron, -1 for D7
    source: str            # "procedural" | "hemibrain"
    landmark: np.ndarray   # (n_wedges, N) per-unit-current input pattern for a landmark at each wedge


def landmark_patterns(n, n_wedges, wedge_of, epg_ids):
    """Row w: the input each neuron gets from a unit-current landmark at wedge w.
    Every EPG in a wedge d away from w (|d| <= 2) gets cos(pi*d/5)."""
    P = np.zeros((n_wedges, n))
    for w in range(n_wedges):
        for d in LANDMARK_OFFSETS:
            P[w, epg_ids[wedge_of[epg_ids] == (w + d) % n_wedges]] += np.cos(np.pi * d / 5)
    return P


def build_procedural(params) -> Connectome:
    """Build the Scale A connectome from `params` (w_ee, w_ed, w_de, w_ep, w_pe, neuromod_gain)."""
    extra = {k: getattr(params, k) for k in ("w_dd", "w_dp", "w_pp") if getattr(params, k) != 0}
    if extra:
        raise ValueError(f"the procedural connectome has no D7->D7, D7->PEN or PEN->PEN pathways: {extra}")
    nw = N_WEDGES
    idx = {
        "EPG": slice(0, nw),
        "PEN_L": slice(nw, 2 * nw),
        "PEN_R": slice(2 * nw, 3 * nw),
        "D7": slice(3 * nw, 3 * nw + N_D7),
    }
    n = 3 * nw + N_D7
    W = np.zeros((n, n))

    i = np.arange(nw)
    epg = i
    pen_l = nw + i
    pen_r = 2 * nw + i

    # w_ee * max(0, cos(theta_i - theta_j)), built from a 1-D table over circular
    # wedge distance so the block is exactly symmetric and circulant. Float
    # residue such as cos(pi/2) = 6e-17 is snapped to exact zero.
    dist = np.minimum(i, nw - i)
    c = np.cos(2 * np.pi * dist / nw)
    kernel = params.w_ee * np.where(c > 1e-12, c, 0.0)
    kernel[0] = 0.0  # no self-excitation
    W[epg[:, None], epg[None, :]] = kernel[(epg[None, :] - epg[:, None]) % nw]

    W[idx["EPG"], idx["D7"]] = params.w_ed
    # neuromod_gain scales D7->EPG ONLY, and is baked into W here at build time.
    # tick() does not read Input.neuromod_gain; if it ever does, remove it from
    # this line or the gain is applied twice.
    W[idx["D7"], idx["EPG"]] = -params.w_de * params.neuromod_gain

    W[epg, pen_l] = params.w_ep
    W[epg, pen_r] = params.w_ep
    W[pen_l, (i + 1) % nw] = params.w_pe  # +1 wedge -> CCW
    W[pen_r, (i - 1) % nw] = params.w_pe  # -1 wedge -> CW

    wedge_of = np.concatenate([i, i, i, -np.ones(N_D7, dtype=int)])
    return Connectome(W=W, N=n, n_wedges=nw, idx=idx, wedge_of=wedge_of, source="procedural",
                      landmark=landmark_patterns(n, nw, wedge_of, epg))


def build(params, source=None) -> Connectome:
    """The connectome a spec asks for. source = spec["connectome"]: None or {"source": "procedural"}
    gives Scale A; {"source": "hemibrain", "file": ..., "sha256": ...} loads Scale B (the measured
    wiring, data/cx_model.npz), and "hemibrain_averaged" its rotation-averaged ring (data/cx_averaged.npz)."""
    kind = (source or {}).get("source", "procedural")
    if kind == "procedural":
        return build_procedural(params)
    if kind in ("hemibrain", "hemibrain_averaged"):
        if not source.get("sha256"):
            raise ValueError("a hemibrain connectome source must pin its content: connectome.sha256")
        return load_csr(os.path.join(ROOT, source["file"]), params, source["sha256"], label=kind)
    if kind == "hemibrain_blend":
        return load_blend(params, source)
    raise ValueError(f"unknown connectome source {kind!r}")


def load_blend(params, source) -> Connectome:
    """W = (1 - alpha) * averaged + alpha * measured, on the averaged ring's neuron order and wedges.
    source = {"source": "hemibrain_blend", "alpha": a, "averaged": {"file", "sha256"}, "measured": {"file", "sha256"}}.
    Both use the same gains and the measured per-pathway normalizer, so alpha only moves the wiring
    pattern from rotation-averaged (0) to exactly measured (1). Geometry does NOT move: wedges, the
    landmark footprint and the per-wedge read-out always come from the averaged ring's even placement,
    so every alpha is measured in one frame. alpha = 1 is therefore the measured wiring read in the
    averaged frame, not the "hemibrain" spec (10% of EPG sit one wedge apart between the two frames)."""
    alpha = float(source["alpha"])
    if not 0.0 <= alpha <= 1.0:
        raise ValueError(f"blend alpha must be in [0, 1], got {alpha}")
    for part in ("averaged", "measured"):
        if not source[part].get("sha256"):
            raise ValueError(f"a hemibrain_blend source must pin both files: connectome.{part}.sha256")
    avg_path = os.path.join(ROOT, source["averaged"]["file"])
    avg = load_csr(avg_path, params, source["averaged"]["sha256"], label="hemibrain_blend")
    meas = load_csr(os.path.join(ROOT, source["measured"]["file"]), params, source["measured"]["sha256"])
    with np.load(avg_path, allow_pickle=False) as f:
        ix = f["measured_index"]  # averaged row -> measured row (the file's hash was just verified)
    W = (1.0 - alpha) * avg.W + alpha * meas.W[np.ix_(ix, ix)]
    return Connectome(W=W, N=avg.N, n_wedges=avg.n_wedges, idx=avg.idx, wedge_of=avg.wedge_of,
                      source="hemibrain_blend", landmark=avg.landmark)


def content_hash(arrays):
    """sha256 over a dict of numpy arrays (sorted keys; name, dtype, shape and bytes of each).
    Identifies a connectome by content, independent of when or how the file was written."""
    h = hashlib.sha256()
    for key in sorted(k for k in arrays if k != "meta"):
        a = np.ascontiguousarray(arrays[key])
        h.update(key.encode())
        h.update(a.dtype.str.encode())
        h.update(repr(a.shape).encode())
        h.update(a.tobytes())
    return h.hexdigest()


def load_csr(path, params, expected_sha256=None, label="hemibrain") -> Connectome:
    """Scale B: a hemibrain connectome written by derive_cx.py (measured or averaged).

    W[pre, post] = sign * gain * count / mean_count, per pathway, where gain is the
    pathway's Params field and mean_count the mean synapse count per connection in
    that pathway (so a gain is "the weight of an average connection"). A file that
    stores pathway_mean (the averaged ring) uses it: the MEASURED mean, in the file's
    count units, so a gain means the same in both files. neuromod_gain
    scales D7->EPG only, as in the procedural model. Ring placement is read as stored
    integer wedges; nothing here recomputes geometry."""
    with np.load(path, allow_pickle=False) as f:
        m = {k: f[k] for k in f.files}
    if expected_sha256 is not None and content_hash(m) != expected_sha256:
        raise ValueError(f"{path}: content hash differs from the spec's connectome.sha256")
    cls = m["cls"]
    n = len(cls)
    idx = {}
    for name in ("EPG", "PEN_L", "PEN_R", "D7"):
        ids = np.flatnonzero(cls == name)
        if ids.size == 0 or not np.array_equal(ids, np.arange(ids[0], ids[-1] + 1)):
            raise ValueError(f"{path}: population {name} is missing or not a contiguous block")
        idx[name] = slice(int(ids[0]), int(ids[-1]) + 1)
    rows = np.repeat(np.arange(n), np.diff(m["indptr"]))
    cols = m["indices"]
    count = m["data"].astype(np.float64)
    pathway = m["pathway"]
    gains = np.array([getattr(params, g) for g in m["pathway_gains"]], dtype=np.float64)
    signs = m["pathway_signs"].astype(np.float64)
    if "pathway_mean" in m:
        mean = m["pathway_mean"].astype(np.float64)
    else:  # counts are integers < 2**53, so each pathway sum is exact and the mean is correctly rounded
        mean = np.array([count[pathway == k].sum() / np.count_nonzero(pathway == k) for k in range(len(gains))])
    neuromod = np.where(m["pathway_names"] == "D7->EPG", params.neuromod_gain, 1.0)
    W = np.zeros((n, n))
    W[rows, cols] = signs[pathway] * (gains[pathway] * neuromod[pathway] / mean[pathway]) * count
    nw = int(m["n_wedges"])
    wedge_of = m["wedge"].astype(int)
    epg = np.arange(n)[idx["EPG"]]
    epg_wedges = wedge_of[epg]
    if np.any(np.diff(epg_wedges) < 0) or not np.array_equal(np.unique(epg_wedges), np.arange(nw)):
        raise ValueError(f"{path}: EPG must be sorted by wedge with every one of the {nw} wedges occupied")
    return Connectome(W=W, N=n, n_wedges=nw, idx=idx, wedge_of=wedge_of, source=label,
                      landmark=landmark_patterns(n, nw, wedge_of, epg))
