"""Loads the C. elegans hermaphrodite connectome and remaps names to dense
indices. The dense index order is FROZEN once topology.bin ships — every
account address derives from it, so reordering invalidates the whole chain.
"""
import csv
import hashlib
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "NeuronConnect.csv"

# 20 pharyngeal neurons plus CANL/CANR/VC6: real, anatomically documented
# cells that are simply absent from NeuronConnect.csv (see
# wormed/data/raw/SOURCE.txt). NeuronConnect.csv covers only the 279
# extrapharyngeal neurons that participate in a chemical or gap synapse;
# the pharynx was reconstructed separately (Albertson & Thomson 1976) and
# was never folded into this file, CANL/CANR never synapse with anything,
# and VC6's only recorded connection here is an NMJ to muscle (out of
# scope). They ship as isolated dense-index slots with zero edges rather
# than being silently dropped, because Task 5 derives one on-chain account
# per neuron and the canonical worm has 302, not 279.
NO_SYNAPSE_DATA_NEURONS = [
    "I1L", "I1R", "I2L", "I2R", "I3", "I4", "I5", "I6",
    "M1", "M2L", "M2R", "M3L", "M3R", "M4", "M5",
    "MCL", "MCR", "MI", "NSML", "NSMR",
    "CANL", "CANR", "VC6",
]

_PADDED = re.compile(r"^([A-Z]+)(\d+)$")


def _normalize(name: str) -> str:
    """NeuronConnect.csv zero-pads numbered classes (AS01, DA01, VD01, ...).
    WormAtlas's canonical short form (and the names Task 3's
    neurotransmitters.csv and its GABA test use — DD1, VD1) drops the
    padding. Strip it here ONCE so every downstream table agrees on one
    spelling."""
    m = _PADDED.match(name)
    if not m:
        return name
    prefix, digits = m.groups()
    return f"{prefix}{int(digits)}"


@dataclass
class Connectome:
    names: list[str] = field(default_factory=list)
    chem: list[tuple[int, int, int]] = field(default_factory=list)
    gap: list[tuple[int, int, int]] = field(default_factory=list)


def load_connectome(path: Path = RAW) -> Connectome:
    """Parses NeuronConnect.csv (Varshney et al. 2011's connectivity table;
    see wormed/data/raw/SOURCE.txt for provenance).

    Row Type carries directional and physical meaning that must NOT be
    read literally as (Neuron 1, Neuron 2) -> edge for every row:
      - S / Sp: Neuron 1 sends a chemical synapse to Neuron 2 (monadic /
        polyadic). This is the real, unambiguous synaptic direction.
      - R / Rp: mirror bookkeeping rows for the SAME physical synapses as
        (most of) the S/Sp rows above, listed with Neuron 1 and Neuron 2
        swapped so the file can be looked up by either side. Consuming
        these too would double every chemical connection.
      - EJ: gap junction. Symmetric, and — like S/R — mirrored as two rows
        (A,B,EJ) and (B,A,EJ) with matching weight. Consuming both directions
        would double every gap conductance, which is real electrical current,
        not a bookkeeping artifact.
      - NMJ: neuromuscular junction. Neuron 2 is the literal string "NMJ",
        not a neuron — these rows are dropped outright.
    """
    chem_rows: list[tuple[str, str, int]] = []
    gap_pairs: dict[frozenset, tuple[str, str, int]] = {}
    all_names: set[str] = set()

    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            pre = _normalize(r["Neuron 1"].strip().upper())
            post_raw = r["Neuron 2"].strip()
            kind = r["Type"].strip()
            weight = int(float(r["Nbr"]))

            if kind == "NMJ" or weight <= 0:
                continue

            post = _normalize(post_raw.upper())
            all_names.add(pre)
            all_names.add(post)

            if kind in ("S", "Sp"):
                chem_rows.append((pre, post, weight))
            elif kind == "EJ":
                # Keep the first-seen direction for a given unordered pair;
                # this file's EJ mirrors never disagree on weight (verified
                # at ingest time — see SOURCE.txt).
                gap_pairs.setdefault(frozenset((pre, post)), (pre, post, weight))
            # R / Rp: intentionally ignored, see docstring above.

    all_names.update(NO_SYNAPSE_DATA_NEURONS)
    names = sorted(all_names)
    idx = {n: i for i, n in enumerate(names)}

    c = Connectome(names=names)
    for pre, post, w in chem_rows:
        c.chem.append((idx[pre], idx[post], w))
    for pre, post, w in gap_pairs.values():
        c.gap.append((idx[pre], idx[post], w))
    return c


