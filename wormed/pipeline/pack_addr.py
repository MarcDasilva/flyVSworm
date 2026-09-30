"""Derives the 302 neuron account addresses. Thru derives a program account
address from (program_id, seed); we shell out to the CLI rather than
reimplementing the derivation, because getting it subtly wrong would only
surface as BAD_ACCOUNT_ADDRESS (-16) at creation time."""
import base64
import json
import subprocess
from pathlib import Path

# docs/measurements.md lives at the REPO ROOT, not under wormed/ — three
# parents up from this file (wormed/pipeline/pack_addr.py -> wormed/pipeline
# -> wormed -> repo root).
DOCS = Path(__file__).resolve().parent.parent.parent / "docs"
CACHE = Path(__file__).resolve().parent.parent / "data" / "addresses.json"


def _program_id() -> str:
    for line in (DOCS / "measurements.md").read_text().splitlines():
        if line.startswith("PROGRAM_ADDRESS:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("PROGRAM_ADDRESS not in docs/measurements.md — run Task 1 Step 5")


def derive_addresses(names: list[str]) -> list[str]:
    if CACHE.exists():
        cached = json.loads(CACHE.read_text())
        if len(cached) == len(names):
            return cached
    pid = _program_id()
    out = []
    for name in names:
        seed = f"neuron-{name}"
        r = subprocess.run(
            ["thru", "program", "derive-address", "--json", pid, seed],
            capture_output=True, text=True, check=True,
        )
        addr = json.loads(r.stdout)["derive_address"]["derived_address"]
        out.append(addr)
    CACHE.parent.mkdir(exist_ok=True, parents=True)
    CACHE.write_text(json.dumps(out))
    return out


def _decode_pubkey_bytes(addr: str) -> bytes:
    """Raw bytes underneath a `ta...` address. Thru's own account-list sort
    (`thru txn sort`) orders by THESE bytes, not by the encoded string's
    ASCII codepoints — the `-`/`_` characters in the base64url alphabet
    (values 62/63) do not sit where '-'/'_' sit in ASCII (0x2D/0x5F), so a
    Python `sorted()` over the encoded strings disagrees with the chain at
    nearly every position. Verified against the CLI's real output for all
    302 neuron addresses (task-9-report.md, fix round 1)."""
    body = addr[2:] if addr.startswith("ta") else addr
    pad = "=" * (-len(body) % 4)
    return base64.urlsafe_b64decode(body + pad)


def chain_order_index(addrs: list[str]) -> tuple[dict, str]:
    """The ONE place in this codebase that answers "what order does Thru
    impose on these addresses". Returns ({address: ascending_rank}, source).

    `ascending_rank` is an address's position in Thru's own ascending order —
    the same order `thru txn execute --readwrite-accounts` imposes on a
    transaction's writable account list, and the same shape `thru txn sort
    --json` itself returns. Every caller that needs "the k-th account in a
    writable batch" (pipeline/pack.py's slot_map, pipeline/deploy.py's
    per-batch account index) must go through this function rather than
    reimplementing the sort, so there is exactly one definition of "ascending
    by address" in the codebase.

    source is "cli" when `thru txn sort` produced the order, or
    "python-fallback" when the CLI was unavailable and _decode_pubkey_bytes
    + sort ran instead. The fallback reproduces the CLI's order exactly
    (verified against all 302 real neuron addresses — see
    task-9-report.md), but callers that persist an artifact derived from
    this (pack.py's topology.bin) must record which path produced it in
    provenance.json, so it is never ambiguous which order shipped."""
    try:
        r = subprocess.run(
            ["thru", "--json", "txn", "sort", *addrs],
            capture_output=True, text=True, check=True, timeout=60,
        )
        order = json.loads(r.stdout)
        if set(order) != set(addrs):
            raise ValueError("thru txn sort returned a different address set")
        return order, "cli"
    except (FileNotFoundError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired, json.JSONDecodeError, ValueError):
        ranked = sorted(addrs, key=_decode_pubkey_bytes)
        return {a: i for i, a in enumerate(ranked)}, "python-fallback"
