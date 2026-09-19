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

/* Error codes. Returned via tsdk_revert(). */
#define ERR_BAD_INSTR_SIZE    0x1001u
#define ERR_BAD_INSTR_TYPE    0x1002u
#define ERR_BAD_MAGIC         0x1003u
#define ERR_RESIZE_FAILED     0x1004u
#define ERR_STALE_STEP_TAG    0x1005u
#define ERR_ACCOUNT_COUNT     0x1006u
#define ERR_TRANSFER_FAILED   0x1007u

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
