"""Token-free tests of the hemibrain extraction's pure part (extract_hemibrain.build_arrays)."""
import json

import numpy as np
import pandas as pd

from connectome import content_hash
from extract_hemibrain import build_arrays, summarize, token_from_dotenv


def _fake():
    neurons = pd.DataFrame({"bodyId": [30, 10, 20, 40], "type": ["PEN_a(PEN1)", "EPG", "EPG", "Delta7"],
                            "instance": ["PEN_a(PEN1)_R1", "EPG(PB08)_L1", None, "Delta7_R"],
                            "status": ["Traced"] * 4, "cropped": [False] * 4, "pre": 0, "post": 0})
    conn = pd.DataFrame({"bodyId_pre": [10, 10, 20, 30, 40, 40, 99], "bodyId_post": [30, 30, 40, 20, 10, 20, 10],
                         "roi": ["PB", "EB", "PB", "EB", "PB", None, "PB"], "weight": [5, 2, 7, 11, 3, 4, 100]})
    syn = pd.DataFrame({"bodyId": [10, 10, 20, 30], "type": ["post", "post", "post", "pre"],
                        "x": [0.0, 2.0, 5.0, 1.0], "y": [0.0, 0.0, 5.0, 1.0], "z": [1.0, 1.0, 1.0, 1.0]})
    return neurons, conn, syn


def _dense(a):
    n = len(a["body_id"])
    W = np.zeros((n, n), np.int64)
    for r in range(n):
        for k in range(a["indptr"][r], a["indptr"][r + 1]):
            W[r, a["indices"][k]] = a["data"][k]
    return W


def test_csr_matches_per_roi_rows_and_drops_outside_bodies():
    a = build_arrays(*_fake())
    W = _dense(a)
    R = np.zeros_like(W)
    np.add.at(R, (a["roi_pre"], a["roi_post"]), a["roi_weight"])
    assert np.array_equal(W, R)
    assert W.sum() == 5 + 2 + 7 + 11 + 3 + 4  # body 99 is outside the set
    assert list(a["type"]) == ["Delta7", "EPG", "EPG", "PEN_a(PEN1)"]  # deterministic order
    assert summarize(a)["pathway_synapses"]["EPG -> PEN_a(PEN1)"] == 7


def test_saved_file_loads_without_pickle_and_hash_is_content_only(tmp_path):
    a = build_arrays(*_fake())
    for key in ("type", "instance", "status", "roi_names"):
        assert a[key].dtype.kind == "U", key  # never object arrays
    p1, p2 = tmp_path / "a.npz", tmp_path / "b.npz"
    np.savez_compressed(p1, meta=json.dumps({"fetched_utc": "then"}), **a)
    np.savez_compressed(p2, meta=json.dumps({"fetched_utc": "now"}), **a)
    with np.load(p1, allow_pickle=False) as f1, np.load(p2, allow_pickle=False) as f2:
        l1, l2 = {k: f1[k] for k in f1.files}, {k: f2[k] for k in f2.files}
    assert content_hash(l1) == content_hash(l2) == content_hash(a)  # the fetch time does not change the hash
    assert list(l1["instance"]) == list(a["instance"])


def test_token_from_dotenv_formats(tmp_path):
    fake = "0123abcd" * 8  # not a real token
    for text in (f"NEUPRINT_APPLICATION_CREDENTIALS={fake}\n", f'export NEUPRINT_TOKEN="{fake}"\n',
                 f"# comment\nOTHER=1\nNEUPRINT_APPLICATION_CREDENTIALS = '{fake}'\n",
                 f"NEUPRINT_TOKEN={fake}  # mine\n"):
        p = tmp_path / ".env"
        p.write_text(text)
        assert token_from_dotenv(str(p)) == fake
    p.write_text("SOMETHING_ELSE=1\n")
    assert token_from_dotenv(str(p)) is None
    assert token_from_dotenv(str(tmp_path / "missing.env")) is None
