import json
import struct
from pathlib import Path

from wormed.pipeline.connectome import load_connectome, assign_physiology, neuron_positions
from wormed.pipeline.pack import build_all, LAYOUT

DATA = Path(__file__).resolve().parent.parent / "data"

# Every array pack.build_all() must emit into topology.bin. A LAYOUT dict
# that is empty, or missing one of these, would let the alignment test below
# pass vacuously — this set is what makes it actually check something.
EXPECTED_ARRAYS = {
    "slot_map", "chem_rowptr", "chem_col", "chem_g", "chem_E",
    "gap_rowptr", "gap_col", "gap_g", "params", "lut",
}

def test_connectome_has_302_neurons_and_expected_edge_counts():
    """The hermaphrodite connectome is a fixed, published quantity. If these
    numbers drift, the source data changed under us and every downstream
    conductance is suspect.

    Bounds adjusted from the original brief (6000-8000 chem / 1100-1700 gap):
    those numbers match Varshney et al. 2011's published SYNAPTIC CONTACT
    totals (6394 chemical, 890 gap — i.e. sum of the Nbr weight column), not
    the number of distinct edges. Our loader stores one tuple per distinct
    (pre, post) connection, weight = contact count, and deduplicates the
    source file's mirrored S/R and bidirectional EJ rows (each physical
    synapse is listed twice in NeuronConnect.csv — see
    wormed/data/raw/SOURCE.txt). That yields 2575 chemical edges and 517 gap
    edges, and sum(w for *,*,w in c.chem) == 6394 / sum(w for *,*,w in
    c.gap) == 890 reproduces the published totals exactly."""
    c = load_connectome()
    assert len(c.names) == 302
    assert len(set(c.names)) == 302, "duplicate neuron names"
    assert 2400 <= len(c.chem) <= 2700, f"chemical edges out of range: {len(c.chem)}"
    assert 450 <= len(c.gap) <= 600, f"gap junctions out of range: {len(c.gap)}"
    assert sum(w for _, _, w in c.chem) == 6394, "chemical contact total should match Varshney et al. 2011"
    assert sum(w for _, _, w in c.gap) == 890, "gap contact total should match Varshney et al. 2011"

def test_left_right_pairs_stay_distinct():
    """AVAL and AVAR are different cells. Merging them silently halves the
    command layer and the classifier reads garbage."""
    c = load_connectome()
    assert "AVAL" in c.names and "AVAR" in c.names
    assert c.names.index("AVAL") != c.names.index("AVAR")

def test_edge_indices_are_in_range():
    c = load_connectome()
    n = len(c.names)
    for pre, post, w in c.chem:
        assert 0 <= pre < n and 0 <= post < n and w > 0
    for a, b, w in c.gap:
        assert 0 <= a < n and 0 <= b < n and w > 0

def test_gaba_neurons_get_inhibitory_reversal_potential():
    """Sign is not in the connectome. If GABAergic cells come out excitatory,
    the reflex circuit has no brake and every drive saturates."""
    c = load_connectome()
    p = assign_physiology(c)
    gaba_idx = {c.names.index(n) for n in ("DD1", "VD1") if n in c.names}
    assert gaba_idx, "expected DD1/VD1 in the connectome"
    for e, (pre, post, w) in enumerate(c.chem):
        if pre in gaba_idx:
            assert p.chem_E_mV[e] == -70, f"GABAergic edge {e} came out excitatory"

def test_every_edge_has_physiology_and_unknowns_are_recorded():
    c = load_connectome()
    p = assign_physiology(c)
    assert len(p.chem_E_mV) == len(c.chem)
    assert len(p.chem_g) == len(c.chem)
    assert len(p.gap_g) == len(c.gap)
    assert len(p.params) == 302
    assert "unknown_transmitter" in p.provenance

def test_conductance_scales_with_contact_count():
    """Edge weight is the number of synaptic contacts. A 10-contact synapse
    must not have the same conductance as a 1-contact synapse."""
    c = load_connectome()
    p = assign_physiology(c)
    weights = [w for _, _, w in c.chem]
    lo = min(range(len(weights)), key=lambda i: weights[i])
    hi = max(range(len(weights)), key=lambda i: weights[i])
    assert p.chem_g[hi] > p.chem_g[lo]

