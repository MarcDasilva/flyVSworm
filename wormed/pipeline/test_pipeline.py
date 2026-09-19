from wormed.pipeline.connectome import load_connectome, assign_physiology, neuron_positions

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
