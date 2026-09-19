-- Throwaway. Answers exactly two questions the design branches on:
-- does badge.radio carry NUL bytes, and what does a 10 KB dex.txt cost
-- on a real ESP32-C3 heap. Delete after phase 0.
local lines = {}
local dex, heap_before, heap_after, peak
local radio_ok, echo_seen, echo_binary = false, false, false
local sent_at = 0

local function say(i, s)
  if lines[i] then lines[i]:set_text(s) end
end

function on_enter(root)
  local bg = badge.ui.box(root, 320, 240)
  bg:set_pos(0, 0)
  bg:style({bg_color = 0x101418})
  for i = 1, 8 do
    lines[i] = badge.ui.label(root, "")
    lines[i]:style({text_font = 14})
    lines[i]:align("top_left", 8, 6 + (i - 1) * 22)
  end

  -- Measure the dex cost with a collection either side, so the number is
  -- the resident string and not accumulated garbage.
  badge.sys.gc_step(); badge.sys.gc_step(); badge.sys.gc_step()
  heap_before = badge.sys.heap()
  dex = badge.fs.read("dex.txt")
  badge.sys.gc_step(); badge.sys.gc_step(); badge.sys.gc_step()
  heap_after = badge.sys.heap()

  say(1, "dex bytes: " .. tostring(dex and #dex or -1))
  say(2, "heap before: " .. heap_before)
  say(3, "heap after:  " .. heap_after)
  say(4, "dex cost:    " .. (heap_after - heap_before))

  local x, y, z = badge.sensor.accel()
  say(5, x and ("accel ok: " .. math.floor(x) .. "," .. math.floor(y) .. "," .. math.floor(z))
        or "ACCEL UNAVAILABLE")

  radio_ok = badge.radio.enable()
  say(6, radio_ok and "radio: on - press A to test binary" or "RADIO FAILED TO ENABLE")
  if radio_ok then
    badge.radio.on_recv(function(mac, rssi, payload)
      if type(payload) ~= "string" then return end
      if #payload < 4 or payload:sub(1, 3) ~= "PRB" then return end
      echo_seen = true
      -- The whole question: did the NUL and the high byte survive the air?
      echo_binary = (#payload == 7)
        and (payload:sub(4, 4) == "\0")
        and (payload:sub(5, 5) == "\255")
        and (payload:sub(6, 6) == "\10")
        and (payload:sub(7, 7) == "\13")
      say(7, "echo len=" .. #payload .. " binary_ok=" .. tostring(echo_binary))
    end)
  end
  say(8, "A send  B stats  HOME exit")
end

function on_tick()
  local st = badge.sys.stats()
  if st and st.lua_peak then peak = st.lua_peak end
end

function on_button(b, kind)
  if kind ~= badge.input.KIND.PRESSED then return end
  if b == badge.input.BUTTON.A and radio_ok then
    -- NUL, 0xFF, LF and CR are the four bytes most likely to be eaten by a
    -- string-oriented transport. If all four return, binary framing is safe.
    badge.radio.send("PRB" .. "\0" .. "\255" .. "\10" .. "\13")
    sent_at = badge.sys.ms()
    say(7, "sent at " .. sent_at .. " - waiting for the other badge")
  elseif b == badge.input.BUTTON.B then
    local st = badge.sys.stats()
    say(2, "used " .. st.lua_used .. " peak " .. st.lua_peak)
    say(3, "limit " .. st.lua_limit .. " free " .. st.free_heap)
    say(4, "widgets " .. st.widgets .. " dropped " .. badge.radio.dropped())
  end
end

function on_exit()
  if radio_ok then
    badge.radio.on_recv(nil)
    badge.radio.disable()
  end
  badge.led.clear()
  badge.led.show()
end
