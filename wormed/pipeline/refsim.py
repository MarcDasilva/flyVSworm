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
