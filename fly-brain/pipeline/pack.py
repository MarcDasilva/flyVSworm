"""Turn the fly's connectome into the binary blob the on-chain program reads.

    python -m fly-brain.pipeline.pack        (or: python pipeline/pack.py)

Writes data/topology.bin plus the sidecars the deploy and the front end need.
The blob is deterministic: the same spec produces the same bytes, which is what
lets a chain mismatch be blamed on the chain.

LAYOUT RULES, both load-bearing on ThruVM:

  * every array starts 8-byte aligned. The VM faults on an unaligned scalar
    load AND on any single access spanning a 4 KB page boundary. Element sizes
    here are 1, 4 and 8, all of which divide 8, and 4096 is a multiple of 8, so
    8-alignment defeats both at once.
  * the header is exactly 64 bytes and its total_sz sits at 0x2C, because
    fly.c's do_upload reads that field out of the FIRST CHUNK to size the
    account in one resize rather than re-charging memory units per chunk.

THE DENSE INDEX ORDER IS FROZEN once topology.bin ships: every neuron account's
address derives from its name, and the names are emitted in this order. Adding
a neuron in the middle invalidates every address after it.
"""
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
sys.path.insert(0, os.path.join(ROOT, "python"))

import connectome                      # noqa: E402
import live                            # noqa: E402
from model_float import load_spec      # noqa: E402

Q16 = 65536
HDR_SZ = 64
MAGIC = 0x31594C46                     # "FLY1", matching FLY_MAGIC in fly.h
VERSION = 1

# Compile-time bounds in fly.h. Exceeding one is a buffer overrun in the
# on-chain program, not a wrong number, so these are asserts and not warnings.
FLY_H_N_NEURONS = 134
FLY_H_N_WEDGES = 16
FLY_H_RATE_WINDOW_MAX = 64

RATE_WINDOW = 50        # metrics.rate_series' default: the readout's window
NO_WEDGE = 0xFF         # D7 cells sit outside the ring; wedge_of gives them -1

LAYOUT = {}             # {name: (offset, byte_length)}, asserted by the tests


def q16(x):
    """Float -> Q16.16, round half to even. Deterministic, and the only place
    the model's floats become integers: everything downstream -- the on-chain
    program, the native harness and the fixed-point reference -- reads these
    same ints, so this rounding fixes the model, it does not approximate it."""
    return np.rint(np.asarray(x, dtype=np.float64) * Q16).astype(np.int64)


def neuron_names(cx):
    """One <=8 byte name per neuron, in dense index order.

    Names are labels, not identity -- the classifier reads class and wedge out
    of the topology rather than matching strings, so a rebuild that renames a
    cell cannot silently point it at the wrong population. They exist because
    the account seed has to be something a human can read in an explorer."""
    prefix = {"EPG": "EPG", "PEN_L": "PENL", "PEN_R": "PENR", "D7": "D7"}
    names, seen = [None] * cx.N, {}
    for pop, ix in cx.idx.items():
        members = np.arange(cx.N)[ix] if isinstance(ix, slice) else np.atleast_1d(ix)
        for k, i in enumerate(members):
            name = f"{prefix[pop]}{k:02d}"
            if len(name) > 8:
                raise ValueError(f"name {name!r} does not fit in 8 bytes")
            if name in seen:
                raise ValueError(f"duplicate neuron name {name!r}")
            seen[name] = True
            names[int(i)] = name
    if any(n is None for n in names):
        raise ValueError("a neuron belongs to no population: idx does not cover the ring")
    return names


def classes(cx):
    """CLS_* per neuron, matching the constants in fly.h."""
    code = {"EPG": 0, "PEN_L": 1, "PEN_R": 2, "D7": 3}
    out = np.full(cx.N, 255, np.uint8)
    for pop, ix in cx.idx.items():
        out[ix] = code[pop]
    if (out == 255).any():
        raise ValueError("a neuron belongs to no population")
    return out


def wedges(cx):
    """Angular unit per neuron; NO_WEDGE for cells outside the ring."""
    w = np.asarray(cx.wedge_of)
    out = np.where(w < 0, NO_WEDGE, w).astype(np.uint8)
    epg = classes(cx) == 0
    present = set(int(v) for v in out[epg])
    missing = set(range(cx.n_wedges)) - present
    if missing:
        # wedge_rates divides by the number of EPG cells in each wedge; an
        # empty one would divide by zero on chain.
        raise ValueError(f"wedges {sorted(missing)} hold no EPG cell")
    return out


def initial_potentials(cx, p, seed=0):
    """The membrane potentials a fresh run starts from.

    model_float.init_state draws these uniformly in [v_reset, v_thresh) from a
    seeded generator. A ring started from a flat zero never breaks symmetry and
    no bump forms, so the on-chain reset needs real values; drawing them here,
    from the same generator, is what makes a chain reset start the same brain
    the laptop would."""
    rng = np.random.default_rng(seed)
    return rng.uniform(p.v_reset, p.v_thresh, cx.N)


