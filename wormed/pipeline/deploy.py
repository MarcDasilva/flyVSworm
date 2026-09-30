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
import base64
import concurrent.futures
import functools
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
    r = subprocess.run(["thru", "--json", *args], capture_output=True, text=True)
    if r.returncode != 0:
        # The CLI's reason is in its output, NOT in CalledProcessError's message — a bare
        # "exit status 1" in the relay log is what this used to be.
        raise RuntimeError(f"thru {' '.join(args)} failed: {(r.stdout + r.stderr).strip()[:300]}")
    return json.loads(r.stdout)


@functools.cache
def _derive(seed: str) -> str:
    """Cached for the life of the process. Derivation is a pure function of
    the program id and the seed, and the relay worker (web/relay.mjs spawns
    it) calls this six times per chain operation — uncached, that is ~2 s of
    `thru` subprocess latency on top of every touch the demo serves."""
    d = _run_json(["program", "derive-address", _program_id(), seed])
    return d["derive_address"]["derived_address"]


def _topology_account() -> str: return _derive("topology")
def _reservoir_account() -> str: return _derive("reservoir")
def _behavior_account() -> str: return _derive("behavior")


def _sort_order(addrs: list[str]) -> dict:
    """Canonical ascending order. Delegates to pack_addr.chain_order_index —
    the ONE definition of "ascending by address" in this codebase, shared
    with pipeline/pack.py's slot_map — rather than duplicating the `thru txn
    sort` call here. FIX ROUND 1: this file and pack.py used to each roll
    their own notion of "sorted", and pack.py's used Python's sorted() on the
    encoded ta... string, which disagrees with the chain's real order (by
    decoded pubkey bytes) at effectively every position. That let
    topology.bin's slot_map ship with a permutation that could never match
    what account creation actually did. Fix (task-9-report.md) is to have
    both call this one function."""
    from .pack_addr import chain_order_index
    order, source = chain_order_index(addrs)
    if source != "cli":
        print(f"WARNING: chain_order_index fell back to {source!r} — "
              f"`thru` CLI was unavailable for account ordering")
    return order


def _make_proof(addr: str) -> bytes:
    """Called immediately before building the transaction that consumes it.
    State proofs are slot-bound (INVALID_PROOF_SLOT / -33 if stale) — do not
    cache these across a sleep or a large batch-building loop."""
    d = _run_json(["txn", "make-state-proof", "creating", addr])
    return bytes.fromhex(d["makeStateProof"]["proof_data_hex"])


def _exec(readwrite: list[str], hexdata: str, fee: int, compute_units: int | None = None) -> dict:
    cmd = ["thru", "--json", "txn", "execute", "--fee-payer", FEE_PAYER, "--fee", str(fee)]
    if compute_units is not None:
        # thru txn execute defaults to 300,000,000 — enough for a step batch up
        # to roughly (300e6 - FIXED_CU) / MARGINAL_CU steps (docs/measurements.md).
        # Larger batches (up to STEPS_PER_TX) need this raised explicitly, capped
        # at req_compute_units' own uint32 ceiling (4,294,967,295).
        cmd += ["--compute-units", str(min(compute_units, 4_294_967_295))]
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


# --- Stepping (Task 10) -----------------------------------------------------
#
# INSTR_STEP / INSTR_STIMULATE / INSTR_RESIZE_SCRATCH from worm.h. Kept as
# literal ints here (not imported) to match this file's existing convention —
# the create/upload instructions above (1, 2, 6) are literals too.
INSTR_STEP = 4
INSTR_STIMULATE = 3
INSTR_RESIZE_SCRATCH = 7

# Flat fee. A step transaction's real ceiling is `--compute-units`, which
# `thru txn execute` defaults to 300,000,000 — comfortably above even a
# 51-step transaction's measured cost (docs/measurements.md) — so the fee
# paid here doesn't need to scale with n_steps the way create-batch fees
# scale with neuron count.
FEE_STEP = 200

