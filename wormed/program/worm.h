#ifndef WORM_H
#define WORM_H
#include <stdint.h>

#define WORM_MAGIC        0x574F524Du  /* "WORM" */
#define WORM_VERSION      1u
#define N_NEURONS         302
#define N_CHEM            2600  /* upper bound; real count in the header */
#define N_GAP             1100  /* both directions stored */
#define LUT_ENTRIES       257

/* Instruction discriminants. Little-endian u32 at instruction_data[0..4). */
#define INSTR_UPLOAD_CHUNK       1u
#define INSTR_CREATE_NEURONS     2u
#define INSTR_STIMULATE          3u
#define INSTR_STEP               4u
#define INSTR_CLASSIFY           5u
#define INSTR_CREATE_SINGLETONS  6u
#define INSTR_RESIZE_SCRATCH     7u
#define INSTR_SETTLE_SYNAPSE     8u

/* Error codes. Returned via tsdk_revert(). */
#define ERR_BAD_INSTR_SIZE    0x1001u
#define ERR_BAD_INSTR_TYPE    0x1002u
#define ERR_BAD_MAGIC         0x1003u
#define ERR_RESIZE_FAILED     0x1004u
#define ERR_STALE_STEP_TAG    0x1005u
#define ERR_ACCOUNT_COUNT     0x1006u
#define ERR_TRANSFER_FAILED   0x1007u
#define ERR_XFER_OVERFLOW     0x1008u
#define ERR_PENDING_SYNAPSES  0x1009u
#define ERR_BAD_SYNAPSE       0x100Au

/* Persistent outbox. Each nonzero current settlement has exactly one entry
 * and must be executed by its own INSTR_SETTLE_SYNAPSE transaction. */
#define SYNAPSE_MAGIC 0x53594e50u
#define SYNAPSE_CAPACITY 32768u
typedef struct {
    uint32_t step;
    uint16_t pre, post;
    int32_t amount;       /* chemical: signed reservoir -> post; gap: pre -> post */
    uint8_t kind;         /* 0 = electrical, 1 = chemical */
    uint8_t settled;
    uint16_t _pad;
} worm_synapse_t;
_Static_assert(sizeof(worm_synapse_t) == 16, "synapse outbox wire size");

/* Topology header. EVERY array below starts 8-byte aligned — ThruVM faults on
 * unaligned access AND on any access spanning a 4KB page boundary. 4096 is a
 * multiple of 8, so 8-alignment defeats both. pack.py asserts it. */
typedef struct {
    uint32_t magic;          /* 0x00 */
    uint32_t version;        /* 0x04 */
    uint32_t n_neurons;      /* 0x08 */
    uint32_t n_chem;         /* 0x0C */
    uint32_t n_gap;          /* 0x10 */
    uint32_t off_slot_map;   /* 0x14  u16[n_neurons]   */
    uint32_t off_chem_rowptr;/* 0x18  u32[n_neurons+1] */
    uint32_t off_chem_col;   /* 0x1C  u16[n_chem]      */
    uint32_t off_chem_g;     /* 0x20  i16[n_chem] Q8.8 */
    uint32_t off_chem_E;     /* 0x24  i16[n_chem] mV   */
    uint32_t off_gap_rowptr; /* 0x28  u32[n_neurons+1] */
    uint32_t off_gap_col;    /* 0x2C  u16[n_gap]       */
    uint32_t off_gap_g;      /* 0x30  i16[n_gap] Q8.8  */
    uint32_t off_params;     /* 0x34  worm_param_t[n]  */
    uint32_t off_lut;        /* 0x38  i32[257] Q16.16  */
    uint32_t total_sz;       /* 0x3C */
} worm_topology_hdr_t;       /* 64 bytes, naturally aligned, NOT packed */
_Static_assert(sizeof(worm_topology_hdr_t) == 64,
    "worm_topology_hdr_t size drifted from 64 bytes — HDR_SZ in pipeline/pack.py is hardcoded to match");