def sincos(n_wedges):
    """cos then sin of each wedge's angle, Q16.16.

    The population vector needs these and ThruVM has no libm. metrics.heading
    uses theta_w = 2*pi*w/n_wedges, so these are that, tabulated."""
    theta = 2 * np.pi * np.arange(n_wedges) / n_wedges
    return np.concatenate([q16(np.cos(theta)), q16(np.sin(theta))])


def build(spec_path=None):
    """(blob bytes, names, meta) for the current spec."""
    spec_path = spec_path or live.SPEC_PATH
    p, spec = load_spec(spec_path)
    cx = connectome.build(p, spec.get("connectome"))

    if cx.N != FLY_H_N_NEURONS:
        raise ValueError(f"{cx.N} neurons, but fly.h compiles N_NEURONS={FLY_H_N_NEURONS}; "
                         "update the header, do not let it overrun")
    if cx.n_wedges != FLY_H_N_WEDGES:
        raise ValueError(f"{cx.n_wedges} wedges, but fly.h compiles N_WEDGES={FLY_H_N_WEDGES}")
    if RATE_WINDOW > FLY_H_RATE_WINDOW_MAX:
        raise ValueError(f"rate window {RATE_WINDOW} exceeds fly.h's RATE_WINDOW_MAX")
    if p.noise_amp != 0.0:
        # The chain has no source of randomness the reference can reproduce.
        raise ValueError(f"noise_amp is {p.noise_amp}, but the on-chain step is deterministic; "
                         "a nonzero noise term cannot be reproduced bit for bit")

    names = neuron_names(cx)
    body = bytearray()

    def align():
        while (HDR_SZ + len(body)) % 8:
            body.append(0)

    def put(name, fmt, values):
        align()
        off = HDR_SZ + len(body)
        assert off % 8 == 0, f"{name} misaligned at {off}"
        flat = np.asarray(values).reshape(-1)
        body.extend(struct.pack(f"<{flat.size}{fmt}", *(int(v) for v in flat)))
        LAYOUT[name] = (off, flat.size * struct.calcsize(fmt))
        return off

    off_w        = put("w",        "i", q16(cx.W))                     # row = presynaptic
    off_class    = put("class",    "B", classes(cx))
    off_wedge    = put("wedge",    "B", wedges(cx))
    off_landmark = put("landmark", "i", q16(cx.landmark))
    off_v0       = put("v0",       "i", q16(initial_potentials(cx, p)))
    off_sincos   = put("sincos",   "i", sincos(cx.n_wedges))

    align()
    off_params = HDR_SZ + len(body)
    assert off_params % 8 == 0
    params = struct.pack("<5iIIi",
                         int(q16(p.dt)), int(q16(1.0 / p.tau)), int(q16(p.syn_decay)),
                         int(q16(p.v_thresh)), int(q16(p.v_reset)),
                         int(p.refrac_ticks), RATE_WINDOW, 0)
    assert len(params) == 32, "fly_param_t is 32 bytes"
    body.extend(params)
    LAYOUT["params"] = (off_params, len(params))

    total = HDR_SZ + len(body)
    hdr = struct.pack("<16I", MAGIC, VERSION, cx.N, cx.n_wedges,
                      off_w, off_class, off_wedge, off_landmark, off_v0,
                      off_sincos, off_params, total, 0, 0, 0, 0)
    assert len(hdr) == HDR_SZ, "fly_topology_hdr_t is 64 bytes"

    meta = {
        "spec": os.path.relpath(spec_path, ROOT).replace(os.sep, "/"),
        "source": cx.source,
        "n_neurons": cx.N,
        "n_wedges": cx.n_wedges,
        "nonzero_weights": int(np.count_nonzero(cx.W)),
        "rate_window": RATE_WINDOW,
        "total_sz": total,
        "layout": {k: list(v) for k, v in sorted(LAYOUT.items())},
        "populations": {k: int(np.atleast_1d(np.arange(cx.N)[v]).size) for k, v in cx.idx.items()},
    }
    return bytes(hdr) + bytes(body), names, meta


def build_all(spec_path=None):
    """Write data/topology.bin, data/fly_names.json and data/fly_provenance.json."""
    blob, names, meta = build(spec_path)
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "topology.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(DATA, "fly_names.json"), "w") as f:
        json.dump(names, f, indent=1)
    with open(os.path.join(DATA, "fly_provenance.json"), "w") as f:
        json.dump(meta, f, indent=1)
    return blob, names, meta


if __name__ == "__main__":
    blob, names, meta = build_all(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"topology.bin: {len(blob):,} bytes, {meta['n_neurons']} neurons, "
          f"{meta['nonzero_weights']:,} nonzero weights")
    for name, (off, size) in sorted(meta["layout"].items(), key=lambda kv: kv[1][0]):
        print(f"  {name:<9} at {off:>7,}  {size:>8,} bytes")