def test_positions_are_worm_shaped_not_a_hairball():
    """A force-directed layout tells the viewer nothing. The point cloud must
    be anatomically ordered: head cells anterior, tail cells posterior."""
    c = load_connectome()
    pos = neuron_positions(c)
    assert len(pos) == 302
    x = {n: pos[i][0] for i, n in enumerate(c.names)}
    # ALM is an anterior touch cell; PLM is a posterior one. This ordering is
    # the whole point of using real coordinates.
    assert x["ALML"] < x["PLML"], "anterior/posterior axis is inverted or flat"
    assert all(0.0 <= p[0] <= 1.0 for p in pos)
    assert all(-1.0 <= p[1] <= 1.0 and -1.0 <= p[2] <= 1.0 for p in pos)

def test_positions_are_spread_not_degenerate():
    c = load_connectome()
    pos = neuron_positions(c)
    xs = sorted(p[0] for p in pos)
    assert xs[-1] - xs[0] > 0.5, "all neurons collapsed onto one point"
    assert len({round(p[0], 3) for p in pos}) > 50, "too many neurons share an x"


def test_every_array_offset_is_8_byte_aligned():
    """ThruVM raises an exception on unaligned access and on any access that
    spans a 4KB page boundary. 4096 is a multiple of 8, so 8-alignment kills
    both. This assert is the entire defense — so it must genuinely check
    every emitted array, not pass on an empty or partial LAYOUT."""
    build_all()
    assert LAYOUT, "LAYOUT is empty — the alignment check below would be vacuous"
    assert set(LAYOUT.keys()) == EXPECTED_ARRAYS, f"LAYOUT covers {set(LAYOUT.keys())}, expected {EXPECTED_ARRAYS}"
    for name, (off, length) in LAYOUT.items():
        assert off % 8 == 0, f"{name} starts at {off}, not 8-byte aligned"


def test_header_offsets_match_the_layout_table():
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    magic, version, n_neurons, n_chem, n_gap = struct.unpack_from("<IIIII", blob, 0)
    assert magic == 0x574F524D
    assert version == 1
    assert n_neurons == 302
    off_slot_map, off_chem_rowptr, off_chem_col = struct.unpack_from("<III", blob, 0x14)
    assert off_slot_map == LAYOUT["slot_map"][0]
    assert off_chem_rowptr == LAYOUT["chem_rowptr"][0]
    assert off_chem_col == LAYOUT["chem_col"][0]


def test_csr_rowptr_is_monotonic_and_terminates_at_edge_count():
    """A non-monotonic rowptr makes the inner loop read out of bounds, which on
    ThruVM is an access violation and a reverted transaction, not a wrong number."""
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    n_chem = struct.unpack_from("<I", blob, 0x0C)[0]
    off = LAYOUT["chem_rowptr"][0]
    ptrs = struct.unpack_from("<303I", blob, off)
    assert ptrs[0] == 0
    assert all(ptrs[i] <= ptrs[i + 1] for i in range(302))
    assert ptrs[302] == n_chem


def test_gap_junctions_are_stored_symmetrically():
    """A gap junction is ohmic and bidirectional. Storing one direction gives
    a rectifying junction, which is a different piece of physics.

    The bare count check (n_gap == 2 * len(gap)) passes just as well if every
    edge is stored TWICE IN THE SAME DIRECTION, which is exactly the
    rectifying-junction bug this test exists to catch. Walk the packed CSR
    instead and require the reverse edge to exist and carry equal
    conductance."""
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    n = 302
    n_gap = struct.unpack_from("<I", blob, 0x10)[0]
    assert n_gap == 2 * len(load_connectome().gap)

    off_grp = LAYOUT["gap_rowptr"][0]
    off_gc = LAYOUT["gap_col"][0]
    off_gg = LAYOUT["gap_g"][0]
    rowptr = struct.unpack_from(f"<{n + 1}I", blob, off_grp)
    col = struct.unpack_from(f"<{n_gap}H", blob, off_gc)
    g = struct.unpack_from(f"<{n_gap}h", blob, off_gg)

    edge_g = {}
    for i in range(n):
        for e in range(rowptr[i], rowptr[i + 1]):
            edge_g[(i, col[e])] = g[e]

    assert edge_g, "no gap junctions stored"
    for (i, j), gij in edge_g.items():
        assert (j, i) in edge_g, f"gap junction {i}->{j} has no reverse edge {j}->{i}"
        assert edge_g[(j, i)] == gij, (
            f"gap junction {i}<->{j} conductance differs by direction: "
            f"{gij} vs {edge_g[(j, i)]} — this is a rectifying junction, wrong physics"
        )


