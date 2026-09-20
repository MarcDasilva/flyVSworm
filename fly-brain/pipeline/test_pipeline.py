"""Offline checks on the packed topology and the fixed-point reference.

Nothing here touches the chain. This is the half of the verification chain that
can run on a laptop with no key and no network:

    model_float.py  ->  FixedSim  ->  native C  ->  ThruVM
    [------- here -------------]     [native_test.c]  [test_chain.py]
"""
import os
import struct
import subprocess
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "python"))

from pipeline import pack, refsim                        # noqa: E402
from pipeline.refsim import Q16, FixedSim                 # noqa: E402

EXPECTED_ARRAYS = {"w", "class", "wedge", "landmark", "v0", "sincos", "params"}


@pytest.fixture(scope="module")
def built():
    blob, names, meta = pack.build_all()
    return blob, names, meta


@pytest.fixture(scope="module")
def sim(built):
    return FixedSim()


# ------------------------------------------------------------ the blob --

def test_every_array_offset_is_8_byte_aligned(built):
    """ThruVM faults on an unaligned load and on any access spanning a 4 KB
    page. Both are impossible when every array starts 8-aligned -- but only if
    this actually checks every array, so the name set is asserted first: an
    empty or partial LAYOUT would otherwise pass trivially."""
    _, _, meta = built
    layout = meta["layout"]
    assert set(layout) == EXPECTED_ARRAYS
    for name, (off, size) in layout.items():
        assert off % 8 == 0, f"{name} starts at {off}, which is not 8-aligned"
        assert size > 0


def test_header_matches_the_layout_table(built):
    blob, _, meta = built
    h = struct.unpack_from("<16I", blob, 0)
    assert h[0] == pack.MAGIC
    assert h[1] == pack.VERSION
    assert h[2] == meta["n_neurons"]
    assert h[3] == meta["n_wedges"]
    for k, name in enumerate(["w", "class", "wedge", "landmark", "v0", "sincos", "params"]):
        assert h[4 + k] == meta["layout"][name][0], f"header offset for {name} disagrees with the layout"
    assert h[11] == len(blob) == meta["total_sz"]


def test_total_size_sits_where_do_upload_reads_it(built):
    """fly.c's do_upload reads total_sz out of the FIRST CHUNK at byte 0x2C to
    size the account in one resize. If the field moves, the upload resizes the
    topology account to garbage."""
    blob, _, _ = built
    assert struct.unpack_from("<I", blob, 0x2C)[0] == len(blob)


def test_names_are_unique_and_fit_the_account_field(built):
    _, names, meta = built
    assert len(names) == meta["n_neurons"]
    assert len(set(names)) == len(names)
    assert all(0 < len(n) <= 8 for n in names)


def test_every_wedge_holds_an_epg_cell(sim):
    """wedge_rates divides by the number of EPG cells in a wedge. An empty one
    would divide by zero on chain, which is a reverted transaction rather than
    a wrong heading."""
    for w in range(sim.n_wedges):
        assert np.any((sim.cls == refsim.CLS_EPG) & (sim.wedge == w)), f"wedge {w} has no EPG cell"


def test_params_survive_the_round_trip(built, sim):
    from model_float import load_spec
    import live
    p, _ = load_spec(live.SPEC_PATH)
    assert sim.dt == pack.q16(p.dt)
    assert sim.v_thresh == pack.q16(p.v_thresh)
    assert sim.v_reset == pack.q16(p.v_reset)
    assert sim.refrac_ticks == p.refrac_ticks
    assert sim.rate_window == pack.RATE_WINDOW
    # 1/tau rather than tau: the step never needs tau itself
    assert abs(sim.inv_tau / Q16 - 1.0 / p.tau) < 1e-4


def test_weights_keep_the_weakest_pathway(sim):
    """The connectome spans 0.00059 to 0.053. Q8.8 -- the format the worm uses
    for conductances -- resolves 0.0039 and would quantise the weakest pathway
    to zero, silently deleting it. This is why the port is Q16.16 throughout."""
    nonzero = sim.W[sim.W != 0]
    assert nonzero.size == 11028
    assert np.abs(nonzero).min() >= 1, "a nonzero weight quantised to zero"


# ------------------------------------------------- the fixed-point model --

def test_the_ring_is_silent_without_a_landmark(sim):
    """Released from its initial potentials with no input, every cell decays
    toward rest and nothing crosses threshold. This is not a bug -- it is why
    the protocol boots with a landmark -- but it is worth pinning, because a
    ring that spikes here would mean the reset state is wrong."""
    sim.reset()
    sim.drive(0.0, 0.0)
    sim.set_landmark(0, 0, active=False)
    sim.step(200)
    assert int(np.sum(sim.history)) == 0


def test_the_landmark_builds_a_bump_where_it_is_placed():
    s = refsim.booted()
    wedge, strength = s.heading_wedges()
    assert abs(wedge - refsim.LANDMARK_WEDGE) < 0.5, f"bump formed at wedge {wedge:.2f}"
    assert strength > 0.5, f"bump strength {strength:.3f} is not a bump"


def test_push_pull_drive_turns_the_bump_counterclockwise():
    """THE behavioural regression test. drive_pen_l = +d with drive_pen_r = -d
    turns the bump counterclockwise -- increasing wedge index. Getting this
    backwards is the single easiest way to port the connectome wrong, because
    W is W[pre, post] and dropping the transpose reverses the rotation without
    changing anything else that is observable."""
    before = refsim.booted()
    w0, _ = before.heading_wedges()
    before.drive(0.0273, -0.0273)
    before.step(300)
    w1, strength = before.heading_wedges()
    moved = (w1 - w0) % before.n_wedges
    assert strength > 0.5, "the bump fell apart under drive"
    assert 0.2 < moved < before.n_wedges / 2, f"the bump moved {moved:.2f} wedges, not counterclockwise"


