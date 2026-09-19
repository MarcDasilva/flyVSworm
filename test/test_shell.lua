package.path = "test/?.lua;app/?.lua;" .. package.path
local mock = require("mock_badge")
local M = mock.install()
local f = io.open("app/dex.txt", "rb"); M.files["dex.txt"] = f:read("a"); f:close()

require("main")

-- on_enter has a 3,000 ms budget on new firmware but only 250 ms on old, and
-- there is no way to detect which. Building ~170 widgets up front is the
-- classic way this app dies before it ever draws, so on_enter must build the
-- title screen and little else.
on_enter(M.root)
local after_enter = M.widget_count()
assert(after_enter < 40,
  "on_enter created " .. after_enter .. " widgets; it must stage the rest across ticks")

-- Input is ignored until construction finishes, or A lands on a half-built
-- screen and indexes a nil widget - fatal, with no pcall to catch it.
assert(current() == "TITLE")
M.press(badge.input.BUTTON.A)
assert(current() == "TITLE", "A must be ignored while still loading")

-- Construction completes within a couple of seconds of ticks.
M.tick(120)
assert(ready(), "staged construction did not finish within 120 ticks")
local total = M.widget_count()
assert(total > after_enter, "ticks must actually build something")
assert(total <= 512, "widget count " .. total .. " exceeds the hard cap of 512")

-- Every screen in the order must exist and be hidden except the current one.
for _, name in ipairs(SCREEN_ORDER) do
  assert(screens[name], "screen " .. name .. " was never built")
  assert(screens[name].root, "screen " .. name .. " has no root container")
end

-- The router shows exactly one screen at a time.
show("MAP")
assert(current() == "MAP")
assert(M.hidden[screens.MAP.root] == false)
assert(M.hidden[screens.TITLE.root] == true, "the old screen must be hidden")

-- LEDs are staged then shown once per frame, and the frame is derived from
-- the clock rather than a tick counter, because ticks pause under the HOME
-- confirmation while badge.sys.ms() keeps advancing.
led_scene("map_idle")
M.tick(10)
local lit = 0
for i = 1, 6 do
  local c = M.leds[i]
  if c[1] + c[2] + c[3] > 0 then lit = lit + 1 end
end
assert(lit > 0, "the map_idle LED scene lit nothing")

-- The resume gap: a HOME confirmation pauses ticks for seconds. Anything
-- timing-sensitive must notice and reset rather than fast-forwarding.
M.advance(5000)
on_tick()
assert(resumed(), "a tick gap over 300 ms must be reported as a resume")
on_tick()
assert(not resumed(), "resume must be a one-shot edge, not a sticky flag")

-- Exit must clean up the LEDs and persist, and must not error.
on_exit()
for i = 1, 6 do
  assert(M.leds[i][1] == 0 and M.leds[i][2] == 0 and M.leds[i][3] == 0,
    "on_exit must leave the LEDs dark")
end

print("test_shell: OK")
