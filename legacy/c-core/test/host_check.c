#include <stdio.h>
#include <stdlib.h>

#include "badge_fsm.h"
#include "imu_throw.h"
#include "monster.h"

static void fail(const char *msg)
{
    fprintf(stderr, "FAIL: %s\n", msg);
    exit(1);
}

static void test_monster(void)
{
    Monster m;
    uint8_t wire[MONSTER_BYTES];
    Monster copy;

    if (sizeof(Monster) != 5) {
        fail("sizeof(Monster) != 5");
    }

    monster_init(&m, 12, 25, TYPE_WATER, true, true, 7, 15, 10, 0x0B);

    if (monster_species(&m) != 12) fail("species");
    if (monster_level(&m) != 25) fail("level");
    if (!monster_is_shiny(&m)) fail("shiny");
    if (monster_type(&m) != TYPE_WATER) fail("type");
    if (!monster_is_shielded(&m)) fail("shield");
    if (monster_hp_iv(&m) != 7) fail("hp");
    if (monster_atk_iv(&m) != 15) fail("atk");
    if (monster_def_iv(&m) != 10) fail("def");
    if (!monster_has_move(&m, 0) || !monster_has_move(&m, 1) || !monster_has_move(&m, 3)) {
        fail("moves");
    }
    if (monster_can_transfer(&m)) fail("shielded starter must not transfer");

    monster_pack(&m, wire);
    monster_unpack(&copy, wire);
    if (copy.bytes[0] != m.bytes[0] || copy.bytes[4] != m.bytes[4]) {
        fail("pack/unpack");
    }

    monster_init(&m, SPECIES_RAYQUAZA, 127, TYPE_DRAGON, false, false, 7, 15, 15, 0xFF);
    if (!monster_is_unbeatable(&m)) fail("rayquaza must be unbeatable");
    if (monster_can_transfer(&m)) fail("unbeatable must not transfer");
    if (!monster_species_is_unbeatable(SPECIES_GIRATINA)) fail("giratina species");
    if (!monster_species_is_unbeatable(SPECIES_DIALGA)) fail("dialga species");
    if (monster_species_is_unbeatable(25)) fail("pikachu is beatable");
}

static void test_fsm(void)
{
    BadgeFsm fsm;
    badge_fsm_init(&fsm, 0);

    if (fsm.mode != BADGE_IDLE) fail("init idle");

    badge_fsm_dispatch(&fsm, EVT_NFC_BIOME, 3, 10);
    if (fsm.mode != BADGE_ENCOUNTER || fsm.biome != 3) fail("nfc encounter");

    badge_fsm_dispatch(&fsm, EVT_THROW_RESOLVE, 0, 20);
    if (fsm.mode != BADGE_ENCOUNTER) fail("miss should retry");

    badge_fsm_dispatch(&fsm, EVT_THROW_RESOLVE, THROW_GREAT, 30);
    if (fsm.mode != BADGE_IDLE) fail("catch returns idle");

    badge_fsm_dispatch(&fsm, EVT_BUMP, 0, 40);
    if (fsm.mode != BADGE_BATTLE) fail("bump battle");

    badge_fsm_tick(&fsm, 40 + FSM_BATTLE_MS);
    if (fsm.mode != BADGE_IDLE) fail("battle timeout");

    badge_fsm_dispatch(&fsm, EVT_BUMP_TRADE, 0, 100);
    badge_fsm_dispatch(&fsm, EVT_CONFIRM, 0, 110);
    if (fsm.mode != BADGE_TRADE || fsm.trade_acks != 1) fail("trade step 1");
    badge_fsm_dispatch(&fsm, EVT_CONFIRM, 0, 120);
    if (fsm.mode != BADGE_IDLE) fail("trade step 2");

    badge_fsm_dispatch(&fsm, EVT_NFC_ROCKET, 0, 200);
    badge_fsm_dispatch(&fsm, EVT_BUMP, 0, 210);
    if (fsm.mode != BADGE_HEIST) fail("rocket heist");
    badge_fsm_dispatch(&fsm, EVT_SHAKE, 0, 220);
    if (fsm.mode != BADGE_IDLE) fail("shake breaks heist");
}

static void feed_rest(ThrowDetector *d, int n)
{
    AccelMg s = {0, 1000, 0};
    int i;
    for (i = 0; i < n; i++) {
        throw_detector_feed(d, s);
    }
}

static void test_throw(void)
{
    ThrowDetector d;
    AccelMg s;
    int i;
    bool done = false;

    throw_detector_init(&d);
    feed_rest(&d, IMU_CALIB_SAMPLES);
    if (d.phase != THROW_ARMED) fail("calib");

    /* Excellent: sharp +Y spike, little X/Z. */
    for (i = 0; i < 12; i++) {
        s.ax = 40;
        s.ay = (int16_t)(1000 + 4000);
        s.az = -20;
        done = throw_detector_feed(&d, s);
    }
    for (i = 0; i < IMU_THROW_END_HOLD + 1 && !done; i++) {
        s.ax = 0;
        s.ay = 1000;
        s.az = 0;
        done = throw_detector_feed(&d, s);
    }
    if (!done) fail("throw not detected");
    if (d.last_grade != THROW_EXCELLENT) fail("expected excellent");
    if (d.last_mult_tenths != 20) fail("excellent multiplier");
}

int main(void)
{
    test_monster();
    test_fsm();
    test_throw();
    puts("ok");
    return 0;
}
