/* The timestep. Compiled TWICE -- once for ThruVM, once natively -- so a
 * disagreement between chain and laptop localizes to the VM, not the math.
 * NO SDK CALLS BELONG IN THIS FILE.
 *
 * This is model_float.tick(), transcribed. The float model reads:
 *
 *     syn_in = sum of W[pre] over spiking pre
 *     syn    = syn * syn_decay + syn_in
 *     I      = syn + ext
 *     v[free] += (I[free] - v[free]/tau) * dt
 *     spikes  = v >= v_thresh
 *     v[spikes] = v_reset;  refrac[spikes] = refrac_ticks
 *     refrac[not spiked and refrac > 0] -= 1
 *
 * Two things about that order are load-bearing and easy to break. `free` is
 * read from the refractory counters as they stood at the END of the previous
 * tick, before this tick touches them. And the spikes that drive syn_in are
 * the PREVIOUS tick's -- a neuron's own spike reaches its targets one tick
 * later, which is what gives the ring its rotation speed. Fusing the two loops
 * would deliver current in the same tick it was generated and the bump would
 * move at a different rate.
 *
 * The float model sums W rows in ascending neuron order rather than calling
 * BLAS, because with a hard threshold a last-bit difference flips a spike.
 * Here the accumulator is integral, so addition is exact and associative and
 * the order genuinely does not matter -- the fixed-point port is the more
 * reproducible of the two. */
#include "sim.h"
#include "fixed.h"

static inline void const *at(void const *base, uint32_t off) {
    return (void const *)((unsigned char const *)base + off);
}

void fly_sim_bind(fly_sim_t *sim, void const *topo,
                  int32_t *v, int32_t *syn, uint16_t *refrac, uint8_t *spikes) {
    fly_topology_hdr_t const *h = (fly_topology_hdr_t const *)topo;
    sim->hdr      = h;
    sim->W        = (int32_t     const *)at(topo, h->off_w);
    sim->cls      = (uint8_t     const *)at(topo, h->off_class);
    sim->wedge    = (uint8_t     const *)at(topo, h->off_wedge);
    sim->landmark = (int32_t     const *)at(topo, h->off_landmark);
    sim->v0       = (int32_t     const *)at(topo, h->off_v0);
    sim->p        = (fly_param_t const *)at(topo, h->off_params);
    sim->v = v; sim->syn = syn; sim->refrac = refrac; sim->spikes = spikes;
}

/* Freshly created accounts hold v = 0, which for this model is v_reset rather
 * than anything resting -- a ring started from a flat zero never breaks
 * symmetry and no bump forms. The float model draws the initial potentials
 * uniformly in [v_reset, v_thresh) from the seeded generator; pack.py draws
 * exactly that, from exactly that generator, and bakes the result into v0, so
 * a chain reset starts the same brain the laptop would. */
void fly_sim_reset(fly_sim_t *sim) {
    for (uint32_t i = 0; i < sim->hdr->n_neurons; i++) {
        sim->v[i]      = sim->v0[i];
        sim->syn[i]    = 0;
        sim->refrac[i] = 0;
        sim->spikes[i] = 0;
    }
}

void fly_step(fly_sim_t *sim, uint32_t n, fly_input_t const *in) {
    uint32_t const N = sim->hdr->n_neurons;
    fly_param_t const *p = sim->p;

    for (uint32_t it = 0; it < n; it++) {
        for (uint32_t i = 0; i < N; i++) {
            /* Pass 1: last tick's spikes reach their targets. Reading the
             * accumulator per postsynaptic neuron (a column walk) rather than
             * scattering per presynaptic one (a row walk) keeps the write set
             * to one int64 in a register; the matrix is 61% dense, so neither
             * direction is sparse enough for the indirection of a CSR to pay
             * for itself. */
            int64_t acc = 0;
            for (uint32_t pre = 0; pre < N; pre++)
                if (sim->spikes[pre]) acc += sim->W[pre * N + i];

            int32_t syn = q16_mul(sim->syn[i], p->syn_decay) + (int32_t)acc;
            sim->syn[i] = syn;

            /* Pass 2: the external drive. Push-pull on the two PEN
             * populations is the steering signal; the landmark is an optional
             * bump anchor with a precomputed footprint. */
            int32_t ext = 0;
            if      (sim->cls[i] == CLS_PEN_L) ext = in->drive_l;
            else if (sim->cls[i] == CLS_PEN_R) ext = in->drive_r;
            if (in->landmark_active) {
                uint32_t w = in->landmark_wedge % sim->hdr->n_wedges;
                ext += q16_mul(in->landmark_current, sim->landmark[w * N + i]);
            }

            /* Pass 3: leaky integration, for neurons out of refraction. The
             * refractory counters read here are last tick's, deliberately. */
            if (sim->refrac[i] == 0) {
                int32_t I = syn + ext;
                sim->v[i] += q16_mul(I - q16_mul(sim->v[i], p->inv_tau), p->dt);
            }
        }

        /* Pass 4: threshold, reset and the refractory clock. Separated from
         * the integration above because a neuron's new spike must not reach
         * anything until the next iteration. */
        for (uint32_t i = 0; i < N; i++) {
            if (sim->v[i] >= p->v_thresh) {
                sim->spikes[i] = 1;
                sim->v[i]      = p->v_reset;
                sim->refrac[i] = (uint16_t)p->refrac_ticks;
            } else {
                sim->spikes[i] = 0;
                if (sim->refrac[i] > 0) sim->refrac[i]--;
            }
        }
    }
}

/* Population vector over the EPG ring. `rate` is one Q16.16 rate per WEDGE,
 * already averaged over the EPG cells in it (metrics.wedge_rates), so this is
 * metrics.heading's R = sum_w rate_w * exp(i*theta_w) with the angle left for
 * the reader -- see fly_behavior_t. */
void fly_heading(fly_sim_t const *sim, int32_t const *rate,
                 int32_t *x, int32_t *y) {
    uint32_t const NW = sim->hdr->n_wedges;
    int32_t const *cos_t = (int32_t const *)((unsigned char const *)sim->hdr
                                             + sim->hdr->off_sincos);
    int32_t const *sin_t = cos_t + NW;
    int64_t ax = 0, ay = 0;
    for (uint32_t w = 0; w < NW; w++) {
        ax += q16_mul(rate[w], cos_t[w]);
        ay += q16_mul(rate[w], sin_t[w]);
    }
    *x = (int32_t)ax;
    *y = (int32_t)ay;
}