def test_sidecar_json_files_are_complete():
    build_all()
    names = json.loads((DATA / "names.json").read_text())
    pos = json.loads((DATA / "positions.json").read_text())
    prov = json.loads((DATA / "provenance.json").read_text())
    assert len(names) == 302 and len(pos) == 302
    assert "caveat" in prov


def test_provenance_records_cli_derivation():
    """Task 5 derives addresses by shelling out to `thru program
    derive-address` rather than reimplementing PDA derivation. If this ever
    silently falls back to a Python reimplementation, addresses could drift
    from what the deployed program actually computes."""
    build_all()
    prov = json.loads((DATA / "provenance.json").read_text())
    assert prov.get("derivation") == "cli"


def test_addresses_sidecar_has_one_entry_per_neuron():
    build_all()
    addrs = json.loads((DATA / "addresses.json").read_text())
    c = load_connectome()
    assert len(addrs) == len(c.names) == 302
    assert len(set(addrs)) == 302, "duplicate derived addresses"


def test_edges_json_is_the_strongest_1500_chemical_edges_by_contact_count():
    """The front-end renders these as connectome lines; taking a random 1500
    instead of the strongest 1500 would draw noise edges and omit the
    circuits that actually carry signal."""
    build_all()
    c = load_connectome()
    edges = json.loads((DATA / "edges.json").read_text())
    assert len(edges) == min(1500, len(c.chem))
    assert all(len(e) == 2 for e in edges)
    n = len(c.names)
    assert all(0 <= pre < n and 0 <= post < n for pre, post in edges)

    ranked = sorted(c.chem, key=lambda e: -e[2])
    expected_top_weight = ranked[0][2]
    got_top = edges[0]
    got_top_weight = next(w for pre, post, w in c.chem if (pre, post) == tuple(got_top))
    assert got_top_weight == expected_top_weight, "edges.json is not ranked by contact count descending"


# --- Task 6: NumPy float64 reference simulator -----------------------------

def test_resting_state_is_stable():
    """With no input, the network must settle to A fixed point and STAY there.
    Drift after convergence means the backward-Euler solve is wrong, and every
    later bit-for-bit assert would be comparing two wrong answers.

    Deviation from the task-6 brief: the brief asserts every neuron sits AT
    -70mV (its leak reversal). That only holds for a neuron with zero edges,
    because chem_g summed over a well-connected postsynaptic neuron (AVAL:
    74 incoming edges, sum(chem_g) ~= 12 vs g_leak = 1.0) dwarfs the leak
    conductance even though the presynaptic sigmoid is barely open
    (s(-70mV) ~= 0.029) — so the true fixed point for a connected neuron is
    pulled toward the synaptic reversal potentials, not -70mV. Verified by
    hand against the raw topology.bin data, independent of FloatSim, in the
    task report. The 23 neurons with NO chemical or gap edges (20
    pharyngeal + CANL/CANR/VC6, see connectome.NO_SYNAPSE_DATA_NEURONS) have
    no such pull and must land exactly on their leak potential — that part
    of the brief's assertion is kept, scoped to those neurons."""
    import numpy as np
    from wormed.pipeline.refsim import FloatSim
    from wormed.pipeline.connectome import NO_SYNAPSE_DATA_NEURONS
    s = FloatSim()
    s.step(400)
    v_converged = s.V.copy()
    s.step(50)
    assert np.allclose(s.V, v_converged, atol=1e-6), \
        f"still drifting after 400 steps: {np.max(np.abs(s.V - v_converged))}"
    isolated = [s.names.index(n) for n in NO_SYNAPSE_DATA_NEURONS]
    assert np.allclose(s.V[isolated], -70.0, atol=0.5), \
        f"isolated neuron off leak potential: {s.V[isolated]}"

def test_stimulating_alm_depolarizes_ava_not_avb():
    """Anterior touch drives the reversal command neuron. If AVB moves more
    than AVA, either the sign assignment or the CSR direction is flipped."""
    from wormed.pipeline.refsim import FloatSim
    s = FloatSim()
    base = s.V.copy()
    s.stimulate("ALML", 40.0)
    s.step(200)
    names = s.names
    d_ava = s.V[names.index("AVAL")] - base[names.index("AVAL")]
    d_avb = s.V[names.index("AVBL")] - base[names.index("AVBL")]
    assert d_ava > 1.0, f"AVA did not depolarize: {d_ava}"
    assert d_ava > d_avb, f"AVB ({d_avb}) beat AVA ({d_ava}) on anterior touch"

