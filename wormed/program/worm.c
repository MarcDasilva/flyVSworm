#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include <string.h>
#include "worm.h"
#include "sim.h"
#include "fixed.h"   /* Q16 and q16_mul — Tasks 10-12 use both here */

/* Topology is account index 2 during setup, read-only during stepping. */
#define ACC_TOPOLOGY 2u

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint32_t offset;
    uint32_t len;
    /* payload bytes follow */
} upload_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t count;
    /* count * { uint16 acct_idx; uint16 neuron_idx; char name[8];
                 uint8 seed[32]; uint32 proof_sz; uint8 proof[] } follows */
} create_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t count;
    /* count * { uint16 acct_idx; uint32 data_sz; uint8 seed[32];
                 uint32 proof_sz; uint8 proof[] } follows */
} create_singleton_args_t;

/* Fixed portion of one INSTR_CREATE_NEURONS record: acct_idx(2) +
 * neuron_idx(2) + name(8) + seed(32) + proof_sz(4). proof bytes follow and
 * vary per neuron, so no C struct describes a whole record. */
#define NEURON_REC_FIXED_SZ (2u + 2u + 8u + 32u + 4u)

/* Fixed portion of one INSTR_CREATE_SINGLETONS record: acct_idx(2) +
 * data_sz(4) + seed(32) + proof_sz(4). */
#define SINGLETON_REC_FIXED_SZ (2u + 4u + 32u + 4u)

/* Instruction data is a flat byte stream at BYTE granularity — only the
 * stream's start (tsdk_txn_get_instr_data) is guaranteed 8-aligned, not the
 * offset of every field inside it (proof_sz alone lands 2 mod 4 off that
 * base once one variable-length proof precedes it). ThruVM faults on any
 * unaligned scalar load, so every multi-byte field in this file goes
 * through TSDK_LOAD instead of a raw pointer cast. Only account DATA
 * pointers (worm_neuron_t below) are naturally aligned by the runtime and
 * may be dereferenced directly. */

