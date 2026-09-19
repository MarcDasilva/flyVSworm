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

## Four measurements

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

3. **CU_PER_STEP_STUB = PENDING** — deferred to Task 11.

4. **STATE_UNITS_PER_CREATE ≈ 0.1 (1 state unit per 10-account create batch)** —
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
