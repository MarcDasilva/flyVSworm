#ifndef MONSTER_H
#define MONSTER_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Wire payload: exactly 5 bytes. Safe to memcpy into a BLE manufacturer
 * AD blob or an ESP-NOW frame. Bitfields are avoided so endianness of
 * packing is identical on ESP32, nRF52, and RP2040 (GCC).
 *
 * Byte 0: species_id            (0 = empty slot, 1..255 = species)
 * Byte 1: [s][lllllll]          shiny << 7 | level (1..127)
 * Byte 2: [hhh][s][tttt]        hp_iv << 5 | shield << 4 | type (0..15)
 * Byte 3: [aaaa][dddd]          atk_iv << 4 | def_iv
 * Byte 4: moveset bitmask       bit n = move n unlocked (species pool)
 */
#define MONSTER_BYTES 5

/*
 * Unbeatable bosses (Hoenn weather trio + Sinnoh creation trio).
 * Wire species is one byte, so these sit at 250..255 instead of
 * National Dex. Sprites live in sprites/iconic-36/legendary/.
 */
#define SPECIES_UNBEATABLE_MIN 250
#define SPECIES_KYOGRE         250 /* dex 382, Water  */
#define SPECIES_GROUDON        251 /* dex 383, Ground */
#define SPECIES_RAYQUAZA       252 /* dex 384, Dragon */
#define SPECIES_DIALGA         253 /* dex 483, Dragon */
#define SPECIES_PALKIA         254 /* dex 484, Water  */
#define SPECIES_GIRATINA       255 /* dex 487, Ghost  */

typedef enum {
    TYPE_NORMAL = 0,
    TYPE_FIRE,
    TYPE_WATER,
    TYPE_GRASS,
    TYPE_ELECTRIC,
    TYPE_ICE,
    TYPE_FIGHTING,
    TYPE_POISON,
    TYPE_GROUND,
    TYPE_FLYING,
    TYPE_PSYCHIC,
    TYPE_BUG,
    TYPE_ROCK,
    TYPE_GHOST,
    TYPE_DRAGON,
    TYPE_DARK,
    TYPE_COUNT = 16
} ElementType;

typedef struct {
    uint8_t bytes[MONSTER_BYTES];
} Monster;

#ifdef __cplusplus
static_assert(sizeof(Monster) == MONSTER_BYTES, "Monster wire size must be 5");
static_assert(TYPE_COUNT <= 16, "ElementType must fit in 4 bits");
#else
_Static_assert(sizeof(Monster) == MONSTER_BYTES, "Monster wire size must be 5");
_Static_assert(TYPE_COUNT <= 16, "ElementType must fit in 4 bits");
#endif

void monster_clear(Monster *m);
bool monster_is_empty(const Monster *m);

void monster_init(Monster *m,
                  uint8_t species,
                  uint8_t level,
                  ElementType type,
                  bool shiny,
                  bool shield,
                  uint8_t hp_iv,
                  uint8_t atk_iv,
                  uint8_t def_iv,
                  uint8_t moves);

uint8_t monster_species(const Monster *m);
uint8_t monster_level(const Monster *m);
bool monster_is_shiny(const Monster *m);
ElementType monster_type(const Monster *m);
bool monster_is_shielded(const Monster *m);
uint8_t monster_hp_iv(const Monster *m);
uint8_t monster_atk_iv(const Monster *m);
uint8_t monster_def_iv(const Monster *m);
uint8_t monster_moves(const Monster *m);
bool monster_has_move(const Monster *m, uint8_t slot);

/* Starter is permanent: cannot be wagered, stolen, or traded. */
bool monster_can_transfer(const Monster *m);

/* Species 250..255: bosses that cannot be KO'd, caught, or transferred. */
bool monster_species_is_unbeatable(uint8_t species);
bool monster_is_unbeatable(const Monster *m);

void monster_pack(const Monster *m, uint8_t out[MONSTER_BYTES]);
void monster_unpack(Monster *m, const uint8_t in[MONSTER_BYTES]);

#ifdef __cplusplus
}
#endif

#endif /* MONSTER_H */
