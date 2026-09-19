package.path = "test/?.lua;app/?.lua;" .. package.path
local mock = require("mock_badge")

-- Every public accessor must tolerate being called before load() ever runs.
-- A radio handler or UI screen that races init and reads the dex first must
-- get nil, never a fabricated answer -- see first_of_type's t == nil trap
-- below, where an unguarded == against an all-nil table returns species 1.
mock.install()
package.loaded["dex"] = nil
local dex0 = require("dex")
assert(dex0.name(1) == nil, "name must be nil before load()")
assert(dex0.type(1) == nil, "type must be nil before load()")
assert(dex0.strength(1) == nil, "strength must be nil before load()")
assert(dex0.family(1) == nil, "family must be nil before load()")
assert(dex0.art(1) == nil, "art must be nil before load()")
for t = 1, 6 do
  assert(dex0.first_of_type(t) == nil, "first_of_type(" .. t .. ") must be nil before load()")
end
assert(dex0.first_of_type(nil) == nil,
  "first_of_type(nil) must not fall back to species 1 via a nil == nil match")

local M = mock.install()
package.loaded["dex"] = nil

-- dex.load reads through badge.fs, so the harness must hold the real file.
local f = io.open("app/dex.txt", "rb")
M.files["dex.txt"] = f:read("a")
f:close()

local dex = require("dex")
assert(dex.load(), "load must succeed when dex.txt is present")

assert(dex.COUNT == 36)
assert(dex.TYPE.WATER == 1 and dex.TYPE.ELECTRIC == 6,
  "wheel positions are load-bearing: Water must be 1 and Electric must be 6")
assert(dex.TYPE_NAME[3] == "FIRE")

-- Every species must be fully described. A nil here means a parse bug that
-- would otherwise surface as a blank screen on the badge with no traceback.
local per_type, per_family = {}, {}
for id = 1, 36 do
  local n, t, s, fam, art = dex.name(id), dex.type(id), dex.strength(id),
                            dex.family(id), dex.art(id)
  assert(type(n) == "string" and #n >= 4, "bad name at " .. id)
  assert(t >= 1 and t <= 6, "bad type at " .. id)
  assert(s >= 1 and s <= 10, "bad strength at " .. id)
  assert(fam >= 1 and fam <= 12, "bad family at " .. id)
  assert(#art == 256, "art must be 256 chars at " .. id .. ", got " .. #art)
  per_type[t] = (per_type[t] or 0) + 1
  per_family[fam] = (per_family[fam] or 0) + 1
end
for t = 1, 6 do assert(per_type[t] == 6, "type " .. t .. " has " .. tostring(per_type[t])) end
for f2 = 1, 12 do assert(per_family[f2] == 3, "family " .. f2 .. " is wrong size") end

-- Out of range must return nil, never error. Radio frames carry species ids
-- from strangers, and there is no pcall to catch a bad index.
assert(dex.name(0) == nil and dex.name(37) == nil and dex.name(-5) == nil)
assert(dex.type(999) == nil and dex.strength(999) == nil)
assert(dex.name("junk") == nil, "non-numeric ids must be rejected, not crash")

-- first_of_type is what the starter carousel and nest spawns use.
for t = 1, 6 do
  local id = dex.first_of_type(t)
  assert(id and dex.type(id) == t, "first_of_type broken for " .. t)
end
assert(dex.first_of_type(0) == nil and dex.first_of_type(7) == nil
  and dex.first_of_type(nil) == nil and dex.first_of_type("junk") == nil,
  "first_of_type must reject out-of-wheel and non-numeric t, not fabricate species 1")

-- A missing file must fail cleanly, not throw.
local M2 = mock.install()
package.loaded["dex"] = nil
local dex2 = require("dex")
local ok, err = dex2.load()
assert(ok == false and type(err) == "string", "missing dex.txt must return false plus a reason")

print("test_dex: OK")
