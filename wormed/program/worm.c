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
 * against it, and an empty reservoir fails with INSUFFICIENT_BALANCE (-38). */
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
        default:                      tsdk_revert(ERR_BAD_INSTR_TYPE);
    }
    tsdk_return(TSDK_SUCCESS);
}
