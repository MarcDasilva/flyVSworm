/* The timestep. Compiled TWICE — once for ThruVM, once natively — so a
 * disagreement between chain and laptop localizes to the VM, not the math.
 * NO SDK CALLS BELONG IN THIS FILE. */
#include "sim.h"
#include "fixed.h"

#define DT_Q16 (5 * Q16)   /* dt = 5 ms. Backward Euler is unconditionally
                            * stable, which is what buys 5 ms over 0.5 ms. */

static inline void const *at(void const *base, uint32_t off) {
    return (void const *)((unsigned char const *)base + off);
}

void worm_sim_bind(worm_sim_t *sim, void const *topo, int32_t *V, int32_t *i_stim) {
    worm_topology_hdr_t const *h = (worm_topology_hdr_t const *)topo;
    sim->hdr         = h;
    sim->slot_map    = (uint16_t const *)at(topo, h->off_slot_map);
    sim->chem_rowptr = (uint32_t const *)at(topo, h->off_chem_rowptr);
    sim->chem_col    = (uint16_t const *)at(topo, h->off_chem_col);
    sim->chem_g      = (int16_t  const *)at(topo, h->off_chem_g);
    sim->chem_E      = (int16_t  const *)at(topo, h->off_chem_E);
    sim->gap_rowptr  = (uint32_t const *)at(topo, h->off_gap_rowptr);
    sim->gap_col     = (uint16_t const *)at(topo, h->off_gap_col);
    sim->gap_g       = (int16_t  const *)at(topo, h->off_gap_g);
    sim->params      = (worm_param_t const *)at(topo, h->off_params);
    sim->lut         = (int32_t  const *)at(topo, h->off_lut);
    sim->V = V; sim->i_stim = i_stim; sim->dt = DT_Q16;
}

void worm_sim_reset(worm_sim_t *sim) {
    for (uint32_t i = 0; i < sim->hdr->n_neurons; i++) {
        sim->V[i] = (int32_t)sim->params[i].E_leak_mV * Q16;
        sim->i_stim[i] = 0;
    }
}

void worm_step(worm_sim_t *sim, uint32_t n) {
    uint32_t const N = sim->hdr->n_neurons;
    for (uint32_t it = 0; it < n; it++) {
        /* Pass 1. Activation depends ONLY on the presynaptic neuron, so this
         * is 302 sigmoid evaluations instead of 7000. Worth ~570k CU/step —
         * roughly half the budget. Moving it into the edge loop is the single
         * most expensive "simplification" available. */
        for (uint32_t j = 0; j < N; j++) {
            worm_param_t const *p = &sim->params[j];
            int32_t x = q16_mul(sim->V[j] - ((int32_t)p->V_half_mV * Q16),
                                (int32_t)p->k_recip << 8);
            sim->s[j] = sigmoid_q16(x, sim->lut);
        }

        for (uint32_t i = 0; i < N; i++) {
            worm_param_t const *p = &sim->params[i];
            int32_t g_leak = (int32_t)p->g_leak << 8;   /* Q8.8 -> Q16.16 */
            /* int64: AVAL has 74 incoming edges and Q16.16 products overflow
             * int32. This declaration IS the fix — do NOT narrow it back to
             * int32 before the dt multiply below, that reintroduces the
             * overflow the accumulator exists to avoid. */
            int64_t acc_g  = g_leak;
            int64_t acc_gE = (int64_t)q16_mul(g_leak, (int32_t)p->E_leak_mV * Q16)
                           + sim->i_stim[i];

            /* Pass 2a: chemical. Conductance gated by presynaptic activation. */
            for (uint32_t e = sim->chem_rowptr[i]; e < sim->chem_rowptr[i + 1]; e++) {
                int32_t g = q16_mul((int32_t)sim->chem_g[e] << 8,
                                    sim->s[sim->chem_col[e]]);
                acc_g  += g;
                acc_gE += q16_mul(g, (int32_t)sim->chem_E[e] * Q16);
            }
            /* Pass 2b: gap. An ohmic junction g*(Vi-Vj) is algebraically a
             * conductance g with reversal potential Vj — SAME accumulator,
             * no second code path. */
            for (uint32_t e = sim->gap_rowptr[i]; e < sim->gap_rowptr[i + 1]; e++) {
                int32_t g = (int32_t)sim->gap_g[e] << 8;
                acc_g  += g;
                acc_gE += q16_mul(g, sim->V[sim->gap_col[e]]);
            }

            /* Pass 3: backward Euler. ONE divide per NEURON, not per synapse —
             * and on ThruVM divu costs 4 CU, the same as add, because cost is
             * charged by instruction SIZE, not latency. acc_gE/acc_g stay
             * int64 through the dt multiply (q16_mul64) — the Python
             * reference never narrows them either, and matching it here is
             * what keeps this bit-for-bit. */
            int32_t C = (int32_t)p->C << 8;
            int64_t num = (int64_t)q16_mul(C, sim->V[i])
                        + q16_mul64(sim->dt, acc_gE);
            int64_t den = (int64_t)C + q16_mul64(sim->dt, acc_g);
            sim->v_next[i] = (int32_t)q16_floordiv(num << 16, den);
        }

        for (uint32_t i = 0; i < N; i++) sim->V[i] = sim->v_next[i];
    }
}

/* Same conductances and fixed-point arithmetic as the integrator. A "fire"
 * here means a nonzero native-unit current settlement, not an action potential
 * (this is a graded-potential model). No strongest-N filter or sampling. */
int32_t worm_collect_synapses(worm_sim_t *sim, worm_synapse_t *out,
                              uint32_t capacity, uint32_t step) {
    uint32_t count = 0;
    for (uint32_t j = 0; j < sim->hdr->n_neurons; j++) {
        worm_param_t const *p = &sim->params[j];
        sim->s[j] = sigmoid_q16(q16_mul(sim->V[j] - (int32_t)p->V_half_mV * Q16,
                                       (int32_t)p->k_recip << 8), sim->lut);
    }
    for (uint32_t i = 0; i < sim->hdr->n_neurons; i++) {
        for (uint32_t kind = 0; kind < 2; kind++) {
            uint32_t const *rows = kind ? sim->chem_rowptr : sim->gap_rowptr;
            for (uint32_t e = rows[i]; e < rows[i + 1]; e++) {
                uint32_t j = kind ? sim->chem_col[e] : sim->gap_col[e];
                if (!kind && j <= i) continue;
                int32_t flow;
                uint16_t pre = (uint16_t)j, post = (uint16_t)i;
                if (kind) {
                    int32_t g = q16_mul((int32_t)sim->chem_g[e] << 8, sim->s[j]);
                    flow = q16_mul(g, (int32_t)sim->chem_E[e] * Q16 - sim->V[i]);
                } else {
                    flow = q16_mul((int32_t)sim->gap_g[e] << 8, sim->V[j] - sim->V[i]);
                    if (flow < 0) { pre = (uint16_t)i; post = (uint16_t)j; flow = -flow; }
                }
                int32_t amount = (int32_t)((int64_t)flow * BAL_SCALE / Q16);
                if (!amount) continue;
                if (count == capacity) return -1;
                out[count++] = (worm_synapse_t){ .step = step, .pre = pre,
                    .post = post, .amount = amount, .kind = (uint8_t)kind };
            }
        }
    }
    return (int32_t)count;
}
