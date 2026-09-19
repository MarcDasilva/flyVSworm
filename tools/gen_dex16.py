#!/usr/bin/env python3
"""Builds the badge's species data from the 16x16 pixel-art sprites.

Line format, one species per line, slot id in National Dex order:

    NN NAME type strength family c1,c2,..  <run pairs>

Art is run-length encoded as TWO chars per run - palette index in base 36,
then length in base 36 - so a decoder walks fixed pairs with no parsing. At
16x16 the runs are few enough that this beats packing them into one char,
which would cap the palette at four colours.

  python3 tools/gen_dex16.py            write app/dex16.txt
  python3 tools/gen_dex16.py --check    verify only
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

WATER, NORMAL, FIRE, ICE, GRASS, ELECTRIC = 1, 2, 3, 4, 5, 6

# (type, strength 1-10, family). Family is the evolution line; Eevee's
# children split across four types, so each is its own family.
#
# Eleven of these types are off-canon - the wheel has six positions and Kanto
# has fifteen. Psychic, Fighting, Ghost, Rock, Ground, Bug and Dragon are
# placed by sprite colour so the type chrome never fights the art.
SPECIES = {
    1:   (GRASS,    3,  1),   # Bulbasaur
    3:   (GRASS,    8,  1),   # Venusaur
    4:   (FIRE,     3,  2),   # Charmander
    6:   (FIRE,     8,  2),   # Charizard
    7:   (WATER,    3,  3),   # Squirtle
    9:   (WATER,    8,  3),   # Blastoise
    10:  (GRASS,    2, 18),   # Caterpie      - canon Bug, green
    25:  (ELECTRIC, 3,  4),   # Pikachu
    26:  (ELECTRIC, 5,  4),   # Raichu
    35:  (NORMAL,   2,  6),   # Clefairy      - canon Fairy
    38:  (FIRE,     5,  7),   # Ninetales
    39:  (NORMAL,   2,  8),   # Jigglypuff    - canon Normal/Fairy
    52:  (NORMAL,   2,  9),   # Meowth
    54:  (WATER,    3, 10),   # Psyduck
    59:  (FIRE,     7, 11),   # Arcanine
    61:  (WATER,    4, 12),   # Poliwhirl
    65:  (ELECTRIC, 7, 13),   # Alakazam      - canon Psychic, yellow-brown
    68:  (ICE,      7, 14),   # Machamp       - canon Fighting, grey-blue
    94:  (GRASS,    7, 15),   # Gengar        - canon Ghost/Poison
    95:  (GRASS,    5, 16),   # Onix          - canon Rock/Ground
    104: (NORMAL,   3, 17),   # Cubone        - canon Ground
    129: (WATER,    1,  5),   # Magikarp
    130: (WATER,    8,  5),   # Gyarados
    131: (ICE,      7, 19),   # Lapras        - canon Water/Ice
    132: (NORMAL,   2, 20),   # Ditto
    133: (NORMAL,   3, 21),   # Eevee
    134: (ICE,      6, 22),   # Vaporeon      - canon Water
    135: (ELECTRIC, 6, 23),   # Jolteon
    136: (FIRE,     6, 24),   # Flareon
    143: (ICE,      7, 25),   # Snorlax       - canon Normal, teal sprite
    144: (ICE,      9, 26),   # Articuno
    145: (ELECTRIC, 9, 27),   # Zapdos
    146: (FIRE,     9, 28),   # Moltres
    149: (ELECTRIC, 9, 29),   # Dragonite     - canon Dragon/Flying
    150: (ICE,     10, 30),   # Mewtwo        - canon Psychic
    151: (GRASS,   10, 31),   # Mew           - canon Psychic
}

SRC = "sprites/gen1-16"
OUT = "app/dex16.txt"
GRID = 16
COLORS = 8                 # per species; measured to cost ~3 runs over native
B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def sprite_path(dex_id):
    for f in os.listdir(SRC):
        if f.startswith(f"{dex_id:03d}-"):
            return os.path.join(SRC, f), f[4:-4].upper()
    sys.exit(f"no sprite for dex id {dex_id}")


def quantize(im, k):
    """Keeps the k most-used colours and maps the rest to the nearest kept one.

    The art is already flat and hand-picked, so frequency beats clustering
    here - a k-means centroid would invent a colour the artist never used.
    """
    px = im.load()
    counts = {}
    for y in range(GRID):
        for x in range(GRID):
            c = px[x, y]
            if c[3]:
                counts[c[:3]] = counts.get(c[:3], 0) + 1
    keep = sorted(counts, key=lambda c: -counts[c])[:k]
    keep.sort(key=lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
    cells = []
    for y in range(GRID):
        for x in range(GRID):
            c = px[x, y]
            if not c[3]:
                cells.append(0)
            else:
                cells.append(1 + min(range(len(keep)),
                                     key=lambda i: sum((a - b) ** 2
                                                       for a, b in zip(c[:3], keep[i]))))
    return keep, cells


def encode(cells):
    """(packed art, drawable run count). Runs NEVER cross a row boundary."""
    out, drawable = [], 0
    for y in range(GRID):
        row = cells[y * GRID:(y + 1) * GRID]
        start = 0
        for x in range(1, GRID + 1):
            if x == GRID or row[x] != row[start]:
                out.append(B36[row[start]] + B36[x - start])
                if row[start]:
                    drawable += 1
                start = x
    return "".join(out), drawable


def build():
    lines, worst, most = [], 0, 0
    for slot, dex_id in enumerate(sorted(SPECIES), start=1):
        path, name = sprite_path(dex_id)
        type_id, strength, family = SPECIES[dex_id]
        palette, cells = quantize(Image.open(path).convert("RGBA"), COLORS)
        art, drawable = encode(cells)
        worst = max(worst, drawable)
        most = max(most, len(palette))
        hexes = ",".join("%02X%02X%02X" % c for c in palette)
        lines.append(f"{slot:02d} {name} {type_id} {strength} {family} "
                     f"{hexes} {art}")
    return lines, worst, most


def check(lines, worst, most):
    assert len(lines) == 36, len(lines)
    per_type = {}
    for line in lines:
        slot, name, t, s, f, pal, art = line.split(" ")
        assert name.isalpha() and name.isupper(), name
        assert len(art) % 2 == 0, name
        cells = sum(B36.index(art[i + 1]) for i in range(0, len(art), 2))
        assert cells == GRID * GRID, f"{name}: {cells} cells, want {GRID * GRID}"
        assert 1 <= len(pal.split(",")) <= COLORS, name
        per_type[int(t)] = per_type.get(int(t), 0) + 1
    for t in range(1, 7):
        assert per_type[t] == 6, f"type {t} has {per_type[t]}, want 6"
    return "\n".join(lines) + "\n"


def main():
    lines, worst, most = build()
    text = check(lines, worst, most)
    if "--check" in sys.argv:
        print(f"check ok: 36 species, worst {worst} boxes, {len(text)} bytes")
        return
    with open(OUT, "w") as fh:
        fh.write(text)
    print(f"{OUT}: 36 species at {GRID}x{GRID}, up to {most} colours each, "
          f"worst {worst} boxes ({worst * 2} for a duel pair), "
          f"{len(text)} bytes of the 16 KiB read limit")


if __name__ == "__main__":
    main()
