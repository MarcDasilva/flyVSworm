"""The integer brain the fly program on Thru computes with: the trading fly's weights and constants, Q16.16.

The chain holds three things (user decisions, 2026-09-19):
  what the brain IS    data/chain_manifest.npz  a wallet per neuron, a transaction per measured synapse,
                       append-only, so past and current wiring both stay on chain
  what it DOES         chain_event.py           spike blocks and readouts, one per bar
  what it computes     THIS FILE                the weight table, needed only because the program has to
                       model the fly: the trading fly runs the rotation-averaged ring, whose weights come
                       from float geometry (SVD, exponentials) that the VM cannot recompute. So they are
                       derived here from the spec, quantized, and pinned by a content hash.

Neurons are in the RUNNING fly's order (the spec's connectome), which is not the manifest's order; the
body IDs and the wallet column map each row to its wallet. Integers only: the Thru VM has no floating
point. Q16.16 = round(x * 65536) with Python's round (halves to even), saturated to i32 (chain_event.to_q16).

Arrays:
    body_id, cls, wedge, sign     one row per neuron, in the running fly's order
    wallet                        the neuron's row in data/chain_manifest.npz (its wallet)
    pre, post, weight_q16         one row per nonzero weight: sign included, in the neuron order above
    landmark_q16                  (n_wedges, N) the landmark footprint the boot phase drives with
    const_name, const_q16         model and trading constants (tau, syn_decay, thresholds, drive levels...)
The port may want reciprocals (1/tau) or a different fixed-point format; both are derivable from these,
and a change of format changes this file's hash, which is the point.

    python chain_weights.py [--spec SPEC]   (writes data/chain_weights.npz and .json)
    python chain_weights.py --verify        (rebuilds from the spec and checks the written files)
"""
import argparse
import hashlib
import json
import os

import numpy as np

import chain_event
import connectome
import tests
from model_float import load_spec
from trading import DriveParams, ReadoutParams

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
Q = chain_event.Q


def quantize(a):
    """Float array -> Q16.16 int32, one value at a time, exactly as chain_event encodes readouts."""
    flat = [chain_event.to_q16(float(x)) for x in np.asarray(a, dtype=float).ravel()]
    return np.array(flat, np.int32).reshape(np.shape(a))


def constants(p, spec):
    """(names, Q16.16 values) of everything the program needs besides the weights."""
    pr, dp, rp = spec["protocol"], DriveParams(), ReadoutParams()
    out = {f"model.{k}": getattr(p, k) for k in ("tau", "dt", "syn_decay", "v_thresh", "v_reset", "refrac_ticks",
                                                 "noise_amp", "neuromod_gain")}
    out["protocol.landmark_current"] = pr["landmark_current"]
    for i, d in enumerate(pr["t3_drive_levels"]):
        out[f"protocol.t3_drive_levels.{i}"] = d
    out["protocol.t8_drive"] = pr["t8_drive"]
    out["protocol.t7_noise_amp"] = pr["t7_noise_amp"]
    out.update({f"drive.{k}": v for k, v in vars(dp).items()})
    out.update({f"readout.{k}": v for k, v in vars(rp).items()})
    names = sorted(out)
    return np.array(names, dtype=str), quantize([out[k] for k in names])


