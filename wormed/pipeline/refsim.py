"""Reference simulators. FloatSim is the ground truth for the model; FixedSim
(Task 7) is the ground truth for the arithmetic. The C code is asserted against
FixedSim, and FixedSim against FloatSim. Three links, each independently
checkable — that chain is how you localize a bug on Sunday morning."""
import json, struct
import numpy as np
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DT_MS = 5.0

class FloatSim:
    def __init__(self, topology_path: Path = DATA / "topology.bin"):
        blob = topology_path.read_bytes()
        h = struct.unpack_from("<16I", blob, 0)
        (magic, _ver, self.n, self.n_chem, self.n_gap,
         _slot, o_crp, o_cc, o_cg, o_ce, o_grp, o_gc, o_gg, o_par, o_lut, _tot) = h
        assert magic == 0x574F524D

        u = lambda fmt, cnt, off: np.array(struct.unpack_from(f"<{cnt}{fmt}", blob, off))
        self.chem_rowptr = u("I", self.n + 1, o_crp)
        self.chem_col    = u("H", self.n_chem, o_cc)
        self.chem_g      = u("h", self.n_chem, o_cg).astype(np.float64) / 256.0
        self.chem_E      = u("h", self.n_chem, o_ce).astype(np.float64)
        self.gap_rowptr  = u("I", self.n + 1, o_grp)
        self.gap_col     = u("H", self.n_gap, o_gc)
        self.gap_g       = u("h", self.n_gap, o_gg).astype(np.float64) / 256.0

        par = u("h", self.n * 8, o_par).reshape(self.n, 8)
        self.g_leak  = par[:, 0].astype(np.float64) / 256.0
        self.E_leak  = par[:, 1].astype(np.float64)
        self.C       = par[:, 2].astype(np.float64) / 256.0
        self.V_half  = par[:, 3].astype(np.float64)
        self.k_recip = par[:, 4].astype(np.float64) / 256.0

        self.names = json.loads((DATA / "names.json").read_text())
        self.V = self.E_leak.copy()
        self.i_stim = np.zeros(self.n)

    def stimulate(self, name: str, current: float) -> None:
        self.i_stim[self.names.index(name)] = current

    def step(self, n: int = 1) -> None:
        for _ in range(n):
            s = 1.0 / (1.0 + np.exp(-(self.V - self.V_half) * self.k_recip))
            g_tot  = self.g_leak.copy()
            gE_tot = self.g_leak * self.E_leak + self.i_stim

            # Chemical: conductance gated by presynaptic activation.
            for i in range(self.n):
                for e in range(self.chem_rowptr[i], self.chem_rowptr[i + 1]):
                    g = self.chem_g[e] * s[self.chem_col[e]]
                    g_tot[i]  += g
                    gE_tot[i] += g * self.chem_E[e]
                # Gap: ohmic, so the "reversal potential" IS the partner's V.
                for e in range(self.gap_rowptr[i], self.gap_rowptr[i + 1]):
                    g = self.gap_g[e]
                    g_tot[i]  += g
                    gE_tot[i] += g * self.V[self.gap_col[e]]

            # Backward Euler. Unconditionally stable — this is why dt can be 5ms.
            self.V = (self.C * self.V + DT_MS * gE_tot) / (self.C + DT_MS * g_tot)

Q16 = 65536
LUT_ENTRIES = 257
LUT_SPAN = 8 * Q16        # LUT covers x in [-8, +8]
LUT_STEP_SHIFT = 12       # (16 << 16) / 256 == 4096 == 1 << 12

def q16_mul(a: int, b: int) -> int:
    """Mirrors the C q16_mul exactly, including truncation toward negative
    infinity via arithmetic shift. Python's >> on negative ints already floors,
    which matches RISC-V sra. Do not 'fix' this to round."""
    return (a * b) >> 16

def sigmoid_q16(x: int, lut: list[int]) -> int:
    if x < -LUT_SPAN: x = -LUT_SPAN
    if x >  LUT_SPAN - 1: x = LUT_SPAN - 1
    t = x + LUT_SPAN
    idx = t >> LUT_STEP_SHIFT
    frac = t & ((1 << LUT_STEP_SHIFT) - 1)
    lo, hi = lut[idx], lut[idx + 1]
    return lo + (((hi - lo) * frac) >> LUT_STEP_SHIFT)