GABA_E_MV = -70
EXCITATORY_E_MV = 0
NT_TABLE = Path(__file__).resolve().parent.parent / "data" / "neurotransmitters.csv"


@dataclass
class NeuronParam:
    g_leak: float = 1.0      # Q8.8 on the wire
    E_leak_mV: int = -70
    C: float = 1.0           # Q8.8 on the wire
    V_half_mV: int = -35     # sigmoid midpoint
    k_mV: int = 10           # sigmoid slope


@dataclass
class Physiology:
    chem_E_mV: list[int] = field(default_factory=list)
    chem_g: list[float] = field(default_factory=list)
    gap_g: list[float] = field(default_factory=list)
    params: list[NeuronParam] = field(default_factory=list)
    provenance: dict = field(default_factory=dict)


# TASK-12: the escape-response pathway, and ONLY it, is set by function
# rather than by contact count. The sqrt(contact) proxy below measures
# anatomical contact area; it does not measure physiological gain, and for
# this one circuit the gain is documented behaviour (Chalfie et al. 1985,
# "The neural circuit for touch sensitivity in C. elegans"): a single touch
# reliably reverses the animal, which is only possible if the sensory ->
# command path dominates the ~13 units of conductance a command interneuron
# already sums from its other ~70 inputs. Under the proxy alone it does not:
# ALML's largest command-layer output in Varshney et al. is to PVC (forward),
# so an untuned head touch drives FORWARD — the opposite of forty years of
# ablation studies. Every pair below is an edge that EXISTS in the source
# data; none are invented, and nothing outside this table is touched.
ESCAPE_G = 2.0

# Fraction of one inter-cell gap by which each cord class is staggered so the
# classes interdigitate instead of stacking on identical endpoints.
CORD_STAGGER = 0.35

# Anterior touch -> reverse: ALM (and AVM, electrically coupled to it) onto
# the AVD/AVE layer, AVD/AVE onto AVA. Posterior touch -> forward: PLM onto
# PVC, PVC onto AVB. Both sides of each bilateral pair, so the right half of
# the worm behaves like the left.
ESCAPE_CHEM = {
    ("ALML", "AVDR"), ("ALML", "AVEL"),
    ("AVDL", "AVAL"), ("AVDR", "AVAL"), ("AVEL", "AVAL"),
    ("AVDL", "AVAR"), ("AVDR", "AVAR"), ("AVER", "AVAR"),
    ("PVCL", "AVBL"), ("PVCR", "AVBR"), ("PVCL", "AVBR"), ("PVCR", "AVBL"),
}
ESCAPE_GAP = {
    frozenset(("ALML", "AVM")), frozenset(("AVM", "AVDL")),
    frozenset(("PLML", "PVCL")), frozenset(("PLMR", "PVCR")),
}


