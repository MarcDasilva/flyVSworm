"""The on-chain map of the fly brain, built offline: one wallet per neuron, one transaction per synapse.

User decisions (2026-09-19): every individual measured synapse is a transaction (with its 3D location),
the 134 model neurons are the wallets, and only the MEASURED wiring goes on chain (the averaged ring's
weights are re-derivable from it with derive_cx.py). This file fixes exactly what gets written and in
what order, before anything touches Thru; the submission code only replays it, and anyone can check
the chain against data/chain_manifest.npz by its content hash.

Integers and strings only: the Thru VM has no floating point.

Wallets (the 134 rows of data/cx_model.npz, in that order):
    body_id    hemibrain body ID: the universal key (a running fly may order its neurons differently)
    type       neuPrint type, e.g. EPG, EPGt, PEN_a(PEN1), Delta7
    instance   neuPrint instance
    cls        model class: EPG, PEN_L, PEN_R or D7 (derive_cx.classify)
    wedge      ring wedge 0..15, -1 for D7 (derive_cx)
    sign       +1 excitatory (EPG, PEN: cholinergic), -1 inhibitory (D7: glutamatergic). The sign is the
               presynaptic neuron's, so every synapse transaction carries a positive count of 1.

Synapse transactions (all 114,854 synapses among the 134 neurons, data/cx_synapses.npz):
    pre, post          wallet indices (rows above)
    pre_xyz, post_xyz  T-bar and PSD locations, hemibrain voxels (8 nm), int32
    Order: (pre, post, post_xyz, pre_xyz) ascending, no ties, so a neuron's outgoing synapses are
    contiguous. This includes the 31 PEN->D7 synapses the model drops: the record is the measured brain.

    python chain_manifest.py            (writes data/chain_manifest.npz and data/chain_manifest.json)
    python chain_manifest.py --verify   (rebuilds from the sources and checks the written files)
"""
import argparse
import json
import os

import numpy as np

from connectome import content_hash

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
SIGN = {"EPG": 1, "PEN_L": 1, "PEN_R": 1, "D7": -1}


def load(name):
    with np.load(os.path.join(DATA, name), allow_pickle=False) as f:
        return {k: f[k] for k in f.files}


def build(model, syn):
    """(manifest arrays, summary) from cx_model.npz and cx_synapses.npz contents."""
    body = model["body_id"].astype(np.int64)
    if len(np.unique(body)) != len(body):
        raise ValueError("duplicate body IDs in cx_model")
    index = {int(b): i for i, b in enumerate(body)}
    try:
        pre = np.array([index[int(b)] for b in syn["pre_body"]], np.int64)
        post = np.array([index[int(b)] for b in syn["post_body"]], np.int64)
    except KeyError as e:
        raise ValueError(f"synapse endpoint {e} is not one of the {len(body)} wallets") from None
    pre_xyz, post_xyz = syn["pre_xyz"].astype(np.int32), syn["post_xyz"].astype(np.int32)
    keys = (pre_xyz[:, 2], pre_xyz[:, 1], pre_xyz[:, 0], post_xyz[:, 2], post_xyz[:, 1], post_xyz[:, 0], post, pre)
    order = np.lexsort(keys)  # last key is primary: pre, post, post_xyz, pre_xyz
    pre, post, pre_xyz, post_xyz = pre[order], post[order], pre_xyz[order], post_xyz[order]
    stacked = np.column_stack([pre, post, post_xyz, pre_xyz])
    if np.any(np.all(stacked[1:] == stacked[:-1], axis=1)):
        raise ValueError("two synapses share pre, post and both locations: the order would not be unique")
    cls = model["cls"]
    manifest = {
        "wallet_body_id": body,
        "wallet_type": model["type"],
        "wallet_instance": model["instance"],
        "wallet_cls": cls,
        "wallet_wedge": model["wedge"].astype(np.int64),
        "wallet_sign": np.array([SIGN[str(c)] for c in cls], np.int64),
        "syn_pre": pre,
        "syn_post": post,
        "syn_pre_xyz": pre_xyz,
        "syn_post_xyz": post_xyz,
    }
    pairs = {}
    for a in SIGN:
        for b in SIGN:
            n = int(np.count_nonzero((cls[pre] == a) & (cls[post] == b)))
            if n:
                pairs[f"{a}->{b}"] = n
    summary = {
        "wallets": int(len(body)),
        "wallets_per_class": {c: int((cls == c).sum()) for c in SIGN},
        "transactions": int(len(pre)),
        "connected_pairs": int(len(np.unique(pre * len(body) + post))),
        "transactions_per_class_pair": pairs,
        "units": "hemibrain voxels (8 nm)",
    }
    return manifest, summary


def rebuild():
    """(manifest, summary, sources) from the data files, with each source verified against its own record."""
    model, syn = load("cx_model.npz"), load("cx_synapses.npz")
    with open(os.path.join(DATA, "cx_model.json")) as f:
        model_hash = json.load(f)["content_sha256"]
    if content_hash(model) != model_hash:
        raise ValueError("data/cx_model.npz does not match the hash in cx_model.json: re-run derive_cx.py")
    manifest, summary = build(model, syn)
    return manifest, summary, {"data/cx_model.npz": model_hash, "data/cx_synapses.npz": content_hash(syn)}


def verify():
    """Rebuild from the sources and compare with the written manifest. Returns a list of problems."""
    manifest, _, sources = rebuild()
    stored = load("chain_manifest.npz")
    with open(os.path.join(DATA, "chain_manifest.json")) as f:
        rec = json.load(f)
    bad = []
    if rec["sources"] != sources:
        bad.append(f"sources differ: recorded {rec['sources']}, rebuilt {sources}")
    for k, a in manifest.items():
        if k not in stored or not np.array_equal(stored[k], a):
            bad.append(f"{k} differs from the rebuilt manifest")
    h = content_hash(manifest)
    for name, got in (("chain_manifest.json", rec["content_sha256"]), ("chain_manifest.npz", content_hash(stored))):
        if got != h:
            bad.append(f"{name} content hash {got[:12]} != rebuilt {h[:12]}")
    return bad


def main():
    manifest, summary, sources = rebuild()
    out = {
        "content_sha256": content_hash(manifest),
        "sources": sources,
        **summary,
        "layout": __doc__.split("Wallets (", 1)[1].split("    python chain_manifest.py", 1)[0].strip(),
    }
    np.savez_compressed(os.path.join(DATA, "chain_manifest.npz"), meta=json.dumps(out), **manifest)
    with open(os.path.join(DATA, "chain_manifest.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({k: out[k] for k in ("content_sha256", "sources", "wallets", "wallets_per_class", "transactions",
                                         "connected_pairs", "transactions_per_class_pair")}, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--verify", action="store_true", help="rebuild from the sources and check the written files")
    if ap.parse_args().verify:
        problems = verify()
        print("\n".join(problems) if problems else
              f"data/chain_manifest.npz matches the sources ({json.load(open(os.path.join(DATA, 'chain_manifest.json')))['content_sha256']})")
        raise SystemExit(1 if problems else 0)
    main()
