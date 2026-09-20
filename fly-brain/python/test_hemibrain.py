"""Tests of the Scale B (hemibrain) pipeline: derive step, loader, per-wedge readout."""
import dataclasses
import json
import os

import numpy as np
import pytest

import connectome
import derive_cx
import metrics
from model_float import load_spec

DATA = os.path.join(connectome.ROOT, "data")
SPEC_A = os.path.join(connectome.ROOT, "spec", "params.json")
pytestmark = pytest.mark.skipif(
    not all(os.path.exists(os.path.join(DATA, f)) for f in ("cx_csr.npz", "cx_model.npz", "cx_averaged.npz")),
    reason="hemibrain data missing (run extract_hemibrain.py, then derive_cx.py)")


def _load(name):
    with np.load(os.path.join(DATA, name), allow_pickle=False) as f:
        return {k: f[k] for k in f.files}


def _source():
    with open(os.path.join(DATA, "cx_model.json")) as f:
        return {"source": "hemibrain", "file": "data/cx_model.npz", "sha256": json.load(f)["content_sha256"]}


def _params(**gains):
    p, _ = load_spec(SPEC_A)
    base = {g: 0.01 for g in ("w_ee", "w_ep", "w_pe", "w_ed", "w_de", "w_dd", "w_dp", "w_pp")}
    return dataclasses.replace(p, **{**base, **gains})


def test_derive_reproduces_the_committed_model():
    model, _ = derive_cx.derive(_load("cx_csr.npz"))
    with open(os.path.join(DATA, "cx_model.json")) as f:
        assert connectome.content_hash(model) == json.load(f)["content_sha256"]


def test_loader_signs_gains_and_neuromod():
    p = _params(w_ee=0.02, w_ep=0.03, w_pe=0.04, w_ed=0.05, w_de=0.06, w_dd=0.07, w_dp=0.08, w_pp=0.09)
    cx = connectome.build(p, _source())
    m = _load("cx_model.npz")
    rows = np.repeat(np.arange(len(m["cls"])), np.diff(m["indptr"]))
    for k, (gain, sign) in enumerate(zip(m["pathway_gains"], m["pathway_signs"])):
        w = cx.W[rows[m["pathway"] == k], m["indices"][m["pathway"] == k]]
        assert np.all(np.sign(w) == sign), gain                  # sign per pathway
        assert np.isclose(np.abs(w).mean(), getattr(p, gain))    # the gain is the weight of an average connection
    boosted = connectome.build(dataclasses.replace(p, neuromod_gain=2.0), _source())
    changed = ~np.isclose(boosted.W, cx.W)
    d7, epg = cx.idx["D7"], cx.idx["EPG"]
    assert changed[d7, epg].all() or np.array_equal(changed[d7, epg], cx.W[d7, epg] != 0)
    changed[d7, epg] = False
    assert not changed.any()                                     # neuromod scales D7->EPG only


def test_loader_refuses_a_wrong_or_missing_hash():
    p = _params()
    with pytest.raises(ValueError):
        connectome.build(p, {**_source(), "sha256": "0" * 64})
    with pytest.raises(ValueError):
        connectome.build(p, {"source": "hemibrain", "file": "data/cx_model.npz"})


def test_hemibrain_layout_is_contiguous_and_every_wedge_has_epg():
    cx = connectome.build(_params(), _source())
    assert [cx.idx[k].start for k in ("EPG", "PEN_L", "PEN_R", "D7")] == [0, 50, 71, 92] and cx.N == 134
    counts = np.bincount(cx.wedge_of[cx.idx["EPG"]], minlength=cx.n_wedges)
    assert counts.min() >= 1 and cx.n_wedges == 16


def _averaged_source():
    with open(os.path.join(DATA, "cx_averaged.json")) as f:
        return {"source": "hemibrain_averaged", "file": "data/cx_averaged.npz", "sha256": json.load(f)["content_sha256"]}


def test_derive_reproduces_the_committed_averaged_ring():
    model, info = derive_cx.derive(_load("cx_csr.npz"))
    avg, _ = derive_cx.average(model, info)
    with open(os.path.join(DATA, "cx_averaged.json")) as f:
        assert connectome.content_hash(avg) == json.load(f)["content_sha256"]