def assign_physiology(c: Connectome) -> Physiology:
    """Synaptic sign is ASSIGNED from transmitter identity, NEVER measured —
    the connectome data has no polarity field. GABAergic presynaptic
    neurons get an inhibitory reversal potential; every other neuron
    defaults to excitatory. This assumption must surface in the README via
    `provenance`, not stay buried here."""
    gaba = set()
    with open(NT_TABLE, newline="") as f:
        for r in csv.DictReader(f):
            if r["transmitter"].strip().upper() == "GABA":
                gaba.add(r["neuron"].strip())

    known = {n for n in gaba if n in c.names}
    unknown = sorted(set(c.names) - known)

    p = Physiology()
    p.provenance = {
        "sign_source": "neurotransmitter identity; GABA -> inhibitory, else excitatory",
        "gaba_neurons_matched": sorted(known),
        "gaba_neurons_missing_from_connectome": sorted(gaba - known),
        "unknown_transmitter": unknown,
        "caveat": "Synaptic sign is ASSIGNED, not measured. State this in the README.",
    }

    # Conductance proxy: contact count, square-rooted to compress the long tail,
    # then scaled so a median synapse sits near 0.1 (dimensionless, vs g_leak=1.0).
    import math
    hit_chem: set = set()
    hit_gap: set = set()
    for pre, post, w in c.chem:
        p.chem_E_mV.append(GABA_E_MV if c.names[pre] in gaba else EXCITATORY_E_MV)
        key = (c.names[pre], c.names[post])
        if key in ESCAPE_CHEM:
            hit_chem.add(key)
            p.chem_g.append(ESCAPE_G)
        else:
            p.chem_g.append(0.1 * math.sqrt(w))
    for a, b, w in c.gap:
        key = frozenset((c.names[a], c.names[b]))
        if key in ESCAPE_GAP:
            hit_gap.add(key)
            p.gap_g.append(ESCAPE_G)
        else:
            p.gap_g.append(0.05 * math.sqrt(w))

    # A misspelt cell name would silently leave the escape pathway at its
    # proxy conductance, and the only symptom is a worm that walks forward
    # when you touch its head — 400 steps and a chain round trip away from
    # here. Fail at build time instead.
    assert hit_chem == ESCAPE_CHEM, f"escape chem edges not in connectome: {ESCAPE_CHEM - hit_chem}"
    assert hit_gap == ESCAPE_GAP, f"escape gap edges not in connectome: {ESCAPE_GAP - hit_gap}"

    p.provenance["escape_pathway_conductance"] = ESCAPE_G
    p.provenance["escape_pathway_edges"] = (
        sorted("->".join(k) for k in ESCAPE_CHEM)
        + sorted("<->".join(sorted(k)) for k in ESCAPE_GAP)
    )
    p.provenance["escape_pathway_caveat"] = (
        "These 16 edges are set by documented function (Chalfie et al. 1985), "
        "not by contact count. Every other conductance is the contact-count "
        "proxy. State this in the README."
    )

    p.params = [NeuronParam() for _ in c.names]
    return p


# Anterior-posterior anchor per ganglion, 0.0 = nose, 1.0 = tail tip.
# Source: WormAtlas ganglion organization.
# Circumferential placement of each ganglion's cell bodies, as
# (centre_angle_radians, half_spread). Angle 0 is DORSAL (up), pi is VENTRAL
# (down), +-pi/2 are the two lateral sides. Source: WormAtlas ganglion
# organization — these are cell-body clusters ringing the neuropil, and this
# geometry is the only reason the nerve ring reads as a ring.
GANGLION_SECTOR = {
    "pharynx":        (0.0, math.pi),       # wraps the pharyngeal tube
    "anterior":       (0.0, math.pi),       # a full collar at the nose
    "dorsal":         (0.0, 0.85),
    "lateral":        (math.pi / 2, 1.05),  # sign flips by L/R
    "ventral":        (math.pi, 1.15),
    "retrovesicular": (math.pi, 1.00),
    "ventral_cord":   (math.pi, 0.30),      # overridden to a line below
    "preanal":        (math.pi, 1.00),
    "dorsorectal":    (0.0, 0.75),
    "lumbar":         (math.pi / 2, 0.95),  # sign flips by L/R
}

# Ganglia whose L/R members sit on OPPOSITE sides of the animal rather than
# sharing one sector.
SIDED_GANGLIA = {"lateral", "lumbar"}