def test_the_fixed_model_is_deterministic():
    """Two runs must agree exactly, or the bit-for-bit comparison against C
    means nothing."""
    a, b = refsim.booted(200, (0.0273, -0.0273)), refsim.booted(200, (0.0273, -0.0273))
    assert np.array_equal(a.v, b.v)
    assert np.array_equal(a.syn, b.syn)


def test_potentials_stay_inside_int32(sim):
    """The C port holds v and syn in int32. The busiest neuron takes 110
    incoming weights, so this is the accumulator's headroom, checked under a
    drive well above anything the trading mapper produces."""
    s = refsim.booted(400, (0.08, -0.08))
    assert np.abs(s.v).max() < 2**31
    assert np.abs(s.syn).max() < 2**31


def test_fixed_tracks_the_float_model():
    """Link 1: Q16.16 against float64, on the same protocol from the same
    starting potentials.

    Per-neuron equality is NOT the assertion, and cannot be. The model has a
    hard threshold, so a rounding difference of 1e-5 decides whether a cell
    sitting at 0.99999 fires this tick or next; when it does, that one neuron's
    potential differs by a whole v_thresh because one copy has been reset and
    the other has not. model_float.tick says the same thing about BLAS
    summation order. What must agree is the circuit: which cells are firing,
    and where the bump is."""
    import connectome
    import live
    from model_float import Input, init_state, load_spec, tick

    p, spec = load_spec(live.SPEC_PATH)
    cx = connectome.build(p, spec.get("connectome"))
    fx = FixedSim()

    import metrics

    s = init_state(cx, p, 0)
    s.v = fx.v0 / Q16                       # the same start, dequantised
    boot = Input(landmark_wedge=refsim.LANDMARK_WEDGE, landmark_current=refsim.LANDMARK_CURRENT,
                 landmark_active=True)
    fx.set_landmark(refsim.LANDMARK_CURRENT, refsim.LANDMARK_WEDGE)

    # Phase 1, the ARITHMETIC. Before any cell has sat exactly on the
    # threshold the two models take the same branches, and the only difference
    # between them is the quantisation of the weights: measured, the potentials
    # stay within 4e-4 of each other for the first ten ticks and every neuron
    # agrees about firing. That is the tight assert, and it is where a sign
    # error or a dropped transpose would show up immediately.
    float_history = []
    for _ in range(10):
        tick(s, cx, boot, p)
        fx.step(1)
        float_history.append(s.spikes.copy())
        assert np.array_equal(s.spikes, fx.spikes.astype(bool)), "the two models disagree on who fired"
        assert np.max(np.abs(s.v - fx.v / Q16)) < 1e-3

    # Phase 2, the CIRCUIT. Past the first cell to sit on the threshold the two
    # must drift: one copy resets and the other does not, so that neuron alone
    # differs by a whole v_thresh, and the spike it did or did not send changes
    # everything downstream of it. Measured, the first flip lands at tick 16.
    # What survives is the circuit, and that is what the rest of this checks.
    for _ in range(refsim.BOOT_LANDMARK_TICKS - 10):
        tick(s, cx, boot, p)
        fx.step(1)
        float_history.append(s.spikes.copy())

    agree = np.mean(s.spikes == fx.spikes.astype(bool))
    assert agree > 0.97, f"only {agree:.1%} of the ring agrees on who is firing"

    # And the readout, which is what anything downstream actually consumes,
    # read off the same ticks in both models.
    epg = cx.idx["EPG"]
    rate = metrics.rates(np.array(float_history, dtype=bool), window=fx.rate_window)
    float_wedge, float_strength = metrics.heading(
        metrics.wedge_rates(rate[epg], cx.wedge_of[epg], cx.n_wedges), cx.n_wedges)
    fixed_wedge, fixed_strength = fx.heading_wedges()
    apart = abs((fixed_wedge - float_wedge + cx.n_wedges / 2) % cx.n_wedges - cx.n_wedges / 2)
    assert apart < 0.5, f"the two models put the bump {apart:.2f} wedges apart"
    assert abs(fixed_strength - float_strength) < 0.1, \
        f"bump strength {fixed_strength:.3f} fixed vs {float_strength:.3f} float"


# ------------------------------------------------------ golden vectors --

def test_vector_dump_is_exactly_what_the_c_harness_expects():
    path, size = refsim.dump_vectors()
    n = FixedSim().N
    assert os.path.getsize(path) == (refsim.VECTOR_STEPS + 1) * n * 4 == size


@pytest.mark.skipif(not os.environ.get("FLY_NATIVE"),
                    reason="set FLY_NATIVE=1 to compile and run program/native_test.c")
def test_native_c_matches_the_fixed_reference_bit_for_bit(tmp_path):
    """Link 2. Skipped by default because it needs a host compiler; the file it
    builds is the same sim.c the chain runs."""
    refsim.dump_vectors()
    exe = str(tmp_path / "nt")
    build = subprocess.run(["gcc", "-O0", "-g", "-I.", "native_test.c", "sim.c", "-o", exe],
                           cwd=os.path.join(ROOT, "program"), capture_output=True, text=True)
    assert build.returncode == 0, build.stderr
    run = subprocess.run([exe], cwd=os.path.join(ROOT, "program"), capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    assert "bit-for-bit" in run.stdout
