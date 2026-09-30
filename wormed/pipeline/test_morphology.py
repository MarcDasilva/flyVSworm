"""Guards on the traced 3D anatomy.

Every assertion here is a fact about a real animal that the OLD synthetic
layout could not have satisfied by luck. That is the point: a
prefix-to-ganglion heuristic can put cell bodies in roughly the right
neighbourhood, but it cannot know that AVAL's axon runs the length of the
ventral cord, and it cannot get the nerve ring to close. If this file passes,
the geometry came from the tracing and not from a layout function."""
import json
import struct
from pathlib import Path

from wormed.pipeline.morphology import (
    MAGIC, VERSION, Arbor, load_morphology, pack_morphology, soma_positions)

DATA = Path(__file__).resolve().parent.parent / "data"
NAMES = json.loads((DATA / "names.json").read_text())


def test_every_neuron_has_a_traced_arbor():
    """Coverage must be exact. A missing cell silently rendering at the origin
    is the failure this catches — 301 neurons and one at (0,0,0) still looks
    like a worm."""
    arbors = load_morphology(NAMES)
    assert len(arbors) == 302
    assert all(a.segments for a in arbors), "a neuron traced to zero segments"
    # 13,869 traced segments, collinear-merged to this under SIMPLIFY_EPS.
    assert sum(len(a.segments) for a in arbors) == 9429


def test_soma_is_inside_its_own_arbor():
    """The soma point must be one of the arbor's own endpoints. If the two are
    read from different places the cell bodies float off their processes and
    every firing particle launches from empty space."""
    for a in load_morphology(NAMES):
        ends = {p for seg in a.segments for p in seg}
        near = min(
            (a.soma[0] - p[0]) ** 2 + (a.soma[1] - p[1]) ** 2 + (a.soma[2] - p[2]) ** 2
            for p in ends)
        assert near < 1e-9, f"{a.name}: soma is not on its arbor"


def test_anterior_posterior_axis_is_real_and_points_forward():
    """+x is anterior, matching the crawling body below, which starts out
    heading +x. An inverted axis renders a worm whose head trails its tail."""
    pos = dict(zip(NAMES, soma_positions(load_morphology(NAMES))))
    # ALM is an anterior touch cell, PLM a posterior one; IL1 is at the very
    # nose and PHA is in the tail. Both pairs, so a near-miss cannot pass.
    assert pos["ALML"][0] > pos["PLML"][0]
    assert pos["IL1DL"][0] > pos["PHAL"][0]
    # Nose to tail is the full body, normalised to 1.0 by construction.
    span = max(p[0] for p in pos.values()) - min(p[0] for p in pos.values())
    assert 0.8 < span <= 1.0, f"AP span {span:.3f} is not a whole animal"


def test_dorsal_cells_sit_above_ventral_cells():
    """+y is dorsal. Checked ONLY on the radially arranged head sensory
    classes, whose D and V members sit at the same AP level so the body's
    natural bend cancels out of the comparison.

    RMD and SMD are deliberately excluded: despite the D/V in their names
    their cell bodies are in the LATERAL ganglion, and the letter refers to
    the muscle quadrant they innervate. Including them makes this test fail
    on correct anatomy."""
    pos = dict(zip(NAMES, soma_positions(load_morphology(NAMES))))
    pairs = [("RMED", "RMEV"), ("IL1DL", "IL1VL"), ("IL1DR", "IL1VR"),
             ("IL2DL", "IL2VL"), ("IL2DR", "IL2VR"), ("CEPDL", "CEPVL"),
             ("CEPDR", "CEPVR"), ("OLQDL", "OLQVL"), ("OLQDR", "OLQVR"),
             ("URADL", "URAVL"), ("URYDL", "URYVL"), ("SIADL", "SIAVL")]
    for d, v in pairs:
        assert pos[d][1] > pos[v][1], f"{d} is not dorsal to {v}"


def test_left_and_right_cells_straddle_the_midline():
    """+z is left. The bilateral pairs must land on OPPOSITE sides — a
    normalisation that centres on the wrong axis collapses them together and
    the render loses its whole left/right structure."""
    pos = dict(zip(NAMES, soma_positions(load_morphology(NAMES))))
    for stem in ["ALM", "PLM", "ASE", "AWC", "ADL", "AIY", "PHA", "URX", "OLL"]:
        left, right = pos[stem + "L"][2], pos[stem + "R"][2]
        assert left > 0 > right, f"{stem}L/{stem}R do not straddle the midline"