static void do_upload(uchar const *data, ulong sz) {
    if (sz < sizeof(upload_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint32_t offset = TSDK_LOAD(uint32_t, data + 4);
    uint32_t len    = TSDK_LOAD(uint32_t, data + 8);
    if (sz != sizeof(upload_args_t) + len) tsdk_revert(ERR_BAD_INSTR_SIZE);

    if (tsys_set_account_data_writable(ACC_TOPOLOGY) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);

    /* Resize once, on the first chunk, to the full declared size. Growing
     * incrementally would re-charge memory units on every chunk. */
    if (offset == 0) {
        uint32_t total = TSDK_LOAD(uint32_t, data + sizeof(upload_args_t) + 0x3C);
        if (tsys_account_resize(ACC_TOPOLOGY, total) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
    }
    unsigned char *dst = (unsigned char *)tsdk_get_account_data_ptr(ACC_TOPOLOGY);
    memcpy(dst + offset, data + sizeof(upload_args_t), len);
    tsdk_return(TSDK_SUCCESS);
}

static void do_create(uchar const *data, ulong sz) {
    if (sz < sizeof(create_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t count = TSDK_LOAD(uint16_t, data + 4);
    uchar const *p = data + sizeof(create_args_t);
    uchar const *end = data + sz;

    for (uint16_t k = 0; k < count; k++) {
        if (p + NEURON_REC_FIXED_SZ > end) tsdk_revert(ERR_BAD_INSTR_SIZE);
        uint16_t acct_idx  = TSDK_LOAD(uint16_t, p);      p += 2;
        uint16_t neuron_ix = TSDK_LOAD(uint16_t, p);      p += 2;
        char name[8];        memcpy(name, p, 8);          p += 8;
        uchar seed[TN_SEED_SIZE]; memcpy(seed, p, TN_SEED_SIZE); p += TN_SEED_SIZE;
        uint32_t proof_sz  = TSDK_LOAD(uint32_t, p);      p += 4;
        if (p + proof_sz > end) tsdk_revert(ERR_BAD_INSTR_SIZE);

        if (tsys_account_create(acct_idx, seed, p, proof_sz) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        p += proof_sz;

        if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        if (tsys_account_resize(acct_idx, sizeof(worm_neuron_t)) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);

        worm_neuron_t *nd = (worm_neuron_t *)tsdk_get_account_data_ptr(acct_idx);
        memset(nd, 0, sizeof(*nd));
        nd->index = neuron_ix;
        memcpy(nd->name, name, 8);
    }
    tsdk_return(TSDK_SUCCESS);
}

/* Topology, reservoir and behavior are program-owned accounts with no neuron
 * header. The reservoir must ALSO be funded — chemical settlement transfers
 * against it, and an empty reservoir fails with INSUFFICIENT_BALANCE (-38).
 * TASK 11: the reservoir's DATA bytes are separately owned by worm_scratch_t
 * (see the TASK 11 note above that typedef) — settlement moves its BALANCE
 * only, never its data. */
static void do_create_singletons(uchar const *data, ulong sz) {
    if (sz < sizeof(create_singleton_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t count = TSDK_LOAD(uint16_t, data + 4);
    uchar const *p = data + sizeof(create_singleton_args_t);
    uchar const *end = data + sz;

    for (uint16_t k = 0; k < count; k++) {
        if (p + SINGLETON_REC_FIXED_SZ > end) tsdk_revert(ERR_BAD_INSTR_SIZE);
        uint16_t acct_idx = TSDK_LOAD(uint16_t, p);           p += 2;
        uint32_t data_sz  = TSDK_LOAD(uint32_t, p);           p += 4;
        uchar seed[TN_SEED_SIZE]; memcpy(seed, p, TN_SEED_SIZE); p += TN_SEED_SIZE;
        uint32_t proof_sz = TSDK_LOAD(uint32_t, p);           p += 4;
        if (p + proof_sz > end) tsdk_revert(ERR_BAD_INSTR_SIZE);

        if (tsys_account_create(acct_idx, seed, p, proof_sz) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        p += proof_sz;
        if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        if (data_sz && tsys_account_resize(acct_idx, data_sz) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        if (data_sz) {
            unsigned char *d = (unsigned char *)tsdk_get_account_data_ptr(acct_idx);
            memset(d, 0, data_sz);
        }
    }
    tsdk_return(TSDK_SUCCESS);
}

/* Thru sorts the ENTIRE writable account array ascending by address, so the
 * singletons do NOT land at fixed indices — they interleave with the neurons
 * wherever their addresses happen to sort. The client knows the sort order, so
 * it passes the three singleton slots in the instruction data, exactly as
 * Thru's own counter example passes account_index. Everything else in the
 * writable array is a neuron, identified by the index field in its own data. */
typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint32_t n_steps;
    uint32_t flags;        /* bit0: settle  bit1: emit trace  bit2: reset
                             * bit3: gap-junction neuron-to-neuron transfers */
    uint32_t settle_every;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
    uint16_t _pad;
} step_args_t;

/* Forward declarations: do_step calls both. Tasks 11 and 12 supply the bodies;
 * Step 3 of this task adds no-op stubs so it compiles today. */
static void emit_trace(uint32_t step);
static void settle_transfers(uint32_t flags);

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t neuron_idx;
    int32_t  current;      /* Q16.16 */
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
} stim_args_t;

/* TASK-10 FINDING (see task-10-report.md): writing to this program's own
 * static/global (.bss) memory hard-faults (VM_FAILED) the instant the SAME
 * transaction also touches any account via tsdk_get_account_data_ptr /
 * tsys_set_account_data_writable — a combination hello.c and the
 * pre-task-10 worm.c never exercised. Plain stack locals are not a
 * substitute either: the VM's per-call stack is a few KB at most, and a
 * single N_NEURONS int32 array already overflows it (VM_FAILED, segment 5 —
 * the stack segment). tsys_increment_anonymous_segment_sz and
 * tsys_set_anonymous_segment_sz (the heap escape hatch) both return -21 on
 * this alphanet build regardless of arguments — not implemented.
 *
 * The fix: park the working set in the RESERVOIR account's own DATA region.
 * Account-data reads and writes are the ONE thing proven to work at any
 * size (topology is 28,564 bytes) — do_resize_scratch (INSTR_RESIZE_SCRATCH)
 * grows the reservoir to fit worm_scratch_t once; every step/stimulate call
 * after that reuses the SAME memory instead of a static or stack array. The
 * reservoir's BALANCE (Task 11's settlement target) is a separate
 * account-meta field — resizing its data never touches it.
 *
 * TASK 11 — READ THIS BEFORE TOUCHING THE RESERVOIR: the reservoir account
 * now has TWO, UNRELATED faces. Its DATA bytes are OWNED by worm_scratch_t
 * (this struct) — INSTR_RESIZE_SCRATCH sized them, and every do_step /
 * do_stimulate call reinterprets them as this exact struct with NO framing,
 * NO magic number, NO length prefix. If settlement writes ANYTHING into the
 * reservoir's data (a balance record, a settlement log, anything), the NEXT
 * do_step call reads that write back as `sim.hdr` and dereferences it as a
 * worm_topology_hdr_t* — a wild pointer read, not a clean revert. Settlement
 * belongs on the reservoir's BALANCE only (the separate tsdk_account_meta
 * field moved by tsys_account_transfer) — that field is free and is exactly
 * what settle_transfers should move. If a fourth field is ever needed here,
 * give it its OWN account; do not grow into this one. */
typedef struct {
    worm_sim_t sim;
    int32_t    V[N_NEURONS];
    int32_t    stim[N_NEURONS];
    uint16_t   neuron_to_slot[N_NEURONS];
} worm_scratch_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t acct_idx;
    uint32_t min_size;
} resize_args_t;

/* min_size is a FLOOR, not the actual size — this always grows to at least
 * sizeof(worm_scratch_t) regardless of what the caller asks for, so deploy.py
 * doesn't need to know the C struct's exact byte count. */
static void do_resize_scratch(uchar const *data, ulong sz) {
    if (sz != sizeof(resize_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t acct_idx = TSDK_LOAD(uint16_t, data + 4);
    uint32_t min_size = TSDK_LOAD(uint32_t, data + 6);
    uint32_t size = min_size < (uint32_t)sizeof(worm_scratch_t)
                  ? (uint32_t)sizeof(worm_scratch_t) : min_size;
    if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    if (tsys_account_resize(acct_idx, size) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    unsigned char *d = (unsigned char *)tsdk_get_account_data_ptr(acct_idx);
    memset(d, 0, size);
    tsdk_return(TSDK_SUCCESS);
}

/* Builds the neuron -> account-slot map by reading each account's own index
 * field, rather than trusting a fixed layout. Every one of these accounts is
 * page-faulted by the step anyway, so the 2-byte read is free. Also binds
 * *out_scratch to the reservoir account's data, reinterpreted as
 * worm_scratch_t (see above) — the caller's ONLY handle on the sim state. */
static void bind_accounts(uint16_t a_topo, uint16_t a_res, uint16_t a_beh,
                           worm_scratch_t **out_scratch) {
    if (tsys_set_account_data_writable(a_res) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    worm_scratch_t *scratch = (worm_scratch_t *)tsdk_get_account_data_ptr(a_res);
    *out_scratch = scratch;

    if (tsys_set_account_data_writable(a_topo) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    void const *topo = tsdk_get_account_data_ptr(a_topo);
    worm_sim_bind(&scratch->sim, topo, scratch->V, scratch->stim);
    if (scratch->sim.hdr->magic != WORM_MAGIC) tsdk_revert(ERR_BAD_MAGIC);

    tsdk_txn_t const *txn = tsdk_get_txn();
    ulong n_rw = tsdk_txn_readwrite_account_cnt(txn);
    uint32_t found = 0;
    for (ulong slot = 2; slot < 2 + n_rw; slot++) {
        if (slot == a_topo || slot == a_res || slot == a_beh) continue;
        if (tsys_set_account_data_writable((uint16_t)slot) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        worm_neuron_t const *nd =
            (worm_neuron_t const *)tsdk_get_account_data_ptr((uint16_t)slot);
        if (nd->index >= scratch->sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
        scratch->neuron_to_slot[nd->index] = (uint16_t)slot;
        found++;
    }
    if (found != scratch->sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
}

/* TASK-10 R5: account DATA v_next is the simulation's source of truth — it
 * resolves Q16.16 (~1.5e-5 mV). Balance only resolves 0.1 mV (BAL_SCALE=10,
 * worm.h) and is the settled PROJECTION that Task 11's settle_transfers
 * writes separately. Reconstructing V from balance here would cap voltage
 * precision at 0.1 mV and make the bit-for-bit assert against native C
 * mathematically impossible — do NOT go back to decoding the balance. */
static void load_state(worm_scratch_t *scratch) {
    for (uint32_t i = 0; i < scratch->sim.hdr->n_neurons; i++) {
        uint16_t slot = scratch->neuron_to_slot[i];
        worm_neuron_t const *nd =
            (worm_neuron_t const *)tsdk_get_account_data_ptr(slot);
        scratch->V[i]    = nd->v_next;
        scratch->stim[i] = nd->i_stim;
    }
}

/* `tag` is do_step's own local `done` counter, which starts at 0 on EVERY
 * call — it is not a running total across separate transactions. Comparing
 * it against the account's existing step_tag therefore only makes sense
 * within a single do_step invocation's own chunk loop (protects against a
 * call that itself under-runs); across separate calls it would wrongly
 * flag a normal second call whose `done` happens to be smaller than the
 * previous call's final tag. `force` (do_step's reset flag) bypasses the
 * check outright — reset is DELIBERATELY rewinding to tag 0. */
static void store_state(worm_scratch_t *scratch, uint32_t tag, int force) {
    for (uint32_t i = 0; i < scratch->sim.hdr->n_neurons; i++) {
        uint16_t slot = scratch->neuron_to_slot[i];
        /* Account data pages are read-only until explicitly marked writable
         * for THIS instruction — do_create/do_upload already do this before
         * their writes. Skipping it here doesn't revert cleanly; it VM_FAULTs
         * (TN_RUNTIME_TXN_ERR_VM_FAILED) on the write below. */
        if (tsys_set_account_data_writable(slot) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        worm_neuron_t *nd = (worm_neuron_t *)tsdk_get_account_data_ptr(slot);
        if (!force && nd->step_tag > tag) tsdk_revert(ERR_STALE_STEP_TAG);
        nd->v_next   = scratch->V[i];
        nd->step_tag = tag;
    }
}

/* Every field below comes from instruction data, whose interior offsets are
 * NOT guaranteed aligned (only the stream's start is) — a raw `a->field` on
 * a pointer cast, even through a packed struct, is the fault Task 9 hit.
 * TSDK_LOAD at explicit byte offsets is the only safe way to read it; the
 * step_args_t/stim_args_t typedefs above exist solely for their sizeof(). */
static void do_step(uchar const *data, ulong sz) {
    if (sz != sizeof(step_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint32_t n_steps       = TSDK_LOAD(uint32_t, data + 4);
    uint32_t flags         = TSDK_LOAD(uint32_t, data + 8);
    uint32_t settle_every  = TSDK_LOAD(uint32_t, data + 12);
    uint16_t acc_topology  = TSDK_LOAD(uint16_t, data + 16);
    uint16_t acc_reservoir = TSDK_LOAD(uint16_t, data + 18);
    uint16_t acc_behavior  = TSDK_LOAD(uint16_t, data + 20);

    worm_scratch_t *scratch;
    bind_accounts(acc_topology, acc_reservoir, acc_behavior, &scratch);

    /* Freshly created accounts have v_next == 0, which is NOT the resting
     * potential. Reset seeds V from the topology's E_leak parameters instead
     * of loading from accounts, and lets settlement push real balance into
     * every neuron from the reservoir — that first settlement is what makes
     * the accounts' balances non-zero (deploy.py's reset_sim()). */
    if (flags & 4u) worm_sim_reset(&scratch->sim);
    else            load_state(scratch);

    uint32_t done = 0;
    do {
        uint32_t chunk = settle_every ? settle_every : n_steps;
        if (chunk > n_steps - done) chunk = n_steps - done;
        if (chunk) worm_step(&scratch->sim, chunk);
        done += chunk;
        if (flags & 2u) emit_trace(done);
        /* bit0: reservoir reconciliation. bit3: gap-junction transfers. Both
         * are Task 11's settlement bodies; either one firing is reason to
         * call in. */
        if (flags & (1u | 8u)) settle_transfers(flags);
    } while (done < n_steps);

    store_state(scratch, done, (flags & 4u) != 0);
    tsdk_return(TSDK_SUCCESS);
}

static void do_stimulate(uchar const *data, ulong sz) {
    if (sz != sizeof(stim_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t neuron_idx    = TSDK_LOAD(uint16_t, data + 4);
    int32_t  current       = TSDK_LOAD(int32_t,  data + 6);
    uint16_t acc_topology  = TSDK_LOAD(uint16_t, data + 10);
    uint16_t acc_reservoir = TSDK_LOAD(uint16_t, data + 12);
    uint16_t acc_behavior  = TSDK_LOAD(uint16_t, data + 14);

    worm_scratch_t *scratch;
    bind_accounts(acc_topology, acc_reservoir, acc_behavior, &scratch);
    if (neuron_idx >= scratch->sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
    uint16_t slot = scratch->neuron_to_slot[neuron_idx];
    if (tsys_set_account_data_writable(slot) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    worm_neuron_t *nd = (worm_neuron_t *)tsdk_get_account_data_ptr(slot);
    nd->i_stim = current;
    tsdk_return(TSDK_SUCCESS);
}

static void emit_trace(uint32_t step) { (void)step; }          /* Task 12 */
static void settle_transfers(uint32_t flags) { (void)flags; }  /* Task 11 */

TSDK_ENTRYPOINT_FN void start(void) {
    tsdk_txn_t const *txn = tsdk_get_txn();
    uchar const *data = tsdk_txn_get_instr_data(txn);
    ulong sz = tsdk_txn_get_instr_data_sz(txn);
    if (sz < sizeof(uint32_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);

    uint32_t instr = TSDK_LOAD(uint32_t, data);
    switch (instr) {
        case INSTR_UPLOAD_CHUNK:      do_upload(data, sz); break;
        case INSTR_CREATE_NEURONS:    do_create(data, sz); break;
        case INSTR_CREATE_SINGLETONS: do_create_singletons(data, sz); break;
        case INSTR_STEP:               do_step(data, sz); break;
        case INSTR_STIMULATE:          do_stimulate(data, sz); break;
        case INSTR_RESIZE_SCRATCH:     do_resize_scratch(data, sz); break;
        default:                       tsdk_revert(ERR_BAD_INSTR_TYPE);
    }
    tsdk_return(TSDK_SUCCESS);
}
