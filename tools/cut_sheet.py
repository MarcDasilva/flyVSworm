#!/usr/bin/env python3
"""Cuts the 151-Pokemon pixel-art sheet into one transparent PNG per species.

The art is drawn on a 6 px block grid aligned to the image origin, so the
sheet is really 280x240 pixels upscaled 6x. Everything here works in that
NATIVE space: each of the 14 columns is 20 native pixels wide, and every
sprite is drawn on a 16x16 canvas inside it.

Output is a uniform 16x16 so the badge gets ONE decoder, ONE pool size and no
per-species offsets. Exactly one sprite (Muk) measures 17 wide; its extra
column is a single body-coloured pixel from WebP bleed and is cropped.

Two artifacts have to be undone. The source is lossy WebP, so each block's
36 pixels disagree slightly; block MEDIAN fixes that. Then near-identical
colours are merged, or one flat body colour reads as forty.

Background removal is a flood fill from each cell's border, NOT a black-key:
these sprites have near-black outlines and dark interior pixels that a naive
key would punch holes through.

  python3 tools/cut_sheet.py            write sprites/gen1-sheet/
  python3 tools/cut_sheet.py --sheet    also write a labelled contact sheet
"""
import os
import sys
from collections import deque

from PIL import Image, ImageDraw

SRC = (".context/attachments/As0jDw/"
       "all-151-gen-1-pokemon-pixel-art-by-me-v0-l1xavzdt90f01.webp")
OUT = "sprites/gen1-16"
CANVAS = 16      # the artist's drawing canvas; 150 of 151 fit exactly
COLS, PITCH = 14, 20         # native pixels, not source pixels
BLOCK = 6                    # source pixels per native pixel
DARK = 30                    # r+g+b at or below this is background-coloured
MERGE = 30                   # squared-distance floor for "the same colour"

NAMES = """Bulbasaur Ivysaur Venusaur Charmander Charmeleon Charizard Squirtle
Wartortle Blastoise Caterpie Metapod Butterfree Weedle Kakuna Beedrill Pidgey
Pidgeotto Pidgeot Rattata Raticate Spearow Fearow Ekans Arbok Pikachu Raichu
Sandshrew Sandslash NidoranF Nidorina Nidoqueen NidoranM Nidorino Nidoking
Clefairy Clefable Vulpix Ninetales Jigglypuff Wigglytuff Zubat Golbat Oddish
Gloom Vileplume Paras Parasect Venonat Venomoth Diglett Dugtrio Meowth Persian
Psyduck Golduck Mankey Primeape Growlithe Arcanine Poliwag Poliwhirl Poliwrath
Abra Kadabra Alakazam Machop Machoke Machamp Bellsprout Weepinbell Victreebel
Tentacool Tentacruel Geodude Graveler Golem Ponyta Rapidash Slowpoke Slowbro
Magnemite Magneton Farfetchd Doduo Dodrio Seel Dewgong Grimer Muk Shellder
Cloyster Gastly Haunter Gengar Onix Drowzee Hypno Krabby Kingler Voltorb
Electrode Exeggcute Exeggutor Cubone Marowak Hitmonlee Hitmonchan Lickitung
Koffing Weezing Rhyhorn Rhydon Chansey Tangela Kangaskhan Horsea Seadra Goldeen
Seaking Staryu Starmie MrMime Scyther Jynx Electabuzz Magmar Pinsir Tauros
Magikarp Gyarados Lapras Ditto Eevee Vaporeon Jolteon Flareon Porygon Omanyte
Omastar Kabuto Kabutops Aerodactyl Snorlax Articuno Zapdos Moltres Dratini
Dragonair Dragonite Mewtwo Mew""".split()