def build(spec_path):
    """(arrays, summary) for one spec: its connectome's weights and constants as integers."""
    p, spec = load_spec(spec_path)
    cx = connectome.build(p, spec.get("connectome"))
    with np.load(os.path.join(DATA, "chain_manifest.npz"), allow_pickle=False) as f:
        wallets = f["wallet_body_id"]
    source = spec["connectome"]["file"] if spec.get("connectome", {}).get("file") else None
    if source is None:
        raise ValueError(f"{spec_path}: only a hemibrain spec has body IDs to map to wallets")
    with np.load(os.path.join(connectome.ROOT, source), allow_pickle=False) as f:
        body_id, cls = f["body_id"], f["cls"]
    index = {int(b): i for i, b in enumerate(wallets)}
    if set(index) != {int(b) for b in body_id}:
        raise ValueError("the spec's neurons are not the manifest's wallets")
    pre, post = np.nonzero(cx.W)
    arrays = {
        "body_id": body_id.astype(np.int64),
        "cls": cls,
        "wedge": cx.wedge_of.astype(np.int64),
        "sign": np.array([-1 if str(c) == "D7" else 1 for c in cls], np.int64),
        "wallet": np.array([index[int(b)] for b in body_id], np.int64),
        "pre": pre.astype(np.int64),
        "post": post.astype(np.int64),
        "weight_q16": quantize(cx.W[pre, post]),
        "landmark_q16": quantize(cx.landmark),
    }
    arrays["const_name"], arrays["const_q16"] = constants(p, spec)
    w = cx.W[pre, post]
    err = np.abs(arrays["weight_q16"].astype(float) / Q - w) / np.abs(w)
    summary = {
        "spec": os.path.basename(spec_path),
        "connectome": spec["connectome"],
        "model_sha256": hashlib.sha256(json.dumps({"model": spec["model"], "protocol": spec["protocol"]},
                                                  sort_keys=True).encode()).hexdigest(),
        "manifest_sha256": json.load(open(os.path.join(DATA, "chain_manifest.json")))["content_sha256"],
        "neurons": int(cx.N),
        "weights": int(len(pre)),
        "format": f"Q16.16 = round(x * {Q}) (halves to even), saturated to i32",
        "suite_check": "T1-T8 pass with these weights (chain_weights.as_connectome) on seeds 0-9",
        "weight_rounding": {"median_rel_error": round(float(np.median(err)), 6),
                            "p95_rel_error": round(float(np.percentile(err, 95)), 6),
                            "max_rel_error": round(float(err.max()), 6),
                            "rounded_to_zero": int((arrays["weight_q16"] == 0).sum())},
    }
    return arrays, summary


def as_connectome(arrays, spec):
    """The brain the table describes, as a Connectome: weights and landmark read back from Q16.16.
    Running the suite on this is the float-vs-fixed check the port is bisected against."""
    n = len(arrays["body_id"])
    W = np.zeros((n, n))
    W[arrays["pre"], arrays["post"]] = arrays["weight_q16"].astype(np.float64) / Q
    cls = arrays["cls"]
    idx = {}
    for name in ("EPG", "PEN_L", "PEN_R", "D7"):
        ids = np.flatnonzero(cls == name)
        idx[name] = slice(int(ids[0]), int(ids[-1]) + 1)
    return connectome.Connectome(W=W, N=n, n_wedges=len(arrays["landmark_q16"]), idx=idx,
                                 wedge_of=arrays["wedge"].astype(int),
                                 source=spec["connectome"]["source"] + "+q16",
                                 landmark=arrays["landmark_q16"].astype(np.float64) / Q)


def verify(spec_path):
    """Rebuild from the spec and compare with the written files. Returns a list of problems."""
    arrays, summary = build(spec_path)
    with np.load(os.path.join(DATA, "chain_weights.npz"), allow_pickle=False) as f:
        stored = {k: f[k] for k in f.files}
    with open(os.path.join(DATA, "chain_weights.json")) as f:
        rec = json.load(f)
    bad = [f"{k} differs from the rebuilt table" for k, a in arrays.items()
           if k not in stored or not np.array_equal(stored[k], a)]
    h = connectome.content_hash(arrays)
    for name, got in (("chain_weights.json", rec["content_sha256"]), ("chain_weights.npz", connectome.content_hash(stored))):
        if got != h:
            bad.append(f"{name} content hash {got[:12]} != rebuilt {h[:12]}")
    for k in ("spec", "connectome", "model_sha256", "manifest_sha256"):
        if rec[k] != summary[k]:
            bad.append(f"{k} differs: recorded {rec[k]}, rebuilt {summary[k]}")
    return bad


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spec", default=tests.DEFAULT_SPEC, help="the fly to write (default: the trading fly)")
    ap.add_argument("--verify", action="store_true", help="rebuild from the spec and check the written files")
    args = ap.parse_args()
    if args.verify:
        problems = verify(args.spec)
        print("\n".join(problems) if problems else
              f"data/chain_weights.npz matches {os.path.basename(args.spec)} "
              f"({json.load(open(os.path.join(DATA, 'chain_weights.json')))['content_sha256']})")
        raise SystemExit(1 if problems else 0)
    arrays, summary = build(args.spec)
    out = {"content_sha256": connectome.content_hash(arrays), **summary}
    np.savez_compressed(os.path.join(DATA, "chain_weights.npz"), meta=json.dumps(out), **arrays)
    with open(os.path.join(DATA, "chain_weights.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=1))