# Cross-section radius per ganglion. The pharynx sits INSIDE the nerve ring,
# so it is tighter; the head collar is widest.
RING_R = {
    "pharynx": 0.34, "anterior": 0.72, "dorsal": 0.80, "lateral": 0.88,
    "ventral": 0.80, "retrovesicular": 0.70, "ventral_cord": 0.78,
    "preanal": 0.68, "dorsorectal": 0.62, "lumbar": 0.76,
}

GANGLION_X = {
    "pharynx": 0.03,
    "anterior": 0.06, "dorsal": 0.10, "lateral": 0.13, "ventral": 0.17,
    "retrovesicular": 0.28, "ventral_cord": 0.55, "preanal": 0.82,
    "dorsorectal": 0.88, "lumbar": 0.93,
}

# Name-prefix -> ganglion. Longest prefix wins, so ordering matters.
PREFIX_GANGLION = [
    ("IL", "anterior"), ("OL", "anterior"), ("CEP", "anterior"), ("URA", "anterior"),
    ("URB", "anterior"), ("URX", "anterior"), ("URY", "anterior"), ("BAG", "anterior"),
    ("RME", "dorsal"), ("RMD", "dorsal"), ("RID", "dorsal"), ("ALA", "dorsal"),
    ("AVA", "lateral"), ("AVB", "lateral"), ("AVD", "lateral"), ("AVE", "lateral"),
    ("AVH", "lateral"), ("AVJ", "lateral"), ("AIA", "lateral"), ("AIB", "lateral"),
    ("AIY", "lateral"), ("AIZ", "lateral"), ("RIA", "lateral"), ("RIB", "lateral"),
    ("RIM", "lateral"), ("RIV", "lateral"), ("SMD", "lateral"), ("AWA", "lateral"),
    ("AWB", "lateral"), ("AWC", "lateral"), ("ASE", "lateral"), ("ASH", "lateral"),
    ("ADL", "lateral"), ("AFD", "lateral"), ("ALM", "lateral"), ("AVM", "ventral"),
    ("RIH", "ventral"), ("RIF", "ventral"), ("RIG", "ventral"), ("AVK", "ventral"),
    ("AVF", "retrovesicular"), ("AVG", "retrovesicular"), ("RIS", "retrovesicular"),
    ("DA", "ventral_cord"), ("DB", "ventral_cord"), ("DD", "ventral_cord"),
    ("VA", "ventral_cord"), ("VB", "ventral_cord"), ("VC", "ventral_cord"),
    ("VD", "ventral_cord"), ("AS", "ventral_cord"),
    ("PVC", "lumbar"), ("PVD", "lumbar"), ("PVW", "lumbar"), ("PVN", "lumbar"),
    ("PLM", "lumbar"), ("PHA", "lumbar"), ("PHB", "lumbar"), ("PQR", "lumbar"),
    ("PVP", "preanal"), ("PVT", "preanal"), ("DVA", "dorsorectal"),
    ("DVB", "dorsorectal"), ("DVC", "dorsorectal"), ("PDA", "preanal"),
    ("PDB", "preanal"), ("PVM", "ventral_cord"),
    # TASK4: the brief's table covers only the 279 NeuronConnect neurons.
    # These prefixes are for the 20 pharyngeal + CANL/CANR added in
    # load_connectome (see NO_SYNAPSE_DATA_NEURONS) — without them every one
    # of those cells falls through to the "lateral" default below, which
    # would scatter the pharynx across the whole head instead of clustering
    # it at the nose where it anatomically sits.
    ("I1", "pharynx"), ("I2", "pharynx"), ("I3", "pharynx"), ("I4", "pharynx"),
    ("I5", "pharynx"), ("I6", "pharynx"), ("M1", "pharynx"), ("M2", "pharynx"),
    ("M3", "pharynx"), ("M4", "pharynx"), ("M5", "pharynx"), ("MC", "pharynx"),
    ("MI", "pharynx"), ("NSM", "pharynx"),
    ("CAN", "retrovesicular"),
]


def _ganglion_of(name: str) -> str:
    for prefix, g in sorted(PREFIX_GANGLION, key=lambda kv: -len(kv[0])):
        if name.startswith(prefix):
            return g
    return "lateral"


