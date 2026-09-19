"""Live-chain tests. Slow and network-dependent — run with -m chain.
These are the fourth and last link in the verification chain:
numpy -> fixed python -> native C -> ThruVM."""
import pytest

from wormed.pipeline.refsim import FixedSim
from wormed.pipeline.deploy import (
    reset_sim, stimulate, run_steps, read_voltages, read_balances,
    read_reservoir_balance, classify, read_behavior, last_event_bytes,
    read_transfer_event,
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


def test_head_touch_drives_reverse_and_tail_touch_drives_forward():
    """THE behavioral regression test. Fifteen cells, forty years of
    literature, one assert. If this fails the demo is dead, and nothing else
    in the suite would have told you."""
    REVERSE, FORWARD = 2, 1

    reset_sim(); stimulate("ALML", 40.0); run_steps(400); classify()
    assert read_behavior()["state"] == REVERSE

    reset_sim(); stimulate("PLML", 40.0); run_steps(400); classify()
    assert read_behavior()["state"] == FORWARD


def test_classifier_does_not_flicker_at_the_crossover():
    """A bare argmax oscillates when the two drives are close, and a flickering
    worm reads as broken. Hysteresis plus dwell is what stops it."""
    reset_sim(); stimulate("ALML", 12.0); stimulate("PLML", 12.0)
    seen = []
    for _ in range(10):
        run_steps(40); classify()
        seen.append(read_behavior()["state"])
    assert len(set(seen)) <= 2, f"state thrashed across {set(seen)}"


def test_trace_event_is_the_expected_size():
    """302 int16 millivolts plus an 8-byte tail. The tail keeps the payload
    8-aligned so web/src/chain.ts can build an Int16Array VIEW over the
    received buffer instead of copying it."""
    out = run_steps(4, emit=True)
    assert len(last_event_bytes(out)) == 302 * 2 + 8


def test_gap_settlement_emits_the_transfers_it_made():
    """Task 11 could not prove settlement moves anything per-synapse: `thru
    txn execute`'s output carries no per-operation trace. The program now
    reports its own gap transfers as an event, so the claim is checkable —
    and checkable against the chain's OWN balance deltas, not against a
    replay of the same formula, which would only prove the program agrees
    with itself."""
    reset_sim()
    run_steps(20)
    before = read_balances()
    out = run_steps(20, gap=True)
    after = read_balances()

    xs = read_transfer_event(out)
    assert xs, "gap settlement reported no transfers at all"

    implied = [0] * len(before)
    for pre, post, amt in xs:
        assert amt > 0, f"transfer {pre}->{post} carries {amt} units"
        implied[pre] -= amt
        implied[post] += amt
    assert sum(implied) == 0, "reported transfers are not conservative"
    assert [a - b for a, b in zip(after, before)] == implied, (
        "reported transfers disagree with the balance deltas the chain applied"
    )


def test_sustained_reversal_releases_into_an_omega_turn():
    """OMEGA is the one classifier state nothing else covers, and it is
    reachable by ONE path only (worm.c do_classify): a REVERSE held for
    OMEGA_HOLD (160 steps) whose reverse drive has since fallen back under
    THRESH_OFF. Get the dwell arithmetic wrong in either direction and the
    worm either never turns — it just backs up and resumes, which is not the
    escape response anyone recognises — or it turns on every release.

    Step counts are read off the offline FixedSim, not guessed: a head touch
    saturates rev at 0.686 within ~30 steps, and releasing it puts rev under
    0.06 within 20. The 210-step tail asserts the other half of the state
    machine, that OMEGA times out into FORWARD on its own rather than
    latching."""
    THRESH_OFF = int(0.20 * 65536)
    FORWARD, REVERSE, OMEGA = 1, 2, 3

    reset_sim()
    stimulate("ALML", 40.0)
    run_steps(80)          # past DWELL_MIN (60) with rev saturated
    classify()
    assert read_behavior()["state"] == REVERSE, "head touch did not enter REVERSE"

    stimulate("ALML", 0.0)  # let go
    run_steps(170)          # held >= OMEGA_HOLD, and rev has decayed
    classify()
    b = read_behavior()
    assert b["drive_rev"] < THRESH_OFF, (
        f"reverse drive {b['drive_rev'] / 65536:.3f} never fell back under "
        "THRESH_OFF, so this run could not have tested the release condition")
    assert b["state"] == OMEGA, (
        f"released reversal went to {b['state']}, not OMEGA")

    run_steps(210)          # OMEGA runs to completion: 200 steps, then FORWARD
    classify()
    assert read_behavior()["state"] == FORWARD, "OMEGA latched instead of timing out"
