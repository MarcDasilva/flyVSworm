#!/usr/bin/env python3
"""Emits imgprobe.lua: does badge.ui.image load a .bin the app wrote itself?

If yes, a creature costs ONE widget instead of the ~60-100 row-run boxes it
costs today, and the measured 240-widget ceiling stops governing how many fit
on screen. That is the whole question; everything else here is scaffolding.

Embeds one native sprite as a palette plus one index char per pixel.
"""
import os
import sys

from PIL import Image

SPRITE = "sprites/gen1-sheet/025-Pikachu.png"
OUT = "imgprobe.lua"


def main():
    im = Image.open(SPRITE).convert("RGBA")
    w, h = im.size
    px = im.load()
    palette = []
    idx = []
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3] == 0:
                idx.append(0)
                continue
            if c[:3] not in palette:
                palette.append(c[:3])
            idx.append(palette.index(c[:3]) + 1)
    if len(palette) > 93:
        sys.exit(f"{len(palette)} colours will not fit one printable char each")

    cells = "".join(chr(33 + i) for i in idx)
    esc = cells.replace("\\", "\\\\").replace('"', '\\"')
    pal = ", ".join("0x%02X%02X%02X" % c for c in palette)
    want = 12 + w * h * 3

    with open(OUT, "w") as fh:
        fh.write(TEMPLATE.format(w=w, h=h, pal=pal, cells=esc, want=want,
                                 name=os.path.basename(SPRITE), ncol=len(palette)))
    print(f"{OUT}: {os.path.getsize(OUT)} bytes, {w}x{h} sprite, "
          f"{len(palette)} colours, target .bin {want} bytes")


TEMPLATE = '''--[==[badge-app
slug=imgprobe
name=Image Probe
icon=IMG
api=2
]==]
-- Tests ONE thing: can the app write an LVGL .bin at runtime and then draw it
-- with badge.ui.image? If yes a creature costs ONE widget instead of ~100
-- row-run boxes, and the measured 240-widget ceiling stops mattering.
--
-- The 12-byte header is not a guess: the guide states a 42x42 icon.bin is
-- 5,304 bytes, and 12 + 42*42*2 (RGB565) + 42*42 (A8) is exactly 5,304.
--
--   on enter   builds and writes the file, reports bytes and exists()
--   A          the risky call: badge.ui.image on that file
--   B          same from the appdata/ path, in case the app dir is read-only

local W, H = {w}, {h}
local PAL = {{{pal}}}
local CELLS = "{cells}"        -- {name}, {ncol} colours, one char per pixel

local info, parent
local PATH, ALT = "spr.bin", "appdata/spr.bin"

local function say(s) info:set_text(s) end

local function build()
  local rgb, alpha = {{}}, {{}}
  for i = 1, W * H do
    local idx = string.byte(CELLS, i) - 33
    if idx == 0 then
      rgb[i] = string.char(0, 0)
      alpha[i] = string.char(0)
    else
      local c = PAL[idx]
      local r = math.floor(c / 65536) % 256
      local g = math.floor(c / 256) % 256
      local b = c % 256
      -- RGB565, little endian: 5 bits red, 6 green, 5 blue.
      local p = math.floor(r / 8) * 2048 + math.floor(g / 4) * 32 + math.floor(b / 8)
      rgb[i] = string.char(p % 256, math.floor(p / 256))
      alpha[i] = string.char(255)
    end
  end
  -- magic 0x19, cf 0x14 (RGB565A8), flags, w, h, stride = w*2, reserved
  local hdr = string.char(0x19, 0x14, 0, 0,
                          W % 256, math.floor(W / 256),
                          H % 256, math.floor(H / 256),
                          (W * 2) % 256, math.floor(W * 2 / 256), 0, 0)
  return hdr .. table.concat(rgb) .. table.concat(alpha)
end

function on_enter(root)
  parent = root
  info = badge.ui.label(root, "")
  info:align("top_left", 6, 6)
  local data = build()
  local ok = badge.fs.write(PATH, data)
  local ok2 = badge.fs.write(ALT, data)
  say("built " .. #data .. " b (want {want})"
    .. "\\nwrite " .. tostring(ok) .. " / " .. tostring(ok2)
    .. "  exists " .. tostring(badge.fs.exists(PATH))
    .. "\\nfree " .. badge.sys.stats().free_heap
    .. "\\nA image(" .. PATH .. ")"
    .. "\\nB image(" .. ALT .. ")")
end

function on_button(b, kind)
  if kind ~= badge.input.KIND.PRESSED then return end
  local path = (b == badge.input.BUTTON.A) and PATH
            or (b == badge.input.BUTTON.B) and ALT
  if not path then return end
  say("calling image(" .. path .. ") ...")
  local w = badge.ui.image(parent, path)
  w:align("center", 0, 20)
  local st = badge.sys.stats()
  say("IMAGE OK from " .. path
    .. "\\nwidgets " .. st.widgets .. "  free " .. st.free_heap)
end
'''


if __name__ == "__main__":
    main()
