#ifndef FLY_SIM_H
#define FLY_SIM_H
#include <stdint.h>
#include "fly.h"

typedef struct {
    fly_topology_hdr_t const *hdr;
    int32_t      const *W;         /* n*n Q16.16, row = presynaptic */
    uint8_t      const *cls;
    uint8_t      const *wedge;
    int32_t      const *landmark;  /* n_wedges * n, Q16.16 */
    int32_t      const *v0;
    fly_param_t  const *p;

    int32_t *v;        /* Q16.16, caller-owned, n_neurons entries */
    int32_t *syn;      /* Q16.16, caller-owned */
    uint16_t *refrac;  /* ticks, caller-owned */
    uint8_t  *spikes;  /* 0/1 per neuron, caller-owned; THIS tick's firing */
} fly_sim_t;

/* The external drive applied every tick: push-pull on the two PEN populations
 * plus an optional landmark. Held in the behavior account between calls so a
 * step transaction does not have to restate it. */
typedef struct {
    int32_t  drive_l;          /* Q16.16 */
    int32_t  drive_r;          /* Q16.16 */
    int32_t  landmark_current; /* Q16.16 */
    uint16_t landmark_wedge;
    uint8_t  landmark_active;
    uint8_t  _pad;
} fly_input_t;

void fly_sim_bind(fly_sim_t *sim, void const *topology,
                  int32_t *v, int32_t *syn, uint16_t *refrac, uint8_t *spikes);
void fly_sim_reset(fly_sim_t *sim);
void fly_step(fly_sim_t *sim, uint32_t n, fly_input_t const *in);

/* Population vector over the EPG ring, as its two Q16.16 components. The angle
 * and the vector's length are the reader's job -- see fly_behavior_t. */
void fly_heading(fly_sim_t const *sim, int32_t const *rate,
                 int32_t *x, int32_t *y);
#endif
