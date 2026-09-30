/* Diffs the native build of sim.c against the Python Q16.16 reference,
 * bit-for-bit. When the on-chain worm goes silent, this is the test that says
 * whether the bug is in the arithmetic or in the VM. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "worm.h"
#include "sim.h"

/* Native-only name resolution. On-chain the name is in the account itself
 * (worm_neuron_t.name) — nothing on-chain needs to search by name, so this
 * has no equivalent in sim.c. */
static char g_names[N_NEURONS][12];
static int g_names_loaded = 0;

int worm_native_name_index(char const *name) {
    if (!g_names_loaded) {
        FILE *f = fopen("../data/names.json", "rb");
        if (!f) return -1;
        static char buf[65536];
        size_t n = fread(buf, 1, sizeof(buf) - 1, f); buf[n] = 0; fclose(f);
        int k = 0; char *p = buf;
        while ((p = strchr(p, '"')) && k < N_NEURONS) {
            char *end = strchr(++p, '"');
            if (!end) break;
            size_t len = (size_t)(end - p);
            if (len > 11) len = 11;
            memcpy(g_names[k], p, len); g_names[k][len] = 0;
            k++; p = end + 1;
        }
        g_names_loaded = 1;
    }
    for (int i = 0; i < N_NEURONS; i++)
        if (strcmp(g_names[i], name) == 0) return i;
    return -1;
}

int main(void) {
    {
        worm_topology_hdr_t header = { .n_neurons = 2 };
        uint32_t rows[] = { 0, 1, 2 };
        uint16_t columns[] = { 1, 0 };
        int16_t conductances[] = { 256, 256 }, reversals[] = { 0, -80 };
        int32_t voltages[] = { -40 * 65536, -60 * 65536 }, lut[LUT_ENTRIES];
        for (int i = 0; i < LUT_ENTRIES; i++) lut[i] = 32768;
        worm_param_t params[2] = {0};
        worm_sim_t fixture = { .hdr = &header, .params = params, .V = voltages, .lut = lut,
            .chem_rowptr = rows, .gap_rowptr = rows, .chem_col = columns, .gap_col = columns,
            .chem_g = conductances, .gap_g = conductances, .chem_E = reversals };
        worm_synapse_t events[3];
        assert(worm_collect_synapses(&fixture, events, 3, 10) == 3);
        assert(events[0].kind == 0 && events[0].pre == 0 && events[0].post == 1 && events[0].amount == 200);
        assert(events[1].kind == 1 && events[1].pre == 1 && events[1].post == 0 && events[1].amount == 200);
        assert(events[2].kind == 1 && events[2].pre == 0 && events[2].post == 1 && events[2].amount == -100);
        for (int i = 0; i < 3; i++) assert(events[i].step == 10 && !events[i].settled);
        assert(worm_collect_synapses(&fixture, events, 2, 10) == -1);
        conductances[0] = conductances[1] = 0;
        assert(worm_collect_synapses(&fixture, events, 3, 10) == 0);
    }
    FILE *ft = fopen("../data/topology.bin", "rb");
    if (!ft) { fprintf(stderr, "run pipeline/pack.py first\n"); return 2; }
    fseek(ft, 0, SEEK_END); long tsz = ftell(ft); fseek(ft, 0, SEEK_SET);
    void *topo = malloc((size_t)tsz);
    if (fread(topo, 1, (size_t)tsz, ft) != (size_t)tsz) return 2;
    fclose(ft);

    FILE *fv = fopen("../data/vectors/alm_400.bin", "rb");
    if (!fv) { fprintf(stderr, "run refsim.dump_vectors() first\n"); return 2; }
    static int32_t golden[401][N_NEURONS];
    if (fread(golden, sizeof(golden), 1, fv) != 1) return 2;
    fclose(fv);

    static int32_t V[N_NEURONS], i_stim[N_NEURONS];
    worm_sim_t sim;
    worm_sim_bind(&sim, topo, V, i_stim);
    worm_sim_reset(&sim);

    for (int i = 0; i < N_NEURONS; i++)
        if (V[i] != golden[0][i]) {
            fprintf(stderr, "initial state mismatch at %d: %d != %d\n",
                    i, V[i], golden[0][i]);
            return 1;
        }

    int alml = worm_native_name_index("ALML");
    if (alml < 0) { fprintf(stderr, "ALML not found in names.json\n"); return 2; }
    i_stim[alml] = (int32_t)(40 * 65536);

    for (int f = 1; f <= 400; f++) {
        worm_step(&sim, 1);
        for (int i = 0; i < N_NEURONS; i++) {
            if (V[i] != golden[f][i]) {
                fprintf(stderr, "step %d neuron %d: C=%d python=%d (delta %d)\n",
                        f, i, V[i], golden[f][i], V[i] - golden[f][i]);
                return 1;
            }
        }
    }
    printf("OK: 400 steps x 302 neurons bit-for-bit against the Q16.16 reference\n");
    return 0;
}
