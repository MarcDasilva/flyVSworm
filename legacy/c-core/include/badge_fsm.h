#ifndef BADGE_FSM_H
#define BADGE_FSM_H

#include <stdbool.h>
#include <stdint.h>

#include "monster.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Top-level badge modes. Encounter owns the throw QTE; Battle/Trade/Heist
 * are entered from a bump (radio) or a hidden NFC tag.
 */
typedef enum {
    BADGE_IDLE = 0,
    BADGE_ENCOUNTER,
    BADGE_BATTLE,
    BADGE_TRADE,
    BADGE_HEIST,
    BADGE_MODE_COUNT
} BadgeMode;

typedef enum {
    EVT_NONE = 0,
    EVT_NFC_BIOME,       /* wild spawn from venue sticker */
    EVT_NFC_ROCKET,      /* hidden tag: arm Team Rocket */
    EVT_THROW_RESOLVE,   /* IMU throw finished (see ThrowGrade in payload) */
    EVT_BUMP,            /* peer radio contact, no button held */
    EVT_BUMP_TRADE,      /* peer radio contact while trade button held */
    EVT_CONFIRM,         /* tactile confirm (trade step / ante lock-in) */
    EVT_CANCEL,          /* abort current mode */
    EVT_SHAKE,           /* IMU interrupt: break a heist siphon */
    EVT_TIMEOUT          /* injected by badge_fsm_tick() */
} BadgeEvent;

/* Mode dwell limits (ms). Heist siphon is spec'd at 10 s. */
#define FSM_ENCOUNTER_MS 20000u
#define FSM_BATTLE_MS    30000u
#define FSM_TRADE_MS     15000u
#define FSM_HEIST_MS     10000u

typedef struct {
    BadgeMode mode;
    uint32_t entered_ms;
    uint8_t biome;
    uint8_t trade_acks;     /* 0..2 two-step confirm */
    bool rocket_armed;      /* set by hidden NFC until next bump */
    Monster wild;           /* spawned encounter */
    Monster stake;          /* wagered / offered monster */
} BadgeFsm;

void badge_fsm_init(BadgeFsm *fsm, uint32_t now_ms);

/*
 * Advance the machine. now_ms is the RTC/uptime millisecond clock.
 * extra is event-specific: biome id, throw grade, etc.
 * Returns the mode after the transition.
 */
BadgeMode badge_fsm_dispatch(BadgeFsm *fsm,
                             BadgeEvent evt,
                             uint8_t extra,
                             uint32_t now_ms);

/* Call from the main loop; synthesizes EVT_TIMEOUT on dwell expiry. */
BadgeMode badge_fsm_tick(BadgeFsm *fsm, uint32_t now_ms);

#ifdef __cplusplus
}
#endif

#endif /* BADGE_FSM_H */
