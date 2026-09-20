/* The fruit fly's heading circuit, running on Thru.
 *
 * Every neuron is an account. Its membrane potential is the account's DATA
 * (Q16.16, the simulation's source of truth) and, settled, its BALANCE. A
 * spike moves balance from the neuron that fired to the ones it drives, so the
 * ledger's arithmetic and the circuit's arithmetic are the same arithmetic.
 *
 * Structure is inherited wholesale from the C. elegans program this is a port
 * of, and so are its hard-won platform workarounds: every multi-byte read out
 * of instruction data goes through TSDK_LOAD because only the stream's START
 * is guaranteed aligned; the working set lives in an account's data because
 * writable statics hard-fault the moment the same transaction touches an
 * account and the VM stack is a few KB; account data pages are read-only until
 * explicitly marked writable for THIS instruction, and skipping that faults
 * rather than reverting.
 */
#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include <string.h>
#include "fly.h"
#include "sim.h"
#include "fixed.h"

/* Topology is account index 2 during setup: it is the only writable account in
 * an upload transaction, so it necessarily sorts first. During stepping the
 * slot is passed in the instruction data instead, because the singletons
 * interleave with the neurons wherever their addresses sort. */
#define ACC_TOPOLOGY 2u

/* The rate window the readout averages over, as a compile-time bound on the
 * history ring. params.rate_window may be smaller; larger is rejected. */
#define RATE_WINDOW_MAX 64

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint32_t offset;
    uint32_t len;
    /* payload bytes follow */
} upload_args_t;

/* Fixed portion of one INSTR_CREATE_NEURONS record: acct_idx(2) +
 * neuron_idx(2) + name(8) + seed(32) + proof_sz(4). Proof bytes follow and
 * vary per neuron, so no C struct describes a whole record. */
#define NEURON_REC_FIXED_SZ (2u + 2u + 8u + 32u + 4u)
/* Fixed portion of one INSTR_CREATE_SINGLETONS record. */
#define SINGLETON_REC_FIXED_SZ (2u + 4u + 32u + 4u)

typedef struct __attribute__((packed)) { uint32_t instr; uint16_t count; } create_args_t;
typedef struct __attribute__((packed)) { uint32_t instr; uint16_t count; } create_singleton_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint32_t n_steps;
    uint32_t flags;        /* bit0: reconcile  bit1: emit trace  bit2: reset
                            * bit3: spike transfers */
    uint32_t settle_every;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
    uint16_t _pad;
} step_args_t;

/* The steering signal. Held in the behavior account between calls so a step
 * transaction does not have to restate it -- and so that, exactly as with the
 * worm's i_stim, a drive that is never released stays applied. */
typedef struct __attribute__((packed)) {
    uint32_t instr;
    int32_t  drive_l;          /* Q16.16 */
    int32_t  drive_r;          /* Q16.16 */
    int32_t  landmark_current; /* Q16.16 */
    uint16_t landmark_wedge;
    uint8_t  landmark_active;
    uint8_t  _pad;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
    uint16_t _pad2;
} drive_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
} classify_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t acct_idx;
    uint32_t min_size;
} resize_args_t;

struct fly_scratch_s;
static void emit_trace(struct fly_scratch_s *scratch, uint32_t step, uint16_t acc_behavior);
static void settle_transfers(struct fly_scratch_s *scratch, uint32_t flags,
                             uint16_t acc_reservoir, uint32_t step);

/* The working set. Writing to this program's own .bss hard-faults the instant
 * the same transaction also touches an account, and a single int32[134] array
 * already overflows the VM's few-KB stack, so everything lives in the
 * reservoir account's DATA region -- account reads and writes being the one
 * thing proven to work at any size.
 *
 * THE RESERVOIR HAS TWO UNRELATED FACES. These bytes are this struct, with no
 * framing, no magic and no length prefix; its BALANCE is settlement's
 * counterparty. If settlement ever writes into the reservoir's DATA, the next
 * step reads that write back as sim.hdr and dereferences it -- a wild pointer,
 * not a clean revert. If a fourth field is ever needed, give it its own
 * account; do not grow into this one. */
