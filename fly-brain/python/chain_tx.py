"""Instruction bytes for the fly_brain Thru program (chain/examples/tn_fly_brain.h).

Turns data/chain_manifest.npz into the transactions that put the brain on chain, in manifest order:

    CreateBrain    once: the manifest hash, the totals, and the authority allowed to write
    CreateNeuron   134, one per neuron: creates its program-derived account (its wallet)
    AddSynapse     114,854, one per measured synapse

Every write carries its manifest row index, and the program requires it to equal the count already
recorded, so a retried transaction reverts instead of recording a duplicate and resuming is exactly
"read the brain account's counts and continue there".

Layouts are little-endian packed C structs; chain/fly_brain.abi.yaml mirrors them and
`thru abi reflect` decodes what this module encodes (test_chain_tx.py runs that round trip).

    python chain_tx.py --plan                 what the submission will send
    python chain_tx.py --sample DIR           one sample payload per instruction, for reflection
"""
import argparse
import json
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
SEED_SIZE = 32          # TN_SEED_SIZE
CREATE_BRAIN, CREATE_NEURON, ADD_SYNAPSE = 0, 1, 2
CLS = {"EPG": 0, "PEN_L": 1, "PEN_R": 2, "D7": 3}
BRAIN_SEED = "fly-brain"                       # the brain account's seed
NEURON_SEED = "fly-n-{body_id}"                # one per neuron, from its hemibrain body ID

_CREATE_BRAIN = struct.Struct("<IH32s32s32sIII")
_CREATE_NEURON = struct.Struct("<IHHI32sQBbbBI")
_ADD_SYNAPSE = struct.Struct("<IHHHHIQQiiiiii")


def seed(text):
    """A 32-byte program seed from a name, as `thru program seed-to-hex` encodes it."""
    raw = text.encode()
    if len(raw) > SEED_SIZE:
        raise ValueError(f"seed {text!r} is longer than {SEED_SIZE} bytes")
    return raw.ljust(SEED_SIZE, b"\0")


def load_manifest():
    with np.load(os.path.join(DATA, "chain_manifest.npz"), allow_pickle=False) as f:
        return {k: f[k] for k in f.files if k != "meta"}


def manifest_hash():
    with open(os.path.join(DATA, "chain_manifest.json")) as f:
        return bytes.fromhex(json.load(f)["content_sha256"])


def create_brain(account_index, authority, neuron_total, synapse_total, proof=b"", seed_text=BRAIN_SEED):
    """Create the brain account: it records the manifest being written, the totals and the authority."""
    if len(authority) != 32:
        raise ValueError("authority must be a 32-byte public key")
    return _CREATE_BRAIN.pack(CREATE_BRAIN, account_index, seed(seed_text), manifest_hash(), bytes(authority),
                              neuron_total, synapse_total, len(proof)) + bytes(proof)


def create_neuron(brain_index, account_index, index, body_id, cls, wedge, sign, proof=b""):
    """Create one neuron's account. index is its manifest row (0..133)."""
    return _CREATE_NEURON.pack(CREATE_NEURON, brain_index, account_index, index,
                               seed(NEURON_SEED.format(body_id=body_id)), body_id,
                               CLS[str(cls)], wedge, sign, 0, len(proof)) + bytes(proof)


def add_synapse(brain_index, pre_index, post_index, index, pre_body_id, post_body_id, pre_xyz, post_xyz):
    """Record one synapse. index is its manifest row (0..114853); the body IDs bind it to its neurons."""
    return _ADD_SYNAPSE.pack(ADD_SYNAPSE, brain_index, pre_index, post_index, 0, index,
                             pre_body_id, post_body_id, *(int(v) for v in pre_xyz), *(int(v) for v in post_xyz))


def neuron_rows(m, start=0):
    """(index, body_id, cls, wedge, sign, seed text) per neuron, from start (the brain's neuron_count)."""
    for i in range(start, len(m["wallet_body_id"])):
        body = int(m["wallet_body_id"][i])
        yield (i, body, str(m["wallet_cls"][i]), int(m["wallet_wedge"][i]), int(m["wallet_sign"][i]),
               NEURON_SEED.format(body_id=body))


def synapse_rows(m, start=0):
    """(index, pre wallet, post wallet, pre body, post body, pre_xyz, post_xyz) per synapse, from start."""
    body = m["wallet_body_id"]
    for i in range(start, len(m["syn_pre"])):
        pre, post = int(m["syn_pre"][i]), int(m["syn_post"][i])
        yield i, pre, post, int(body[pre]), int(body[post]), m["syn_pre_xyz"][i], m["syn_post_xyz"][i]


def plan(m):
    """What a full submission sends, with the account each transaction needs."""
    return {
        "create_brain": 1,
        "create_neuron": len(m["wallet_body_id"]),
        "add_synapse": int(len(m["syn_pre"])),
        "transactions": 1 + len(m["wallet_body_id"]) + int(len(m["syn_pre"])),
        "brain_seed": BRAIN_SEED,
        "neuron_seed": NEURON_SEED,
        "bytes_per_add_synapse": _ADD_SYNAPSE.size,
        "state_proofs_needed": 1 + len(m["wallet_body_id"]),  # only account creation needs one
    }


def samples(m, authority=b"\x11" * 32):
    """One payload per instruction, from the real manifest, for `thru abi reflect`."""
    i, body, cls, wedge, sign, _ = next(neuron_rows(m))
    s = next(synapse_rows(m))
    return {
        "create_brain": create_brain(2, authority, len(m["wallet_body_id"]), len(m["syn_pre"]), proof=b"\x07" * 104),
        "create_neuron": create_neuron(2, 3, i, body, cls, wedge, sign, proof=b"\x07" * 104),
        "add_synapse": add_synapse(2, s[1], s[2], s[0], s[3], s[4], s[5], s[6]),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", action="store_true", help="print what a full submission sends")
    ap.add_argument("--sample", metavar="DIR", help="write one sample payload per instruction into DIR")
    args = ap.parse_args()
    m = load_manifest()
    if args.plan or not args.sample:
        print(json.dumps(plan(m), indent=1))
    if args.sample:
        os.makedirs(args.sample, exist_ok=True)
        for name, payload in samples(m).items():
            path = os.path.join(args.sample, f"{name}.bin")
            with open(path, "wb") as f:
                f.write(payload)
            print(f"{path}: {len(payload)} bytes")
