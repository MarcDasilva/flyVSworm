#ifndef FLY_H
#define FLY_H
#include <stdint.h>

#define FLY_MAGIC    0x31594C46u   /* "FLY1" */
#define FLY_VERSION  1u
#define N_NEURONS    134           /* EPG 50, PEN_L 21, PEN_R 21, D7 42 */
#define N_WEDGES     16

/* Neuron classes. Order matches spec/params_hemibrain_avg.json and
 * connectome.py's idx dict; pipeline/pack.py writes it and the classifier
 * below reads it, so the two must not drift. */
#define CLS_EPG   0u
#define CLS_PEN_L 1u
#define CLS_PEN_R 2u
#define CLS_D7    3u

/* Instruction discriminants. Little-endian u32 at instruction_data[0..4). */
#define INSTR_UPLOAD_CHUNK       1u
#define INSTR_CREATE_NEURONS     2u
#define INSTR_DRIVE              3u
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
#define ERR_XFER_OVERFLOW     0x1008u

/* Topology header. EVERY array below starts 8-byte aligned -- ThruVM faults on
 * unaligned access AND on any access spanning a 4KB page boundary. 4096 is a
 * multiple of 8, so 8-alignment defeats both. pack.py asserts it. */
typedef struct {
    uint32_t magic;          /* 0x00 */
    uint32_t version;        /* 0x04 */
    uint32_t n_neurons;      /* 0x08 */
    uint32_t n_wedges;       /* 0x0C */
    uint32_t off_w;          /* 0x10  i32[n*n] Q16.16, W[pre][post]        */
    uint32_t off_class;      /* 0x14  u8[n]   CLS_*                        */
    uint32_t off_wedge;      /* 0x18  u8[n]   which of n_wedges            */
    uint32_t off_landmark;   /* 0x1C  i32[n_wedges*n] Q16.16 footprints    */
    uint32_t off_v0;         /* 0x20  i32[n]  Q16.16 reset potentials      */
    uint32_t off_sincos;     /* 0x24  i32[2*n_wedges] Q16.16: cos then sin */
    uint32_t off_params;     /* 0x28  fly_param_t                          */
    uint32_t total_sz;       /* 0x2C */
    uint32_t _pad[4];        /* 0x30..0x40: keeps the header 64 bytes so the
                              * first array starts 8-aligned whatever follows */
} fly_topology_hdr_t;        /* 64 bytes, naturally aligned, NOT packed */
_Static_assert(sizeof(fly_topology_hdr_t) == 64,
    "fly_topology_hdr_t size drifted from 64 bytes -- HDR_SZ in pipeline/pack.py is hardcoded to match");

/* The model's global parameters, in the fixed-point form the step uses.
 *
 * The update is written as (I - v*inv_tau) * dt, one multiply per factor, in
 * that order -- NOT folded into I*dt - v*(dt/tau). The two are algebraically
 * equal and numerically different, and pipeline/refsim.py performs this exact
 * sequence, which is what makes the bit-for-bit assert meaningful. dt is 1.0
 * for this model, where q16_mul(x, Q16) is exact, so the second multiply
 * currently costs nothing and rounds nothing. */
typedef struct {
    int32_t  dt;             /* Q16.16 ms */
    int32_t  inv_tau;        /* Q16.16, 1/tau */
    int32_t  syn_decay;      /* Q16.16 */
    int32_t  v_thresh;       /* Q16.16 */
    int32_t  v_reset;        /* Q16.16 */
    uint32_t refrac_ticks;
    uint32_t rate_window;    /* ticks of spike history the readout averages */
    int32_t  _pad;
} fly_param_t;               /* 32 bytes */
_Static_assert(sizeof(fly_param_t) == 32,
    "fly_param_t size drifted from 32 bytes -- pipeline/pack.py's _pack_params struct format assumes this");