class FixedSim(FloatSim):
    def __init__(self, topology_path=DATA / "topology.bin"):
        super().__init__(topology_path)
        blob = topology_path.read_bytes()
        o_lut = struct.unpack_from("<I", blob, 0x38)[0]
        self.lut = list(struct.unpack_from(f"<{LUT_ENTRIES}i", blob, o_lut))
        self.V = [int(v) * Q16 for v in self.E_leak]
        self.i_stim = [0] * self.n
        # Read the raw Q8.8 integers rather than round-tripping through float —
        # a float round-trip would introduce exactly the rounding difference the
        # bit-for-bit assert exists to catch.
        self.q_chem_g = list(struct.unpack_from(
            f"<{self.n_chem}h", blob, struct.unpack_from("<I", blob, 0x20)[0]))
        self.q_chem_E = list(struct.unpack_from(
            f"<{self.n_chem}h", blob, struct.unpack_from("<I", blob, 0x24)[0]))
        self.q_gap_g = list(struct.unpack_from(
            f"<{self.n_gap}h", blob, struct.unpack_from("<I", blob, 0x30)[0]))
        par_off = struct.unpack_from("<I", blob, 0x34)[0]
        par = list(struct.unpack_from(f"<{self.n * 8}h", blob, par_off))
        self.q_g_leak  = [par[i * 8 + 0] for i in range(self.n)]
        self.q_E_leak  = [par[i * 8 + 1] for i in range(self.n)]
        self.q_C       = [par[i * 8 + 2] for i in range(self.n)]
        self.q_V_half  = [par[i * 8 + 3] for i in range(self.n)]
        self.q_k_recip = [par[i * 8 + 4] for i in range(self.n)]
        self.dt = int(DT_MS * Q16)

    def stimulate(self, name: str, current: float) -> None:
        self.i_stim[self.names.index(name)] = int(current * Q16)

    def step(self, n: int = 1) -> None:
        for _ in range(n):
            # Pass 1: activation is per PRESYNAPTIC neuron, so 302 evaluations,
            # not 7000. Roughly half the compute budget lives in this choice.
            s = [sigmoid_q16(q16_mul(self.V[j] - (self.q_V_half[j] * Q16),
                                     self.q_k_recip[j] << 8), self.lut)
                 for j in range(self.n)]
            v_next = [0] * self.n
            for i in range(self.n):
                g_leak = self.q_g_leak[i] << 8          # Q8.8 -> Q16.16
                acc_g = g_leak
                acc_gE = q16_mul(g_leak, self.q_E_leak[i] * Q16) + self.i_stim[i]
                # Pass 2: accumulate. int64 in C; Python ints are arbitrary
                # precision, which is exactly why the overflow test above exists.
                for e in range(self.chem_rowptr[i], self.chem_rowptr[i + 1]):
                    g = q16_mul(self.q_chem_g[e] << 8, s[self.chem_col[e]])
                    acc_g += g
                    acc_gE += q16_mul(g, self.q_chem_E[e] * Q16)
                for e in range(self.gap_rowptr[i], self.gap_rowptr[i + 1]):
                    g = self.q_gap_g[e] << 8
                    acc_g += g
                    acc_gE += q16_mul(g, self.V[self.gap_col[e]])
                # Pass 3: backward Euler. ONE divide per neuron, not per synapse.
                num = q16_mul(self.q_C[i] << 8, self.V[i]) + q16_mul(self.dt, acc_gE)
                den = (self.q_C[i] << 8) + q16_mul(self.dt, acc_g)
                v_next[i] = (num << 16) // den
            self.V = v_next

def dump_vectors(path: Path = DATA / "vectors" / "alm_400.bin") -> Path:
    """The golden vector native_test.c diffs against. 401 frames: the initial
    state plus 400 steps."""
    path.parent.mkdir(parents=True, exist_ok=True)
    x = FixedSim()
    x.stimulate("ALML", 40.0)
    buf = bytearray()
    buf.extend(struct.pack(f"<{x.n}i", *x.V))
    for _ in range(400):
        x.step(1)
        buf.extend(struct.pack(f"<{x.n}i", *x.V))
    path.write_bytes(bytes(buf))
    return path
