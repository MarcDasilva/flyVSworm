"""Float reference model of the central-complex heading ring attractor.

Leaky integrate-and-fire neurons with exponentially decaying synaptic current,
stepped by tick(). This is the known-good reference the fixed-point port is
bisected against, so the dynamics stay plain: no special cases, no sign
branches (sign lives in the connectome weights).

Direction convention: counterclockwise (CCW) = INCREASING wedge index. PEN_L
projects one wedge CCW (PEN_L_i -> EPG_{i+1}), PEN_R one wedge CW. The turn
that T3 validates is PUSH-PULL drive: drive_pen_l = +d, drive_pen_r = -d turns
the bump CCW. Two consequences of the LIF dynamics that callers must know:
  - drive_pen_l alone ABOVE the PEN threshold current (v_thresh/tau) turns
    the bump CLOCKWISE (see tests.t3_phases for the mechanism);
  - small drives fall in a dead zone where the bump stays pinned to its wedge,
    so small inputs produce no rotation at all.

Time: one tick = dt milliseconds (dt = 1.0 -> 1 ms per tick).

All randomness comes from the single seeded Generator carried in State.rng.
"""
import json
from dataclasses import dataclass, fields

import numpy as np


@dataclass
class Params:
    tau: float
    dt: float
    syn_decay: float
    v_thresh: float
    v_reset: float
    refrac_ticks: int
    w_ee: float
    w_ed: float
    w_de: float
    w_ep: float
    w_pe: float
    noise_amp: float
    neuromod_gain: float  # baked into W (D7->EPG) by connectome.build_procedural

    @classmethod
    def from_dict(cls, d):
        """Strict: an unknown or missing key raises, so a typo cannot silently fall back to a default."""
        names = {f.name for f in fields(cls)}
        unknown, missing = sorted(set(d) - names), sorted(names - set(d))
        if unknown or missing:
            raise ValueError(f"params: unknown keys {unknown}, missing keys {missing}")
        return cls(**d)

    def to_dict(self):
        return {f.name: getattr(self, f.name) for f in fields(self)}


def load_spec(path):
    """Read spec/params.json. Returns (Params, full spec dict)."""
    with open(path) as f:
        spec = json.load(f)
    return Params.from_dict(spec["model"]), spec


@dataclass
class State:
    v: np.ndarray
    syn: np.ndarray
    refrac: np.ndarray
    spikes: np.ndarray
    tick: int
    rng: np.random.Generator


@dataclass
class Input:
    drive_pen_l: float = 0.0
    drive_pen_r: float = 0.0
    landmark_wedge: int = 0
    landmark_current: float = 0.0
    landmark_active: bool = False
    neuromod_gain: float = 1.0  # NOT read by tick(): currently baked into W at build time
    noise_amp: float = 0.0


def init_state(cx, p, seed):
    """Fresh state. Initial membrane potentials are drawn uniformly in [v_reset, v_thresh)."""
    rng = np.random.default_rng(seed)
    return State(
        v=rng.uniform(p.v_reset, p.v_thresh, cx.N),
        syn=np.zeros(cx.N),
        refrac=np.zeros(cx.N, dtype=int),
        spikes=np.zeros(cx.N, dtype=bool),
        tick=0,
        rng=rng,
    )


def tick(s, cx, inp, p):
    ext = np.zeros(cx.N)
    ext[cx.idx["PEN_L"]] = inp.drive_pen_l
    ext[cx.idx["PEN_R"]] = inp.drive_pen_r
    if inp.landmark_active:
        # Footprint (5 wedges, cos(pi*d/5) profile) is precomputed by the connectome.
        ext += inp.landmark_current * cx.landmark[inp.landmark_wedge % cx.n_wedges]

    # W is W[pre, post], so input to each postsynaptic neuron is W.T @ spikes:
    # the sum of the ROWS of the neurons that spiked. Dropping the transpose
    # silently reverses the rotation direction. Rows are added in ascending
    # neuron order instead of calling BLAS, whose summation order can differ
    # across machines; with a hard threshold a last-bit difference flips spikes.
    syn_in = np.zeros(cx.N)
    for pre in np.flatnonzero(s.spikes):
        syn_in += cx.W[pre]
    s.syn = s.syn * p.syn_decay + syn_in
    I = s.syn + ext + inp.noise_amp * s.rng.standard_normal(cx.N)

    free = s.refrac == 0
    s.v[free] += (I[free] - s.v[free] / p.tau) * p.dt

    s.spikes = s.v >= p.v_thresh
    s.v[s.spikes] = p.v_reset
    s.refrac[s.spikes] = p.refrac_ticks
    s.refrac[~s.spikes & (s.refrac > 0)] -= 1
    s.tick += 1
    return s
