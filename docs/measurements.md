# Thru toolchain gate — measurements

Recorded 2026-09-19, alphanet (`https://rpc.alphanet.thru.org`), `thru` CLI
0.3.16+c55cda22, toolchain/SDK v0.3.17. Node reported by `getversion`:
`thru-node 0.0.0-local+e1bd9df9` (commit `e1bd9df9`, 2026-08-25).

Program deployed for these measurements: `hello-worm-v1`
- Program account: `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ`
- Meta account: `ta_Sp-Yu_FiiORa8k1PnFxjUmTC-MmVTi4BDA9O7LhsdoO`

Task 5 needs the program account above for address derivation.

PROGRAM_ADDRESS: taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ

## SDK accessors

Confirmed by reading the installed C SDK headers directly (see
`task-1-report.md` Step 3 for the exact grep commands and paths — the real
install path is `~/.thru/sdk/c/thru-sdk/c/*.h`, one level shallower than the
brief's `~/.thru/sdk/c/thru-sdk/thru-sdk/c/*.h`).

Balance accessor (`tn_sdk_txn.h`) — packed struct field, not a function:

```c
struct __attribute__(( packed )) tsdk_account_meta {
  uchar       version; /* bytes: [0,1) */
  uchar       flags;   /* bytes: [1,2) */
  uint        data_sz; /* bytes: [2,6) */
  ulong       seq;     /* bytes: [6,14) */
  tn_pubkey_t owner;   /* bytes: [14,46) */
  ulong       balance; /* bytes: [46,54) - Account balance in native tokens */
  ulong       nonce;   /* bytes: [54,62) */
};
typedef struct tsdk_account_meta tsdk_account_meta_t;
```

Account meta / data accessors (`tn_sdk.h`):

```c
tsdk_account_meta_t const * tsdk_get_account_meta( ushort account_idx );
void * tsdk_get_account_data_ptr( ushort account_idx );
```

Transfer and event syscalls (`tn_sdk_syscall.h`):

```c
ulong tsys_account_transfer( ulong from_account_idx, ulong to_account_idx,
                             ulong amount );
ulong tsys_emit_event( void const * data, ulong data_sz );
```

`tsys_account_create`, referenced by the plan's R3 ruling, was not found in
any of the three headers above; account creation is a transaction-level
operation (`thru account create`), not a syscall exposed to program code in
this SDK version — later tasks that assumed an in-program
`tsys_account_create` syscall should re-check this before relying on it.

## Seven measurements

1. **MAX_BLOCK_COMPUTE_UNITS = 2147483648000000** — read via the Explorer MCP
   server (`https://scan.thru.org/api/mcp`, tool `get_block`) for slot
   `12723125` (the slot that executed the hello-world transaction below).
   Block response: `computeUnits.max: "2147483648000000"`,
   `computeUnits.consumed: "0"` (the per-block consumed counter reported 0
   despite the transaction in that block consuming 5321 CU per
   `thru txn execute` — the two counters are evidently not the same
   accounting; steps-per-transaction sizing should use the transaction-level
   CU counter, not this block field, until that discrepancy is understood).
   Date: 2026-09-19.

2. **BLOCKS_PER_SEC ≈ 4.5** — `thru --json getheight` at 2026-09-19T10:16:02Z
   read height `12723172`; a second read at 2026-09-19T10:16:15Z (after a
   `sleep 10`, 13s actual wall-clock delta including command dispatch
   overhead) read height `12723230`. Delta = 58 blocks / 13s ≈ 4.46
   blocks/sec. Using the brief's literal "divide by 10" instead of the
   measured wall-clock delta gives 5.8 blocks/sec — recorded here so Task 11
   can pick whichever is more conservative.

3. **CU_PER_STEP: marginal ≈ 363,236 CU/step, fixed ≈ 422,333 CU/tx** —
   measured on-chain (program `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ`,
   seed `hello-worm-v1`, 2026-09-19) with `pipeline.deploy.run_steps` against
   all 305 writable accounts (302 neurons + topology + reservoir +
   behavior): a 1-step `INSTR_STEP` transaction (after `reset_sim()`)
   consumed `CU@1 = 785,569`; a 51-step transaction consumed
   `CU@51 = 18,947,369`. `marginal = (CU@51 - CU@1) / 50 = 363,236`;
   `fixed = CU@1 - marginal = 422,333`. Both come in well under the spec's
   ~600k/~1.30M predictions — the real connectome has 3,607 CSR rows, not
   the 9,800 the spec budgeted for. Build used
   `-march=rv64imc_zba_zbb_zbc_zbs_zknh` at `-O3` (Task 8's Makefile flags,
   unchanged); the marginal cost already beats the spec without needing
   `-Os`.
   `STEPS_PER_TX = floor(0.8 * REQ_COMPUTE_UNITS_MAX - FIXED_CU) / MARGINAL_CU
   = 9,458` steps, where `REQ_COMPUTE_UNITS_MAX = 4,294,967,295` — the
   `req_compute_units` transaction header field's own `uint32` ceiling is the
   real per-transaction throttle, not `MAX_BLOCK_COMPUTE_UNITS` (2.1e15,
   measurement 1 above), which a single transaction can never approach.
   `thru txn execute`'s own `--compute-units` default (300,000,000) covers
   the first ~824 steps unassisted; `pipeline.deploy.run_steps` now passes an
   explicit budget (1.5x the measured fixed+marginal estimate) above that.

5. **SETTLEMENT_OVERHEAD ≈ +0.99% (settle_every=20 vs no settlement, 100 steps)** —
   measured on-chain (program `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ`,
   seed `hello-worm-v1`, 2026-09-19), both immediately following a
   `reset_sim()` in the same Python session: `run_steps(100)` (flags=0, no
   settlement) consumed `36,746,075` CU; `run_steps(100, settle_every=20)`
   (flags=1, reservoir reconciliation only — no gap transfers) consumed
   `37,111,033` CU. `delta = 364,958 CU`, `364,958 / 36,746,075 = 0.993%`.
   `tsys_account_transfer` is a flat 512 CU/call, so this delta implies
   `364,958 / 512 ≈ 713` real transfers across the 5 settlement calls the
   run makes (steps 20/40/60/80/100) — roughly 143 of the 302 neurons per
   call, not all 302, because only neurons whose balance actually drifted
   from `v_to_balance(V)` since the last settlement generate a transfer
   (`worm.c`'s `want == have` skip). This comes in far below the spec's
   ~6% estimate, which was sized for ~1,400 gap junctions firing every
   settlement; the real connectome has 517 gap-junction pairs (three of
   which are self-loops that never transfer — see task-11-report.md), and
   this measurement doesn't even include the gap pass (bit3), only the
   reservoir reconciliation (bit0).

6. **GAP_JUNCTION_YIELD: 339 of 517 pairs (65.6%) transfer non-zero balance
   in a real settlement** — computed by replaying `settle_transfers`'s exact
   fixed-point formula (`program/worm.c`) in Python against the real
   `V` snapshot read back from chain (`read_voltages()`) after
   `reset_sim(); run_steps(20)` — the identical state the on-chain program
   used for `test_gap_junction_settlement_conserves_total_balance`'s
   gap-only pass. Of the 517 undirected pairs in `topology.bin`, 3 are
   self-loops (RIBL, RIBR, VA8, each wired to itself — a topology-data
   artifact, not a bug) that the `j <= i` dedup guard always skips
   regardless of voltage, leaving 514 genuine inter-neuron pairs; 339 of
   those (65.9%) clear the BAL_SCALE=10 (0.1 mV-equivalent) rounding floor
   in this snapshot. Transfer sizes ranged 1-17 balance units (mean 3.1).
   This will vary with the voltage state (a more polarized worm settles
   more junctions); see task-11-report.md for the reproduction script.

7. **STATE_UNITS_PER_CREATE ≈ 0.1 (1 state unit per 10-account create batch)** —
   measured on-chain across the 31 `INSTR_CREATE_NEURONS` transactions that
   created all 302 neuron accounts (program `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ`,
   seed `hello-worm-v1`, 2026-09-19). Every 10-neuron batch (each doing 10x
   `tsys_account_create` + `tsys_account_resize` to 28 bytes) reported
   `state_units_consumed: 1` from `thru --json txn execute`, including the
   final 2-neuron batch — state units evidently meter something coarser than
   "per account" (e.g. per state-trie write op per transaction), not a
   per-account linear cost. A single bare create with no resize (topology
   singleton, data_sz=0) consumed 0 state units; a create+resize to 32 bytes
   (behavior singleton) consumed 1. Compute units scaled roughly linearly:
   ~47,377 CU for a 10-neuron create batch vs 8,259 CU for a single bare
   create. Batch size 10 was used throughout (not 20) per Task 9's ruling on
   state-proof staleness.

## Hello-world execution (Step 6 reference measurement)

`thru txn execute --fee-payer worm --fee 1000 taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ ""`
at slot `12723125`:

- Execution Result: 0 (`TN_RUNTIME_TXN_EXECUTE_SUCCESS`)
- Compute Units Consumed: 5321
- State Units Consumed: 0
- Event data (hex): `eeffc00000000000` — little-endian encoding of the
  `0xC0FFEEULL` marker in `hello.c` (the brief's expected
  `eecfc00000000000` has a transposed byte and does not match the correct
  little-endian encoding of `0xC0FFEE`; `eeffc00000000000` is the value
  actually required by, and produced from, the program's own source).

## Task 12 — classifier, behavior state and events (live alphanet, 2026-09-19)

Program `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ`, seed `hello-worm-v1`.

1. **`INSTR_CLASSIFY` costs ~336,780 CU.** Two runs, 336,773 and 336,781. It
   page-faults the same 305-account writable array a step does and then reads
   302 voltages, so it is essentially the fixed cost of touching the brain
   with no timestep on top — cheaper than a single step (363,236 CU marginal).

2. **Trace event: 620 bytes emitted, 612 delivered, +8,669 CU.** A 40-step
   transaction cost 14,960,777 CU without `emit` and 14,969,446 with it —
   0.06% for one frame. `events_size` in the receipt reports the EMITTED
   size (620); the payload the client receives is 612 (see finding 4).

3. **Gap-transfer event: 334 transfers, 2,689 bytes emitted, +378,152 CU for
   settlement AND the event together** (14,960,873 -> 15,339,025 over 40
   steps, 2.5%). 334 of 517 junctions clear the 0.1 mV rounding floor with
   the Task 12 conductances (Task 11 measured 339 before the escape-pathway
   retune). The transfers summed to 1,874 units, largest single transfer 104.

4. **PLATFORM FINDING — `tsys_emit_event` reframes the buffer you give it.**
   Verified against transaction
   `tsRXqoX04nVA22XJs_QGTmTwag20Gl9DvpaBgpOBBCujXnIR891ZShz7jLut4rS9-sqRiaWmVtaDGhwdrd8BL-Bh6a`:
   the runtime takes the FIRST 8 BYTES of the emitted buffer as the event's
   `event_type` (little-endian u64, never repeated in the payload) and STRIPS
   TRAILING ZERO BYTES from the remainder. A 612-byte trace whose first field
   was `mV[0]` came back as 597 bytes starting at `mV[4]`, with no error
   anywhere: `event_type` decoded to `0xffbdffbbffbcffbc`, which is four
   membrane potentials. Both worm events now open with an explicit 8-byte
   type tag (`WORMTRCE` / `WORMGAPX`, which is what the explorer and the
   front-end switch on) and close with a non-zero terminator byte so nothing
   can be trimmed.

5. **Event payloads are NOT in the `txn execute` response.** It reports
   `events_count` and `events_size` only. `thru txn get <signature>` carries
   them under `events[].data` as `{"type": "hex", "value": ...}`. There is no
   `thru txn last` subcommand.

6. **ABI published**: account `taTUnO3Mr-xryw6pCHLYhs1oVG1N9JgcBvplQofLjyzxXV`,
   meta `ta5eGgn8DsrXAE6cQkd7IcgL8iNK0YqzyJmGSjzo7RWKh-`, 8,680 bytes of YAML,
   state OPEN (deliberately not finalized — Task 15 may still need to change
   it). `thru program publish-abi` does not exist; the command is
   `thru abi account create <seed> <file>`.