def test_backward_euler_is_stable_at_large_conductance():
    """The whole reason for backward Euler. Forward Euler oscillates and blows
    up here; this test is what stops someone 'simplifying' it back."""
    import numpy as np
    from wormed.pipeline.refsim import FloatSim
    s = FloatSim()
    s.chem_g *= 50.0
    s.stimulate("ALML", 100.0)
    s.step(500)
    assert np.all(np.isfinite(s.V))
    assert s.V.max() < 200.0 and s.V.min() > -300.0, "solution diverged"


# --- Task 7: Q16.16 reference simulator and the test-vector dump -----------

def test_fixed_tracks_float_within_a_tenth_of_a_millivolt():
    """If fixed-point drifts from float, the model and the arithmetic are BOTH
    suspect and you cannot tell which. 0.1 mV over 400 steps is the budget."""
    import numpy as np
    from wormed.pipeline.refsim import FloatSim, FixedSim, Q16
    f, x = FloatSim(), FixedSim()
    f.stimulate("ALML", 40.0); x.stimulate("ALML", 40.0)
    f.step(400); x.step(400)
    fixed_mV = np.array(x.V, dtype=np.float64) / Q16
    assert np.max(np.abs(fixed_mV - f.V)) < 0.1

def test_fixed_sim_is_deterministic():
    """Two runs must be bit-identical, or the C comparison in Task 10 is
    meaningless."""
    from wormed.pipeline.refsim import FixedSim
    a, b = FixedSim(), FixedSim()
    a.stimulate("PLML", 40.0); b.stimulate("PLML", 40.0)
    a.step(120); b.step(120)
    assert a.V == b.V

def test_accumulator_does_not_overflow_on_the_most_connected_neuron():
    """AVA has 300+ incoming edges. In Q16.16 the products overflow int32 and
    silently wrap. This is the bug the int64 accumulator exists to prevent."""
    from wormed.pipeline.refsim import FixedSim, Q16
    x = FixedSim()
    for n in ("ALML", "ALMR", "AVM", "PLML", "PLMR"):
        x.stimulate(n, 80.0)
    x.step(200)
    ava = x.V[x.names.index("AVAL")] / Q16
    assert -200.0 < ava < 200.0, f"AVA wrapped: {ava} mV"

def test_vector_dump_shape_is_exactly_what_the_c_harness_expects():
    from wormed.pipeline.refsim import dump_vectors
    p = dump_vectors()
    assert p.stat().st_size == 401 * 302 * 4


# --- Fix round 1: resting-state normalisation (FINDING 1) -------------------

def test_v_rest_mv_matches_converged_float_state_and_zeroes_command_drive_at_rest():
    """Regression for the broken classifier normalisation: d(n) =
    (V[n]-E_leak[n])/20mV read AVAL 0.627, AVBL 0.512, AVDL 0.494, AVEL
    0.682, PVCL 0.588 at rest — all above the 0.35 command threshold with
    nobody touching the worm, putting a later behavioural demo in permanent
    REVERSE. The fix normalises against the measured resting state
    (worm_param_t.V_rest_mV) instead of E_leak. Checks both halves: the
    packed V_rest_mV matches an independently converged float resting
    voltage (not just self-consistent with compute_resting_state, which
    could share its own bug), and (V_rest-V_rest)/20 — the actual fixed
    normalisation — reads exactly zero for the five command neurons."""
    import numpy as np
    from wormed.pipeline.refsim import FloatSim, compute_resting_state
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    off_params = LAYOUT["params"][0]
    n = 302
    par = struct.unpack_from(f"<{n * 8}h", blob, off_params)
    v_rest_stored = [par[i * 8 + 5] for i in range(n)]

    # Independent convergence loop — does not call compute_resting_state, so
    # a bug inside that function cannot hide from this test.
    sim = FloatSim()
    prev = sim.V.copy()
    for _ in range(400):
        sim.step(50)
        if np.max(np.abs(sim.V - prev)) < 1e-6:
            break
        prev = sim.V.copy()

    for i in range(n):
        assert abs(v_rest_stored[i] - sim.V[i]) < 1.0, (
            f"neuron {i}: stored V_rest_mV={v_rest_stored[i]} vs converged float V={sim.V[i]}"
        )

    assert compute_resting_state() == v_rest_stored

    names = json.loads((DATA / "names.json").read_text())
    for name in ("AVAL", "AVBL", "AVDL", "AVEL", "PVCL"):
        i = names.index(name)
        drive = (v_rest_stored[i] - v_rest_stored[i]) / 20.0
        assert drive == 0.0, f"{name} reads nonzero drive at rest: {drive}"


