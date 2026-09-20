#!/usr/bin/env python3
"""Generates app/dex.txt: 36 creatures, 12 families of 3, 2 families per type.

Art is a 16x16 grid of palette indices, mirrored left-to-right so every
creature reads face-on. Palette: 0 empty, 1 body, 2 shade, 3 accent.

Twelve families must stay distinguishable while sharing only six palettes,
so body plans vary on four INDEPENDENT axes rather than coming from a fixed
list of shapes. Two families share each colour; they must not share a
silhouette.

  python3 tools/gen_dex.py            write app/dex.txt
  python3 tools/gen_dex.py --preview  print all 36 as ASCII
"""
import sys

N = 16                      # grid is N x N
HALF = N // 2               # only the left half is drawn, then mirrored
TYPES = ["WATER", "NORMAL", "FIRE", "ICE", "GRASS", "ELECTRIC"]

# Four independent axes. Twelve families take twelve distinct combinations,
# chosen so that the two families sharing a palette never share an axis value
# in more than one position.
BODY  = ["round", "tall", "squat", "serp"]
HEAD  = ["merged", "distinct", "crested"]
LIMBS = ["none", "two", "four", "fins"]
CROWN = ["none", "horns", "ears", "antennae"]

FAMILY_PLAN = [
    # (body, head, limbs, crown) - index 0..11 is family 1..12
    ("round", "merged",   "two",  "none"),      # 1  Water A
    ("serp",  "distinct", "fins", "antennae"),  # 2  Water B
    ("squat", "distinct", "four", "none"),      # 3  Normal A
    ("tall",  "merged",   "two",  "ears"),      # 4  Normal B
    ("tall",  "crested",  "none", "horns"),     # 5  Fire A
    ("round", "distinct", "four", "antennae"),  # 6  Fire B
    ("squat", "merged",   "fins", "horns"),     # 7  Ice A
    ("tall",  "distinct", "four", "none"),      # 8  Ice B
    ("round", "crested",  "four", "ears"),      # 9  Grass A
    ("serp",  "merged",   "none", "horns"),     # 10 Grass B
    ("squat", "crested",  "two",  "antennae"),  # 11 Electric A
    ("tall",  "distinct", "fins", "ears"),      # 12 Electric B
]

# Six strengths per type: three easy, two middling, one trophy. The trophy
# rotates 8/9/10 across types so no single type owns the hardest catch.
STRENGTH_BASE = [1, 2, 3, 4, 6]
TROPHY = [9, 8, 10, 9, 10, 8]

SYL_A = ["AQUA", "TIDE", "MARI", "DRIP", "FLOW", "WAVE",
         "PLAIN", "DUSTY", "MUND", "TUFT", "PEBB", "FLUFF",
         "EMBER", "CIND", "BLAZE", "SCORCH", "MAGMA", "SOOT",
         "FROST", "GLACI", "RIME", "SLEET", "CHILL", "SHIVER",
         "LEAF", "VINE", "BLOOM", "THORN", "MOSS", "SPROUT",
         "VOLT", "SPARK", "ARC", "JOLT", "OHM", "STATIC"]
SYL_B = ["KIT", "LING", "MAW", "PAW", "WING", "TAIL",
         "FANG", "HORN", "CLAW", "PUP", "MANE", "SCALE"]


def blank():
    return [[0] * N for _ in range(N)]


def ell(g, cx, cy, rx, ry, val):
    """Filled ellipse in grid coordinates. Only the left half is written;
    mirroring happens once at the end."""
    for y in range(N):
        for x in range(HALF):
            dx, dy = (x - cx) / max(rx, 0.01), (y - cy) / max(ry, 0.01)
            if dx * dx + dy * dy <= 1.0:
                g[y][x] = val


def mirror(g):
    for y in range(N):
        for x in range(HALF):
            g[y][N - 1 - x] = g[y][x]


