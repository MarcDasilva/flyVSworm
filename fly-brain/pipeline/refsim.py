"""Reference simulators, and the golden vectors the C harness is checked against.

FloatSim is the ground truth for the MODEL; FixedSim is the ground truth for
the ARITHMETIC. The C code is asserted against FixedSim, and FixedSim against
FloatSim. Three links, each independently checkable, and the chain adds a
fourth -- that chain is what lets a mismatch be localized instead of argued
about:

    model_float.py  ->  FixedSim (here)  ->  native C  ->  ThruVM
      float64            Q16.16 python      sim.c         sim.c on chain
                      tolerance           bit-for-bit   bit-for-bit

FixedSim deliberately re-reads the raw int32s out of topology.bin rather than
reusing the float model's parameters. A float round trip would introduce
exactly the rounding difference the bit-for-bit assert exists to catch.
"""
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
sys.path.insert(0, os.path.join(ROOT, "python"))

Q16 = 65536
INT32_MIN, INT32_MAX = -(1 << 31), (1 << 31) - 1

CLS_EPG, CLS_PEN_L, CLS_PEN_R, CLS_D7 = 0, 1, 2, 3


def q16_mul(a, b):
    """(a * b) >> 16, arithmetic. Python's >> floors toward -inf on negatives,
    which is what RISC-V's sra does and what fixed.h's q16_mul relies on."""
    return (int(a) * int(b)) >> 16