def test_the_nerve_ring_is_a_ring():
    """The defining structure of the head, and the one thing the old synthetic
    layout faked with a hand-tuned sector table. Here it has to EMERGE: take
    every traced point in the nerve-ring AP band and it must form an annulus
    around the pharynx — occupied all the way around, and hollow in the
    middle. A point cloud that merely clusters in the head passes neither
    half."""
    import math
    arbors = load_morphology(NAMES)
    pts = [p for a in arbors for seg in a.segments for p in seg]
    # The ring sits just behind the nose. Anterior is +x with the nose at the
    # maximum, so this band is measured back from the tip.
    nose = max(p[0] for p in pts)
    band = [p for p in pts if nose - 0.075 <= p[0] <= nose - 0.035]
    assert len(band) > 300, f"only {len(band)} points in the nerve-ring band"

    cy = sum(p[1] for p in band) / len(band)
    cz = sum(p[2] for p in band) / len(band)
    radii, occupied = [], set()
    for p in band:
        dy, dz = p[1] - cy, p[2] - cz
        radii.append(math.hypot(dy, dz))
        occupied.add(int((math.atan2(dz, dy) + math.pi) / (2 * math.pi) * 12) % 12)
    assert len(occupied) == 12, f"ring is open — only {sorted(occupied)} of 12 sectors"

    radii.sort()
    inner = radii[len(radii) // 10]        # 10th percentile
    median = radii[len(radii) // 2]
    assert median > 0 and inner / median < 0.6, (
        f"ring is a filled disc, not an annulus (inner {inner:.4f} vs "
        f"median {median:.4f}) — the pharyngeal lumen should be hollow")


def test_ventral_cord_neurons_run_the_length_of_the_body():
    """AVAL/AVAR drive backward locomotion and their axons traverse the whole
    ventral cord. A layout that only knows cell-body positions gives them a
    dot in the head. This is the assertion that most directly separates traced
    morphology from a position heuristic."""
    arbors = {a.name: a for a in load_morphology(NAMES)}
    for name in ["AVAL", "AVAR", "AVBL", "AVBR", "PVCL", "PVCR"]:
        xs = [p[0] for seg in arbors[name].segments for p in seg]
        assert max(xs) - min(xs) > 0.5, (
            f"{name}'s arbor spans only {max(xs) - min(xs):.3f} of the body — "
            f"this is a cell-body dot, not an axon")


def test_geometry_keeps_the_true_aspect_ratio():
    """One uniform scale for all three axes. Scaling each axis to fill its own
    range instead would inflate a 1 mm x 65 um animal into a sausage and quietly
    destroy every angle in the tracing."""
    pts = [p for a in load_morphology(NAMES) for seg in a.segments for p in seg]
    width = max(p[2] for p in pts) - min(p[2] for p in pts)
    # A real adult hermaphrodite is roughly 1 mm long and 65 um across, so the
    # lateral extent is a few percent of the length. Anything near 1.0 means
    # the axes were normalised independently.
    assert 0.02 < width < 0.15, f"lateral width {width:.3f} of body length"


def test_packed_file_round_trips():
    """The renderer reads this buffer with zero parsing, so the header has to
    describe it exactly. An off-by-one in a segment range draws one neuron's
    wires in another neuron's colour."""
    arbors = load_morphology(NAMES)
    blob = pack_morphology(arbors)
    magic, version, n_neurons, n_segments = struct.unpack_from("<4sIII", blob, 0)
    assert magic == MAGIC and version == VERSION
    assert n_neurons == 302 and n_segments == 9429

    ranges = struct.unpack_from(f"<{n_neurons * 2}I", blob, 16)
    expected = 0
    for i, a in enumerate(arbors):
        start, count = ranges[i * 2], ranges[i * 2 + 1]
        assert start == expected, f"{a.name}: range starts at {start}, not {expected}"
        assert count == len(a.segments)
        expected += count
    assert expected == n_segments, "ranges do not tile the segment array"

    verts_off = 16 + n_neurons * 8
    assert verts_off % 8 == 0, "vertex block is not 8-byte aligned"
    assert len(blob) == verts_off + n_segments * 6 * 4, "trailing or missing bytes"

    # Spot-check that the floats are the arbor's, not zeroes or a shifted read.
    first = struct.unpack_from("<6f", blob, verts_off)
    (a0, a1) = arbors[0].segments[0]
    assert all(abs(g - e) < 1e-6 for g, e in zip(first, (*a0, *a1)))


def test_committed_artifacts_match_a_fresh_build():
    """data/morphology.bin and data/positions.json are committed, and the demo
    serves them without running the pipeline. If they drift from what the
    source files produce, the render shows one anatomy and the tests check
    another."""
    arbors = load_morphology(NAMES)
    assert (DATA / "morphology.bin").read_bytes() == pack_morphology(arbors)
    committed = json.loads((DATA / "positions.json").read_text())
    fresh = soma_positions(arbors)
    assert len(committed) == len(fresh)
    for c, f in zip(committed, fresh):
        assert all(abs(a - b) < 1e-9 for a, b in zip(c, f))


def test_each_ventral_cord_class_runs_head_to_tail_in_number_order():
    """Cord motor neurons are numbered from the head back, and each class
    (DA1..DA9, VD1..VD13, ...) spans the WHOLE cord rather than occupying its
    own block. The old synthetic layout got this wrong twice — first stacking
    the classes into disjoint lexicographic bands so VD12 sat anterior to VD3,
    then needing a hand-tuned stagger to spread them again. Against the
    tracing it is simply a property of the animal, and this is the test that
    says so."""
    import re
    pos = dict(zip(NAMES, soma_positions(load_morphology(NAMES))))
    classes: dict[str, list[tuple[int, float]]] = {}
    for n in NAMES:
        m = re.fullmatch(r"(DA|DB|DD|VA|VB|VC|VD|AS)(\d+)", n)
        if m:
            classes.setdefault(m.group(1), []).append((int(m.group(2)), pos[n][0]))

    assert len(classes) == 8, f"expected the 8 cord motor classes, got {sorted(classes)}"
    for cls, cells in classes.items():
        cells.sort()
        xs = [x for _, x in cells]
        # Anterior is +x and cell 1 is the most anterior, so x DECREASES with
        # number. Allowed one inversion per class: real neighbouring cord
        # cell bodies do occasionally swap order in the tracing.
        inversions = sum(1 for a, b in zip(xs, xs[1:]) if b > a)
        assert inversions <= 1, f"{cls} is not ordered head-to-tail: {cells}"
        assert xs[0] - xs[-1] > 0.3, (
            f"{cls} spans only {xs[0] - xs[-1]:.3f} of the body — the classes "
            f"are sitting in blocks instead of interdigitating")
