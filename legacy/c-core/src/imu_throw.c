#include "imu_throw.h"

#define ABS16(v) ((int16_t)((v) < 0 ? -(v) : (v)))

static uint64_t sq_mg(int16_t v)
{
    int32_t x = v;
    return (uint64_t)x * (uint64_t)x;
}

uint8_t throw_multiplier_tenths(ThrowGrade grade)
{
    switch (grade) {
    case THROW_EXCELLENT:
        return 20;
    case THROW_GREAT:
        return 15;
    case THROW_NICE:
        return 10;
    default:
        return 0;
    }
}

/*
 * straightness is 0..255, where 255 is a perfectly axial pitch
 * (no energy on X/Z). Combined with peak Y G-force:
 *   Excellent: >= 3.5 g and very straight
 *   Great:     >= 2.5 g and reasonably straight
 *   Nice:      throw crossed the start threshold
 */
ThrowGrade throw_grade_from_peak(int16_t peak_y_mg, uint8_t straightness)
{
    if (peak_y_mg >= 3500 && straightness >= 200) {
        return THROW_EXCELLENT;
    }
    if (peak_y_mg >= 2500 && straightness >= 140) {
        return THROW_GREAT;
    }
    if (peak_y_mg >= IMU_THROW_START_MG) {
        return THROW_NICE;
    }
    return THROW_NONE;
}

static uint8_t straightness_score(int16_t peak_y, uint64_t lat_energy, uint8_t n)
{
    uint64_t fwd;
    uint64_t denom;

    if (n == 0 || peak_y <= 0) {
        return 0;
    }

    /* peak^2 * n sits in the same milli-g^2 units as lat_energy. */
    fwd = (uint64_t)peak_y * (uint64_t)peak_y * (uint64_t)n;
    denom = fwd + lat_energy;
    if (denom == 0) {
        return 0;
    }
    return (uint8_t)((fwd * 255u) / denom);
}

static void begin_tracking(ThrowDetector *d, int16_t dyn_y, int16_t dx, int16_t dz)
{
    d->phase = THROW_TRACKING;
    d->n = 1;
    d->below_end = 0;
    d->peak_y = ABS16(dyn_y);
    d->lat_energy = sq_mg(dx) + sq_mg(dz);
}

static bool finish_throw(ThrowDetector *d)
{
    uint8_t straight;
    ThrowGrade grade;

    straight = straightness_score(d->peak_y, d->lat_energy, d->n);
    grade = (d->n >= IMU_THROW_MIN_SAMPLES)
                ? throw_grade_from_peak(d->peak_y, straight)
                : THROW_NONE;

    d->last_grade = grade;
    d->last_mult_tenths = throw_multiplier_tenths(grade);
    d->phase = THROW_ARMED;
    d->n = 0;
    d->below_end = 0;
    d->peak_y = 0;
    d->lat_energy = 0;
    return grade != THROW_NONE;
}

void throw_detector_init(ThrowDetector *d)
{
    d->phase = THROW_CALIBRATING;
    d->calib_n = 0;
    d->n = 0;
    d->below_end = 0;
    d->g_ax = 0;
    d->g_ay = 0;
    d->g_az = 0;
    d->grav_x = 0;
    d->grav_y = IMU_GRAVITY_MG;
    d->grav_z = 0;
    d->peak_y = 0;
    d->lat_energy = 0;
    d->last_grade = THROW_NONE;
    d->last_mult_tenths = 0;
}

void throw_detector_set_gravity(ThrowDetector *d, AccelMg rest)
{
    d->grav_x = rest.ax;
    d->grav_y = rest.ay;
    d->grav_z = rest.az;
    d->phase = THROW_ARMED;
    d->calib_n = IMU_CALIB_SAMPLES;
}

bool throw_detector_feed(ThrowDetector *d, AccelMg sample)
{
    int16_t dx, dy, dz;
    int16_t abs_y;

    if (d->phase == THROW_CALIBRATING) {
        d->g_ax += sample.ax;
        d->g_ay += sample.ay;
        d->g_az += sample.az;
        d->calib_n++;
        if (d->calib_n >= IMU_CALIB_SAMPLES) {
            d->grav_x = (int16_t)(d->g_ax / IMU_CALIB_SAMPLES);
            d->grav_y = (int16_t)(d->g_ay / IMU_CALIB_SAMPLES);
            d->grav_z = (int16_t)(d->g_az / IMU_CALIB_SAMPLES);
            d->phase = THROW_ARMED;
        }
        return false;
    }

    dx = (int16_t)(sample.ax - d->grav_x);
    dy = (int16_t)(sample.ay - d->grav_y);
    dz = (int16_t)(sample.az - d->grav_z);
    abs_y = ABS16(dy);

    if (d->phase == THROW_ARMED) {
        if (abs_y >= IMU_THROW_START_MG) {
            begin_tracking(d, dy, dx, dz);
        }
        return false;
    }

    /* THROW_TRACKING: capture peak Y and lateral energy, then settle. */
    if (d->n < IMU_THROW_WINDOW) {
        d->n++;
        if (abs_y > d->peak_y) {
            d->peak_y = abs_y;
        }
        d->lat_energy += sq_mg(dx) + sq_mg(dz);
    }

    if (abs_y < IMU_THROW_END_MG) {
        d->below_end++;
    } else {
        d->below_end = 0;
    }

    if (d->below_end >= IMU_THROW_END_HOLD || d->n >= IMU_THROW_WINDOW) {
        return finish_throw(d);
    }
    return false;
}
