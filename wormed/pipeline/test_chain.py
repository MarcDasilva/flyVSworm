"""Live-chain tests. Slow and network-dependent — run with -m chain.
These are the fourth and last link in the verification chain:
numpy -> fixed python -> native C -> ThruVM."""
import pytest

from wormed.pipeline.refsim import FixedSim
from wormed.pipeline.deploy import (
    reset_sim, stimulate, run_steps, read_voltages, read_balances,
    read_reservoir_balance,
)

pytestmark = pytest.mark.chain


def test_chain_matches_the_fixed_reference_bit_for_bit():
    """If the chain disagrees with native C, the bug is in the VM or in the
    account plumbing — never in the arithmetic, because Task 8 already proved
    that. That is the entire value of this assert."""
    ref = FixedSim()
    ref.stimulate("ALML", 40.0)
    ref.step(100)

    reset_sim()
    stimulate("ALML", 40.0)
    run_steps(100)
    got = read_voltages()

    mismatches = [(i, a, b) for i, (a, b) in enumerate(zip(got, ref.V)) if a != b]
    assert not mismatches, f"{len(mismatches)} neurons differ, first: {mismatches[0]}"


def test_balance_encodes_voltage_within_rounding():
    """Voltage's settled PROJECTION lives in the account BALANCE
    (worm.h: BAL_OFFSET_MV=100, BAL_SCALE=10 — resolves 0.1 mV, coarser than
    v_next's Q16.16 on purpose, see TASK-10 R5). Task 11's settle_transfers
    writes that projection now (bit0, the reservoir reconciliation half) —
    this used to fail against the Task 10 no-op stub (all balances stuck at
    0); it is expected to pass now that settlement is real."""
    OFFSET_MV, SCALE, BAL_MIN, BAL_MAX = 100, 10, 10, 2000
    reset_sim()
    run_steps(20, settle_every=1)
    vs, bs = read_voltages(), read_balances()
    for v, b in zip(vs, bs):
        expected = int((v / 65536 + OFFSET_MV) * SCALE)
        assert abs(int(b) - expected) <= 1
        assert BAL_MIN <= int(b) <= BAL_MAX


def test_gap_junction_settlement_conserves_total_balance():
    """Gap junctions are electrically conservative — current out of one cell
    is current into the other. If total balance moves, they are being
    settled as mint/burn, which is the WRONG physics and the wrong claim on
    stage.

    TASK-11 R6: bit0 (reservoir reconciliation) and bit3 (gap transfers) are
    separate flags precisely so this assert can isolate the gap-only half —
    run WITHOUT bit0 (run_steps(..., gap=True), no settle_every), gap
    transfers are the ONLY balance-moving thing that happens, and the neuron
    total must be exactly unchanged. Running both flags together would let
    the reservoir reconciliation move neuron balances for an unrelated
    reason (chemical/leak/stim drift) and make this assert meaningless."""
    reset_sim()
    run_steps(20)
    before = sum(read_balances())
    run_steps(20, gap=True)
    after = sum(read_balances())
    assert before == after, f"gap settlement leaked {after - before} units"

    # Second half of R6: bit0 alone moves balance BETWEEN neurons and the
    # reservoir (never creates or destroys it) — the reservoir is the OTHER
    # side of every reconciliation transfer settle_transfers makes, so the
    # combined total (neurons + reservoir) must be exactly conserved too.
    before_total = sum(read_balances()) + read_reservoir_balance()
    run_steps(20, settle_every=20)
    after_total = sum(read_balances()) + read_reservoir_balance()
    assert before_total == after_total, (
        f"reservoir reconciliation created/destroyed {after_total - before_total} units"
    )