class FixedSim:
    """The Q16.16 model, reading the packed topology exactly as the VM does."""

    def __init__(self, path=None):
        with open(path or os.path.join(DATA, "topology.bin"), "rb") as f:
            self.blob = f.read()
        h = struct.unpack_from("<16I", self.blob, 0)
        (magic, version, self.N, self.n_wedges, off_w, off_class, off_wedge,
         off_landmark, off_v0, off_sincos, off_params, self.total) = h[:12]
        if magic != 0x31594C46:
            raise ValueError(f"bad magic {magic:#x}: not a fly topology blob")
        n, nw = self.N, self.n_wedges

        self.W = np.array(struct.unpack_from(f"<{n*n}i", self.blob, off_w), np.int64).reshape(n, n)
        self.cls = np.array(struct.unpack_from(f"<{n}B", self.blob, off_class), np.int64)
        self.wedge = np.array(struct.unpack_from(f"<{n}B", self.blob, off_wedge), np.int64)
        self.landmark = np.array(struct.unpack_from(f"<{nw*n}i", self.blob, off_landmark),
                                 np.int64).reshape(nw, n)
        self.v0 = np.array(struct.unpack_from(f"<{n}i", self.blob, off_v0), np.int64)
        sc = np.array(struct.unpack_from(f"<{2*nw}i", self.blob, off_sincos), np.int64)
        self.cos_t, self.sin_t = sc[:nw], sc[nw:]

        (self.dt, self.inv_tau, self.syn_decay, self.v_thresh, self.v_reset,
         self.refrac_ticks, self.rate_window, _) = struct.unpack_from("<5iIIi", self.blob, off_params)

        self.drive_l = 0
        self.drive_r = 0
        self.landmark_current = 0
        self.landmark_wedge = 0
        self.landmark_active = 0
        self.reset()

    # ------------------------------------------------------------- state --

    def reset(self):
        self.v = self.v0.copy()
        self.syn = np.zeros(self.N, np.int64)
        self.refrac = np.zeros(self.N, np.int64)
        self.spikes = np.zeros(self.N, np.int64)
        self.history = []

    def drive(self, left, right):
        """Push-pull steering, in model units (floats), as the spec states it."""
        self.drive_l = int(round(left * Q16))
        self.drive_r = int(round(right * Q16))

    def set_landmark(self, current, wedge, active=True):
        """Anchor the bump at a wedge. Without this a ring released from its
        initial potentials never spikes at all: every cell decays toward rest
        and nothing crosses threshold, which is why the protocol boots with a
        landmark before it hands over to the drive."""
        self.landmark_current = int(round(current * Q16))
        self.landmark_wedge = int(wedge) % self.n_wedges
        self.landmark_active = 1 if active else 0

    # -------------------------------------------------------------- step --

    def step(self, n=1):
        """n ticks. This is sim.c's fly_step, operation for operation."""
        for _ in range(n):
            # Pass 1-3, fused per neuron exactly as the C is: last tick's
            # spikes arrive, synaptic current decays, the cell integrates.
            fired = np.flatnonzero(self.spikes)
            acc = self.W[fired].sum(axis=0) if fired.size else np.zeros(self.N, np.int64)
            for i in range(self.N):
                syn = q16_mul(self.syn[i], self.syn_decay) + int(acc[i])
                self.syn[i] = syn
                if self.cls[i] == CLS_PEN_L:
                    ext = self.drive_l
                elif self.cls[i] == CLS_PEN_R:
                    ext = self.drive_r
                else:
                    ext = 0
                if self.landmark_active:
                    ext += q16_mul(self.landmark_current,
                                   int(self.landmark[self.landmark_wedge][i]))
                if self.refrac[i] == 0:
                    cur = syn + ext
                    self.v[i] += q16_mul(cur - q16_mul(self.v[i], self.inv_tau), self.dt)

            # Pass 4: threshold, reset and the refractory clock, after every
            # neuron has integrated -- a new spike must not reach anything
            # until the next tick.
            over = self.v >= self.v_thresh
            self.spikes = over.astype(np.int64)
            self.v = np.where(over, self.v_reset, self.v)
            self.refrac = np.where(over, self.refrac_ticks,
                                   np.maximum(self.refrac - 1, 0))
            self.history.append(self.spikes.copy())

        if self.v.min() < INT32_MIN or self.v.max() > INT32_MAX:
            raise OverflowError("membrane potential left int32 range; the C port would wrap")
        return self

    # ----------------------------------------------------------- readout --

    def rates(self):
        """Q16.16 Hz per neuron over the last rate_window ticks, as fly.c's
        record_spikes/wedge_rates compute it."""
        window = self.history[-self.rate_window:]
        counts = np.sum(window, axis=0) if window else np.zeros(self.N, np.int64)
        denom = self.rate_window * self.dt
        return np.array([(int(c) * 1000 * Q16 * Q16) // denom for c in counts], np.int64)

    def wedge_rates(self):
        """Mean EPG rate per wedge, Q16.16."""
        rate = np.zeros(self.n_wedges, np.int64)
        seen = np.zeros(self.n_wedges, np.int64)
        per = self.rates()
        for i in range(self.N):
            if self.cls[i] != CLS_EPG:
                continue
            rate[self.wedge[i]] += per[i]
            seen[self.wedge[i]] += 1
        return rate // np.maximum(seen, 1)

    def heading(self):
        """(x, y, rate_sum) -- the population vector's components, Q16.16.

        The angle and the vector's length are left to the reader, exactly as
        the behavior account leaves them: atan2 and sqrt do not belong in a VM
        with no floating point when the only consumer is a browser."""
        rate = self.wedge_rates()
        x = sum(q16_mul(rate[w], self.cos_t[w]) for w in range(self.n_wedges))
        y = sum(q16_mul(rate[w], self.sin_t[w]) for w in range(self.n_wedges))
        return int(x), int(y), int(rate.sum())

    def heading_wedges(self):
        """The heading in wedge units, the way metrics.heading reports it."""
        x, y, total = self.heading()
        ang = np.arctan2(y / Q16, x / Q16) % (2 * np.pi)
        strength = np.hypot(x / Q16, y / Q16) / (total / Q16 + 1e-9)
        return ang * self.n_wedges / (2 * np.pi), strength


def float_sim(spec_path=None, seed=0):
    """The float model, started from the SAME initial potentials the blob
    carries, so the two can be compared tick for tick."""
    import connectome
    import live
    from model_float import Input, init_state, load_spec, tick

    p, spec = load_spec(spec_path or live.SPEC_PATH)
    cx = connectome.build(p, spec.get("connectome"))
    s = init_state(cx, p, seed)
    return s, cx, p, Input, tick


VECTOR_STEPS = 400
VECTORS = os.path.join(DATA, "vectors")

# The protocol the model is specified under: a landmark anchors the bump for
# the first BOOT_LANDMARK_TICKS, then it is released and the drive steers.
BOOT_LANDMARK_TICKS = 100
LANDMARK_CURRENT = 0.30688232817139527      # spec/params_hemibrain_avg.json
LANDMARK_WEDGE = 4                          # n_wedges // 4, as live.py places it


def booted(steps=0, drive=(0.0, 0.0)):
    """A FixedSim with a bump, optionally steered for `steps` ticks after."""
    sim = FixedSim()
    sim.set_landmark(LANDMARK_CURRENT, LANDMARK_WEDGE)
    sim.step(BOOT_LANDMARK_TICKS)
    sim.set_landmark(0, 0, active=False)
    sim.drive(*drive)
    if steps:
        sim.step(steps)
    return sim


def dump_vectors(steps=VECTOR_STEPS, drive=(0.0273, -0.0273)):
    """Golden vectors for native_test.c: steps+1 frames of N int32 potentials.

    Frame 0 is the reset state, so the harness checks its binding before it
    checks any arithmetic. The run boots with the landmark and then turns under
    push-pull drive, because a ring merely sitting still exercises none of the
    rotation the port exists for -- and, released from its initial potentials
    with no landmark at all, it never spikes."""
    sim = FixedSim()
    os.makedirs(VECTORS, exist_ok=True)
    path = os.path.join(VECTORS, "turn_%d.bin" % steps)
    sim.set_landmark(LANDMARK_CURRENT, LANDMARK_WEDGE)
    with open(path, "wb") as f:
        f.write(struct.pack(f"<{sim.N}i", *(int(v) for v in sim.v)))
        for k in range(steps):
            if k == BOOT_LANDMARK_TICKS:
                sim.set_landmark(0, 0, active=False)
                sim.drive(*drive)
            sim.step(1)
            f.write(struct.pack(f"<{sim.N}i", *(int(v) for v in sim.v)))
    return path, (steps + 1) * sim.N * 4


if __name__ == "__main__":
    path, size = dump_vectors()
    print(f"{path}: {size:,} bytes")
    s = FixedSim()
    s.set_landmark(LANDMARK_CURRENT, LANDMARK_WEDGE)
    s.step(BOOT_LANDMARK_TICKS)
    w0, str0 = s.heading_wedges()
    print(f"after the {BOOT_LANDMARK_TICKS}-tick landmark: heading {w0:.2f} wedges, "
          f"strength {str0:.3f}, {int(np.sum(s.history[-50:]))} spikes in the last 50")
    s.set_landmark(0, 0, active=False)
    s.drive(0.0273, -0.0273)
    s.step(300)
    w1, str1 = s.heading_wedges()
    print(f"after 300 ticks of push-pull drive: heading {w1:.2f} wedges, strength {str1:.3f}, "
          f"{int(np.sum(s.history[-50:]))} spikes in the last 50")
    print(f"the bump moved {(w1 - w0) % 16:.2f} wedges counterclockwise")
