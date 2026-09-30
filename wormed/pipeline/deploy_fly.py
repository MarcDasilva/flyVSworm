"""Creates and funds the fly's 56 neuron accounts on Thru alphanet, then hands
the web relay the addresses it settles synaptic events against.

The fly's program (program/fly.c, seed `hello-fly-v1`) does NOT simulate
anything: fly-brain/python runs the spiking model, and each synaptic event it
produces settles here as its own signed transaction. Everything about account
ordering, state proofs and batch sizes is inherited from deploy.py — read its
comments before changing any of it, they were paid for on chain.

Run from the repo root, once:

    python3 -m wormed.pipeline.deploy_fly setup
"""
import json
import struct
import time
import subprocess
import sys
from pathlib import Path

from .deploy import FEE_PAYER, BASE_FEE, FEE_PER_NEURON, _make_proof, _run_json, _sort_order

DATA = Path(__file__).resolve().parent.parent / "data"
PROGRAM_SEED = "hello-fly-v1"
PROGRAM_ID = "taACbGSvPJpP0Wy0QwcL71HVIUIFfWa_f80POFqBJo5Zcf"
N_NEURONS = 56                      # connectome.build_procedural: 3*16 + 8
RESERVOIR_SEED = "reservoir"
# Inhibitory events park charge here and every drained cell is topped up from
# it, so over a long run it is the only account that matters. Top it up with
# `thru transfer worm <reservoirAccount> 10000` if the relay starts reverting.
RESERVOIR_FUNDING = 10_000
# Weights scale to 1-17 units (web/flysynapses.mjs: UNITS), so 300 is a few
# dozen events before the program tops the cell up from the reservoir.
NEURON_FUNDING = 300


def _derive(seed: str) -> str:
    return _run_json(["program", "derive-address", PROGRAM_ID, seed])["derive_address"]["derived_address"]


def addresses() -> list[str]:
    """Neuron 0..55, then the reservoir. Index IS the model's neuron index."""
    return [_derive(f"neuron-{i}") for i in range(N_NEURONS)] + [_derive(RESERVOIR_SEED)]


def _exec(readwrite: list[str], hexdata: str, fee: int, tries: int = 4) -> dict:
    cmd = ["thru", "--json", "txn", "execute", "--fee-payer", FEE_PAYER, "--fee", str(fee)]
    for a in readwrite:
        cmd += ["--readwrite-accounts", a]
    cmd += [PROGRAM_ID, hexdata]
    for attempt in range(tries):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            out = json.loads(r.stdout)["transaction_execute"]
            if out["execution_result"] != 0:
                raise RuntimeError(f"txn reverted: {out}")
            return out
        # The fee payer is SHARED with the worm relay, which is signing its own
        # transactions the whole time this runs. A lost nonce race is expected
        # and costs nothing; anything else is a real failure.
        if "NONCE_TOO_LOW" not in r.stdout or attempt == tries - 1:
            raise RuntimeError(f"txn execute failed: {r.stdout}\n{r.stderr}")
        time.sleep(2)
    raise AssertionError("unreachable")


def _exists(addr: str) -> bool:
    r = subprocess.run(["thru", "--json", "getaccountinfo", addr], capture_output=True, text=True)
    return r.returncode == 0 and '"account_info"' in r.stdout


def create_accounts(batch: int = 8) -> None:
    """FLY_INSTR_CREATE, one batch of records per transaction. Batches stay
    small because state proofs are slot-bound — see deploy.create_all_neurons."""
    addrs = addresses()
    seeds = [f"neuron-{i}" for i in range(N_NEURONS)] + [RESERVOIR_SEED]
    for start in range(0, len(addrs), batch):
        group = [i for i in range(start, min(start + batch, len(addrs))) if not _exists(addrs[i])]
        if not group:
            continue
        group_addrs = [addrs[i] for i in group]
        order = _sort_order(group_addrs)
        rw = sorted(group_addrs, key=lambda a: order[a])
        body = bytearray(struct.pack("<IH", 1, len(group)))
        for i in group:
            proof = _make_proof(addrs[i])
            seed = seeds[i].encode().ljust(32, b"\0")[:32]
            body += struct.pack("<HI", 2 + order[addrs[i]], 0)
            body += seed + struct.pack("<I", len(proof)) + proof
        out = _exec(rw, bytes(body).hex(), BASE_FEE + FEE_PER_NEURON * len(group))
        print(f"fly accounts {group[0]:2d}-{group[-1]:2d} -> {out['signature']} "
              f"cu={out['compute_units_consumed']}")


def _balance(addr: str) -> int:
    r = subprocess.run(["thru", "--json", "getbalance", addr], capture_output=True, text=True)
    return json.loads(r.stdout)["balance"]["balance"] if r.returncode == 0 else 0


def fund(addrs: list[str]) -> None:
    """Every account needs a working balance BEFORE the first event: the
    program tops a drained cell up from the reservoir, and a reservoir that
    was never funded reverts the transaction instead.

    Re-runnable. An account already at its target is skipped, so a lost nonce
    race against the worm relay is fixed by running `setup` again rather than
    by paying to over-fund the accounts that did land."""
    for i, addr in enumerate(addrs):
        want = RESERVOIR_FUNDING if i == len(addrs) - 1 else NEURON_FUNDING
        if _balance(addr) >= want:
            continue
        for attempt in range(4):
            r = subprocess.run(["thru", "transfer", FEE_PAYER, addr, str(want)],
                               capture_output=True, text=True)
            if r.returncode == 0:
                break
            if "NONCE_TOO_LOW" not in r.stdout + r.stderr or attempt == 3:
                raise RuntimeError(f"funding {addr} failed: {r.stdout}\n{r.stderr}")
            time.sleep(2)
        print(f"funded {i} {addr} {want}")


def write_config(addrs: list[str]) -> None:
    (DATA / "fly.json").write_text(json.dumps({
        "rpc": "https://rpc.alphanet.thru.org",
        "programId": PROGRAM_ID,
        "accounts": addrs[:N_NEURONS],
        "reservoirAccount": addrs[N_NEURONS],
        "explorer": "https://scan.thru.org/tx/",
    }, indent=2) + "\n")
    print(f"wrote {DATA / 'fly.json'}")


if __name__ == "__main__":
    if sys.argv[1:] != ["setup"]:
        raise SystemExit(__doc__)
    addrs = addresses()
    write_config(addrs)
    create_accounts()
    fund(addrs)
    print(f"fly program {PROGRAM_ID} ready, {len(addrs)} accounts")
