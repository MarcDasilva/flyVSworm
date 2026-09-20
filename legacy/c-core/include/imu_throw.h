#ifndef IMU_THROW_H
#define IMU_THROW_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Streaming Pokéball-throw detector.
 *
 * Feed calibrated accelerometer samples at IMU_THROW_HZ (milli-g, 1 g = 1000).
 * Y is the pitch axis per the hardware spec; X and Z are the lateral axes
 * used for straightness. Subtracts a gravity estimate so rest (1 g) does
 * not look like a throw.
 *
 * Catch multiplier is in tenths (10 = 1.0x, 15 = 1.5x, 20 = 2.0x) so the
 * encounter RNG can stay integer: catch_roll < base_rate * multiplier / 10.
 */
#define IMU_THROW_HZ            100
#define IMU_THROW_WINDOW        40      /* 400 ms at 100 Hz */
#define IMU_THROW_MIN_SAMPLES   8
#define IMU_THROW_START_MG      1800    /* |dyn_y| to arm */
#define IMU_THROW_END_MG        600     /* |dyn_y| to settle */
#define IMU_THROW_END_HOLD      4       /* consecutive samples below end */
#define IMU_GRAVITY_MG          1000
#define IMU_CALIB_SAMPLES       25      /* 250 ms rest average */

typedef enum {
    THROW_IDLE = 0,
    THROW_CALIBRATING,
    THROW_ARMED,
    THROW_TRACKING
} ThrowPhase;

typedef enum {
    THROW_NONE = 0,
    THROW_NICE,
    THROW_GREAT,
    THROW_EXCELLENT
} ThrowGrade;

typedef struct {
    int16_t ax; /* milli-g */
    int16_t ay;
    int16_t az;
} AccelMg;

typedef struct {
    ThrowPhase phase;
    uint8_t calib_n;
    uint8_t n;              /* samples in current throw window */
    uint8_t below_end;      /* consecutive samples under END_MG */
    int32_t g_ax, g_ay, g_az;
    int16_t grav_x, grav_y, grav_z;
    int16_t peak_y;         /* max |dyn_y| in milli-g */
    uint64_t lat_energy;    /* sum(dx^2 + dz^2), milli-g^2 */
    ThrowGrade last_grade;
    uint8_t last_mult_tenths;
} ThrowDetector;

void throw_detector_init(ThrowDetector *d);

/* Optional: skip CALIBRATING and seed gravity (badge already at rest). */
void throw_detector_set_gravity(ThrowDetector *d, AccelMg rest);

/*
 * Returns true when a throw has just been graded (phase returns to ARMED).
 * Read d->last_grade and d->last_mult_tenths after a true return.
 */
bool throw_detector_feed(ThrowDetector *d, AccelMg sample);

ThrowGrade throw_grade_from_peak(int16_t peak_y_mg, uint8_t straightness);
uint8_t throw_multiplier_tenths(ThrowGrade grade);

#ifdef __cplusplus
}
#endif

#endif /* IMU_THROW_H */
