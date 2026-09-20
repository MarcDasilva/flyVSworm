"""Tests of the on-chain brain map (chain_manifest.py): wallets = neurons, transactions = synapses."""
import json
import os

import numpy as np
import pytest

import chain_manifest
from connectome import content_hash

DATA = chain_manifest.DATA
pytestmark = pytest.mark.skipif(
    not all(os.path.exists(os.path.join(DATA, f)) for f in ("cx_csr.npz", "cx_model.npz", "cx_synapses.npz",
                                                              "chain_manifest.npz")),
    reason="hemibrain data missing (extract_hemibrain.py, derive_cx.py, extract_3d.py, chain_manifest.py)")


@pytest.fixture(scope="module")
def m():
    return chain_manifest.load("chain_manifest.npz")


def test_manifest_reproduces_from_the_data_files(m):
    built, _ = chain_manifest.build(chain_manifest.load("cx_model.npz"), chain_manifest.load("cx_synapses.npz"))
    with open(os.path.join(DATA, "chain_manifest.json")) as f:
        assert content_hash(built) == json.load(f)["content_sha256"] == content_hash(m)


def test_verify_accepts_the_written_manifest():
    assert chain_manifest.verify() == []   # what `python chain_manifest.py --verify` reports


def test_wallets_are_the_model_neurons_with_their_sign(m):
    model = chain_manifest.load("cx_model.npz")
    assert np.array_equal(m["wallet_body_id"], model["body_id"]) and np.array_equal(m["wallet_cls"], model["cls"])
    assert len(np.unique(m["wallet_body_id"])) == len(m["wallet_body_id"]) == 134
    assert np.all(m["wallet_sign"][m["wallet_cls"] == "D7"] == -1)
    assert np.all(m["wallet_sign"][m["wallet_cls"] != "D7"] == 1)


def test_every_measured_synapse_is_one_transaction(m):
    """Per-pair transaction counts equal the connectome's synapse counts, for every pair (none dropped)."""
    csr = chain_manifest.load("cx_csr.npz")
    rows = np.repeat(np.arange(len(csr["body_id"])), np.diff(csr["indptr"]))
    expected = {(int(csr["body_id"][a]), int(csr["body_id"][b])): int(c)
                for a, b, c in zip(rows, csr["indices"], csr["data"])}
    body = m["wallet_body_id"]
    pairs, counts = np.unique(np.column_stack([body[m["syn_pre"]], body[m["syn_post"]]]), axis=0, return_counts=True)
    got = {(int(a), int(b)): int(c) for (a, b), c in zip(pairs, counts)}
    assert got == expected
    assert len(m["syn_pre"]) == sum(expected.values()) == 114854


def test_transaction_order_is_unique_and_grouped_by_sender(m):
    key = np.column_stack([m["syn_pre"], m["syn_post"], m["syn_post_xyz"], m["syn_pre_xyz"]])
    diff = key[1:] - key[:-1]
    first = np.argmax(diff != 0, axis=1)  # first differing column of each consecutive pair
    assert np.all(np.any(diff != 0, axis=1)), "two transactions are identical: order not unique"
    assert np.all(diff[np.arange(len(diff)), first] > 0), "transactions not in (pre, post, post_xyz, pre_xyz) order"


def test_manifest_is_integers_and_strings_only(m):
    """The Thru VM has no floating point."""
    for k, a in m.items():
        if k != "meta":
            assert a.dtype.kind in "iu" or a.dtype.kind == "U", (k, a.dtype)
