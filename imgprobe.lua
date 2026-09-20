--[==[badge-app
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

local W, H = 14, 14
local PAL = {0x222B4D, 0xFEE92F, 0xFFEB27, 0x070200, 0xFB0649, 0xFE014C, 0xFD7BA4, 0xF8EA2B, 0xFFA600, 0x000000, 0xF6A700, 0xFEA506, 0xF3A505, 0xA75833}
local CELLS = "!!!!!!!!\"!!!!!!!!!!!!!#!!!!!\"$$!$$$$$!!!!!!!#$$$$$$!!!!!!!!$%$$%#!!!!!!!!&$$$$'!!!!!!!!'$((#'!)!!!!!!!#$$$%$$!!!!#$$$**$$#+$$$!!!!*$$$,+%#-,!!!!*$$$$%$.!!!!!#$$$$$/-!!!!!!$****$!!!!!!!#$-!!$$$!!!!"        -- 025-Pikachu.png, 14 colours, one char per pixel

local info, parent
local PATH, ALT = "spr.bin", "appdata/spr.bin"

local function say(s) info:set_text(s) end

local function build()
  local rgb, alpha = {}, {}
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
  say("built " .. #data .. " b (want 600)"
    .. "\nwrite " .. tostring(ok) .. " / " .. tostring(ok2)
    .. "  exists " .. tostring(badge.fs.exists(PATH))
    .. "\nfree " .. badge.sys.stats().free_heap
    .. "\nA image(" .. PATH .. ")"
    .. "\nB image(" .. ALT .. ")")
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
    .. "\nwidgets " .. st.widgets .. "  free " .. st.free_heap)
end