/* Per-neuron account data. Membrane potential lives in the account BALANCE as
 * well, as a settled projection -- see v_to_balance in fly.c. `v` here is the
 * simulation's source of truth and resolves Q16.16; the balance resolves
 * 1/BAL_SCALE and must never be inverted to recover v. */
typedef struct {
    uint16_t index;
    char     name[8];        /* "EPG03", "PEN_L07", "D7_11" -- NUL padded */
    uint16_t refrac;         /* ticks left; 0 means the neuron can integrate */
    int32_t  v;              /* Q16.16 */
    int32_t  syn;            /* Q16.16 decaying synaptic current */
    uint32_t step_tag;
    uint32_t _pad1;
} fly_neuron_t;              /* 28 bytes */
_Static_assert(sizeof(fly_neuron_t) == 28,
    "fly_neuron_t size drifted from 28 bytes -- 134 accounts are created with this layout");

/* What the ring is doing, in the terms the trading fly is steered by. The
 * worm's four locomotion states become a heading and a turn direction: this
 * circuit's whole output is where the bump sits and which way it is moving.
 *
 * The heading is carried as the population vector's two COMPONENTS rather than
 * an angle, because recovering the angle needs atan2 and recovering the
 * strength needs a square root, and neither belongs in a VM with no floating
 * point when the only consumer is a browser that has both. metrics.heading
 * computes wedge = angle(R) * n_wedges / 2pi and strength = |R| / sum(rate);
 * x, y and rate_sum are exactly what that formula needs, so the reader
 * finishes it and the chain never rounds an angle.
 *
 * Turning is decided on chain, and does not need the angle either: the sign of
 * the cross product between the previous population vector and this one is the
 * direction the bump moved, which is a multiply and a compare. */
typedef struct {
    uint8_t  turning;        /* 0=HOLDING 1=CCW 2=CW */
    uint8_t  _pad[3];
    int32_t  bump_x;         /* Q16.16 sum over wedges of rate * cos(theta) */
    int32_t  bump_y;         /* Q16.16 sum over wedges of rate * sin(theta) */
    int32_t  rate_sum;       /* Q16.16 sum of wedge rates, strength's divisor */
    int32_t  drive_l;        /* Q16.16 last PEN_L drive */
    int32_t  drive_r;        /* Q16.16 last PEN_R drive */
    /* The landmark. A ring released from its initial potentials has no bump
     * -- the cells decay toward rest and nothing ever crosses threshold -- so
     * the protocol anchors one with a landmark for the first hundred ticks and
     * then lets it fly. That makes the landmark part of the steering state,
     * not a test fixture, and it lives here for the same reason the drive
     * does: a step transaction should not have to restate it. */
    int32_t  landmark_current;
    uint16_t landmark_wedge;
    uint8_t  landmark_active;
    uint8_t  _pad2;
    uint32_t entered_at;
    uint32_t step;
    uint64_t block_time;     /* Unix ns, from BLOCK_CTX */
} fly_behavior_t;            /* 48 bytes */
_Static_assert(sizeof(fly_behavior_t) == 48,
    "fly_behavior_t size drifted from 48 bytes -- pipeline/deploy.py's create_singletons() hardcodes this size");

/* An emitted buffer does not reach every consumer whole: `thru txn get` splits
 * the FIRST 8 BYTES off as the receipt's `event_type` and strips TRAILING ZERO
 * bytes from the rest, while the gRPC event stream delivers the whole buffer
 * including the tag. Both event structs therefore open with an explicit 8-byte
 * type tag and close with a NON-ZERO terminator, so nothing can be trimmed and
 * the in-payload tag tells a reader which transport it is on. */
#define FLY_EVENT_TRACE 0x45435254594C4600ull   /* "\0FLYTRCE" */
#define FLY_EVENT_SPIKE 0x584B5053594C4600ull   /* "\0FLYSPKX" */
#define FLY_EVENT_END   0xA5u                   /* never zero */

