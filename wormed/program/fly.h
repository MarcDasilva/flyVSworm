#ifndef FLY_H
#define FLY_H
#include <stdint.h>

/* The fly's central complex on chain. 56 neurons (connectome.build_procedural:
 * EPG 0-15, PEN_L 16-31, PEN_R 32-47, D7 48-55), one account each, plus a
 * reservoir.
 *
 * WHAT THIS PROGRAM DOES AND DOES NOT CLAIM. The worm's program integrates its
 * own membrane equation on chain; this one does NOT — the fly's spiking model
 * runs in fly-brain/python, and each synaptic event it produces settles here as
 * its own signed transaction. The ledger movement is real and the receipt is
 * real; the arithmetic that produced the event happened off chain. Say so
 * anywhere this is described.
 */

#define FLY_N_NEURONS 56

/* Instruction discriminants. Little-endian u32 at instruction_data[0..4). */
#define FLY_INSTR_CREATE   1u
#define FLY_INSTR_SYNAPSE  2u

/* Error codes, returned via tsdk_revert(). */
#define FLY_ERR_BAD_INSTR_SIZE  0x2001u
#define FLY_ERR_BAD_INSTR_TYPE  0x2002u
#define FLY_ERR_RESIZE_FAILED   0x2003u
#define FLY_ERR_TRANSFER_FAILED 0x2004u
#define FLY_ERR_BAD_SYNAPSE     0x2005u

/* Floor left under every neuron so the NEXT event out of it always has
 * somewhere to come from. A neuron below this is topped up from the reservoir
 * inside the same transaction. */
#define FLY_BAL_MIN 20u

/* Fixed portion of one FLY_INSTR_CREATE record: acct_idx(2) + data_sz(4) +
 * seed(32) + proof_sz(4). Proof bytes follow and vary, so no struct covers a
 * whole record. Deliberately the SAME layout as worm.c's create-singletons
 * record — pipeline/deploy_fly.py packs it with the same code path. */
#define FLY_CREATE_REC_FIXED_SZ (2u + 4u + 32u + 4u)

/* See the TASK-12 note in worm.h: an emitted buffer loses its first eight
 * bytes to `event_type` on one transport and its TRAILING ZEROS on the wire,
 * so every event opens with a tag and closes with a non-zero terminator. */
#define FLY_EVENT_SYNAPSE 0x584e59535f594c46ull  /* "FLY_SYNX" */
#define FLY_EVENT_END     0xA5u

/* 24 bytes, byte-for-byte the shape of worm.h's synapse receipt, so
 * web/src/chain.ts decodes both with one reader. */
typedef struct __attribute__((packed, aligned(8))) {
    uint64_t type;
    uint32_t tick;
    uint16_t pre, post;
    int32_t  amount;   /* signed: negative is inhibitory, charge leaves post */
    uint8_t  kind;     /* 0 = excitatory (pre -> post), 1 = inhibitory (post -> reservoir) */
    uint8_t  pad[2];
    uint8_t  end;      /* FLY_EVENT_END */
} fly_receipt_t;
_Static_assert(sizeof(fly_receipt_t) == 24, "fly receipt wire size");

#endif
