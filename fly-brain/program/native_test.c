/* sim.c, compiled natively and checked against the Q16.16 Python reference.
 *
 *     gcc -O0 -g -I. native_test.c sim.c -o /tmp/nt && /tmp/nt
 *
 * This is the middle link of the verification chain. The float model is the
 * ground truth for the MODEL and pipeline/refsim.py's FixedSim is the ground
 * truth for the ARITHMETIC; this asserts that the C the chain runs performs
 * that arithmetic identically, on a machine where a debugger works. When the
 * chain later disagrees, this having passed is what says the VM is at fault
 * rather than the maths.
 *
 * Every one of the N potentials is compared for EXACT equality at every step.
 * A tolerance here would defeat the point: the model has a hard threshold, so
 * a one-ULP difference flips a spike, and a flipped spike changes the bump's
 * position a hundred ticks later.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sim.h"
#include "fixed.h"

/* Mirrors pipeline/refsim.py's dump_vectors: the landmark anchors a bump for
 * BOOT_LANDMARK_TICKS, then it is released and the push-pull drive steers. The
 * numbers come from spec/params_hemibrain_avg.json's protocol block. */
#define BOOT_LANDMARK_TICKS 100
#define STEPS               400
#define LANDMARK_CURRENT    0.30688232817139527
#define LANDMARK_WEDGE      4
#define DRIVE               0.0273

static int32_t  v[N_NEURONS], syn[N_NEURONS];
static uint16_t refrac[N_NEURONS];
static uint8_t  spikes[N_NEURONS];

static void *slurp(char const *path, long *out_sz) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    void *p = malloc((size_t)sz);
    if (fread(p, 1, (size_t)sz, f) != (size_t)sz) { fprintf(stderr, "short read %s\n", path); exit(2); }
    fclose(f);
    if (out_sz) *out_sz = sz;
    return p;
}

static int32_t to_q16(double x) { return (int32_t)(x * 65536.0 + (x < 0 ? -0.5 : 0.5)); }

int main(void) {
    long topo_sz = 0, vec_sz = 0;
    void *topo = slurp("../data/topology.bin", &topo_sz);
    int32_t *golden = (int32_t *)slurp("../data/vectors/turn_400.bin", &vec_sz);

    fly_sim_t sim;
    fly_sim_bind(&sim, topo, v, syn, refrac, spikes);
    if (sim.hdr->magic != FLY_MAGIC) { fprintf(stderr, "bad magic\n"); return 2; }

    uint32_t const N = sim.hdr->n_neurons;
    long want = (long)(STEPS + 1) * N * 4;
    if (vec_sz != want) {
        fprintf(stderr, "vector file is %ld bytes, expected %ld (%d frames x %u neurons x 4)\n",
                vec_sz, want, STEPS + 1, N);
        return 2;
    }

    fly_sim_reset(&sim);

    /* Frame 0 before any arithmetic: if the binding or the baked v0 is wrong,
     * say so here rather than blaming the first multiply. */
    for (uint32_t i = 0; i < N; i++) {
        if (v[i] != golden[i]) {
            fprintf(stderr, "reset: neuron %u is %d, reference %d\n", i, v[i], golden[i]);
            return 1;
        }
    }

    fly_input_t in;
    memset(&in, 0, sizeof(in));
    in.landmark_current = to_q16(LANDMARK_CURRENT);
    in.landmark_wedge   = LANDMARK_WEDGE;
    in.landmark_active  = 1;

    for (int s = 0; s < STEPS; s++) {
        if (s == BOOT_LANDMARK_TICKS) {
            in.landmark_active  = 0;
            in.landmark_current = 0;
            in.drive_l =  to_q16(DRIVE);
            in.drive_r = -to_q16(DRIVE);
        }
        fly_step(&sim, 1, &in);
        int32_t const *want_frame = golden + (long)(s + 1) * N;
        for (uint32_t i = 0; i < N; i++) {
            if (v[i] != want_frame[i]) {
                fprintf(stderr,
                        "step %d neuron %u: C %d, python %d, delta %d\n",
                        s + 1, i, v[i], want_frame[i], v[i] - want_frame[i]);
                return 1;
            }
        }
    }

    printf("OK: %d steps x %u neurons bit-for-bit against the Q16.16 reference\n", STEPS, N);
    return 0;
}
