#ifndef WORM_SIM_H
#define WORM_SIM_H
#include <stdint.h>
#include "worm.h"

typedef struct {
    worm_topology_hdr_t const *hdr;
    uint16_t const *slot_map;
    uint32_t const *chem_rowptr, *gap_rowptr;
    uint16_t const *chem_col, *gap_col;
    int16_t  const *chem_g, *chem_E, *gap_g;
    worm_param_t const *params;
    int32_t  const *lut;
    int32_t  *V;       /* Q16.16 mV, caller-owned, n_neurons entries */
    int32_t  *i_stim;  /* Q16.16,    caller-owned, n_neurons entries */
    int32_t   s[N_NEURONS];       /* activation scratch, pass 1 */
    int32_t   v_next[N_NEURONS];  /* double buffer, pass 3 */
    int32_t   dt;
} worm_sim_t;

void worm_sim_bind(worm_sim_t *sim, void const *topology, int32_t *V, int32_t *i_stim);
void worm_sim_reset(worm_sim_t *sim);
void worm_step(worm_sim_t *sim, uint32_t n);
/* Returns -1 on overflow; never truncates the set of active synapses. */
int32_t worm_collect_synapses(worm_sim_t *sim, worm_synapse_t *out,
                              uint32_t capacity, uint32_t step);
#endif
