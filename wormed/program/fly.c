#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include <string.h>
#include "fly.h"

/* Instruction data is a flat byte stream at BYTE granularity and ThruVM
 * faults on any unaligned scalar load, so every multi-byte field goes through
 * TSDK_LOAD rather than a pointer cast. Same rule as worm.c. */

/* Account creation. The fly's neurons hold no data — the model's state lives
 * in fly-brain/python — so every record here asks for data_sz 0 and the
 * account exists only to hold, and move, balance. */
static void do_create(uchar const *data, ulong sz) {
    if (sz < 6u) tsdk_revert(FLY_ERR_BAD_INSTR_SIZE);
    uint16_t count = TSDK_LOAD(uint16_t, data + 4);
    uchar const *p = data + 6u;
    uchar const *end = data + sz;

    for (uint16_t k = 0; k < count; k++) {
        if (p + FLY_CREATE_REC_FIXED_SZ > end) tsdk_revert(FLY_ERR_BAD_INSTR_SIZE);
        uint16_t acct_idx = TSDK_LOAD(uint16_t, p);              p += 2;
        uint32_t data_sz  = TSDK_LOAD(uint32_t, p);              p += 4;
        uchar seed[TN_SEED_SIZE]; memcpy(seed, p, TN_SEED_SIZE); p += TN_SEED_SIZE;
        uint32_t proof_sz = TSDK_LOAD(uint32_t, p);              p += 4;
        if (p + proof_sz > end) tsdk_revert(FLY_ERR_BAD_INSTR_SIZE);

        if (tsys_account_create(acct_idx, seed, p, proof_sz) != TSDK_SUCCESS)
            tsdk_revert(FLY_ERR_RESIZE_FAILED);
        p += proof_sz;

        if (data_sz) {
            if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
                tsdk_revert(FLY_ERR_RESIZE_FAILED);
            if (tsys_account_resize(acct_idx, data_sz) != TSDK_SUCCESS)
                tsdk_revert(FLY_ERR_RESIZE_FAILED);
        }
    }
    tsdk_return(TSDK_SUCCESS);
}

/*
 * ONE synaptic event, ONE transaction. The tick, the pair and the weight come
 * from the caller because the model that produced them runs off chain (see the
 * header) — what the chain contributes is that the charge actually moves and
 * that the receipt is signed.
 *
 * Excitatory events move charge presynaptic -> postsynaptic, the way the worm's
 * gap junctions do: current out of one cell IS current into the other.
 * Inhibitory events (the fly's D7 rows, negative by construction) take charge
 * OUT of the postsynaptic cell to the reservoir — nothing flows back up the
 * axon, so the presynaptic account must not gain.
 */
static void do_synapse(uchar const *data, ulong sz) {
    if (sz != 24u) tsdk_revert(FLY_ERR_BAD_INSTR_SIZE);
    uint32_t tick      = TSDK_LOAD(uint32_t, data + 4);
    uint16_t reservoir = TSDK_LOAD(uint16_t, data + 8);
    uint16_t pre       = TSDK_LOAD(uint16_t, data + 10);
    uint16_t post      = TSDK_LOAD(uint16_t, data + 12);
    /* Neuron indices, NOT account slots. A transaction carries three accounts
     * in the chain's own address order, so the slot says nothing about which
     * cell it is; the receipt has to be told. Nothing on chain can check the
     * pairing — the connectome lives off chain with the model (see fly.h). */
    uint16_t pre_ix    = TSDK_LOAD(uint16_t, data + 14);
    uint16_t post_ix   = TSDK_LOAD(uint16_t, data + 16);
    int32_t  amount    = TSDK_LOAD(int32_t,  data + 18);
    uint8_t  kind      = data[22];

    ulong limit = 2u + tsdk_txn_readwrite_account_cnt(tsdk_get_txn());
    if (reservoir < 2u || reservoir >= limit || pre < 2u || pre >= limit ||
        post < 2u || post >= limit || reservoir == pre || reservoir == post ||
        pre == post || kind > 1u || amount == 0 ||
        pre_ix >= FLY_N_NEURONS || post_ix >= FLY_N_NEURONS)
        tsdk_revert(FLY_ERR_BAD_SYNAPSE);

    uint64_t units = (uint64_t)(amount < 0 ? -(int64_t)amount : (int64_t)amount);
    uint16_t from = kind ? post : pre;
    uint16_t to   = kind ? reservoir : post;

    /* Top up rather than revert. A single cell running dry is the normal case
     * — the model spikes far faster than the reservoir reconciles — and
     * dropping the event would make the receipt stream disagree with the
     * firing on screen. */
    uint64_t have = tsdk_get_account_meta(from)->balance;
    if (have < units + FLY_BAL_MIN) {
        uint64_t need = units + FLY_BAL_MIN - have;
        if (tsdk_get_account_meta(reservoir)->balance < need)
            tsdk_revert(FLY_ERR_TRANSFER_FAILED);
        if (tsys_account_transfer(reservoir, from, need) != TSDK_SUCCESS)
            tsdk_revert(FLY_ERR_TRANSFER_FAILED);
    }
    if (tsys_account_transfer(from, to, units) != TSDK_SUCCESS)
        tsdk_revert(FLY_ERR_TRANSFER_FAILED);

    fly_receipt_t receipt = { .type = FLY_EVENT_SYNAPSE, .tick = tick,
        .pre = pre_ix, .post = post_ix, .amount = amount, .kind = kind,
        .end = FLY_EVENT_END };
    tsys_emit_event((uchar const *)&receipt, sizeof(receipt));
    tsdk_return(TSDK_SUCCESS);
}

TSDK_ENTRYPOINT_FN void start(void) {
    tsdk_txn_t const *txn = tsdk_get_txn();
    uchar const *data = tsdk_txn_get_instr_data(txn);
    ulong sz = tsdk_txn_get_instr_data_sz(txn);
    if (sz < sizeof(uint32_t)) tsdk_revert(FLY_ERR_BAD_INSTR_SIZE);

    switch (TSDK_LOAD(uint32_t, data)) {
        case FLY_INSTR_CREATE:  do_create(data, sz); break;
        case FLY_INSTR_SYNAPSE: do_synapse(data, sz); break;
        default:                tsdk_revert(FLY_ERR_BAD_INSTR_TYPE);
    }
    tsdk_return(TSDK_SUCCESS);
}
