#include "monster.h"

#include <string.h>

#define LVL_MASK   0x7Fu
#define SHINY_BIT  0x80u
#define TYPE_MASK  0x0Fu
#define SHIELD_BIT 0x10u
#define HP_SHIFT   5
#define HP_MASK    0x07u
#define ATK_SHIFT  4
#define NIBBLE     0x0Fu

static uint8_t clamp_u8(uint8_t v, uint8_t lo, uint8_t hi)
{
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}

void monster_clear(Monster *m)
{
    memset(m->bytes, 0, MONSTER_BYTES);
}

bool monster_is_empty(const Monster *m)
{
    return m->bytes[0] == 0;
}

void monster_init(Monster *m,
                  uint8_t species,
                  uint8_t level,
                  ElementType type,
                  bool shiny,
                  bool shield,
                  uint8_t hp_iv,
                  uint8_t atk_iv,
                  uint8_t def_iv,
                  uint8_t moves)
{
    monster_clear(m);
    if (species == 0) {
        return;
    }

    m->bytes[0] = species;
    m->bytes[1] = (uint8_t)(clamp_u8(level, 1, 127) & LVL_MASK);
    if (shiny) {
        m->bytes[1] |= SHINY_BIT;
    }

    m->bytes[2] = (uint8_t)((uint8_t)type & TYPE_MASK);
    if (shield) {
        m->bytes[2] |= SHIELD_BIT;
    }
    m->bytes[2] |= (uint8_t)((hp_iv & HP_MASK) << HP_SHIFT);

    m->bytes[3] = (uint8_t)(((atk_iv & NIBBLE) << ATK_SHIFT) | (def_iv & NIBBLE));
    m->bytes[4] = moves;
}

uint8_t monster_species(const Monster *m)
{
    return m->bytes[0];
}

uint8_t monster_level(const Monster *m)
{
    return (uint8_t)(m->bytes[1] & LVL_MASK);
}

bool monster_is_shiny(const Monster *m)
{
    return (m->bytes[1] & SHINY_BIT) != 0;
}

ElementType monster_type(const Monster *m)
{
    return (ElementType)(m->bytes[2] & TYPE_MASK);
}

bool monster_is_shielded(const Monster *m)
{
    return (m->bytes[2] & SHIELD_BIT) != 0;
}

uint8_t monster_hp_iv(const Monster *m)
{
    return (uint8_t)((m->bytes[2] >> HP_SHIFT) & HP_MASK);
}

uint8_t monster_atk_iv(const Monster *m)
{
    return (uint8_t)((m->bytes[3] >> ATK_SHIFT) & NIBBLE);
}

uint8_t monster_def_iv(const Monster *m)
{
    return (uint8_t)(m->bytes[3] & NIBBLE);
}

uint8_t monster_moves(const Monster *m)
{
    return m->bytes[4];
}

bool monster_has_move(const Monster *m, uint8_t slot)
{
    if (slot > 7) {
        return false;
    }
    return (m->bytes[4] & (uint8_t)(1u << slot)) != 0;
}

bool monster_can_transfer(const Monster *m)
{
    return !monster_is_empty(m) && !monster_is_shielded(m);
}

void monster_pack(const Monster *m, uint8_t out[MONSTER_BYTES])
{
    memcpy(out, m->bytes, MONSTER_BYTES);
}

void monster_unpack(Monster *m, const uint8_t in[MONSTER_BYTES])
{
    memcpy(m->bytes, in, MONSTER_BYTES);
}