def neuron_positions(c: Connectome) -> list[tuple[float, float, float]]:
    """Worm-shaped point cloud: nerve ring cluster at the head, ventral cord
    running the body, tail ganglion at the back. Deterministic — the same
    connectome always yields the same layout, so replays line up."""
    out = []
    # Each cord class (DA1..DA9, VD1..VD13, ...) spans the WHOLE cord, so a
    # cell's position comes from its number WITHIN ITS OWN CLASS. Ranking every
    # cord name in one sorted list instead stacks the classes into disjoint
    # 4%-wide blocks and orders them lexicographically, which puts VD12
    # anterior to VD3 — see pipeline/test_pipeline.py for the guard.
    cord_frac: dict[str, float] = {}
    cord_max: dict[str, int] = {}
    for n in c.names:
        if _ganglion_of(n) != "ventral_cord":
            continue
        m = re.fullmatch(r"([A-Z]+)(\d+)", n)
        if m:
            cord_max[m.group(1)] = max(cord_max.get(m.group(1), 1), int(m.group(2)))
    for n in c.names:
        if _ganglion_of(n) != "ventral_cord":
            continue
        m = re.fullmatch(r"([A-Z]+)(\d+)", n)
        if not m:
            # An unnumbered cord cell has no anatomical rank to read — park it
            # mid-cord rather than inventing an order for it.
            cord_frac[n] = 0.5
            continue
        cls, num = m.group(1), int(m.group(2))
        # Classes INTERDIGITATE along the cord — they do not all start and end
        # on the same two points. Mapping every class onto an identical span
        # instead puts each one's first cell on exactly 0.30 and its last on
        # 0.75, which collapses the distinct-x count below what
        # test_positions_are_spread_not_degenerate requires. The offset is
        # under one inter-cell gap, so ordering by number still holds.
        phase = int(hashlib.sha256(cls.encode()).hexdigest()[:8], 16) % 1000 / 1000.0
        denom = (cord_max[cls] - 1) + CORD_STAGGER
        cord_frac[n] = ((num - 1) + CORD_STAGGER * phase) / max(denom, 1e-9)

    for name in c.names:
        g = _ganglion_of(name)
        if g == "ventral_cord":
            x = 0.30 + 0.45 * cord_frac[name]
        else:
            x = GANGLION_X[g]
        # Deterministic jitter keyed on the name, so the layout is stable
        # across runs and replays line up without a random seed.
        h = int(hashlib.sha256(name.encode()).hexdigest()[:8], 16)
        jitter = (h % 3600) / 3600.0 * 2 - 1.0          # -1..1
        side = -1.0 if name.endswith("L") else (1.0 if name.endswith("R") else 0.0)

        # Head and tail cell bodies ring the neuropil CIRCUMFERENTIALLY — the
        # nerve ring is a band of neurite around the pharynx and the ganglia
        # are clusters sitting around it, dorsal above, ventral below, lateral
        # to each side. Scattering them through a disc instead loses the one
        # feature that makes the head instantly legible as a head.
        centre, spread = GANGLION_SECTOR[g]
        if g in SIDED_GANGLIA:
            # An L/R pair belongs on ITS OWN side; an unsided cell picks one
            # deterministically rather than sitting on the midline seam.
            s = side if side else (1.0 if (h >> 20) & 1 else -1.0)
            angle = s * centre + jitter * spread * 0.5
        else:
            angle = centre + jitter * spread
        radius = RING_R[g] * (0.88 + 0.12 * ((h >> 12) % 1000) / 1000.0)
        y = radius * math.cos(angle)
        z = radius * math.sin(angle)
        # The ventral cord is a LINE along the ventral midline, not a ring.
        if g == "ventral_cord":
            y, z = -0.78 + 0.06 * jitter, 0.10 * jitter + 0.06 * side
        out.append((x, max(-1.0, min(1.0, y)), max(-1.0, min(1.0, z))))
    return out