/* One frame of the whole ring. `v` is the membrane potential scaled by
 * V_TRACE_SCALE so it survives as an int16: the model's potentials live in
 * roughly [v_reset, v_thresh] = [0, 1], which would quantise to two values as
 * whole units. Spikes ride along as a bitmap because they are the thing the
 * view actually draws, and recovering them from v is impossible -- a spiking
 * neuron has already been reset to v_reset by the time the frame is built.
 *
 * mV stays immediately after the tag so a browser can build an Int16Array VIEW
 * at offset 8 instead of copying; do not put another field in front of it. */
#define V_TRACE_SCALE 1000
#define SPIKE_BYTES   ((N_NEURONS + 7) / 8)     /* 17 */

typedef struct __attribute__((packed)) {
    int16_t  v[N_NEURONS];              /* v * V_TRACE_SCALE, truncated */
    uint8_t  spikes[SPIKE_BYTES];       /* bit i = neuron i fired this frame */
    uint32_t step;
    int32_t  bump_x;                    /* Q16.16, as in fly_behavior_t */
    int32_t  bump_y;                    /* Q16.16 */
    uint8_t  turning;
    uint8_t  _pad[2];
    uint8_t  end;                       /* FLY_EVENT_END */
} fly_trace_t;
_Static_assert(sizeof(fly_trace_t) == N_NEURONS * 2 + SPIKE_BYTES + 16,
    "fly_trace_t size drifted -- pipeline/test_chain.py and the published ABI both pin it");

typedef struct __attribute__((packed)) {
    uint64_t    type;                   /* FLY_EVENT_TRACE -- consumed as event_type */
    fly_trace_t frame;
} fly_trace_event_t;

/* One settled synaptic transfer. `amount` is native balance units and is
 * always positive: direction is carried by which neuron is pre and which is
 * post, so a consumer can sum -amount/+amount per neuron and get exactly the
 * balance delta the chain applied.
 *
 * An excitatory synapse moves charge from the neuron that fired to the one it
 * drives. An inhibitory synapse moves it the other way -- the postsynaptic
 * cell loses charge -- which is what keeps every transfer a conservative pair
 * and the whole ledger summing to zero. */
typedef struct __attribute__((packed)) {
    uint16_t pre;       /* dense neuron index that LOST the units */
    uint16_t post;      /* dense neuron index that gained them */
    int32_t  amount;
} fly_xfer_t;
_Static_assert(sizeof(fly_xfer_t) == 8,
    "fly_xfer_t must stay 8 bytes -- the ABI and the front-end both decode 8-byte triples");

/* A spiking neuron drives every neuron its row touches: 53 at the sparsest,
 * 110 at the busiest, 83 median. Several neurons spike per tick, so the cap is
 * what one settlement is allowed to emit rather than a property of the wiring;
 * past it, settle_transfers reverts rather than silently truncating. */
#define XFER_MAX 512

typedef struct __attribute__((packed)) {
    uint64_t   type;      /* FLY_EVENT_SPIKE -- consumed as event_type */
    uint32_t   step;
    uint32_t   count;
    fly_xfer_t xfer[XFER_MAX];
    uint8_t    end;       /* FLY_EVENT_END, relocated to follow xfer[count] */
} fly_xfer_event_t;
#define FLY_XFER_EVENT_SZ(count) (8u + 4u + 4u + (count) * 8u + 1u)

/* Membrane potential <-> native balance. A uint64 balance cannot go negative;
 * this model's potential can (inhibition drives it below v_reset), so the
 * offset is what makes a hyperpolarising transfer safe.
 *
 * The scale is set by what a neuron can afford to hold rather than by
 * precision: at BAL_SCALE 1000 a neuron sits near 1,100 units and the ring
 * needs ~150,000, which is a handful of faucet withdrawals. Precision does not
 * matter here because account DATA `v` (Q16.16) is the simulation's source of
 * truth -- the balance is only the settled projection. */
#define BAL_OFFSET_V    1       /* volts of headroom below v_reset */
#define BAL_SCALE       1000
#define BAL_MIN         10u
#endif
