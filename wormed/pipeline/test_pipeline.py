from wormed.pipeline.connectome import load_connectome

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