typedef struct {
    int16_t g_leak;    /* Q8.8 */
    int16_t E_leak_mV;
    int16_t C;         /* Q8.8 */
    int16_t V_half_mV;
    int16_t k_recip;   /* Q8.8 reciprocal of slope — no division in the hot loop */
    int16_t V_rest_mV; /* MEASURED steady state at zero input, not E_leak. The
                         * presynaptic sigmoid is not closed at leak potential,
                         * so a well-connected neuron's true fixed point sits
                         * well off E_leak (pipeline/refsim.py:
                         * compute_resting_state). The classifier normalises
                         * drive against this baseline — using E_leak instead
                         * reads nonzero drive with nobody touching the worm. */
    int16_t _pad[2];
} worm_param_t;        /* 16 bytes */
_Static_assert(sizeof(worm_param_t) == 16,
    "worm_param_t size drifted from 16 bytes — pipeline/pack.py's _pack_params struct format assumes this");

/* Per-neuron account data. Voltage lives in the account BALANCE, not here.
 *
 * FIX ROUND 1 (Task 9 finding 2): this was commented "32 bytes" but the
 * natural-alignment layout below sums to 28 (2+8+2+4+4+4+4), which is what
 * every one of the 302 on-chain accounts actually reports as dataSize — the
 * code was always correct (it resizes with sizeof()), only the comment
 * lied. DO NOT change this layout: 302 accounts already exist on chain with
 * it, and re-creating them is not something anyone wants to pay for. */
typedef struct {
    uint16_t index;
    char     name[8];
    uint16_t _pad0;
    int32_t  v_next;   /* Q16.16 mV */
    int32_t  i_stim;   /* Q16.16 */
    uint32_t step_tag;
    uint32_t _pad1;
} worm_neuron_t;       /* 28 bytes */
_Static_assert(sizeof(worm_neuron_t) == 28,
    "worm_neuron_t size drifted from 28 bytes — 302 accounts already exist on chain with this layout, do not change it");

typedef struct {
    uint8_t  state;      /* 0=PAUSE 1=FORWARD 2=REVERSE 3=OMEGA */
    uint8_t  _pad[3];
    int32_t  gain;       /* Q16.16 */
    int32_t  drive_fwd;  /* Q16.16 */
    int32_t  drive_rev;  /* Q16.16 */
    uint32_t entered_at;
    uint32_t step;
    uint64_t block_time; /* Unix ns, from BLOCK_CTX */
} worm_behavior_t;       /* 32 bytes */
_Static_assert(sizeof(worm_behavior_t) == 32,
    "worm_behavior_t size drifted from 32 bytes — pipeline/deploy.py's create_singletons() hardcodes this size");

/* TASK-12 PLATFORM FINDING, verified against a live alphanet transaction, and
 * AMENDED BY TASK 15: an emitted buffer does not reach every consumer whole.
 * `thru txn get` splits it — the FIRST 8 BYTES become the receipt's
 * `event_type` (little-endian u64) and never appear in `events[].data`, and
 * TRAILING ZERO BYTES are stripped from what remains. A 612-byte trace whose
 * first field was mV[0] came back as 597 bytes starting at mV[4]: four
 * voltages read as the type field, the seven zero bytes of the tail trimmed,
 * and nothing anywhere reporting an error. Both event structs below therefore
 * open with an explicit 8-byte type tag (which IS the discriminator the
 * explorer and the front-end switch on — no in-payload magic needed) and
 * close with a NON-ZERO terminator, so nothing can be trimmed. The receipt's
 * `events_size` counts the emitted buffer. */
#define WORM_EVENT_TRACE 0x454352544d524f57ull   /* "WORMTRCE" */
#define WORM_EVENT_XFER  0x585041474d524f57ull   /* "WORMGAPX" */
#define WORM_EVENT_SYNAPSE 0x584e59534d524f57ull /* "WORMSYNX" */
#define WORM_EVENT_END   0xA5u       /* never zero — see the finding above */

