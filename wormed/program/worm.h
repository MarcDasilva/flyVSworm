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
#define INSTR_UPLOAD_CHUNK    1u
#define INSTR_CREATE_NEURONS  2u
#define INSTR_STIMULATE       3u
#define INSTR_STEP            4u
#define INSTR_CLASSIFY        5u

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

typedef struct {
    int16_t g_leak;    /* Q8.8 */
    int16_t E_leak_mV;
    int16_t C;         /* Q8.8 */
    int16_t V_half_mV;
    int16_t k_recip;   /* Q8.8 reciprocal of slope — no division in the hot loop */
    int16_t _pad[3];
} worm_param_t;        /* 16 bytes */

/* Per-neuron account data. Voltage lives in the account BALANCE, not here. */
typedef struct {
    uint16_t index;
    char     name[8];
    uint16_t _pad0;
    int32_t  v_next;   /* Q16.16 mV */
    int32_t  i_stim;   /* Q16.16 */
    uint32_t step_tag;
    uint32_t _pad1;
} worm_neuron_t;       /* 32 bytes */

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

/* Voltage <-> native balance. uint64 balance cannot go negative; biological
 * voltage can. The +100mV offset is what makes hyperpolarizing transfers safe. */
#define BAL_OFFSET_MV   100
#define BAL_SCALE       1000
#define BAL_MIN         1000u
#define BAL_MAX         200000u
#endif
