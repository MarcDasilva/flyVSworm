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

-- Art runs: the whole reason the renderer fits. One box per CELL would be
-- 256 widgets for a single creature, half the 512-widget cap. Runs must
-- stay under 64 so one pool serves every screen.
local worst, total = 0, 0
for id = 1, 36 do
  local runs = dex.runs(id)
  assert(#runs > 0, "species " .. id .. " produced no runs")
  total = total + #runs
  if #runs > worst then worst = #runs end
  for _, r in ipairs(runs) do
    assert(r.row >= 0 and r.row <= 15, "row out of grid: " .. r.row)
    assert(r.col >= 0 and r.col <= 15, "col out of grid: " .. r.col)
    assert(r.len >= 1 and r.col + r.len <= 16, "run overflows the row")
    assert(r.palette >= 1 and r.palette <= 3, "palette must be 1-3")
  end
end
assert(worst <= 64, "worst-case run count " .. worst .. " exceeds the 64-box pool")

-- Runs must reconstruct the art exactly. A silent decode bug shows up on the
-- badge as a subtly wrong creature and nowhere else.
for id = 1, 36 do
  local grid = {}
  for i = 1, 256 do grid[i] = "0" end
  for _, r in ipairs(dex.runs(id)) do
    for k = 0, r.len - 1 do
      grid[r.row * 16 + r.col + k + 1] = tostring(r.palette)
    end
  end
  assert(table.concat(grid) == dex.art(id), "runs do not reconstruct species " .. id)
end

-- Painting: every geometry value handed to a widget must be an integer, or
-- LVGL rejects it. The mock asserts this inside set_pos and set_size.
-- Use M2, not M: the missing-file test above already called mock.install()
-- again, which reassigns the global `badge` closure. Widgets created now
-- land in M2's tables; asserting against the stale M would silently read
-- an empty hidden/pos/color table and pass for the wrong reason.
local pool = dex.new_pool(M2.root, 64)
assert(#pool == 64)
local painted = dex.paint(pool, 1, 88, 40, 9)
assert(painted >= 1 and painted <= 64)
assert(M2.hidden[pool[64]] == true, "unused boxes must be hidden, not left stale")
local first = pool[1]
assert(M2.pos[first][1] >= 88 and M2.pos[first][2] >= 40, "art must be placed at the offset")
assert(M2.color[first] ~= nil, "each run must be coloured from the type palette")

-- Repainting a different species must not leave boxes from the previous one.
dex.paint(pool, 1, 88, 40, 9)
local wide = dex.paint(pool, 36, 88, 40, 9)
for i = wide + 1, 64 do
  assert(M2.hidden[pool[i]] == true, "stale box " .. i .. " left visible after repaint")
end

-- Out of range must hide the pool rather than crash: species ids arrive
-- over the radio from strangers.
assert(dex.paint(pool, 999, 0, 0, 9) == 0)
assert(M2.hidden[pool[1]] == true)

print("test_dex: OK")