def to_native(im):
    """Collapses each 6x6 source block to its median colour."""
    w, h = im.size
    px = im.load()
    out = Image.new("RGB", (w // BLOCK, h // BLOCK))
    op = out.load()
    for by in range(h // BLOCK):
        for bx in range(w // BLOCK):
            vals = [px[bx * BLOCK + i, by * BLOCK + j]
                    for i in range(BLOCK) for j in range(BLOCK)]
            op[bx, by] = tuple(sorted(v[k] for v in vals)[len(vals) // 2]
                               for k in range(3))
    return out


def denoise(cell):
    """Merges near-identical colours into the most frequent of their cluster."""
    counts = {}
    px = cell.load()
    w, h = cell.size
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3]:
                counts[c[:3]] = counts.get(c[:3], 0) + 1
    ranked = sorted(counts, key=lambda c: -counts[c])
    canon = {}
    keep = []
    for c in ranked:
        hit = next((k for k in keep
                    if sum((a - b) ** 2 for a, b in zip(c, k)) <= MERGE), None)
        canon[c] = hit or c
        if hit is None:
            keep.append(c)
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3]:
                px[x, y] = (*canon[c[:3]], 255)
    return len(keep)


def row_bands(im):
    """Content rows, minus the title band and anything below the last sprite row."""
    w, h = im.size
    px = im.load()
    lit_rows = [any(sum(px[x, y][:3]) > DARK for x in range(w)) for y in range(h)]
    bands, start = [], None
    for y, on in enumerate(lit_rows + [False]):
        if on and start is None:
            start = y
        elif not on and start is not None:
            if y - start >= 4:
                bands.append((start, y - 1))
            start = None
    return bands[1:]            # band 0 is the Pokemon title


def cut(im, x0, y0, x1, y1):
    """Crops a cell and makes only BORDER-CONNECTED dark pixels transparent."""
    cell = im.crop((x0, y0, x1 + 1, y1 + 1)).convert("RGBA")
    w, h = cell.size
    px = cell.load()
    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y][x]:
            continue
        if sum(px[x, y][:3]) > DARK:
            continue
        seen[y][x] = True
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    bbox = cell.getbbox()
    if not bbox:
        return None
    art = cell.crop(bbox)
    # Centre on the fixed canvas, cropping any WebP-bled overflow column.
    if art.width > CANVAS or art.height > CANVAS:
        ox = max(0, (art.width - CANVAS) // 2)
        oy = max(0, (art.height - CANVAS) // 2)
        art = art.crop((ox, oy, min(art.width, ox + CANVAS),
                        min(art.height, oy + CANVAS)))
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(art, ((CANVAS - art.width) // 2, (CANVAS - art.height) // 2), art)
    return out


def main():
    im = to_native(Image.open(SRC).convert("RGB"))
    bands = row_bands(im)
    if len(bands) != 11:
        sys.exit(f"expected 11 sprite rows, found {len(bands)}")

    os.makedirs(OUT, exist_ok=True)
    cut_out, missing, palettes = [], [], []
    for i, name in enumerate(NAMES):
        r, c = divmod(i, COLS)
        y0, y1 = bands[r]
        sprite = cut(im, c * PITCH, y0, c * PITCH + PITCH - 1, y1)
        if sprite is None:
            missing.append(name)
            continue
        palettes.append(denoise(sprite))
        sprite.save(f"{OUT}/{i + 1:03d}-{name}.png")
        cut_out.append((i + 1, name, sprite))

    if missing:
        sys.exit(f"empty cells: {missing}")
    print(f"{OUT}: {len(cut_out)} sprites, uniform {CANVAS}x{CANVAS}, "
          f"{min(palettes)}-{max(palettes)} colours each "
          f"(median {sorted(palettes)[len(palettes)//2]})")

    if "--sheet" in sys.argv:
        cw, ch, cols = 132, 136, 10
        Z = 7
        sheet = Image.new("RGB", (cols * cw, ((len(cut_out) + cols - 1) // cols) * ch),
                          (18, 18, 22))
        d = ImageDraw.Draw(sheet)
        for j, (num, name, sp) in enumerate(cut_out):
            x0, y0 = (j % cols) * cw, (j // cols) * ch
            big = sp.resize((sp.width * Z, sp.height * Z), Image.NEAREST)
            sheet.paste(big, (x0 + (cw - big.width) // 2, y0 + 4), big)
            d.text((x0 + 4, y0 + 118), f"{num} {name}", fill=(235, 235, 235))
        sheet.save(".context/art/gen1_labelled.png")
        print("labelled contact sheet: .context/art/gen1_labelled.png")


if __name__ == "__main__":
    main()
