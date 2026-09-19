#ifndef WORM_FIXED_H
#define WORM_FIXED_H
#include <stdint.h>

/* ThruVM has no F or D extension. Fixed point is not a preference. */
#define Q16            65536
#define LUT_SPAN       (8 * Q16)   /* LUT covers x in [-8, +8] */
#define LUT_STEP_SHIFT 12          /* (16 << 16) / 256 == 4096 == 1 << 12 */

/* Arithmetic shift on a negative value floors toward -inf, matching RISC-V
 * sra AND Python's >>. The reference simulator relies on this — do NOT
 * "fix" it to round-to-nearest or the bit-for-bit assert breaks. */
static inline int32_t q16_mul(int32_t a, int32_t b) {
    return (int32_t)(((int64_t)a * (int64_t)b) >> 16);
}

/* SAME truncation as q16_mul, widened for the backward-Euler solve. acc_gE
 * and acc_g are int64 accumulators — AVAL alone has ~74 incoming edges and
 * overflows int32 — and the Python reference multiplies them by dt at full
 * precision, never narrowing to int32 first. Narrowing to int32 before this
 * multiply wraps the accumulator and diverges from the golden vector after a
 * few steps, not on step 1 — see worm_step's backward-Euler solve in sim.c. */
static inline int64_t q16_mul64(int64_t a, int64_t b) {
    return (a * b) >> 16;
}

/* Python's // floors toward -inf for ALL sign combinations; C's / truncates
 * toward zero. den is always positive (a conductance sum), but num carries
 * V's sign, so a negative numerator with nonzero remainder needs the q--
 * below or the backward-Euler solve is off by one ULP every step it's
 * negative — exactly the mismatch this exists to catch. */
static inline int64_t q16_floordiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    int64_t r = a % b;
    if (r != 0 && ((r < 0) != (b < 0))) q--;
    return q;
}

/* 257th entry is the right edge, so interpolation never reads past the end. */
static inline int32_t sigmoid_q16(int32_t x, int32_t const *lut) {
    if (x < -LUT_SPAN)     x = -LUT_SPAN;
    if (x >  LUT_SPAN - 1) x =  LUT_SPAN - 1;
    int32_t t    = x + LUT_SPAN;
    int32_t idx  = t >> LUT_STEP_SHIFT;
    int32_t frac = t & ((1 << LUT_STEP_SHIFT) - 1);
    int32_t lo = lut[idx], hi = lut[idx + 1];
    return lo + (int32_t)(((int64_t)(hi - lo) * frac) >> LUT_STEP_SHIFT);
}
#endif