def build(family, stage):
    """stage 0,1,2 - same plan, growing size and gaining markings."""
    body, head, limbs, crown = FAMILY_PLAN[family]
    g = blank()
    grow = stage * 0.6                       # later stages are chunkier

    # --- torso -------------------------------------------------------------
    if body == "round":
        ell(g, 7.5, 10.0, 5.0 + grow, 4.2 + grow, 1)
    elif body == "tall":
        ell(g, 7.5, 10.0, 3.6 + grow * 0.5, 5.6 + grow, 1)
    elif body == "squat":
        ell(g, 7.5, 11.5, 6.0 + grow, 3.2 + grow * 0.5, 1)
    else:  # serpentine - a stacked column with a narrow waist
        ell(g, 7.5, 12.5, 4.4 + grow, 2.8, 1)
        ell(g, 7.5, 8.5, 2.6, 2.6 + grow * 0.5, 1)

    # --- head --------------------------------------------------------------
    if head == "merged":
        hy, hr = 6.5, 3.4 + grow * 0.4
        ell(g, 7.5, hy, hr, hr * 0.85, 1)
    elif head == "distinct":
        hy, hr = 4.6, 3.0 + grow * 0.4
        ell(g, 7.5, hy, hr, hr * 0.9, 1)
    else:  # crested - a head with a swept ridge on top
        hy, hr = 4.8, 3.0 + grow * 0.4
        ell(g, 7.5, hy, hr, hr * 0.9, 1)
        for x in range(2, 7):
            yy = 2 - (x - 2) // 2
            if 0 <= yy < N:
                g[yy][x] = 1

    # --- crown -------------------------------------------------------------
    top = int(hy - hr)
    if crown == "horns":
        for k in range(2 + stage):
            yy, xx = top - 1 - k, 4 - (k // 2)
            if 0 <= yy < N and 0 <= xx < HALF:
                g[yy][xx] = 1
    elif crown == "ears":
        for k in range(3 + stage):
            yy, xx = top - k, 4
            if 0 <= yy < N:
                g[yy][xx] = 1
    elif crown == "antennae":
        for k in range(2 + stage):
            yy, xx = top - 1 - k, 5 - k
            if 0 <= yy < N and 0 <= xx < HALF:
                g[yy][xx] = 1
        yy = top - 2 - stage
        if 0 <= yy < N:
            g[yy][max(0, 5 - (1 + stage))] = 3   # glowing tip

    # --- limbs -------------------------------------------------------------
    base = 14 if body == "squat" else 15
    if limbs in ("two", "four"):
        for xx in (4, 6):
            for yy in (base - 1, base):
                if 0 <= yy < N:
                    g[yy][xx] = 1
        if limbs == "four":
            for yy in (10, 11):
                g[yy][1] = 1
    elif limbs == "fins":
        for yy in (9, 10, 11):
            g[yy][0] = 1
            g[yy][1] = 1

    # --- eyes, always last so nothing overwrites them ----------------------
    ey = int(hy)
    if 0 <= ey < N:
        g[ey][5] = 3
        if stage >= 1 and 0 <= ey < N:
            g[ey][4] = 3      # bigger eye on later stages

    # --- belly shading -----------------------------------------------------
    for y in range(N):
        for x in range(HALF):
            if g[y][x] == 1 and y >= 11 and x <= 3:
                g[y][x] = 2
    if stage == 2:
        for x in range(2, 6):
            if g[12][x] == 1:
                g[12][x] = 2

    mirror(g)
    return g


def name_for(idx, family, stage):
    a = SYL_A[(family // 2) * 6 + (family % 2) * 3 + stage]
    b = SYL_B[(family + stage) % len(SYL_B)]
    n = (a + b)[:10]
    return n if len(n) >= 4 else (n + "MON")[:10]


def rows(g):
    return "".join("".join(str(c) for c in row) for row in g)


def generate():
    out = []
    sid = 0
    for t in range(6):                       # type 1..6
        strengths = STRENGTH_BASE + [TROPHY[t]]
        for fslot in range(2):               # two families per type
            family = t * 2 + fslot
            for stage in range(3):
                sid += 1
                s = strengths[fslot * 3 + stage]
                art = rows(build(family, stage))
                assert len(art) == 256, len(art)
                nm = name_for(sid, family, stage)
                out.append(f"{sid:02d} {nm} {t + 1} {s} {family + 1} {art}")
    assert len(out) == 36
    return out


def preview(lines):
    glyph = {"0": " ", "1": "#", "2": "+", "3": "o"}
    for i in range(0, 36, 3):
        trio = lines[i:i + 3]
        heads = []
        grids = []
        for ln in trio:
            p = ln.split(" ")
            heads.append(f"{p[1]} s{p[3]}".ljust(18))
            grids.append([p[5][r * 16:(r + 1) * 16] for r in range(16)])
        print("".join(heads))
        for r in range(16):
            print("".join("".join(glyph[c] for c in gr[r]) + "  " for gr in grids))
        print()


if __name__ == "__main__":
    lines = generate()
    if "--preview" in sys.argv:
        preview(lines)
    else:
        with open("app/dex.txt", "w") as f:
            f.write("\n".join(lines) + "\n")
        total = sum(len(l) + 1 for l in lines)
        print(f"wrote app/dex.txt: 36 species, {total} bytes")