/* One frame of the whole brain as int16 millivolts, then the absolute step
 * and the behavior state. Streaming this beats polling 302 accounts by every
 * measure the front-end cares about.
 *
 * THE TWO TRANSPORTS DISAGREE ABOUT WHERE mV STARTS, and only the in-payload
 * tag makes them safe to write against (TASK-15, measured on alphanet):
 *   - `thru txn get` (pipeline/deploy.py's read_events): the leading tag is
 *     split off into `event_type`, so mV is at byte 0 of `events[].data`.
 *   - the gRPC event stream (web/src/chain.ts): the node delivers the WHOLE
 *     emitted buffer, tag included — 620 bytes beginning 574f524d54524345 —
 *     so mV is at byte 8. StreamEventsResponse has no `event_type` field at
 *     all.
 * Both readers are correct for their own transport. mV stays immediately
 * after the tag so the browser can build an Int16Array VIEW at offset 8
 * instead of copying; do not put another field in front of it. */
typedef struct __attribute__((packed)) {
    int16_t  mV[N_NEURONS];
    uint32_t step;
    uint8_t  state;
    uint8_t  _pad[2];
    uint8_t  end;      /* WORM_EVENT_END */
} worm_trace_t;
_Static_assert(sizeof(worm_trace_t) == N_NEURONS * 2 + 8,
    "worm_trace_t must stay 612 bytes — pipeline/test_chain.py and the published ABI both pin it");

typedef struct __attribute__((packed)) {
    uint64_t     type;    /* WORM_EVENT_TRACE — consumed as event_type */
    worm_trace_t frame;
} worm_trace_event_t;

/* One settled gap-junction transfer. `amount` is native balance units and is
 * always positive: direction is carried by which neuron is pre and which is
 * post, so a consumer can sum -amount/+amount per neuron and get exactly the
 * balance delta the chain applied. */
typedef struct __attribute__((packed)) {
    uint16_t pre;      /* dense neuron index that LOST the units */
    uint16_t post;     /* dense neuron index that gained them */
    int32_t  amount;
} worm_xfer_t;
_Static_assert(sizeof(worm_xfer_t) == 8, "worm_xfer_t must stay 8 bytes — the ABI and the front-end both decode 8-byte triples");

/* The gap CSR stores both directions, so the real pair count is N_GAP/2 and
 * a settlement can never report more transfers than that. */
#define XFER_MAX (N_GAP / 2)

/* Variable length: only the first `count` triples are emitted, and the
 * terminator moves with them — worm.c writes it at xfer[count]. */
typedef struct __attribute__((packed)) {
    uint64_t    type;     /* WORM_EVENT_XFER — consumed as event_type */
    uint32_t    step;
    uint32_t    count;
    worm_xfer_t xfer[XFER_MAX];
    uint8_t     end;      /* WORM_EVENT_END, relocated to follow xfer[count] */
} worm_xfer_event_t;
#define WORM_XFER_EVENT_SZ(count) (8u + 4u + 4u + (count) * 8u + 1u)

/* Voltage <-> native balance. uint64 balance cannot go negative; biological
 * voltage can. The +100mV offset is what makes hyperpolarizing transfers safe.
 *
 * TASK-9 R14: scale dropped from 1000 to 10. At 1000 a neuron holds
 * 20,000-120,000 units and the whole brain needs 10-36M — over a thousand
 * 10,000-unit faucet withdrawals to fund. At 10 a neuron holds ~400 and the
 * brain ~120,000, fundable in ~20 withdrawals. Safe because account DATA
 * v_next (Q16.16) is the simulation's source of truth; balance is only the
 * settled projection — see worm_neuron_t above. */
#define BAL_OFFSET_MV   100
#define BAL_SCALE       10
#define BAL_MIN         10u
#define BAL_MAX         2000u
#endif
