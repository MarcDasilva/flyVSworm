#ifndef FLY_FIXED_H
#define FLY_FIXED_H
#include <stdint.h>

/* ThruVM has no F or D extension. Fixed point is not a preference.
 *
 * The fly's weights are small -- the connectome spans 0.00059 to 0.053 -- so
 * Q8.8 (the worm's conductance format, 1/256 = 0.0039) cannot represent the
 * weakest pathway at all. Everything here is Q16.16, whose 1.5e-5 step resolves
 * the smallest weight to 39 units. This is not a free choice: rounding the
 * model's parameters to four significant figures already broke the ring on seed
 * 0 (drift 1.017 against a 1.0 gate), which is what pinned the spec to full
 * precision in the first place. */
#define Q16 65536

/* Arithmetic shift on a negative value floors toward -inf, matching RISC-V sra
 * AND Python's >>. The reference simulator relies on this -- do NOT "fix" it to
 * round-to-nearest or the bit-for-bit assert breaks. */
static inline int32_t q16_mul(int32_t a, int32_t b) {
    return (int32_t)(((int64_t)a * (int64_t)b) >> 16);
}

/* Same truncation, widened. The synaptic accumulator sums a row of the weight
 * matrix -- up to 110 entries for the busiest neuron -- and the reference adds
 * them at full width before narrowing, so this must too. */
static inline int64_t q16_mul64(int64_t a, int64_t b) {
    return (a * b) >> 16;
}

/* Python's // floors toward -inf for ALL sign combinations; C's / truncates
 * toward zero. v/tau is negative whenever v is, which on this model is often,
 * so the sign correction is load-bearing rather than defensive. */
static inline int64_t q16_floordiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    int64_t r = a % b;
    if (r != 0 && ((r < 0) != (b < 0))) q--;
    return q;
}

#endif
