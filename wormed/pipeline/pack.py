"""Packs the connectome into the binary layout program/worm.h expects.

The 8-byte alignment assert in _align() is load-bearing: ThruVM faults on
unaligned access and on any single access spanning a 4KB page boundary.
Aligning every array start to 8 makes both impossible, because element sizes
(2, 4, 8) all divide 8 and 4096 is a multiple of 8."""
import json
import math
import struct
from pathlib import Path

from .connectome import load_connectome, assign_physiology, neuron_positions
from .pack_addr import derive_addresses, chain_order_index
from .refsim import compute_resting_state

DATA = Path(__file__).resolve().parent.parent / "data"
HDR_SZ = 64
LUT_ENTRIES = 257
N_TOP_EDGES = 1500
# worm.h's static upper bounds (headroom over the real 2573/1034). Kept in
# sync by the assert below rather than by hand — a silent overrun here is a
# buffer overrun in the on-chain program, not a wrong number.
WORM_H_N_CHEM = 2600
WORM_H_N_GAP = 1100
LAYOUT: dict[str, tuple[int, int]] = {}


def _sigmoid_lut() -> list[int]:
    """257 entries spanning x in [-8, 8], output Q16.16 in [0, 1]. The extra
    entry is the right edge, so interpolation never reads past the end."""
    out = []
    for i in range(LUT_ENTRIES):
        x = -8.0 + 16.0 * i / (LUT_ENTRIES - 1)
        out.append(int(round((1.0 / (1.0 + math.exp(-x))) * 65536)))
    return out


def _q88(v: float) -> int:
    return max(-32768, min(32767, int(round(v * 256))))