typedef struct fly_scratch_s {
    fly_sim_t  sim;
    int32_t    v[N_NEURONS];
    int32_t    syn[N_NEURONS];
    uint16_t   refrac[N_NEURONS];
    uint8_t    spikes[N_NEURONS];
    uint16_t   neuron_to_slot[N_NEURONS];

    /* Rolling spike history, for the rate the readout averages. Rates never
     * come from instantaneous spikes: at ~30 Hz most wedges are silent on any
     * given tick and an instantaneous population vector is noise. */
    uint16_t   count[N_NEURONS];               /* spikes inside the window */
    uint8_t    history[RATE_WINDOW_MAX][N_NEURONS];
    uint32_t   hist_pos;
    uint32_t   hist_filled;

    /* Both event payloads are assembled here for the same reason as
     * everything else: a static would fault and a 4 KB stack local would
     * overflow. They are scratch, never read back across calls. */
    fly_trace_event_t trace;
    fly_xfer_event_t  xfers;
} fly_scratch_t;

/* ------------------------------------------------------------------ setup -- */

static void do_upload(uchar const *data, ulong sz) {
    if (sz < sizeof(upload_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint32_t offset = TSDK_LOAD(uint32_t, data + 4);
    uint32_t len    = TSDK_LOAD(uint32_t, data + 8);
    if (sz != sizeof(upload_args_t) + len) tsdk_revert(ERR_BAD_INSTR_SIZE);

    if (tsys_set_account_data_writable(ACC_TOPOLOGY) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);

    /* Resize once, on the first chunk, to the full declared size: growing
     * incrementally re-charges memory units on every chunk. total_sz sits at
     * byte 0x2C of fly_topology_hdr_t, which the first chunk carries. */
    if (offset == 0) {
        uint32_t total = TSDK_LOAD(uint32_t, data + sizeof(upload_args_t) + 0x2C);
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
        if (tsys_account_resize(acct_idx, sizeof(fly_neuron_t)) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);

        fly_neuron_t *nd = (fly_neuron_t *)tsdk_get_account_data_ptr(acct_idx);
        memset(nd, 0, sizeof(*nd));
        nd->index = neuron_ix;
        memcpy(nd->name, name, 8);
    }
    tsdk_return(TSDK_SUCCESS);
}

/* Topology, reservoir and behavior are program-owned accounts with no neuron
 * header. The reservoir must ALSO be funded: reconciliation transfers against
 * it, and an empty reservoir fails with INSUFFICIENT_BALANCE. */
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

/* min_size is a FLOOR, not the actual size -- this always grows to at least
 * sizeof(fly_scratch_t) regardless of what the caller asks for, so deploy.py
 * does not need to know the C struct's exact byte count, and an upgrade that
 * changes the size self-heals the next time reset runs. */
static void do_resize_scratch(uchar const *data, ulong sz) {
    if (sz != sizeof(resize_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t acct_idx = TSDK_LOAD(uint16_t, data + 4);
    uint32_t min_size = TSDK_LOAD(uint32_t, data + 6);
    uint32_t size = min_size < (uint32_t)sizeof(fly_scratch_t)
                  ? (uint32_t)sizeof(fly_scratch_t) : min_size;
    if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    if (tsys_account_resize(acct_idx, size) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    unsigned char *d = (unsigned char *)tsdk_get_account_data_ptr(acct_idx);
    memset(d, 0, size);
    tsdk_return(TSDK_SUCCESS);
}

/* ----------------------------------------------------------- binding -- */

/* Thru sorts the ENTIRE writable account array ascending by address, so the
 * singletons do NOT land at fixed indices -- they interleave with the neurons
 * wherever their addresses happen to sort. The client knows the sort order and
 * passes the three singleton slots in the instruction data. Everything else in
 * the writable array is a neuron, identified by the index field in its own
 * data rather than by a position we assumed. */
static void bind_accounts(uint16_t a_topo, uint16_t a_res, uint16_t a_beh,
                          fly_scratch_t **out_scratch) {
    if (tsys_set_account_data_writable(a_res) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    fly_scratch_t *scratch = (fly_scratch_t *)tsdk_get_account_data_ptr(a_res);
    *out_scratch = scratch;

    if (tsys_set_account_data_writable(a_topo) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    void const *topo = tsdk_get_account_data_ptr(a_topo);
    fly_sim_bind(&scratch->sim, topo, scratch->v, scratch->syn,
                 scratch->refrac, scratch->spikes);
    if (scratch->sim.hdr->magic != FLY_MAGIC) tsdk_revert(ERR_BAD_MAGIC);
    if (scratch->sim.hdr->n_neurons > N_NEURONS) tsdk_revert(ERR_ACCOUNT_COUNT);
    if (scratch->sim.p->rate_window > RATE_WINDOW_MAX) tsdk_revert(ERR_BAD_MAGIC);

    tsdk_txn_t const *txn = tsdk_get_txn();
    ulong n_rw = tsdk_txn_readwrite_account_cnt(txn);
    uint32_t found = 0;
    for (ulong slot = 2; slot < 2 + n_rw; slot++) {
        if (slot == a_topo || slot == a_res || slot == a_beh) continue;
        if (tsys_set_account_data_writable((uint16_t)slot) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        fly_neuron_t const *nd =
            (fly_neuron_t const *)tsdk_get_account_data_ptr((uint16_t)slot);
        if (nd->index >= scratch->sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
        scratch->neuron_to_slot[nd->index] = (uint16_t)slot;
        found++;
    }
    if (found != scratch->sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
}

/* Account DATA is the simulation's source of truth -- it resolves Q16.16,
 * about 1.5e-5 of a threshold. Balance resolves 1/BAL_SCALE and is the settled
 * projection; reconstructing v from it would cap precision there and make the
 * bit-for-bit assert against native C mathematically impossible. */
static void load_state(fly_scratch_t *scratch) {
    for (uint32_t i = 0; i < scratch->sim.hdr->n_neurons; i++) {
        fly_neuron_t const *nd = (fly_neuron_t const *)
            tsdk_get_account_data_ptr(scratch->neuron_to_slot[i]);
        scratch->v[i]      = nd->v;
        scratch->syn[i]    = nd->syn;
        scratch->refrac[i] = nd->refrac;
    }
}

/* `tag` is the ABSOLUTE simulated step this transaction advanced to -- the
 * behavior account's clock plus this call's own progress. A neuron whose
 * step_tag is already AHEAD of it is being overwritten with a stale voltage,
 * which is what a replayed or raced transaction looks like. `force` (reset)
 * bypasses it, because reset is deliberately rewinding to tag 0. */
static void store_state(fly_scratch_t *scratch, uint32_t tag, int force) {
    for (uint32_t i = 0; i < scratch->sim.hdr->n_neurons; i++) {
        uint16_t slot = scratch->neuron_to_slot[i];
        if (tsys_set_account_data_writable(slot) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        fly_neuron_t *nd = (fly_neuron_t *)tsdk_get_account_data_ptr(slot);
        if (!force && nd->step_tag > tag) tsdk_revert(ERR_STALE_STEP_TAG);
        nd->v        = scratch->v[i];
        nd->syn      = scratch->syn[i];
        nd->refrac   = scratch->refrac[i];
        nd->step_tag = tag;
    }
}

/* ------------------------------------------------------------- readout -- */

/* Advance the spike-history ring by one tick and keep the per-neuron counts
 * in step. Counts are maintained incrementally rather than recomputed: the
 * window is 50 ticks deep and a settlement can be a few hundred ticks long. */
static void record_spikes(fly_scratch_t *scratch) {
    uint32_t const N = scratch->sim.hdr->n_neurons;
    uint32_t const W = scratch->sim.p->rate_window;
    uint32_t slot = scratch->hist_pos;
    for (uint32_t i = 0; i < N; i++) {
        if (scratch->hist_filled >= W && scratch->history[slot][i])
            scratch->count[i]--;
        scratch->history[slot][i] = scratch->spikes[i];
        if (scratch->spikes[i]) scratch->count[i]++;
    }
    scratch->hist_pos = (slot + 1u) % W;
    if (scratch->hist_filled < W) scratch->hist_filled++;
}

/* Mean EPG rate per wedge, in Q16.16 Hz -- metrics.wedge_rates, on chain. A
 * wedge with no EPG cell would divide by zero; the connectome guarantees every
 * wedge is occupied and pack.py asserts it, so a zero count here means the
 * topology is not the one this program was built for. */
static void wedge_rates(fly_scratch_t *scratch, int32_t *rate) {
    uint32_t const N = scratch->sim.hdr->n_neurons;
    uint32_t const NW = scratch->sim.hdr->n_wedges;
    fly_param_t const *p = scratch->sim.p;

    for (uint32_t w = 0; w < NW; w++) rate[w] = 0;
    uint32_t seen[N_WEDGES];
    for (uint32_t w = 0; w < NW; w++) seen[w] = 0;

    /* count -> Hz: count * 1000 / (window * dt_ms), carried in Q16.16. dt is
     * itself Q16.16 ms, hence the extra Q16 in the numerator. */
    int64_t denom = (int64_t)p->rate_window * (int64_t)p->dt;
    if (denom <= 0) tsdk_revert(ERR_BAD_MAGIC);

    for (uint32_t i = 0; i < N; i++) {
        if (scratch->sim.cls[i] != CLS_EPG) continue;
        uint32_t w = scratch->sim.wedge[i];
        if (w >= NW) tsdk_revert(ERR_ACCOUNT_COUNT);
        int64_t hz = ((int64_t)scratch->count[i] * 1000 * Q16 * Q16) / denom;
        rate[w] += (int32_t)hz;
        seen[w]++;
    }
    for (uint32_t w = 0; w < NW; w++) {
        if (!seen[w]) tsdk_revert(ERR_ACCOUNT_COUNT);
        rate[w] /= (int32_t)seen[w];
    }
}

/* ---------------------------------------------------------------- step -- */

static void read_input(fly_behavior_t const *b, fly_input_t *in) {
    in->drive_l          = b->drive_l;
    in->drive_r          = b->drive_r;
    in->landmark_current = b->landmark_current;
    in->landmark_wedge   = b->landmark_wedge;
    in->landmark_active  = b->landmark_active;
}

static void do_step(uchar const *data, ulong sz) {
    if (sz != sizeof(step_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint32_t n_steps       = TSDK_LOAD(uint32_t, data + 4);
    uint32_t flags         = TSDK_LOAD(uint32_t, data + 8);
    uint32_t settle_every  = TSDK_LOAD(uint32_t, data + 12);
    uint16_t acc_topology  = TSDK_LOAD(uint16_t, data + 16);
    uint16_t acc_reservoir = TSDK_LOAD(uint16_t, data + 18);
    uint16_t acc_behavior  = TSDK_LOAD(uint16_t, data + 20);

    fly_scratch_t *scratch;
    bind_accounts(acc_topology, acc_reservoir, acc_behavior, &scratch);

    /* Freshly created accounts hold v = 0, which for this model is v_reset and
     * not a state any ring settles out of: a flat zero never breaks symmetry
     * and no bump forms. Reset seeds from the topology's baked v0 instead, and
     * lets reconciliation push real balance into every neuron -- that first
     * settlement is what makes the accounts' balances non-zero. */
    if (flags & 4u) fly_sim_reset(&scratch->sim);
    else            load_state(scratch);

    if (tsys_set_account_data_writable(acc_behavior) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    fly_behavior_t *beh = (fly_behavior_t *)tsdk_get_account_data_ptr(acc_behavior);
    if (flags & 4u) {
        /* A reset that cleared the steering would make every experiment start
         * by restating it. The ring's state resets; the input does not. */
        int32_t dl = beh->drive_l, dr = beh->drive_r, lc = beh->landmark_current;
        uint16_t lw = beh->landmark_wedge;
        uint8_t la = beh->landmark_active;
        memset(beh, 0, sizeof(*beh));
        beh->drive_l = dl;
        beh->drive_r = dr;
        beh->landmark_current = lc;
        beh->landmark_wedge = lw;
        beh->landmark_active = la;
        scratch->hist_pos = scratch->hist_filled = 0;
        for (uint32_t i = 0; i < scratch->sim.hdr->n_neurons; i++) scratch->count[i] = 0;
    }
    uint32_t const step0 = beh->step;

    fly_input_t in;
    read_input(beh, &in);

    uint32_t done = 0;
    do {
        uint32_t chunk = settle_every ? settle_every : n_steps;
        if (chunk > n_steps - done) chunk = n_steps - done;
        /* One tick at a time, so the spike history the readout averages sees
         * every tick rather than only the last of each chunk. */
        for (uint32_t k = 0; k < chunk; k++) {
            fly_step(&scratch->sim, 1, &in);
            record_spikes(scratch);
        }
        done += chunk;
        if (flags & 2u) emit_trace(scratch, step0 + done, acc_behavior);
        if (flags & (1u | 8u))
            settle_transfers(scratch, flags, acc_reservoir, step0 + done);
    } while (done < n_steps);

    beh->step = step0 + done;
    store_state(scratch, beh->step, (flags & 4u) != 0);
    tsdk_return(TSDK_SUCCESS);
}

static void do_drive(uchar const *data, ulong sz) {
    if (sz != sizeof(drive_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    int32_t  drive_l   = TSDK_LOAD(int32_t,  data + 4);
    int32_t  drive_r   = TSDK_LOAD(int32_t,  data + 8);
    int32_t  lm_cur    = TSDK_LOAD(int32_t,  data + 12);
    uint16_t lm_wedge  = TSDK_LOAD(uint16_t, data + 16);
    uint8_t  lm_active = TSDK_LOAD(uint8_t,  data + 18);
    uint16_t acc_behavior = TSDK_LOAD(uint16_t, data + 24);

    if (tsys_set_account_data_writable(acc_behavior) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    fly_behavior_t *b = (fly_behavior_t *)tsdk_get_account_data_ptr(acc_behavior);
    b->drive_l          = drive_l;
    b->drive_r          = drive_r;
    b->landmark_current = lm_cur;
    b->landmark_wedge   = lm_wedge;
    b->landmark_active  = lm_active;
    tsdk_return(TSDK_SUCCESS);
}

/* ----------------------------------------------------------- classify -- */

/* Which way the bump moved, from the sign of the cross product between the
 * previous population vector and this one. No angle, no atan2, no wrap-around
 * special case: a rotation counterclockwise has a positive cross product all
 * the way round the ring.
 *
 * TURN_FLOOR is a deadband. The population vector jitters by a fraction of a
 * wedge even when the bump is pinned, and a bare sign test would report the
 * fly turning back and forth at the tick rate, which reads as broken however
 * correct the voltages underneath are. */
#define TURN_FLOOR ((int64_t)Q16 * 4)

static void do_classify(uchar const *data, ulong sz) {
    if (sz != sizeof(classify_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    uint16_t acc_topology  = TSDK_LOAD(uint16_t, data + 4);
    uint16_t acc_reservoir = TSDK_LOAD(uint16_t, data + 6);
    uint16_t acc_behavior  = TSDK_LOAD(uint16_t, data + 8);

    fly_scratch_t *scratch;
    bind_accounts(acc_topology, acc_reservoir, acc_behavior, &scratch);
    load_state(scratch);

    int32_t rate[N_WEDGES];
    wedge_rates(scratch, rate);

    int32_t x = 0, y = 0;
    fly_heading(&scratch->sim, rate, &x, &y);
    int64_t sum = 0;
    for (uint32_t w = 0; w < scratch->sim.hdr->n_wedges; w++) sum += rate[w];

    if (tsys_set_account_data_writable(acc_behavior) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);
    fly_behavior_t *b = (fly_behavior_t *)tsdk_get_account_data_ptr(acc_behavior);

    int64_t cross = (int64_t)b->bump_x * y - (int64_t)b->bump_y * x;
    uint8_t next = b->turning;
    if (b->bump_x || b->bump_y) {
        if      (cross >  TURN_FLOOR * Q16) next = 1u;   /* counterclockwise */
        else if (cross < -TURN_FLOOR * Q16) next = 2u;   /* clockwise */
        else                                next = 0u;   /* holding */
    }
    if (next != b->turning) { b->turning = next; b->entered_at = b->step; }

    b->bump_x     = x;
    b->bump_y     = y;
    b->rate_sum   = (int32_t)sum;
    b->block_time = tsdk_get_current_block_ctx()->block_time;
    tsdk_return(TSDK_SUCCESS);
}

/* ------------------------------------------------------------- events -- */

/* One event per traced frame. Potentials are scaled by V_TRACE_SCALE and
 * truncated (>> 16 floors, matching every other conversion here) -- the
 * front-end draws them, it does not simulate from them, and `v` in account
 * data remains the Q16.16 source of truth. */
static void emit_trace(fly_scratch_t *scratch, uint32_t step, uint16_t acc_behavior) {
    uint32_t const N = scratch->sim.hdr->n_neurons;
    scratch->trace.type = FLY_EVENT_TRACE;
    for (uint32_t i = 0; i < N; i++) {
        int64_t scaled = ((int64_t)scratch->v[i] * V_TRACE_SCALE) >> 16;
        if (scaled >  32767) scaled =  32767;
        if (scaled < -32768) scaled = -32768;
        scratch->trace.frame.v[i] = (int16_t)scaled;
    }
    memset(scratch->trace.frame.spikes, 0, SPIKE_BYTES);
    for (uint32_t i = 0; i < N; i++)
        if (scratch->spikes[i])
            scratch->trace.frame.spikes[i >> 3] |= (uint8_t)(1u << (i & 7u));

    fly_behavior_t const *b =
        (fly_behavior_t const *)tsdk_get_account_data_ptr(acc_behavior);
    scratch->trace.frame.step    = step;
    scratch->trace.frame.bump_x  = b->bump_x;
    scratch->trace.frame.bump_y  = b->bump_y;
    scratch->trace.frame.turning = b->turning;
    scratch->trace.frame.end     = FLY_EVENT_END;
    tsys_emit_event((uchar const *)&scratch->trace, sizeof(scratch->trace));
}

/* Potential -> settled balance PROJECTION: balance = (v + BAL_OFFSET_V) *
 * BAL_SCALE. NEVER invert this to recover v. The clamp at zero only stops a
 * uint64 wraparound if inhibition ever drives a neuron below -BAL_OFFSET_V. */
static uint64_t v_to_balance(int32_t v_q16) {
    int64_t num = (int64_t)v_q16 + (int64_t)BAL_OFFSET_V * Q16;
    if (num < 0) num = 0;
    return (uint64_t)((num * BAL_SCALE) / Q16);
}

/* A spike is the one conservative event in this model: the charge a neuron
 * delivers is charge it no longer has. So a spike settles as real transfers,
 * one per synapse it crossed, in the direction the current flowed -- an
 * excitatory synapse moves balance from the cell that fired to the cell it
 * drives, an inhibitory one the other way, because inhibition takes charge OUT
 * of the postsynaptic cell.
 *
 * Leak is not conservative and neither is the external drive, so whatever the
 * spike pass did not move is reconciled against the reservoir afterwards. The
 * two ledger operations match the two physics; that is the claim on stage.
 *
 * Order matters when both flags fire: transfers run FIRST, reconciliation
 * SECOND and only makes up the difference. Reconciling first would push every
 * neuron to v_to_balance(v) and the spike pass would immediately pull balance
 * back off that exact value, double counting. */
static void settle_transfers(fly_scratch_t *scratch, uint32_t flags,
                             uint16_t acc_reservoir, uint32_t step) {
    uint32_t const N = scratch->sim.hdr->n_neurons;
    uint32_t n_xfer = 0;

    if (flags & 8u) {
        for (uint32_t pre = 0; pre < N; pre++) {
            if (!scratch->spikes[pre]) continue;
            for (uint32_t post = 0; post < N; post++) {
                int32_t w = scratch->sim.W[pre * N + post];
                if (!w) continue;
                int64_t mag = w < 0 ? -(int64_t)w : (int64_t)w;
                uint64_t amt = (uint64_t)((mag * BAL_SCALE) / Q16);
                if (amt == 0) continue;     /* under the rounding floor */

                uint16_t sp = scratch->neuron_to_slot[pre];
                uint16_t sq = scratch->neuron_to_slot[post];
                uint16_t from = (w > 0) ? sp : sq;
                uint16_t to   = (w > 0) ? sq : sp;

                /* Native balance is uint64 and cannot go negative -- skip
                 * rather than revert if this would breach the floor. There
                 * are hundreds of other synapses to show. */
                if (tsdk_get_account_meta(from)->balance < amt + BAL_MIN) continue;
                if (tsys_account_transfer(from, to, amt) != TSDK_SUCCESS)
                    tsdk_revert(ERR_TRANSFER_FAILED);

                /* Recorded AFTER the transfer succeeds, so the event describes
                 * what the ledger did rather than what this loop intended --
                 * the skips above are exactly where the two would differ. */
                if (n_xfer >= XFER_MAX) tsdk_revert(ERR_XFER_OVERFLOW);
                scratch->xfers.xfer[n_xfer].pre    = (uint16_t)((w > 0) ? pre : post);
                scratch->xfers.xfer[n_xfer].post   = (uint16_t)((w > 0) ? post : pre);
                scratch->xfers.xfer[n_xfer].amount = (int32_t)amt;
                n_xfer++;
            }
        }

        /* The per-synapse record the receipt does not carry: `thru txn
         * execute` reports no per-operation trace, so without this event
         * nothing off-chain can see WHICH synapses moved charge, only that
         * some balance changed. */
        if (n_xfer) {
            scratch->xfers.type  = FLY_EVENT_SPIKE;
            scratch->xfers.step  = step;
            scratch->xfers.count = n_xfer;
            /* The terminator travels with the LAST transfer, not the end of
             * the fixed array -- a small amount ends in zero bytes and the
             * runtime would trim them off the wire. */
            *(uchar *)&scratch->xfers.xfer[n_xfer] = (uchar)FLY_EVENT_END;
            tsys_emit_event((uchar const *)&scratch->xfers, FLY_XFER_EVENT_SZ(n_xfer));
        }
    }

    if (flags & 1u) {
        for (uint32_t i = 0; i < N; i++) {
            uint16_t slot = scratch->neuron_to_slot[i];
            uint64_t want = v_to_balance(scratch->v[i]);
            uint64_t have = tsdk_get_account_meta(slot)->balance;
            if (want == have) continue;
            if (want > have) {
                uint64_t amt = want - have;
                if (tsdk_get_account_meta(acc_reservoir)->balance < amt) continue;
                if (tsys_account_transfer(acc_reservoir, slot, amt) != TSDK_SUCCESS)
                    tsdk_revert(ERR_TRANSFER_FAILED);
            } else {
                uint64_t amt = have - want;
                /* Leave BAL_MIN headroom so a later hyperpolarising transfer
                 * always has somewhere to come from. */
                if (have < amt + BAL_MIN) continue;
                if (tsys_account_transfer(slot, acc_reservoir, amt) != TSDK_SUCCESS)
                    tsdk_revert(ERR_TRANSFER_FAILED);
            }
        }
    }
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
        case INSTR_STEP:              do_step(data, sz); break;
        case INSTR_DRIVE:             do_drive(data, sz); break;
        case INSTR_CLASSIFY:          do_classify(data, sz); break;
        case INSTR_RESIZE_SCRATCH:    do_resize_scratch(data, sz); break;
        default:                      tsdk_revert(ERR_BAD_INSTR_TYPE);
    }
    tsdk_return(TSDK_SUCCESS);
}