# Measured on-chain (docs/measurements.md, 2026-09-19): CU@1=785569,
# CU@51=18947369 -> marginal=(CU@51-CU@1)/50, fixed=CU@1-marginal. Both come
# in well under the spec's ~600k/~1.30M predictions — the real connectome has
# 3,607 CSR rows, not the 9,800 the spec budgeted for.
FIXED_CU = 422_333
MARGINAL_CU = 363_236
# Measured 2026-09-19 on a 1-step run_steps(settle_every=1, emit, gap):
# 1,338,112 CU against a pure-step prediction of 785,569, and again as
# 11.2M over 20 settles in a 400-step run. Settlement and the trace event
# are NOT free and the budget below MUST carry them: a step transaction
# that requests too few units reverts with CU_EXHAUSTED (-764) AND IS STILL
# CHARGED ITS FEE, so an undersized budget burns fee-payer balance for no
# simulation at all.
SETTLE_CU = 560_000

REQ_COMPUTE_UNITS_MAX = 4_294_967_295  # req_compute_units is a uint32 — the
# real per-transaction ceiling; the block-level figure (2.1e15) is not a
# throttle a single transaction can hit.

# STEPS_PER_TX = floor(0.8 * REQ_COMPUTE_UNITS_MAX - FIXED_CU) / MARGINAL_CU —
# the brief's formula, with the u32 req_compute_units ceiling substituted for
# MAX_BLOCK_COMPUTE_UNITS per the ruling that the block figure isn't a real
# throttle. The 0.8 factor leaves headroom for per-step cost drifting with
# future topology changes (more synapses -> more CSR rows walked per step).
STEPS_PER_TX = int((0.8 * REQ_COMPUTE_UNITS_MAX - FIXED_CU) // MARGINAL_CU)


@functools.cache
def _step_accounts() -> list[str]:
    """Thru sorts the ENTIRE writable account array ascending by address, so
    the three singletons interleave with the neurons wherever their
    addresses land. _sort_order (== `thru txn sort`, via
    pack_addr.chain_order_index) is the ONE definition of ascending order in
    this codebase — Python's sorted() on the raw address strings disagrees
    with the chain at effectively every position (task-9-report.md) and must
    never be substituted here, unlike the brief's literal draft of this
    function.

    Cached: the ordering is fixed once the 302 accounts exist, and every
    step/stimulate/classify would otherwise pay a `thru txn sort` round trip
    twice over. Callers MUST NOT mutate the returned list — they all share
    the one instance."""
    addrs = json.loads((DATA / "addresses.json").read_text()) \
          + [_topology_account(), _reservoir_account(), _behavior_account()]
    order = _sort_order(addrs)
    return sorted(addrs, key=lambda a: order[a])


@functools.cache
def _slots() -> tuple[int, int, int]:
    """Account index of topology, reservoir, behavior in the sorted writable
    array _step_accounts() builds. Index 0 is the fee payer and index 1 is
    the program, so the writable array itself starts at 2."""
    topo, reservoir, behavior = _topology_account(), _reservoir_account(), _behavior_account()
    ordered = _step_accounts()
    return (ordered.index(topo) + 2,
            ordered.index(reservoir) + 2,
            ordered.index(behavior) + 2)


def ensure_scratch() -> dict:
    """TASK-10 FINDING (task-10-report.md): ThruVM has no usable static-global
    or large-stack storage for a program's own working set — writing to a
    global faults the instant the same transaction also touches an account,
    and the per-call stack is a few KB (a single N_NEURONS int32 array
    already overflows it). The heap escape hatch
    (tsys_increment_anonymous_segment_sz) returns -21 (unimplemented) on this
    alphanet build. worm.c's fix: do_step/do_stimulate keep their working set
    (worm_scratch_t: the sim struct + V/i_stim/neuron_to_slot arrays) inside
    the RESERVOIR account's own DATA region, sized by this call. Idempotent —
    do_resize_scratch's min_size is a floor, so calling this more than once
    is harmless; callers only need to call it once before the first
    run_steps/stimulate."""
    reservoir = _reservoir_account()
    payload = struct.pack("<IHI", INSTR_RESIZE_SCRATCH, 2, 0)  # reservoir alone -> slot 2
    return _exec([reservoir], payload.hex(), BASE_FEE)


def run_steps(n: int, settle_every: int = 0, emit: bool = False,
              reset: bool = False, gap: bool = False, individual: bool = False) -> dict:
    """flags: bit0 settle (reconcile balances against the reservoir), bit1
    emit trace, bit2 reset, bit3 gap-junction transfers (worm.c step_args_t).
    settle_every requests bit0 automatically, matching do_step's chunking.
    `gap` requests bit3 independently — TASK-11 R6: the two settlement halves
    are separate flags on purpose, so a caller (the conservation test) can run
    gap-only transfers WITHOUT the reservoir reconciliation touching neuron
    balances for an unrelated reason and making the conservation assert
    meaningless. settle_every=0 with gap=True still settles exactly once,
    after the full n-step chunk (do_step's do-while runs one chunk when
    settle_every is 0)."""
    flags = (1 if settle_every else 0) | (2 if emit else 0) | (4 if reset else 0) \
          | (8 if gap else 0) | (16 if individual else 0)
    if individual:
        if reset or n <= 0 or settle_every <= 0:
            raise ValueError("individual settlement needs positive steps and settlement cadence, without reset")
        # Every possible chemical edge and unique gap junction must fit;
        # reject before submitting rather than silently truncating events.
        topology = (DATA / "topology.bin").read_bytes()
        _, _, _, chemical, gaps = struct.unpack_from("<5I", topology)
        if -(-n // settle_every) * (chemical + gaps // 2) > 32768:
            raise ValueError("step batch exceeds the synapse outbox capacity")
    payload = struct.pack("<IIII", INSTR_STEP, n, flags, settle_every) \
            + struct.pack("<HHHH", *_slots(), 0)
    # thru txn execute's own default (300,000,000) covers roughly the first
    # 824 steps; pass an explicit budget (50% margin over the measured
    # fixed+marginal cost) so larger n doesn't silently starve on CU.
    chunks = -(-n // settle_every) if settle_every else 1
    settle_cu = (SETTLE_CU + (1_500_000 if individual else 0)) * chunks if flags & (1 | 2 | 8) else 0
    compute_units = min(REQ_COMPUTE_UNITS_MAX,
                        int(1.5 * (FIXED_CU + MARGINAL_CU * max(n, 1) + settle_cu)))
    out = _exec(_step_accounts(), payload.hex(), FEE_STEP, compute_units=compute_units)
    print(f"run_steps(n={n}, flags={flags}) -> {out['signature']} "
          f"cu={out['compute_units_consumed']} su={out['state_units_consumed']}")
    return out


def count_transfers_in_last_tx(output: dict) -> int:
    """FINDING (task-11-report.md): `thru --json txn execute`'s real output
    (confirmed against a live run_steps(20, settle_every=20) transaction) has
    no per-operation trace at all — no "transfer" substring anywhere in its
    keys or values, and `events`/`events_count` are empty because worm.c
    never calls tsys_emit_event. The brief's line-count approach (grep the
    stdout for "transfer") therefore always returns 0 against the real CLI;
    there is nothing to fall back to parsing either. Kept for interface
    parity with the brief, but callers that need an actual transfer count
    should derive it from the CU delta instead (tsys_account_transfer is a
    flat 512 CU/call — see docs/measurements.md's settlement-overhead entry)
    or, for gap junctions specifically, replay the same fixed-point formula
    settle_transfers uses against topology.bin + read_voltages() off-chain."""
    text = json.dumps(output)
    return text.lower().count("transfer")


def stimulate(name: str, current_mV: float) -> dict:
    names = json.loads((DATA / "names.json").read_text())
    payload = struct.pack("<IHi", INSTR_STIMULATE, names.index(name), int(current_mV * 65536)) \
            + struct.pack("<HHH", *_slots())
    out = _exec(_step_accounts(), payload.hex(), FEE_STEP)
    print(f"stimulate({name!r}, {current_mV}) -> {out['signature']} "
          f"cu={out['compute_units_consumed']}")
    return out


def _account_infos() -> list[dict]:
    """One subprocess per account — `thru` has no batch-account-query
    subcommand (checked: `thru --help`; only single-account
    getaccountinfo/account info exist). Fetched with a thread pool because
    302 sequential network round trips would make every read after a step
    take minutes; ex.map preserves addrs' order so callers can zip against
    addresses.json / names.json directly."""
    addrs = json.loads((DATA / "addresses.json").read_text())

    def fetch(addr: str) -> dict:
        r = subprocess.run(["thru", "--json", "account", "info", addr],
                           capture_output=True, text=True, check=True)
        return json.loads(r.stdout)["account_info"]

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        return list(ex.map(fetch, addrs))


def read_balances() -> list[int]:
    return [int(info["balance"]) for info in _account_infos()]


def read_reservoir_balance() -> int:
    """The reservoir is a singleton, not one of the 302 addresses
    read_balances() covers — settle_transfers moves its BALANCE only (never
    its DATA, which is worm_scratch_t; see worm.c). TASK-11 R6's second
    conservation assert (all neurons + reservoir conserved under bit0) needs
    this read separately from read_balances()."""
    r = subprocess.run(["thru", "--json", "account", "info", _reservoir_account()],
                       capture_output=True, text=True, check=True)
    return int(json.loads(r.stdout)["account_info"]["balance"])


def read_voltages() -> list[int]:
    """TASK-10 R5: account DATA's v_next (worm_neuron_t, int32 Q16.16 at byte
    offset 12 — index u16 + name[8] + pad u16 = 12) is the simulation's
    source of truth, NOT balance. Balance only resolves BAL_SCALE=10 (0.1
    mV) and is the settled projection Task 11 writes separately — decoding V
    from it here would cap precision at 0.1 mV and make the bit-for-bit
    assert against native C's ~1.5e-5 mV resolution mathematically
    impossible. `data` in `account info`'s JSON is base64, not hex."""
    out = []
    for info in _account_infos():
        raw = base64.b64decode(info["data"])
        out.append(struct.unpack_from("<i", raw, 12)[0])
    return out


def reset_sim() -> dict:
    """Reset V to the leak potentials and request settlement, so once Task 11
    lands, every neuron account ends up holding real balance rather than the
    zero it was created with. n_steps=0 with settle_every=1 still triggers
    exactly one settle_transfers call in do_step's do-while (see worm.c).
    Calls ensure_scratch() first — do_step/do_stimulate both need the
    reservoir's scratch region sized before they can run at all."""
    ensure_scratch()
    return run_steps(0, settle_every=1, reset=True)


# --- Classifier, behavior state and events (Task 12) ------------------------

INSTR_CLASSIFY = 5

# worm.h's WORM_EVENT_* tags. The runtime eats the first 8 bytes of every
# emitted buffer and reports them as the event's `event_type` (see
# read_events), so these ARE the discriminator — there is no magic number
# inside the payload to check.
EVENT_TRACE = int.from_bytes(b"WORMTRCE", "little")
EVENT_XFER = int.from_bytes(b"WORMGAPX", "little")


def classify() -> dict:
    """Reads every neuron's voltage and writes one byte of behavior. Needs the
    same 305-account writable array a step does, because the classifier's five
    command interneurons are found by NAME in account data, not by a baked
    index (worm.c: resolve_command_neurons)."""
    payload = struct.pack("<I", INSTR_CLASSIFY) + struct.pack("<HHH", *_slots())
    out = _exec(_step_accounts(), payload.hex(), FEE_STEP)
    print(f"classify() -> {out['signature']} cu={out['compute_units_consumed']}")
    return out


def read_behavior() -> dict:
    """worm_behavior_t, 32 bytes. `data` in account info's JSON is base64, not
    hex — the same trap read_voltages() documents."""
    r = subprocess.run(["thru", "--json", "account", "info", _behavior_account()],
                       capture_output=True, text=True, check=True)
    raw = base64.b64decode(json.loads(r.stdout)["account_info"]["data"])
    state, gain, fwd, rev, entered, step, bt = struct.unpack_from("<B3xiiiIIQ", raw, 0)
    return {"state": state, "gain": gain, "drive_fwd": fwd, "drive_rev": rev,
            "entered_at": entered, "step": step, "block_time": bt}


def read_events(out: dict) -> list[tuple[int, bytes]]:
    """(event_type, payload) per event, in emission order.

    TWO findings here, both verified against live alphanet transactions and
    neither documented anywhere:

    1. `thru txn execute`'s response reports events_count and events_size but
       NOT the payloads. Only `thru txn get <signature>` carries them, under
       events[].data as {"type": "hex", "value": ...}. There is no `thru txn
       last`, which is what the brief's last_event_bytes() assumed.
    2. `tsys_emit_event` does not deliver its buffer verbatim: the runtime
       takes the FIRST 8 BYTES as the event_type and STRIPS TRAILING ZERO
       BYTES from the rest. A 612-byte trace starting at mV[0] arrived as 597
       bytes starting at mV[4], silently. worm.c compensates by leading with
       an explicit 8-byte tag and ending with a non-zero terminator."""
    r = subprocess.run(["thru", "--json", "txn", "get", out["signature"]],
                       capture_output=True, text=True, check=True)
    evs = json.loads(r.stdout)["transaction_get"].get("events") or []
    return [(e["event_type"], bytes.fromhex(e["data"]["value"])) for e in evs]


def last_event_bytes(out: dict) -> bytes:
    return read_events(out)[-1][1]


def read_transfer_event(out: dict) -> list[tuple[int, int, int]]:
    """Every gap-junction transfer the transaction actually settled, as
    (pre_neuron, post_neuron, units). Concatenated across events so a run with
    settle_every set — which settles once per chunk and therefore emits one
    event per chunk — still reports every transfer exactly once."""
    xs: list[tuple[int, int, int]] = []
    for etype, blob in read_events(out):
        if etype != EVENT_XFER:
            continue
        step, count = struct.unpack_from("<II", blob, 0)
        assert len(blob) == 9 + 8 * count, (
            f"transfer event at step {step} declares {count} transfers "
            f"but carries {len(blob)} bytes"
        )
        xs += [struct.unpack_from("<HHi", blob, 8 + 8 * k) for k in range(count)]
    return xs


# --- Front-end handoff and the R19 balance preflight (Task 15) --------------

# One touch costs 4 transactions (stimulate, step, classify, release) and one
# stepper cycle costs 2, all at FEE_STEP. R19: the failure mode when the fee
# payer runs dry is vm_error -509 INSUFFICIENT_FEE_PAYER_BALANCE, which reads
# like a program fault three frames deep in a JSON dump — the floor exists so
# the relay can say "run the faucet" instead. 20,000 units is ~50 touches or
# ~4 minutes of continuous stepping: enough to finish whatever is on screen.
BALANCE_FLOOR = 20_000
FAUCET_REFILL = f"thru faucet withdraw {FEE_PAYER} 10000   # cap is 10,000 per call"


def fee_payer_balance() -> int:
    r = subprocess.run(["thru", "--json", "getbalance", FEE_PAYER],
                       capture_output=True, text=True, check=True)
    return int(json.loads(r.stdout)["balance"]["balance"])


def _rpc_base_url() -> str:
    """The browser talks to the same node the CLI does, or the demo animates
    one chain's events while clicking buttons on another. The CLI keeps it in
    a one-key-per-line YAML file; parsed by prefix rather than pulling in a
    YAML dependency for a single scalar."""
    cfg = Path.home() / ".thru" / "cli" / "config.yaml"
    if cfg.exists():
        for line in cfg.read_text().splitlines():
            if line.startswith("rpc_base_url:"):
                return line.split(":", 1)[1].strip()
    return "https://rpc.alphanet.thru.org"


def write_chain_config() -> None:
    """data/chain.json is the ONLY thing the front-end needs to find the
    chain: vite serves data/ at the URL root (web/vite.config.ts), so this
    lands at /chain.json. Neuron identity is NOT in here — trace and transfer
    events carry dense indices in names.json order, so the browser never
    resolves an address."""
    (DATA / "chain.json").write_text(json.dumps({
        "rpc": _rpc_base_url(),
        "programId": _program_id(),
        "behaviorAccount": _behavior_account(),
        "reservoirAccount": _reservoir_account(),
        "topologyAccount": _topology_account(),
        "dtMs": 5,
        "synapseTransactions": True,
        "explorer": "https://scan.thru.org/tx/",
    }, indent=2) + "\n")
