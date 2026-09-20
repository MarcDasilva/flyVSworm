/* fly_brain - the fruit fly heading circuit on Thru.

   A wallet per neuron, a transaction per synapse (the user's design):
     brain account    one per brain: the manifest hash it is being written from, the authority
                      allowed to write it, and how many neurons and synapses have been recorded.
                      Every write carries its row index and must equal that count, so a retried
                      transaction (over 114,854 of them, some will be retried) reverts instead of
                      recording a duplicate, and resuming is exactly "start at the count".
     neuron account   one per neuron, a program-derived account seeded from its hemibrain body ID
     synapse          not an account: each synapse is one ADD_SYNAPSE transaction, which emits an
                      event carrying it and bumps the counters. The history holds every synapse ever
                      recorded (past wiring included); the accounts hold the current totals, and an
                      indexer rebuilds the wiring from the events.

   Layouts are little-endian and packed; data/chain_manifest.npz is the off-chain source of truth
   (python/chain_manifest.py), and the ABI in chain/fly_brain.abi.yaml mirrors these structs. */
#ifndef TN_FLY_BRAIN_H
#define TN_FLY_BRAIN_H

#include <thru-sdk/c/tn_sdk.h>

/* The SDK defines uchar/ushort/uint/ulong but no signed char alias, and wedge and sign are signed. */
typedef signed char tn_schar;

/* Errors */
#define TN_FLY_ERR_INSTRUCTION_DATA_SIZE (0x1000UL)
#define TN_FLY_ERR_INSTRUCTION_TYPE      (0x1001UL)
#define TN_FLY_ERR_ACCOUNT_CREATE        (0x1002UL)
#define TN_FLY_ERR_ACCOUNT_WRITABLE      (0x1003UL)
#define TN_FLY_ERR_ACCOUNT_RESIZE        (0x1004UL)
#define TN_FLY_ERR_ACCOUNT_DATA          (0x1005UL)
#define TN_FLY_ERR_ACCOUNT_MISSING       (0x1006UL)
#define TN_FLY_ERR_ACCOUNT_NOT_OURS      (0x1007UL)
#define TN_FLY_ERR_ACCOUNT_VERSION       (0x1008UL)
#define TN_FLY_ERR_TOO_MANY              (0x1009UL)
#define TN_FLY_ERR_EMIT_EVENT            (0x100AUL)
#define TN_FLY_ERR_NOT_AUTHORITY         (0x100BUL)
#define TN_FLY_ERR_WRONG_INDEX           (0x100CUL)
#define TN_FLY_ERR_BAD_NEURON            (0x100DUL)

/* Instructions */
#define TN_FLY_INSTRUCTION_CREATE_BRAIN  (0U)
#define TN_FLY_INSTRUCTION_CREATE_NEURON (1U)
#define TN_FLY_INSTRUCTION_ADD_SYNAPSE   (2U)

/* Events: version and kind first, as in chain_event.py (kind 1 is its spike block) */
#define TN_FLY_EVENT_VERSION       ((uchar)1U)
#define TN_FLY_EVENT_BRAIN_CREATED ((uchar)2U)
#define TN_FLY_EVENT_NEURON_CREATED ((uchar)3U)
#define TN_FLY_EVENT_SYNAPSE_ADDED ((uchar)4U)

/* Neuron classes, as derive_cx.py assigns them */
#define TN_FLY_CLS_EPG   ((uchar)0U)
#define TN_FLY_CLS_PEN_L ((uchar)1U)
#define TN_FLY_CLS_PEN_R ((uchar)2U)
#define TN_FLY_CLS_D7    ((uchar)3U)
#define TN_FLY_CLS_MAX   ((uchar)3U)

#define TN_FLY_ACCOUNT_VERSION ((uchar)1U)
/* Account kinds: the second byte, so a reader (and the explorer's ABI reflection) can tell which
   layout an account holds. */
#define TN_FLY_ACCOUNT_BRAIN  ((uchar)0U)
#define TN_FLY_ACCOUNT_NEURON ((uchar)1U)

/* ---------------------------------------------------------------- accounts -- */

