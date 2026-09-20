package.path = "test/?.lua;app/?.lua;" .. package.path
local mock = require("mock_badge")
local M = mock.install()
local f = io.open("app/dex.txt", "rb"); M.files["dex.txt"] = f:read("a"); f:close()
local dex = require("dex")
require("main")
on_enter(M.root)
M.tick(120)
assert(ready())

local own = require("own")

-- Exactly three starters: one Fire, one Water, one Grass. The other three
-- types must come from catching and hatching, never from the egg.
local ids = starter_ids()
assert(#ids == 3, "expected 3 starters, got " .. #ids)
local seen = {}
for _, id in ipairs(ids) do
  local t = dex.type(id)
  assert(not seen[t], "two starters share type " .. t)
  seen[t] = true
end
assert(seen[dex.TYPE.FIRE] and seen[dex.TYPE.WATER] and seen[dex.TYPE.GRASS],
  "starters must be the classic Fire, Water and Grass trio")

-- Starters must be catchable-tier, not trophies: a strength-10 starter would
-- be permanently shielded AND win every tie, which is a dominant opening.
for _, id in ipairs(ids) do
  assert(dex.strength(id) <= 3, "starter " .. id .. " is too strong")
end

-- A fresh save routes to the egg, not the map.
assert(own.starter() == 0)
show("TITLE")
M.press(badge.input.BUTTON.A)
assert(current() == "EGG", "first launch must go to the egg, got " .. current())

-- The egg opens on shakes, not on a button. Partial shaking does not hatch.
M.shake(2)
M.tick(10)
assert(current() == "EGG", "the egg must not hatch on two shakes")

-- Enough shakes hatch it and reveal the carousel.
M.shake(20)
M.tick(30)
assert(current() == "STARTER", "the egg did not hatch, still on " .. current())

-- The carousel shows ONE creature at a time so a single art pool suffices.
local first = starter_index()
M.press(badge.input.BUTTON.RIGHT)
assert(starter_index() ~= first, "RIGHT must move the carousel")
M.press(badge.input.BUTTON.LEFT)
assert(starter_index() == first, "LEFT must move it back")

-- Wrapping in both directions, so the player can never get stuck at an end.
for _ = 1, 5 do M.press(badge.input.BUTTON.RIGHT) end
assert(starter_index() >= 1 and starter_index() <= 3, "carousel index escaped 1-3")

-- Picking sets the starter, shields it, records the catch and lands on MAP.
local chosen = ids[starter_index()]
M.press(badge.input.BUTTON.A)
assert(own.starter() == chosen, "A must commit the highlighted starter")
assert(own.is_shielded(chosen), "the starter must be shielded immediately")
assert(own.caught(chosen) == 1, "picking a starter counts as a catch")
assert(current() == "MAP", "after picking we land on MAP, got " .. current())

-- Choosing must persist: a power cut right after picking is the worst time
-- to lose the only creature a player has.
assert(M.files["appdata/save.dat"], "the starter pick must be saved immediately")

-- Second launch skips the egg entirely.
show("TITLE")
M.press(badge.input.BUTTON.A)
assert(current() == "MAP", "with a starter chosen, A must go straight to MAP")

-- A later egg from a chest hatches a single creature, never the carousel.
own.add_egg()
show("EGG")
M.shake(25)
M.tick(30)
assert(current() ~= "STARTER", "later eggs must not reopen the starter carousel")
assert(own.eggs() == 0, "hatching must consume the egg")

print("test_starter: OK")
