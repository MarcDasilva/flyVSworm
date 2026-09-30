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

/* Forward declarations: do_step calls both. Tasks 11 and 12 supply the bodies.
 * settle_transfers takes a scratch pointer (struct worm_scratch_s, defined
 * below as worm_scratch_t once its members are known) rather than reading
 * global state — do_step's `scratch` is a local bound into the reservoir's
 * own DATA (see the TASK-10 finding above worm_scratch_t), and there is no
 * other way to reach it from here. */
struct worm_scratch_s;
static void emit_trace(struct worm_scratch_s *scratch, uint32_t step,
                        uint16_t acc_behavior);
static void settle_transfers(struct worm_scratch_s *scratch, uint32_t flags,
                              uint16_t acc_reservoir, uint32_t step);

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t neuron_idx;
    int32_t  current;      /* Q16.16 */
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
} stim_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
} classify_args_t;

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
typedef struct worm_scratch_s {
    /* Fixed wire prefix, followed by persisted events. The remaining fields
     * are scratch only; rebinding sim must never overwrite the outbox. */
    uint32_t pending_magic, pending_count, pending_remaining, pending_generation;
    worm_synapse_t pending[SYNAPSE_CAPACITY];
    tn_pubkey_t pending_accounts[N_NEURONS];
    worm_sim_t sim;
    int32_t    V[N_NEURONS];
    int32_t    stim[N_NEURONS];
    uint16_t   neuron_to_slot[N_NEURONS];
    /* TASK 12: both event payloads are assembled HERE for the same reason
     * everything else is — a 612-byte static would fault the moment this
     * instruction also touched an account, and a 4.4 KB stack local
     * overflows the VM's few-KB stack outright. They are scratch, never
     * read back across calls. Growing this struct means ensure_scratch()
     * must run again before the next step; deploy.py's reset_sim() calls
     * it every time, so an upgrade that changes this size self-heals. */
    worm_trace_event_t trace;
    worm_xfer_event_t  xfers;
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
    if (tsdk_get_account_meta(acct_idx)->data_sz >= sizeof(worm_scratch_t)) {
        worm_scratch_t const *old = tsdk_get_account_data_ptr(acct_idx);
        if (old->pending_magic == SYNAPSE_MAGIC && old->pending_remaining)
            tsdk_revert(ERR_PENDING_SYNAPSES);
    }
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

/* `tag` is the ABSOLUTE simulated step this transaction advanced the worm
 * to — the behavior account's clock plus this call's own progress, not the
 * per-call counter it used to be. That is what makes the guard below mean
 * something: a neuron whose step_tag is already AHEAD of what this
 * transaction computed is being overwritten with a stale voltage, which is
 * what a replayed or raced transaction looks like. Task 10 left this guard
 * honest only within one call's chunk loop and flagged it as worse than no
 * guard; with an absolute clock it holds across transactions too.
 * `force` (do_step's reset flag) bypasses it outright — reset is
 * DELIBERATELY rewinding to tag 0. */
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
        /* i_stim goes back too. load_state read it from here and nothing in
         * the step mutates it, so this is a no-op EXCEPT after a reset,
         * where worm_sim_reset zeroed the scratch copy. Without this write
         * a reset leaves every past stimulus latched in account data and
         * the next experiment runs with the previous one still applied —
         * the head-touch/tail-touch test is exactly what that breaks. */
        nd->i_stim   = scratch->stim[i];
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

    if (scratch->pending_magic == SYNAPSE_MAGIC && scratch->pending_remaining)
        tsdk_revert(ERR_PENDING_SYNAPSES);
    if (flags & 16u) {
        scratch->pending_magic = SYNAPSE_MAGIC;
        scratch->pending_count = 0;
        scratch->pending_remaining = 0;
        scratch->pending_generation++;
        tn_pubkey_t const *accounts = tsdk_txn_get_acct_addrs(tsdk_get_txn());
        for (uint32_t i = 0; i < N_NEURONS; i++)
            scratch->pending_accounts[i] = accounts[scratch->neuron_to_slot[i]];
    }

    /* Freshly created accounts have v_next == 0, which is NOT the resting
     * potential. Reset seeds V from the topology's E_leak parameters instead
     * of loading from accounts, and lets settlement push real balance into
     * every neuron from the reservoir — that first settlement is what makes
     * the accounts' balances non-zero (deploy.py's reset_sim()). */
    if (flags & 4u) worm_sim_reset(&scratch->sim);
    else            load_state(scratch);

    /* The behavior account's `step` is the simulation's ONLY clock. The
     * classifier's dwell and hysteresis are both measured against it, so if
     * stepping does not advance it the classifier can never leave its
     * starting state — every dwell comparison reads held == 0 forever. */
    if (tsys_set_account_data_writable(acc_behavior) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    worm_behavior_t *beh =
        (worm_behavior_t *)tsdk_get_account_data_ptr(acc_behavior);
    if (flags & 4u) {
        memset(beh, 0, sizeof(*beh));
    }
    uint32_t const step0 = beh->step;

    uint32_t done = 0;
    do {
        uint32_t chunk = settle_every ? settle_every : n_steps;
        if (chunk > n_steps - done) chunk = n_steps - done;
        if (chunk) worm_step(&scratch->sim, chunk);
        done += chunk;
        if (flags & 16u) {
            int32_t count = worm_collect_synapses(&scratch->sim,
                scratch->pending + scratch->pending_count,
                SYNAPSE_CAPACITY - scratch->pending_count, step0 + done);
            if (count < 0) tsdk_revert(ERR_XFER_OVERFLOW);
            scratch->pending_count += (uint32_t)count;
            scratch->pending_remaining += (uint32_t)count;
        }
        if (flags & 2u) emit_trace(scratch, step0 + done, acc_behavior);
        /* bit0: reservoir reconciliation. bit3: gap-junction transfers. Both
         * are Task 11's settlement bodies; either one firing is reason to
         * call in. */
        if (flags & (1u | 8u))
            settle_transfers(scratch, (flags & 16u) ? flags & ~8u : flags,
                             acc_reservoir, step0 + done);
    } while (done < n_steps);

    beh->step = step0 + done;
    store_state(scratch, beh->step, (flags & 4u) != 0);
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

/* The command interneurons ARE the classifier. AVA/AVD/AVE carry reversal
 * and AVB/PVC carry forward locomotion — that is their documented function
 * (Chalfie et al. 1985), not a mapping we invented to have something to
 * read. Resolved from each account's own name field rather than a baked
 * index, so a connectome rebuild that shifts dense indices cannot silently
 * point the classifier at the wrong five cells. */
#define CMD_AVA 0
#define CMD_AVD 1
#define CMD_AVE 2
#define CMD_AVB 3
#define CMD_PVC 4
#define CMD_N   5

static void resolve_command_neurons(worm_scratch_t *scratch, int16_t *ix) {
    for (uint32_t k = 0; k < CMD_N; k++) ix[k] = -1;
    for (uint32_t i = 0; i < scratch->sim.hdr->n_neurons; i++) {
        worm_neuron_t const *nd = (worm_neuron_t const *)
            tsdk_get_account_data_ptr(scratch->neuron_to_slot[i]);
        if      (!memcmp(nd->name, "AVAL", 5)) ix[CMD_AVA] = (int16_t)nd->index;
        else if (!memcmp(nd->name, "AVDL", 5)) ix[CMD_AVD] = (int16_t)nd->index;
        else if (!memcmp(nd->name, "AVEL", 5)) ix[CMD_AVE] = (int16_t)nd->index;
        else if (!memcmp(nd->name, "AVBL", 5)) ix[CMD_AVB] = (int16_t)nd->index;
        else if (!memcmp(nd->name, "PVCL", 5)) ix[CMD_PVC] = (int16_t)nd->index;
    }
}

/* Drive is depolarisation above the cell's OWN measured resting potential,
 * 20 mV full scale. Normalising against E_leak instead reads 0.49-0.68 on
 * every command neuron with nobody touching the worm (R13, and
 * worm_param_t.V_rest_mV in worm.h) — the worm would latch into REVERSE
 * before the demo started and tail touch would never register. */
static int32_t drive_of(worm_scratch_t *scratch, int16_t ix) {
    if (ix < 0) return 0;
    int32_t d = scratch->V[ix] - (int32_t)scratch->sim.params[ix].V_rest_mV * Q16;
    d = q16_mul(d, Q16 / 20);
    if (d < 0)   d = 0;
    if (d > Q16) d = Q16;
    return d;
}

#define THRESH_ON   (Q16 * 35 / 100)
#define THRESH_OFF  (Q16 * 20 / 100)
#define DWELL_MIN   60     /* 300 ms at dt=5ms */
#define OMEGA_HOLD  160    /* 800 ms */

static void do_classify(uchar const *data, ulong sz) {
    if (sz != sizeof(classify_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t acc_topology  = TSDK_LOAD(uint16_t, data + 4);
    uint16_t acc_reservoir = TSDK_LOAD(uint16_t, data + 6);
    uint16_t acc_behavior  = TSDK_LOAD(uint16_t, data + 8);

    worm_scratch_t *scratch;
    bind_accounts(acc_topology, acc_reservoir, acc_behavior, &scratch);
    load_state(scratch);

    int16_t ix[CMD_N];
    resolve_command_neurons(scratch, ix);

    int32_t rev = q16_mul(Q16 * 50 / 100, drive_of(scratch, ix[CMD_AVA]))
                + q16_mul(Q16 * 30 / 100, drive_of(scratch, ix[CMD_AVD]))
                + q16_mul(Q16 * 20 / 100, drive_of(scratch, ix[CMD_AVE]));
    int32_t fwd = q16_mul(Q16 * 60 / 100, drive_of(scratch, ix[CMD_AVB]))
                + q16_mul(Q16 * 40 / 100, drive_of(scratch, ix[CMD_PVC]));

    if (tsys_set_account_data_writable(acc_behavior) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    worm_behavior_t *b =
        (worm_behavior_t *)tsdk_get_account_data_ptr(acc_behavior);
    uint32_t held = b->step - b->entered_at;
    uint8_t next = b->state;

    /* Dwell and hysteresis, not argmax. Two drives within noise of each
     * other flip a bare argmax every frame, and a worm that flickers
     * between forward and reverse reads as broken however correct the
     * voltages underneath are. */
    if (b->state == 3u) {                      /* OMEGA runs to completion */
        if (held >= 200u) next = 1u;           /* 1.0 s, then FORWARD */
    } else if (b->state == 2u && held >= OMEGA_HOLD && rev < THRESH_OFF) {
        next = 3u;                             /* sustained reversal, released */
    } else if (held >= DWELL_MIN) {
        if (rev > THRESH_ON && rev > fwd)      next = 2u;
        else if (fwd > THRESH_ON && fwd > rev) next = 1u;
        else if (rev < THRESH_OFF && fwd < THRESH_OFF) next = 0u;
    }

    if (next != b->state) { b->state = next; b->entered_at = b->step; }
    b->gain       = (rev > fwd) ? rev : fwd;
    b->drive_fwd  = fwd;
    b->drive_rev  = rev;
    b->block_time = tsdk_get_current_block_ctx()->block_time;
    tsdk_return(TSDK_SUCCESS);
}

/* One event per traced frame. Voltages are truncated to whole millivolts
 * (>> 16 floors, matching every other conversion in this program) — the
 * front-end draws them, it does not simulate from them, and v_next in
 * account data remains the Q16.16 source of truth (TASK-10 R5). */
static void emit_trace(worm_scratch_t *scratch, uint32_t step,
                        uint16_t acc_behavior) {
    uint32_t const N = scratch->sim.hdr->n_neurons;
    scratch->trace.type = WORM_EVENT_TRACE;
    for (uint32_t i = 0; i < N; i++)
        scratch->trace.frame.mV[i] = (int16_t)(scratch->V[i] >> 16);
    scratch->trace.frame.step = step;
    worm_behavior_t const *b =
        (worm_behavior_t const *)tsdk_get_account_data_ptr(acc_behavior);
    scratch->trace.frame.state = b->state;
    scratch->trace.frame.end   = WORM_EVENT_END;
    tsys_emit_event((uchar const *)&scratch->trace, sizeof(scratch->trace));
}

/* Voltage -> settled balance PROJECTION (worm.h R14): balance = (V_mV + 100)
 * * BAL_SCALE. NEVER invert this to recover V — v_next (Q16.16) is the ONLY
 * source of truth (load_state above, TASK-10 R5). num is clamped at 0 only
 * to stop a uint64 wraparound if V ever drops below -100mV; BAL_MIN/BAL_MAX
 * are deliberately NOT re-applied here, because the bit-for-bit test
 * (test_balance_encodes_voltage_within_rounding) computes its expected value
 * from this exact unclamped formula. */
static uint64_t v_to_balance(int32_t v_q16) {
    int64_t num = (int64_t)v_q16 + (int64_t)BAL_OFFSET_MV * Q16;
    if (num < 0) num = 0;
    return (uint64_t)((num * BAL_SCALE) / Q16);
}

/* Gap junctions settle as TRANSFERS because they are conservative: current
 * out of one cell IS current into the other. Chemical synapses (bundled here
 * with leak and stimulus current, none of which are conservative either)
 * settle against the reservoir — a chemical synapse gates a conductance, the
 * presynaptic cell does not lose what the postsynaptic gains. The two ledger
 * operations match the two physics; that is the claim on stage.
 *
 * Order matters when both flags fire in the same call: gap transfers run
 * FIRST, moving balance neuron-to-neuron; reservoir reconciliation runs
 * SECOND and only has to make up whatever the gap pass didn't already move.
 * Reconciling first would push every neuron to v_to_balance(V) and then the
 * gap pass would immediately pull balance back OFF that exact value — double
 * counting the gap component instead of isolating it. */
static void settle_transfers(worm_scratch_t *scratch, uint32_t flags,
                              uint16_t acc_reservoir, uint32_t step) {
    uint32_t const N = scratch->sim.hdr->n_neurons;
    uint32_t n_xfer = 0;

    /* One transfer per anatomical junction (517 real undirected pairs; the
     * CSR stores both directions symmetrically, so j > i takes each pair
     * once) in the direction of net current — current leaves the
     * higher-voltage cell. R14: BAL_SCALE=10 resolves 0.1 mV, so a junction
     * whose |g*(Vi-Vj)| is under that floor rounds to a zero-unit transfer
     * and is skipped outright (see task-11-report.md for how many of the 517
     * clear the bar during a real settlement). */
    if (flags & 8u) {
        for (uint32_t i = 0; i < N; i++) {
            for (uint32_t e = scratch->sim.gap_rowptr[i]; e < scratch->sim.gap_rowptr[i + 1]; e++) {
                uint32_t j = scratch->sim.gap_col[e];
                if (j <= i) continue;
                int32_t  g_fixed  = (int32_t)scratch->sim.gap_g[e] << 8; /* Q8.8 -> Q16.16 */
                int32_t  dV       = scratch->V[i] - scratch->V[j];      /* Q16.16 mV */
                int64_t  flow     = (int64_t)q16_mul(g_fixed, dV);      /* Q16.16 g*dV */
                int64_t  abs_flow = flow < 0 ? -flow : flow;
                uint64_t amt      = (uint64_t)((abs_flow * BAL_SCALE) / Q16);
                if (amt == 0) continue;

                uint16_t si   = scratch->neuron_to_slot[i];
                uint16_t sj   = scratch->neuron_to_slot[j];
                uint16_t from = (flow > 0) ? si : sj;   /* higher-V cell loses charge */
                uint16_t to   = (flow > 0) ? sj : si;

                /* R8: native balance is uint64 and cannot go negative — skip
                 * rather than revert if this would breach the BAL_MIN floor.
                 * There are 516 other junctions to show. */
                uint64_t from_bal = tsdk_get_account_meta(from)->balance;
                if (from_bal < amt + BAL_MIN) continue;
                if (tsys_account_transfer(from, to, amt) != TSDK_SUCCESS)
                    tsdk_revert(ERR_TRANSFER_FAILED);

                /* Recorded AFTER the transfer succeeds, so the event
                 * describes what the ledger did rather than what this loop
                 * intended — the skips above (rounding floor, BAL_MIN) are
                 * exactly the cases where the two would differ, and
                 * test_gap_settlement_emits_the_transfers_it_made checks the
                 * event against the chain's own balance deltas. */
                if (n_xfer >= XFER_MAX) tsdk_revert(ERR_XFER_OVERFLOW);
                scratch->xfers.xfer[n_xfer].pre    = (uint16_t)((flow > 0) ? i : j);
                scratch->xfers.xfer[n_xfer].post   = (uint16_t)((flow > 0) ? j : i);
                scratch->xfers.xfer[n_xfer].amount = (int32_t)amt;
                n_xfer++;
            }
        }

        /* The per-synapse record the transaction receipt does not carry:
         * `thru txn execute` reports no per-operation trace, so without this
         * event nothing off-chain can see WHICH junctions moved charge — only
         * that some balance changed. Task 15 animates from it. 334 of 517
         * junctions clear the rounding floor in a settled run, so ~2.7 KB. */
        if (n_xfer) {
            scratch->xfers.type  = WORM_EVENT_XFER;
            scratch->xfers.step  = step;
            scratch->xfers.count = n_xfer;
            /* The terminator travels with the LAST transfer, not at the end
             * of the fixed-size array — a small `amount` ends in zero bytes
             * and the runtime would trim them off the wire. */
            *(uchar *)&scratch->xfers.xfer[n_xfer] = (uchar)WORM_EVENT_END;
            tsys_emit_event((uchar const *)&scratch->xfers,
                            WORM_XFER_EVENT_SZ(n_xfer));
        }
    }

    /* Reconcile every neuron's balance to its simulated voltage. Whatever the
     * gap pass above didn't already settle is, by elimination, the
     * non-conservative (chemical + leak + stimulus) component — moved
     * against the reservoir's BALANCE only, never its DATA (see the TASK 11
     * comment above worm_scratch_t: the reservoir's data bytes belong to this
     * struct, with no framing, and a stray write there is a wild pointer read
     * on the next do_step call, not a clean revert). */
    if (flags & 1u) {
        for (uint32_t i = 0; i < N; i++) {
            uint16_t slot = scratch->neuron_to_slot[i];
            uint64_t want = v_to_balance(scratch->V[i]);
            uint64_t have = tsdk_get_account_meta(slot)->balance;
            if (want == have) continue;
            if (want > have) {
                uint64_t amt = want - have;
                /* R8: the reservoir is funded (deploy.py's fund_reservoir),
                 * but skip rather than revert if it ever runs dry — repeat
                 * with `thru faucet withdraw worm 10000`. */
                uint64_t res_bal = tsdk_get_account_meta(acc_reservoir)->balance;
                if (res_bal < amt) continue;
                if (tsys_account_transfer(acc_reservoir, slot, amt) != TSDK_SUCCESS)
                    tsdk_revert(ERR_TRANSFER_FAILED);
            } else {
                uint64_t amt = have - want;
                /* R8: leave BAL_MIN headroom below resting potential so a
                 * later hyperpolarizing transfer always has somewhere to
                 * come from — skip this neuron's settlement rather than
                 * revert the whole transaction over it. */
                if (have < amt + BAL_MIN) continue;
                if (tsys_account_transfer(slot, acc_reservoir, amt) != TSDK_SUCCESS)
                    tsdk_revert(ERR_TRANSFER_FAILED);
            }
        }
    }
}

/* Keep voltage's balance projection independent of the current ledger, as in
 * the old batch reconciliation. One synapse transaction may include this
 * reservoir bookkeeping, but never another synaptic event. */
static void reconcile_neuron(uint16_t slot, uint16_t reservoir) {
    worm_neuron_t const *neuron = tsdk_get_account_data_ptr(slot);
    uint64_t want = v_to_balance(neuron->v_next);
    if (want < BAL_MIN) want = BAL_MIN;
    uint64_t have = tsdk_get_account_meta(slot)->balance;
    if (want > have) {
        if (tsys_account_transfer(reservoir, slot, want - have) != TSDK_SUCCESS)
            tsdk_revert(ERR_TRANSFER_FAILED);
    } else if (have > want) {
        if (tsys_account_transfer(slot, reservoir, have - want) != TSDK_SUCCESS)
            tsdk_revert(ERR_TRANSFER_FAILED);
    }
}

static void do_settle_synapse(uchar const *data, ulong sz) {
    if (sz != 20u) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint32_t generation = TSDK_LOAD(uint32_t, data + 4);
    uint32_t index = TSDK_LOAD(uint32_t, data + 8);
    uint16_t reservoir = TSDK_LOAD(uint16_t, data + 12);
    uint16_t pre = TSDK_LOAD(uint16_t, data + 14);
    uint16_t post = TSDK_LOAD(uint16_t, data + 16);
    ulong limit = 2 + tsdk_txn_readwrite_account_cnt(tsdk_get_txn());
    if (reservoir < 2 || reservoir >= limit || pre < 2 || pre >= limit ||
        post < 2 || post >= limit || reservoir == pre || reservoir == post)
        tsdk_revert(ERR_BAD_SYNAPSE);
    if (tsdk_get_account_meta(reservoir)->data_sz < sizeof(worm_scratch_t))
        tsdk_revert(ERR_BAD_SYNAPSE);
    if (tsys_set_account_data_writable(reservoir) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    worm_scratch_t *scratch = tsdk_get_account_data_ptr(reservoir);
    if (scratch->pending_magic != SYNAPSE_MAGIC ||
        generation != scratch->pending_generation || index >= scratch->pending_count)
        tsdk_revert(ERR_BAD_SYNAPSE);
    worm_synapse_t *event = &scratch->pending[index];
    if (event->settled || !scratch->pending_remaining) tsdk_revert(ERR_BAD_SYNAPSE);
    tn_pubkey_t const *accounts = tsdk_txn_get_acct_addrs(tsdk_get_txn());
    if (memcmp(&accounts[pre], &scratch->pending_accounts[event->pre], sizeof(tn_pubkey_t)) ||
        memcmp(&accounts[post], &scratch->pending_accounts[event->post], sizeof(tn_pubkey_t)))
        tsdk_revert(ERR_BAD_SYNAPSE);

    uint16_t from = event->kind ? (event->amount > 0 ? reservoir : post) : pre;
    uint16_t to = event->kind ? (event->amount > 0 ? post : reservoir) : post;
    uint64_t amount = event->amount < 0 ? -(int64_t)event->amount : event->amount;
    uint64_t have = tsdk_get_account_meta(from)->balance;
    if (from != reservoir && have < amount + BAL_MIN) {
        if (tsys_account_transfer(reservoir, from, amount + BAL_MIN - have) != TSDK_SUCCESS)
            tsdk_revert(ERR_TRANSFER_FAILED);
    }
    if (tsys_account_transfer(from, to, amount) != TSDK_SUCCESS)
        tsdk_revert(ERR_TRANSFER_FAILED);
    reconcile_neuron(post, reservoir);
    if (!event->kind && pre != post) reconcile_neuron(pre, reservoir);

    /* Fixed 24-byte receipt: type, step, pre, post, signed amount, kind, pad,
     * terminator. The enclosing transaction signature identifies ONE event. */
    struct __attribute__((packed, aligned(8))) {
        uint64_t type;
        uint32_t step;
        uint16_t pre, post;
        int32_t amount;
        uint8_t kind, pad[2], end;
    } receipt = { .type = WORM_EVENT_SYNAPSE, .step = event->step,
        .pre = event->pre, .post = event->post, .amount = event->amount,
        .kind = event->kind, .end = WORM_EVENT_END };
    event->settled = 1;
    scratch->pending_remaining--;
    tsys_emit_event((uchar const *)&receipt, sizeof(receipt));
    tsdk_return(TSDK_SUCCESS);
}

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
        case INSTR_CLASSIFY:           do_classify(data, sz); break;
        case INSTR_RESIZE_SCRATCH:     do_resize_scratch(data, sz); break;
        case INSTR_SETTLE_SYNAPSE:      do_settle_synapse(data, sz); break;
        default:                       tsdk_revert(ERR_BAD_INSTR_TYPE);
    }
    tsdk_return(TSDK_SUCCESS);
}
