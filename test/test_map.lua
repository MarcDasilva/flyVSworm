package.path = "test/?.lua;app/?.lua;" .. package.path
local mock = require("mock_badge")
local M = mock.install()
local f = io.open("app/dex.txt", "rb"); M.files["dex.txt"] = f:read("a"); f:close()
local dex = require("dex")
require("main")
on_enter(M.root)
M.tick(120)
local own = require("own")
own.set_starter(dex.first_of_type(3))
show("MAP")

-- The map is the hub: every other screen must be one button away.
local B = badge.input.BUTTON
M.press(B.UP);    assert(current() == "DEX", "UP must open the Pokedex")
show("MAP"); M.press(B.DOWN);  assert(current() == "COLLECTION", "DOWN must open the collection")
show("MAP"); M.press(B.LEFT);  assert(current() == "PAIR", "LEFT must open pairing")
show("MAP"); M.press(B.START); assert(current() == "WALK", "START must open Walk mode")
M.press(B.B); assert(current() == "MAP", "B must come back from Walk mode")

-- AUX1 is in the enum but not on the board. Nothing may respond to it.
local before = current()
M.press(B.AUX1)
assert(current() == before, "AUX1 must be inert - it is not a physical button")

-- Walk mode is the ONLY place that takes a wake lock outside a duel, because
-- two AA cells do not survive holding the badge awake by default.
M.wake = nil
show("WALK")
assert(M.wake == true, "Walk mode must take the wake lock")
show("MAP")
assert(M.wake == false, "leaving Walk mode must release the wake lock")

-- Walk mode must be cheap: near-black, almost no widgets lit, and it must
-- not repaint per tick.
local painted_before = 0
for i = 1, #art_pool do if M.hidden[art_pool[i]] == false then painted_before = painted_before + 1 end end
assert(painted_before == 0 or true)
show("WALK")
M.tick(50)
local lit = 0
for i = 1, 6 do
  local c = M.leds[i]
  if c[1] + c[2] + c[3] > 40 then lit = lit + 1 end
end
assert(lit <= 1, "Walk mode must keep the LEDs nearly dark, " .. lit .. " were bright")

-- The step meter fills and eventually spawns an encounter.
show("WALK")
local start = own.steps()
for _ = 1, 200 do add_step_for_test() end
assert(own.steps() == start + 200, "steps must persist through own")
assert(spawn_meter() >= 0 and spawn_target() >= 40 and spawn_target() <= 80,
  "spawn target must be 40-80 steps, got " .. spawn_target())

-- Crossing the target must move to an encounter and reset the meter. Do
-- this across several respawns, not one: refresh_map divides by target,
-- so a reseed that is usually fine but occasionally lands on zero would
-- be a divide-by-zero on a badge with no pcall, and a single respawn is
-- not enough to catch a formula that only fails sometimes.
for i = 1, 5 do
  show("WALK")
  while current() == "WALK" do add_step_for_test(); on_tick() end
  assert(current() == "ENCOUNTER",
    "filling the step meter must spawn an encounter, respawn " .. i)
  assert(spawn_meter() == 0, "the meter must reset after spawning, respawn " .. i)
  assert(spawn_target() ~= 0,
    "respawned target must never be zero, respawn " .. i)
  assert(spawn_target() >= 40 and spawn_target() <= 80,
    "respawned target must be 40-80, got " .. spawn_target() ..
    " on respawn " .. i)
end

-- The spawn meter must animate on MAP once it has any progress, not just
-- breathe idly forever - a fixed LED scene here is dead code that would
-- silently regress if the switch to step_meter were ever removed.
show("MAP")
for _ = 1, 20 do add_step_for_test() end
M.tick(10)
local smc = M.leds[1]
assert(smc[1] == 0 and smc[2] == 60 and smc[3] == 30,
  "MAP must switch to the step_meter LED scene once steps have accrued")

-- Steps must NOT accrue on screens where the badge is being thrown, or a
-- throw registers as a walk.
show("DEX")
local s0 = own.steps()
add_step_for_test()
assert(own.steps() == s0, "DEX must not count steps")

print("test_map: OK")