def test_averaged_ring_has_the_measured_neurons_and_totals():
    m, a = _load("cx_model.npz"), _load("cx_averaged.npz")
    ix = a["measured_index"]
    assert np.array_equal(np.sort(ix), np.arange(len(m["cls"])))           # a permutation of the measured rows
    assert np.array_equal(a["body_id"], m["body_id"][ix]) and np.array_equal(a["cls"], m["cls"][ix])
    assert a["data"].min() >= derive_cx.PRUNE_BELOW * derive_cx.MILLI              # pruned below the floor
    # same synapse totals per pathway within 7%: smoothing, no self-pairs and the 0.5-synapse floor
    # lose at most 5.4% (EPG->EPG); a gain absorbs a uniform loss, so this only guards against gross errors
    for k in range(len(m["pathway_names"])):
        measured = m["data"][m["pathway"] == k].sum()
        assert abs(a["data"][a["pathway"] == k].sum() / derive_cx.MILLI / measured - 1) < 0.07, m["pathway_names"][k]
        assert a["pathway_mean"][k] == measured * derive_cx.MILLI / np.count_nonzero(m["pathway"] == k)


def test_averaged_ring_is_even_and_loads_with_measured_gain_units():
    cx = connectome.build(_params(), _averaged_source())
    assert cx.source == "hemibrain_averaged" and cx.N == 134
    counts = np.bincount(cx.wedge_of[cx.idx["EPG"]], minlength=cx.n_wedges)
    assert counts.max() - counts.min() <= 1                                 # evenly spaced: 3 or 4 EPG per wedge
    measured = connectome.build(_params(), _source())
    for pop in ("EPG", "PEN_L", "PEN_R", "D7"):                            # same total input per population (+/-5%)
        sl = cx.idx[pop]
        assert np.isclose(np.abs(cx.W[:, sl]).sum(), np.abs(measured.W[:, measured.idx[pop]]).sum(), rtol=0.05), pop


def test_blend_ends_are_the_averaged_and_the_measured_wiring():
    p = _params(w_ee=0.02, w_ep=0.03, w_pe=0.04, w_ed=0.05, w_de=0.06, w_dd=0.07, w_dp=0.08, w_pp=0.09)
    blend = lambda a: connectome.build(p, {"source": "hemibrain_blend", "alpha": a,
                                           "averaged": _averaged_source(), "measured": _source()})
    avg, meas = connectome.build(p, _averaged_source()), connectome.build(p, _source())
    ix = _load("cx_averaged.npz")["measured_index"]
    assert np.array_equal(blend(0.0).W, avg.W)
    assert np.array_equal(blend(1.0).W, meas.W[np.ix_(ix, ix)])
    assert np.allclose(blend(0.25).W, 0.75 * avg.W + 0.25 * meas.W[np.ix_(ix, ix)])
    assert blend(0.5).source == "hemibrain_blend"
    # intended: geometry is the averaged ring's at every alpha, so alpha moves only the wiring
    for a in (0.0, 0.5, 1.0):
        assert np.array_equal(blend(a).wedge_of, avg.wedge_of) and np.array_equal(blend(a).landmark, avg.landmark)
    assert not np.array_equal(blend(1.0).wedge_of, meas.wedge_of[ix])  # the measured frame differs (documented)
    with pytest.raises(ValueError):
        blend(1.5)


def test_wedge_rates_identity_and_mean():
    r = np.array([[5.0, 7.0, 0.1, 3.0]])
    assert np.array_equal(metrics.wedge_rates(r, np.arange(4), 4), r)  # one EPG per wedge: bit-identical
    assert np.allclose(metrics.wedge_rates(np.array([2.0, 4.0, 9.0, 1.0, 3.0]), np.array([0, 0, 1, 2, 2]), 3),
                       [3.0, 9.0, 2.0])
    with pytest.raises(ValueError):
        metrics.wedge_rates(np.ones(3), np.array([0, 2, 2]), 3)       # wedge 1 empty