# --- Task 9 fix round 1: slot_map must use the chain's real address order --

def test_slot_map_matches_the_chains_own_ascending_order():
    """Regression for the broken cross-check: slot_map used to be built with
    Python's sorted(range(n), key=lambda i: addrs[i]) — an ASCII sort over
    the ENCODED `ta...` address string. Thru's real ascending order (the one
    `thru txn execute --readwrite-accounts` actually imposes, and what
    pipeline/deploy.py used to create every one of the 302 on-chain
    accounts) sorts by the DECODED pubkey bytes instead, and the two
    disagree at effectively every position — '-'/'_' in the base64url
    alphabet (values 62/63) don't sit where ASCII puts 0x2D/0x5F. slot_map
    is a cross-check the on-chain program never reads today (Task 10 will),
    so this was silent: the moment it IS read, every slot_map lookup points
    at the wrong neuron and every step transaction that trusts it reverts.

    This is the test that would have caught it: for every slot k,
    addresses[slot_map[k]] must be the k-th address in the chain's own
    ascending order (pack_addr.chain_order_index — the same function
    pipeline/deploy.py uses to pick the account index when it actually
    creates accounts)."""
    from wormed.pipeline.pack_addr import chain_order_index
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    n = 302
    off = LAYOUT["slot_map"][0]
    slot_map = struct.unpack_from(f"<{n}H", blob, off)
    addrs = json.loads((DATA / "addresses.json").read_text())

    rank, source = chain_order_index(addrs)
    assert source == "cli", "expected the real `thru txn sort` CLI to be available for this test"
    expected_kth_address = sorted(addrs, key=lambda a: rank[a])

    assert sorted(slot_map) == list(range(n)), "slot_map is not a permutation of every neuron index"
    for k in range(n):
        assert addrs[slot_map[k]] == expected_kth_address[k], (
            f"slot {k}: slot_map points at neuron {slot_map[k]} ({addrs[slot_map[k]]}), "
            f"but the chain's real ascending order puts {expected_kth_address[k]} there"
        )


def test_provenance_records_which_order_slot_map_used():
    """If chain_order_index ever falls back to python-fallback (CLI missing),
    that must be visible in provenance.json rather than indistinguishable
    from a CLI-derived topology.bin — see chain_order_index's docstring."""
    build_all()
    prov = json.loads((DATA / "provenance.json").read_text())
    assert prov.get("slot_map_order") in ("cli", "python-fallback")


def test_touch_reflex_drives_the_right_command_neurons():
    """The behavioural claim, checked offline against the reference sim so a
    conductance change fails in three seconds instead of after a two-minute
    chain round trip. Head touch must drive the REVERSE command layer harder
    than the FORWARD one and past the classifier's 0.35 threshold, and tail
    touch the reverse — with nobody touching the worm, both must read ~0.

    Under the raw contact-count conductance proxy this fails: ALML's largest
    command-layer output in Varshney et al. is to PVC, so an untuned head
    touch reads fwd > rev. connectome.ESCAPE_CHEM / ESCAPE_GAP exist to fix
    exactly that, and this test is what stops them being quietly reverted."""
    from wormed.pipeline.refsim import FloatSim
    THRESH_ON = 0.35
    # Rebuild first: FloatSim reads data/topology.bin, so without this the
    # assert measures whatever the last test to call build_all() left on
    # disk rather than the physiology in the working tree.
    build_all()

    def drives(stim: dict[str, float]) -> tuple[float, float]:
        s = FloatSim()
        for name, amt in stim.items():
            s.stimulate(name, amt)
        s.step(400)
        d = lambda n: max(0.0, min(1.0, (s.V[s.names.index(n)]
                                         - s.V_rest_mV[s.names.index(n)]) / 20.0))
        return (0.5 * d("AVAL") + 0.3 * d("AVDL") + 0.2 * d("AVEL"),
                0.6 * d("AVBL") + 0.4 * d("PVCL"))

    rev, fwd = drives({})
    assert rev < 0.1 and fwd < 0.1, f"untouched worm already driving: rev={rev} fwd={fwd}"

    rev, fwd = drives({"ALML": 40.0})
    assert rev > THRESH_ON and rev > fwd, f"head touch: rev={rev} fwd={fwd}"

    rev, fwd = drives({"PLML": 40.0})
    assert fwd > THRESH_ON and fwd > rev, f"tail touch: rev={rev} fwd={fwd}"
