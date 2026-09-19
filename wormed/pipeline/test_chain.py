"""Live-chain tests. Slow and network-dependent — run with -m chain.
These are the fourth and last link in the verification chain:
numpy -> fixed python -> native C -> ThruVM."""
import pytest

from wormed.pipeline.refsim import FixedSim
from wormed.pipeline.deploy import reset_sim, stimulate, run_steps, read_voltages

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
    v_next's Q16.16 on purpose, see TASK-10 R5). settle_transfers, which
    writes that projection, is still Task 11's no-op stub (worm.c) as of
    this task — so this is EXPECTED TO FAIL until Task 11 lands. Kept here,
    as instructed, to pin the projection's contract for that task."""
    from wormed.pipeline.deploy import read_balances
    OFFSET_MV, SCALE, BAL_MIN, BAL_MAX = 100, 10, 10, 2000
    reset_sim()
    run_steps(20, settle_every=1)
    vs, bs = read_voltages(), read_balances()
    for v, b in zip(vs, bs):
        expected = int((v / 65536 + OFFSET_MV) * SCALE)
        assert abs(int(b) - expected) <= 1
        assert BAL_MIN <= int(b) <= BAL_MAX
