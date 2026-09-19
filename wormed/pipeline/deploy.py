"""Chunked topology upload and 302-neuron account creation against the live
worm program on Thru alphanet.

CLI subcommands and flags below were confirmed against `thru` 0.3.16 by
running --help on every command used here (task-9-report.md has the raw
output) — do not extend this file by guessing new flags without doing the
same.

Chunk size is bounded by Thru's 32 KiB transaction limit; 2 KiB leaves ample
room for the header, account addresses, state proofs and hex-encoding
overhead (state proofs run ~200 bytes each and dominate a creation batch's
payload, not the topology chunks).
"""
import json
import struct
import subprocess
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
CHUNK = 2048
FEE_PAYER = "worm"

# Measured on-chain (task-9-report.md): a bare 1-account create costs fee 10
# at 8259 CU; a 2-account create+resize batch costs fee 20 at 12137 CU / 1
# state unit. FEE scales with batch size below rather than using one constant,
# because a 10-neuron create batch (10x create+resize+write) runs far more
# compute than either measurement.
FEE_SINGLETON = 20
FEE_PER_NEURON = 8   # additive per neuron in a create-batch, plus BASE_FEE
BASE_FEE = 20


def _program_id() -> str:
    from .pack_addr import _program_id as pid
    return pid()


def _run_json(args: list[str]) -> dict:
    r = subprocess.run(["thru", "--json", *args], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def _derive(seed: str) -> str:
    d = _run_json(["program", "derive-address", _program_id(), seed])
    return d["derive_address"]["derived_address"]


def _topology_account() -> str: return _derive("topology")
def _reservoir_account() -> str: return _derive("reservoir")
def _behavior_account() -> str: return _derive("behavior")


def _sort_order(addrs: list[str]) -> dict:
    """Canonical ascending order, from the chain's own `thru txn sort` —
    NOT Python's sorted(). Verified empirically that they disagree on these
    addresses (some decode such that '-'/'_' don't preserve ASCII order once
    the base62-ish encoding is undone). Using Python's sorted() here would
    write each neuron's name and index into the WRONG account, silently —
    see task-9-report.md for the diff that caught this."""
    return _run_json(["txn", "sort", *addrs])


def _make_proof(addr: str) -> bytes:
    """Called immediately before building the transaction that consumes it.
    State proofs are slot-bound (INVALID_PROOF_SLOT / -33 if stale) — do not
    cache these across a sleep or a large batch-building loop."""
    d = _run_json(["txn", "make-state-proof", "creating", addr])
    return bytes.fromhex(d["makeStateProof"]["proof_data_hex"])


def _exec(readwrite: list[str], hexdata: str, fee: int) -> dict:
    cmd = ["thru", "--json", "txn", "execute", "--fee-payer", FEE_PAYER, "--fee", str(fee)]
    for a in readwrite:
        cmd += ["--readwrite-accounts", a]   # clap wants the flag repeated, not comma-joined
    cmd += [_program_id(), hexdata]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"txn execute failed: {r.stdout}\n{r.stderr}")
    out = json.loads(r.stdout)["transaction_execute"]
    if out["execution_result"] != 0:
        raise RuntimeError(f"txn reverted: {out}")
    return out


def create_singletons() -> None:
    """Topology, reservoir and behavior. Must run BEFORE upload_topology().
    Topology gets size 0 here — upload_topology resizes it to the real size on
    the first chunk, so memory units are charged once rather than per chunk."""
    specs = [(_topology_account(), "topology", 0),
             (_reservoir_account(), "reservoir", 0),
             (_behavior_account(), "behavior", 32)]
    addrs = [a for a, _, _ in specs]
    order = _sort_order(addrs)
    rw = sorted(addrs, key=lambda a: order[a])
    body = bytearray(struct.pack("<IH", 6, len(specs)))
    for addr, seed_str, size in specs:
        pb = _make_proof(addr)
        seed = seed_str.encode().ljust(32, b"\0")[:32]
        body += struct.pack("<HI", 2 + order[addr], size)
        body += seed + struct.pack("<I", len(pb)) + pb
    out = _exec(rw, bytes(body).hex(), FEE_SINGLETON)
    print(f"create_singletons -> {out['signature']} "
          f"cu={out['compute_units_consumed']} su={out['state_units_consumed']}")


def fund_reservoir(amount: int = 200_000) -> None:
    """Chemical settlement transfers against the reservoir. ~200,000 units
    (~20 faucet withdrawals at 10,000/call) is headroom for every neuron
    sitting at BAL_MAX (2000, post R14) simultaneously plus margin — cheap
    insurance against a mid-demo INSUFFICIENT_BALANCE (-38)."""
    subprocess.run(["thru", "transfer", FEE_PAYER, _reservoir_account(), str(amount)], check=True)


def upload_topology() -> None:
    blob = (DATA / "topology.bin").read_bytes()
    topo = _topology_account()
    for off in range(0, len(blob), CHUNK):
        piece = blob[off:off + CHUNK]
        payload = struct.pack("<III", 1, off, len(piece)) + piece
        out = _exec([topo], payload.hex(), BASE_FEE)
        print(f"chunk {off:6d}/{len(blob)} -> {out['signature']} "
              f"cu={out['compute_units_consumed']} su={out['state_units_consumed']}")


def create_all_neurons(batch: int = 10) -> None:
    """Thru sorts the writable array ascending BY THE CHAIN'S OWN notion of
    address order (thru txn sort), not Python's sorted() — see _sort_order.
    The account index a neuron gets is its position in that sorted batch, not
    its position in the group. Getting this wrong writes every neuron's name
    into the wrong account and the failure only surfaces much later as a
    scrambled classifier.

    Batch of 10 (not the 20 a naive read of the brief suggests): state proofs
    are slot-bound, so a smaller batch that submits sooner after proof
    generation is less likely to hit INVALID_PROOF_SLOT (-33)."""
    names = json.loads((DATA / "names.json").read_text())
    addrs = json.loads((DATA / "addresses.json").read_text())
    for start in range(0, len(names), batch):
        group = list(range(start, min(start + batch, len(names))))
        group_addrs = [addrs[i] for i in group]
        order = _sort_order(group_addrs)
        rw = sorted(group_addrs, key=lambda a: order[a])
        body = bytearray(struct.pack("<IH", 2, len(group)))
        for i in group:
            pb = _make_proof(addrs[i])
            seed = f"neuron-{names[i]}".encode().ljust(32, b"\0")[:32]
            body += struct.pack("<HH", 2 + order[addrs[i]], i)
            body += names[i].encode().ljust(8, b"\0")[:8]
            body += seed + struct.pack("<I", len(pb)) + pb
        fee = BASE_FEE + FEE_PER_NEURON * len(group)
        out = _exec(rw, bytes(body).hex(), fee)
        print(f"neurons {start:3d}-{group[-1]:3d} -> {out['signature']} "
              f"cu={out['compute_units_consumed']} su={out['state_units_consumed']}")
