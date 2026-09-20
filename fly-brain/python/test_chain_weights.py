"""Tests of the integer brain (chain_weights.py): the fly the Thru program computes with."""
import json
import os

import numpy as np
import pytest

import chain_weights
import tests
from model_float import load_spec

DATA = chain_weights.DATA
pytestmark = pytest.mark.skipif(
    not all(os.path.exists(os.path.join(DATA, f)) for f in ("chain_manifest.npz", "chain_weights.npz")),
    reason="chain artifacts missing (chain_manifest.py, chain_weights.py)")


@pytest.fixture(scope="module")
def table():
    with np.load(os.path.join(DATA, "chain_weights.npz"), allow_pickle=False) as f:
        return {k: f[k] for k in f.files if k != "meta"}


@pytest.fixture(scope="module")
def spec_path():
    with open(os.path.join(DATA, "chain_weights.json")) as f:
        return os.path.join(chain_weights.connectome.ROOT, "spec", json.load(f)["spec"])


def test_weight_table_rebuilds_from_its_spec(spec_path):
    assert chain_weights.verify(spec_path) == []   # what `python chain_weights.py --verify` reports


def test_table_is_integers_and_maps_onto_the_wallets(table):
    with np.load(os.path.join(DATA, "chain_manifest.npz"), allow_pickle=False) as f:
        wallets = f["wallet_body_id"]
    assert set(map(int, table["body_id"])) == set(map(int, wallets))
    assert np.array_equal(wallets[table["wallet"]], table["body_id"])   # wallet column maps row -> wallet
    for k, a in table.items():
        assert a.dtype.kind in "iuU", (k, a.dtype)
    assert np.all(table["weight_q16"] != 0)        # no weight is lost to rounding
    assert np.all(np.abs(table["weight_q16"]) < 2 ** 31)


def test_quantized_fly_still_passes_the_suite(table, spec_path):
    """T1-T8 with the weights read back from Q16.16: the port starts from a fly that works.
    One seed here (a few seconds); seeds 0-9 were checked when the table was written (suite_check)."""
    p, spec = load_spec(spec_path)
    cx = chain_weights.as_connectome(table, spec)
    results = {}
    for seed in spec["seeds"][:1]:
        runs = tests.run_all_protocols(cx, p, spec["protocol"], seed)
        results = tests.evaluate(runs, p)
    assert all(ok for ok, _ in results.values()), {k: m for k, (ok, m) in results.items() if not ok}