typedef struct __attribute__((packed)) {
  uchar version;              /* TN_FLY_ACCOUNT_VERSION */
  uchar kind;                 /* TN_FLY_ACCOUNT_BRAIN */
  uchar pad[2];
  uint  neuron_count;         /* neurons recorded so far */
  uint  synapse_count;        /* synapses recorded so far */
  uint  neuron_total;         /* neurons the manifest expects */
  uint  synapse_total;        /* synapses the manifest expects */
  uchar manifest_sha256[32];  /* data/chain_manifest.json content_sha256 */
  uchar authority[32];        /* only this key may add neurons and synapses */
} tn_fly_brain_account_t;

typedef struct __attribute__((packed)) {
  uchar version;              /* TN_FLY_ACCOUNT_VERSION */
  uchar kind;                 /* TN_FLY_ACCOUNT_NEURON */
  uchar cls;                  /* TN_FLY_CLS_* */
  tn_schar wedge;                /* ring wedge 0..15, -1 for D7 */
  tn_schar sign;                 /* +1 excitatory, -1 inhibitory (the neuron's, not the synapse's) */
  uchar pad[3];
  uint  out_count;            /* synapses recorded out of this neuron */
  uint  in_count;             /* synapses recorded into it */
  ulong body_id;              /* hemibrain body ID */
} tn_fly_neuron_account_t;

/* ------------------------------------------------------------ instructions -- */

typedef struct __attribute__((packed)) {
  uint  instruction_type;     /* TN_FLY_INSTRUCTION_CREATE_BRAIN */
  ushort account_index;       /* the brain account to create */
  uchar seed[TN_SEED_SIZE];
  uchar manifest_sha256[32];
  uchar authority[32];
  uint  neuron_total;
  uint  synapse_total;
  uint  proof_size;
  /* proof_data follows */
} tn_fly_create_brain_args_t;

typedef struct __attribute__((packed)) {
  uint  instruction_type;     /* TN_FLY_INSTRUCTION_CREATE_NEURON */
  ushort brain_index;         /* the brain account, writable: its neuron_count is bumped */
  ushort account_index;       /* the neuron account to create */
  uint  index;                /* manifest row: must equal brain->neuron_count */
  uchar seed[TN_SEED_SIZE];
  ulong body_id;
  uchar cls;
  tn_schar wedge;
  tn_schar sign;
  uchar pad;
  uint  proof_size;
  /* proof_data follows */
} tn_fly_create_neuron_args_t;

typedef struct __attribute__((packed)) {
  uint  instruction_type;     /* TN_FLY_INSTRUCTION_ADD_SYNAPSE */
  ushort brain_index;         /* writable: synapse_count is bumped */
  ushort pre_index;           /* writable: the sending neuron's account */
  ushort post_index;          /* writable: the receiving neuron's account */
  ushort pad;
  uint  index;                /* manifest row: must equal brain->synapse_count */
  ulong pre_body_id;          /* must match the pre account: binds the row to its neurons */
  ulong post_body_id;
  int   pre_xyz[3];           /* T-bar location, hemibrain voxels (8 nm) */
  int   post_xyz[3];          /* PSD location */
} tn_fly_add_synapse_args_t;

/* ----------------------------------------------------------------- events -- */

typedef struct __attribute__((packed)) {
  uchar version;
  uchar kind;                 /* TN_FLY_EVENT_BRAIN_CREATED */
  uint  neuron_total;
  uint  synapse_total;
  uchar manifest_sha256[32];
} tn_fly_brain_created_event_t;

typedef struct __attribute__((packed)) {
  uchar version;
  uchar kind;                 /* TN_FLY_EVENT_NEURON_CREATED */
  uchar cls;
  tn_schar wedge;
  tn_schar sign;
  uchar pad[3];
  ulong body_id;
} tn_fly_neuron_created_event_t;

typedef struct __attribute__((packed)) {
  uchar version;
  uchar kind;                 /* TN_FLY_EVENT_SYNAPSE_ADDED */
  uchar pad[6];
  ulong pre_body_id;
  ulong post_body_id;
  int   pre_xyz[3];
  int   post_xyz[3];
} tn_fly_synapse_added_event_t;

#endif /* TN_FLY_BRAIN_H */
