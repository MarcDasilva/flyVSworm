"""One recorded full-animal run: 302 neurons, every synapse, on chain.

Recorded, not live — the README quotes these numbers and says so. Everything
written to data/benchmark.json comes back from the chain (signatures, compute
units, the behavior account), so any claim in the README can be re-checked
against a block explorer without rerunning anything.

Run from the repo root:  python3 -m wormed.scripts.benchmark
"""
import json
import time
from pathlib import Path

from wormed.pipeline.deploy import (
    BALANCE_FLOOR, FAUCET_REFILL, FEE_STEP, classify, fee_payer_balance,
    read_behavior, reset_sim, run_steps, stimulate,
)

DATA = Path(__file__).resolve().parent.parent / "data"
Q16 = 65536.0
DT_MS = 5

# Measured, not guessed: docs/measurements.md puts the per-transaction ceiling
# at 9,458 steps, sized against `req_compute_units`'s own uint32 limit. 3,000
# is deliberately a third of that. A 3,000-step transaction with settlement
# consumed 1.172e9 CU on alphanet (27% of the ceiling), which leaves room for
# the connectome to grow — a future topology with more CSR rows raises the
# marginal cost per step, and a transaction that runs out of compute REVERTS
# AND IS STILL CHARGED ITS FEE. It also keeps one classifier sample per 15 s
# of worm time, which is what makes the behavior trace below readable.
STEPS_PER_TX = 3000
BATCHES = 20

# Settle on the same cadence the live demo uses (worm.c step chunking): real
# transfers every 20 steps == every 100 ms of worm time, gap junctions
# included (bit3, the conservative half).
SETTLE_EVERY = 20

# Touch script, keyed by batch index. Each entry is applied BEFORE that
# batch's steps. Written to walk the whole classifier state machine — quiet,
# head touch, release into the omega turn, tail touch, release — rather than
# to hold one state for five minutes.
TOUCHES: dict[int, list[tuple[str, float]]] = {
    4:  [("ALML", 40.0)],   # head touch
    7:  [("ALML", 0.0)],    # let go: sustained reversal releases into OMEGA
    12: [("PLML", 40.0)],   # tail touch
    15: [("PLML", 0.0)],
}

STATE_NAME = ["PAUSE", "FORWARD", "REVERSE", "OMEGA"]


def _preflight() -> int:
    """R19. The fee payer running dry mid-run surfaces as vm_error -509 three
    frames deep in a JSON dump, and every reverted transaction is STILL
    charged its 200-unit fee — so the check has to happen before the first
    one, not after the tenth."""
    txns = 2 * BATCHES + sum(len(t) for t in TOUCHES.values()) + 2
    need = txns * FEE_STEP + BALANCE_FLOOR
    have = fee_payer_balance()
    if have < need:
        raise SystemExit(
            f"fee payer has {have} units; this run needs {need} "
            f"({txns} transactions at {FEE_STEP} + a {BALANCE_FLOOR} floor).\n"
            f"Top up and rerun:\n  {FAUCET_REFILL}")
    print(f"preflight: {have} units, run needs {need} ({txns} transactions)")
    return have


def main() -> None:
    have = _preflight()

    reset_sim()
    frames, latencies = [], []
    t0 = time.time()
    for batch in range(BATCHES):
        for name, current in TOUCHES.get(batch, []):
            stimulate(name, current)
        t = time.time()
        out = run_steps(STEPS_PER_TX, settle_every=SETTLE_EVERY, gap=True)
        classify()
        chain_s = time.time() - t
        latencies.append(chain_s)
        b = read_behavior()
        frames.append({
            "batch": batch,
            "touch": TOUCHES.get(batch, []),
            "signature": out["signature"],
            "compute_units": int(out["compute_units_consumed"]),
            "chain_seconds": round(chain_s, 2),
            "step": b["step"],
            "state": b["state"],
            "state_name": STATE_NAME[b["state"]],
            "drive_fwd": round(b["drive_fwd"] / Q16, 4),
            "drive_rev": round(b["drive_rev"] / Q16, 4),
            "gain": round(b["gain"] / Q16, 4),
        })
        print(f"  batch {batch:2d} step {b['step']:6d} "
              f"{STATE_NAME[b['state']]:<7} "
              f"fwd {b['drive_fwd']/Q16:.3f} rev {b['drive_rev']/Q16:.3f} "
              f"({chain_s:.1f}s)")
    wall = time.time() - t0
    left = fee_payer_balance()

    steps = BATCHES * STEPS_PER_TX
    sim_s = steps * DT_MS / 1000
    chain_s = sum(latencies)
    result = {
        "recorded": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "neurons": 302,
        "steps": steps,
        "steps_per_tx": STEPS_PER_TX,
        "dt_ms": DT_MS,
        "settle_every": SETTLE_EVERY,
        "sim_seconds": sim_s,
        "wall_seconds": round(wall, 2),
        "chain_seconds": round(chain_s, 2),
        # Two different claims, and conflating them would be the most
        # dishonest number in this file. `realtime_ratio` is what a viewer
        # experiences: every transaction's full round trip, account reads
        # included. `chain_realtime_ratio` counts only the step+classify
        # round trips. Neither is the raw compute capacity — that is
        # docs/measurements.md's 9,458 steps per transaction, which is what
        # the VM could do if block time and network latency were free.
        "realtime_ratio": round(sim_s / wall, 3),
        "chain_realtime_ratio": round(sim_s / chain_s, 3),
        "tx_latency_seconds": {
            "min": round(min(latencies), 2),
            "max": round(max(latencies), 2),
            "mean": round(chain_s / len(latencies), 2),
        },
        "compute_units_total": sum(f["compute_units"] for f in frames),
        "fee_units_spent": have - left,
        "fee_payer_balance_before": have,
        "fee_payer_balance_after": left,
        "behavior_trace": frames,
    }
    (DATA / "benchmark.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"\n{sim_s:.0f}s of worm ({steps} steps x 302 neurons) in "
          f"{wall:.0f}s wall — {result['realtime_ratio']}x real time end to end, "
          f"{result['chain_realtime_ratio']}x counting chain round trips only.")
    print(f"{result['compute_units_total']:,} compute units, "
          f"{result['fee_units_spent']} fee units.")


if __name__ == "__main__":
    main()
