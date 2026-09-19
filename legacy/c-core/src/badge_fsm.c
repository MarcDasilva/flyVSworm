#include "badge_fsm.h"

#include <string.h>

static uint32_t mode_limit_ms(BadgeMode mode)
{
    switch (mode) {
    case BADGE_ENCOUNTER:
        return FSM_ENCOUNTER_MS;
    case BADGE_BATTLE:
        return FSM_BATTLE_MS;
    case BADGE_TRADE:
        return FSM_TRADE_MS;
    case BADGE_HEIST:
        return FSM_HEIST_MS;
    default:
        return 0;
    }
}

static void enter_mode(BadgeFsm *fsm, BadgeMode mode, uint32_t now_ms)
{
    fsm->mode = mode;
    fsm->entered_ms = now_ms;
    if (mode != BADGE_TRADE) {
        fsm->trade_acks = 0;
    }
    if (mode == BADGE_IDLE) {
        monster_clear(&fsm->wild);
        monster_clear(&fsm->stake);
    }
}

void badge_fsm_init(BadgeFsm *fsm, uint32_t now_ms)
{
    memset(fsm, 0, sizeof(*fsm));
    enter_mode(fsm, BADGE_IDLE, now_ms);
}

static BadgeMode on_idle(BadgeFsm *fsm, BadgeEvent evt, uint8_t extra, uint32_t now_ms)
{
    switch (evt) {
    case EVT_NFC_BIOME:
        fsm->biome = extra;
        enter_mode(fsm, BADGE_ENCOUNTER, now_ms);
        return fsm->mode;
    case EVT_NFC_ROCKET:
        fsm->rocket_armed = true;
        return fsm->mode;
    case EVT_BUMP:
        if (fsm->rocket_armed) {
            fsm->rocket_armed = false;
            enter_mode(fsm, BADGE_HEIST, now_ms);
        } else {
            enter_mode(fsm, BADGE_BATTLE, now_ms);
        }
        return fsm->mode;
    case EVT_BUMP_TRADE:
        fsm->rocket_armed = false;
        fsm->trade_acks = 0;
        enter_mode(fsm, BADGE_TRADE, now_ms);
        return fsm->mode;
    default:
        return fsm->mode;
    }
}

static BadgeMode on_encounter(BadgeFsm *fsm, BadgeEvent evt, uint8_t extra, uint32_t now_ms)
{
    switch (evt) {
    case EVT_THROW_RESOLVE:
        /* extra == 0 is a miss; stay in encounter so the trainer can retry. */
        if (extra == 0) {
            return fsm->mode;
        }
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    case EVT_CANCEL:
    case EVT_TIMEOUT:
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    default:
        return fsm->mode;
    }
}

static BadgeMode on_battle(BadgeFsm *fsm, BadgeEvent evt, uint32_t now_ms)
{
    switch (evt) {
    case EVT_CANCEL:
    case EVT_TIMEOUT:
    case EVT_CONFIRM: /* battle layer reports a KO via CONFIRM */
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    default:
        return fsm->mode;
    }
}

static BadgeMode on_trade(BadgeFsm *fsm, BadgeEvent evt, uint32_t now_ms)
{
    switch (evt) {
    case EVT_CONFIRM:
        fsm->trade_acks++;
        if (fsm->trade_acks >= 2) {
            enter_mode(fsm, BADGE_IDLE, now_ms);
        }
        return fsm->mode;
    case EVT_CANCEL:
    case EVT_TIMEOUT:
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    default:
        return fsm->mode;
    }
}

static BadgeMode on_heist(BadgeFsm *fsm, BadgeEvent evt, uint32_t now_ms)
{
    switch (evt) {
    case EVT_SHAKE:
        /* Victim broke the siphon. */
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    case EVT_TIMEOUT:
        /* Siphon completed — steal is applied by the heist layer. */
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    case EVT_CANCEL:
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    default:
        return fsm->mode;
    }
}

BadgeMode badge_fsm_dispatch(BadgeFsm *fsm,
                             BadgeEvent evt,
                             uint8_t extra,
                             uint32_t now_ms)
{
    if (evt == EVT_NONE) {
        return fsm->mode;
    }

    switch (fsm->mode) {
    case BADGE_IDLE:
        return on_idle(fsm, evt, extra, now_ms);
    case BADGE_ENCOUNTER:
        return on_encounter(fsm, evt, extra, now_ms);
    case BADGE_BATTLE:
        return on_battle(fsm, evt, now_ms);
    case BADGE_TRADE:
        return on_trade(fsm, evt, now_ms);
    case BADGE_HEIST:
        return on_heist(fsm, evt, now_ms);
    default:
        enter_mode(fsm, BADGE_IDLE, now_ms);
        return fsm->mode;
    }
}

BadgeMode badge_fsm_tick(BadgeFsm *fsm, uint32_t now_ms)
{
    uint32_t limit = mode_limit_ms(fsm->mode);
    if (limit == 0) {
        return fsm->mode;
    }
    if ((uint32_t)(now_ms - fsm->entered_ms) >= limit) {
        return badge_fsm_dispatch(fsm, EVT_TIMEOUT, 0, now_ms);
    }
    return fsm->mode;
}
