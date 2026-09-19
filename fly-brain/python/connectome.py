"""Weight-matrix construction for the central-complex heading circuit.

This is the ONLY size-aware module. Everything downstream reads the neuron
count, wedge count and population index ranges from the Connectome object;
nothing outside this file may assume a particular N or wedge count.

Scale A (procedural, built here): 16-wedge idealization, 56 neurons, ordered
    EPG 0-15, PEN_L 16-31, PEN_R 32-47, D7 48-55.
The protocerebral bridge's 18 glomeruli reduce to 16 computational units for
EPG and 8 for D7 (Hulse et al. 2021).

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
from dataclasses import dataclass

import numpy as np

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


def landmark_patterns(n, n_wedges, epg_ids):
    """Row w: the input each neuron gets from a unit-current landmark at wedge w."""
    P = np.zeros((n_wedges, n))
    for w in range(n_wedges):
        for d in LANDMARK_OFFSETS:
            P[w, epg_ids[(w + d) % n_wedges]] += np.cos(np.pi * d / 5)
    return P


def build_procedural(params) -> Connectome:
    """Build the Scale A connectome from `params` (w_ee, w_ed, w_de, w_ep, w_pe, neuromod_gain)."""
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
                      landmark=landmark_patterns(n, nw, epg))


def load_csr(path) -> Connectome:
    """Scale B (hemibrain CSR) loader. Not built yet: build_procedural is the sole entry point."""
    raise NotImplementedError(f"load_csr({path!r}): Scale B connectome is not implemented")