def build_all() -> Path:
    c = load_connectome()
    p = assign_physiology(c)
    pos = neuron_positions(c)
    n = len(c.names)

    # --- CSR by POSTSYNAPTIC neuron: row i holds every edge arriving at i. ---
    chem_by_post: list[list[int]] = [[] for _ in range(n)]
    for e, (pre, post, _w) in enumerate(c.chem):
        chem_by_post[post].append(e)

    chem_rowptr, chem_col, chem_g, chem_E = [0], [], [], []
    for i in range(n):
        for e in chem_by_post[i]:
            chem_col.append(c.chem[e][0])
            chem_g.append(_q88(p.chem_g[e]))
            chem_E.append(p.chem_E_mV[e])
        chem_rowptr.append(len(chem_col))

    # Gap junctions stored in BOTH directions so the inner loop is uniform.
    gap_by_node: list[list[tuple[int, int]]] = [[] for _ in range(n)]
    for e, (a, b, _w) in enumerate(c.gap):
        gap_by_node[b].append((a, e))
        gap_by_node[a].append((b, e))

    gap_rowptr, gap_col, gap_g = [0], [], []
    for i in range(n):
        for other, e in gap_by_node[i]:
            gap_col.append(other)
            gap_g.append(_q88(p.gap_g[e]))
        gap_rowptr.append(len(gap_col))

    # The real connectome must fit inside worm.h's static array bounds — those
    # bounds are compile-time constants in the on-chain program, and silently
    # exceeding them is a buffer overrun, not a wrong number.
    assert len(chem_col) <= WORM_H_N_CHEM, (
        f"chemical edge count {len(chem_col)} exceeds worm.h N_CHEM={WORM_H_N_CHEM} "
        "— update N_CHEM in wormed/program/worm.h"
    )
    assert len(gap_col) <= WORM_H_N_GAP, (
        f"gap edge count (both directions) {len(gap_col)} exceeds worm.h N_GAP={WORM_H_N_GAP} "
        "— update N_GAP in wormed/program/worm.h"
    )

    # --- Account-slot permutation. Thru sorts writable accounts ascending by
    # address, so slot k in the transaction is NOT neuron k.
    #
    # The program derives this map at runtime by reading each account's own
    # index field (Task 10), so this array is a CROSS-CHECK, not the source of
    # truth: if the two ever disagree, address derivation drifted — almost
    # always a changed program id — and every transfer would target the wrong
    # neuron. Keeping it costs 604 bytes and catches a silent, total failure.
    #
    # FIX ROUND 1 (Task 9 finding 1): this used to be `sorted(range(n),
    # key=lambda i: addrs[i])` — Python's string sort over the ENCODED `ta...`
    # address. That disagrees with Thru's real ascending order (by decoded
    # pubkey bytes) at effectively every position, because '-'/'_' in the
    # base64url alphabet don't sit where ASCII puts them. deploy.py already
    # used the chain's real order (`thru txn sort`) to create the 302
    # accounts; this cross-check must use the SAME order or it is guaranteed
    # to disagree with the on-chain reality it exists to catch drift against.
    # chain_order_index is the one shared definition of "ascending by
    # address" — see pack_addr.py. ---
    addrs = derive_addresses(c.names)
    rank, slot_map_order = chain_order_index(addrs)
    slot_map = [0] * n
    for neuron_idx, addr in enumerate(addrs):
        slot_map[rank[addr]] = neuron_idx

    # --- Emit, 8-aligning every array start. ---
    body = bytearray()
    LAYOUT.clear()

    def _align():
        while (HDR_SZ + len(body)) % 8:
            body.append(0)

    def _put(name: str, fmt: str, values) -> int:
        _align()
        off = HDR_SZ + len(body)
        assert off % 8 == 0, f"{name} misaligned at {off}"
        body.extend(struct.pack(f"<{len(values)}{fmt}", *values))
        LAYOUT[name] = (off, len(values) * struct.calcsize(fmt))
        return off

    off_slot_map    = _put("slot_map",     "H", slot_map)
    off_chem_rowptr = _put("chem_rowptr",  "I", chem_rowptr)
    off_chem_col    = _put("chem_col",     "H", chem_col)
    off_chem_g      = _put("chem_g",       "h", chem_g)
    off_chem_E      = _put("chem_E",       "h", chem_E)
    off_gap_rowptr  = _put("gap_rowptr",   "I", gap_rowptr)
    off_gap_col     = _put("gap_col",      "H", gap_col)
    off_gap_g       = _put("gap_g",        "h", gap_g)

    _align()
    off_params = HDR_SZ + len(body)
    LAYOUT["params"] = (off_params, n * 16)
    params_start = len(body)

    def _pack_params(v_rest_mV: list[int]) -> bytes:
        buf = bytearray()
        for q, v_rest in zip(p.params, v_rest_mV):
            buf.extend(struct.pack("<hhhhhh4x",
                                    _q88(q.g_leak), q.E_leak_mV, _q88(q.C),
                                    q.V_half_mV, _q88(1.0 / q.k_mV), v_rest))
        return bytes(buf)

    # Placeholder V_rest_mV=0 for the bootstrap write below — FloatSim never
    # reads this field to simulate, only the classifier (a later task) does.
    body.extend(_pack_params([0] * n))
    params_end = len(body)

    off_lut = _put("lut", "i", _sigmoid_lut())
    total = HDR_SZ + len(body)

    hdr = struct.pack("<16I",
        0x574F524D, 1, n, len(chem_col), len(gap_col),
        off_slot_map, off_chem_rowptr, off_chem_col, off_chem_g, off_chem_E,
        off_gap_rowptr, off_gap_col, off_gap_g, off_params, off_lut, total)
    assert len(hdr) == HDR_SZ

    DATA.mkdir(exist_ok=True)
    out = DATA / "topology.bin"
    out.write_bytes(hdr + bytes(body))

    # FINDING 1: the network does not rest at E_leak (see refsim.py:
    # compute_resting_state). Solve for the real resting voltages against the
    # topology.bin just written — every field FloatSim reads to simulate is
    # already final, only V_rest_mV itself is a placeholder — then patch the
    # params block in place and rewrite. Total size and every other offset
    # are unchanged.
    v_rest_mV = compute_resting_state()
    body[params_start:params_end] = _pack_params(v_rest_mV)
    out.write_bytes(hdr + bytes(body))

    (DATA / "names.json").write_text(json.dumps(c.names))
    (DATA / "positions.json").write_text(json.dumps(pos))
    (DATA / "addresses.json").write_text(json.dumps(addrs))

    # TASK5: front-end connectome renderer wants a bounded edge list, not the
    # full 2573 — 1500 strongest by contact count keeps the render readable
    # and stays well under any reasonable payload budget.
    top_edges = sorted(c.chem, key=lambda e: -e[2])[:N_TOP_EDGES]
    (DATA / "edges.json").write_text(json.dumps([[pre, post] for pre, post, _w in top_edges]))

    provenance = dict(p.provenance)
    provenance["derivation"] = "cli"
    # FIX ROUND 1: records which code path produced slot_map's ordering, so
    # a topology.bin built without the CLI available (python-fallback) is
    # never silently indistinguishable from one built with it.
    provenance["slot_map_order"] = slot_map_order
    (DATA / "provenance.json").write_text(json.dumps(provenance, indent=2))
    return out


if __name__ == "__main__":
    path = build_all()
    print(f"{path} — {path.stat().st_size} bytes, {path.stat().st_size / 4096:.1f} pages")
