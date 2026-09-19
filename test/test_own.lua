package.path = "test/?.lua;app/?.lua;" .. package.path
local mock = require("mock_badge")
local M = mock.install()
local f = io.open("app/dex.txt", "rb"); M.files["dex.txt"] = f:read("a"); f:close()
local dex = require("dex"); assert(dex.load())
local own = require("own")

own.load()

-- Fresh save: nothing held, nothing caught.
assert(own.starter() == 0)
assert(own.balls() == 0 and own.eggs() == 0 and own.steps() == 0)
for id = 1, 36 do
  assert(not own.has(id), "fresh save must hold nothing")
  assert(own.caught(id) == 0)
end

-- The core rule: duplicates bump the Pokedex, they are NOT held twice.
own.record_catch(7)
own.record_catch(7)
own.record_catch(7)
assert(own.has(7))
assert(own.caught(7) == 3, "third catch must be counted, got " .. own.caught(7))

-- Losing a creature clears the bit and leaves the Pokedex alone. This is the
-- rule that makes duels survivable: you can lose a creature, never a record.
own.remove(7)
assert(not own.has(7), "removed species must leave the collection")
assert(own.caught(7) == 3, "the Pokedex must NEVER decrease")

-- Bitmap round-trip. Five bytes is what makes the whole collection fit in
-- one radio frame, which is the only reason cross-collection targeting works.
own.add(1); own.add(8); own.add(9); own.add(36)
local bm = own.bitmap()
assert(#bm == 5, "collection bitmap must be exactly 5 bytes, got " .. #bm)
local ids = own.from_bitmap(bm)
table.sort(ids)
assert(#ids == 4 and ids[1] == 1 and ids[2] == 8 and ids[3] == 9 and ids[4] == 36,
  "bitmap round-trip lost a species")

-- A hostile bitmap must never yield an out-of-range id.
for _, junk in ipairs({"", "\255", "\255\255\255\255\255", "\255\255\255\255\255\255\255"}) do
  for _, id in ipairs(own.from_bitmap(junk)) do
    assert(id >= 1 and id <= 36, "from_bitmap leaked id " .. id)
  end
end

-- The starter is shielded forever, and nothing else ever is.
own.set_starter(4)
assert(own.starter() == 4 and own.has(4))
assert(own.is_shielded(4))
assert(not own.is_shielded(1))

-- Distinct types held is the duel gate.
local t = own.types_held()
assert(#t >= 1)
for i = 2, #t do assert(t[i] > t[i - 1], "types_held must be sorted and distinct") end

-- Counters clamp rather than going negative or unbounded.
own.add_balls(3); assert(own.balls() == 3)
assert(own.spend_ball() and own.balls() == 2)
own.add_balls(-99); assert(own.balls() >= 0, "balls must never go negative")
for _ = 1, 500 do own.add_balls(10) end
assert(own.balls() <= 255, "balls must saturate inside one byte")
for _ = 1, 300 do own.record_catch(2) end
assert(own.caught(2) <= 255, "Pokedex counts must saturate at 255")

-- Tag log: cooldowns are in steps because badge.sys.ms() resets on reboot.
assert(own.tag_seen("04A1B2C3D4E5F6") == nil)
for _ = 1, 40 do own.add_step() end
own.tag_visit("04A1B2C3D4E5F6")
assert(own.tag_seen("04A1B2C3D4E5F6") == 40)

-- More distinctive state ahead of the reload below. A save-format offset
-- error corrupts silently with no pcall and no crash, so the round-trip
-- assertions must cover every persisted field individually, and every value
-- here is chosen so it cannot alias another field's value (see the reload
-- assertions' messages for which offset a failure implicates).
own.record_catch(15)                     -- caught(15) == 1
for _ = 1, 5 do own.record_catch(20) end -- caught(20) == 5
own.add(20)                              -- collection bit in a THIRD bitmap byte (byte 3)
for _ = 1, 7 do own.add_egg() end        -- eggs == 7, distinct from balls == 255

for _ = 1, 8960 do own.add_step() end    -- steps: 40 -> 9000
own.tag_visit("AABBCCDD001122")          -- second tag entry, recorded at step 9000
for _ = 1, 50 do own.add_step() end      -- steps: 9000 -> 9050, distinct from both tag steps
assert(own.tag_seen("AABBCCDD001122") == 9000)

-- Persistence across a full reload. Every field below gets its own assertion
-- naming the field, so a shifted byte offset points straight at itself
-- instead of hiding behind an unrelated field that happens to still match.
own.save()
local saved = M.files["appdata/save.dat"]
assert(saved and #saved >= 43, "save file too short: " .. tostring(saved and #saved))
package.loaded["own"] = nil
local own2 = require("own")
own2.load()
assert(own2.starter() == 4, "starter did not survive reload")
assert(own2.has(4), "starter's collection bit did not survive reload")
assert(own2.has(1) and own2.has(8) and own2.has(9),
  "byte-1 collection bits did not survive reload")
assert(own2.has(20), "byte-3 (middle) collection bit did not survive reload")
assert(own2.has(36), "byte-5 (last) collection bit did not survive reload")
assert(not own2.has(7), "removed species must stay removed across reload")
assert(own2.caught(7) == 3, "caught(7) did not survive reload")
assert(own2.caught(2) == 255, "caught(2) saturation did not survive reload")
assert(own2.caught(15) == 1, "caught(15) did not survive reload")
assert(own2.caught(20) == 5, "caught(20) did not survive reload")
assert(own2.balls() == 255, "balls did not survive reload")
assert(own2.eggs() == 7, "eggs did not survive reload")
assert(own2.steps() == 9050, "steps did not survive reload")
assert(own2.tag_seen("04A1B2C3D4E5F6") == 40, "first tag's step did not survive reload")
assert(own2.tag_seen("AABBCCDD001122") == 9000, "second tag's step did not survive reload")

-- Corruption must degrade to a fresh save, never crash. There is no pcall.
for _, bad in ipairs({"", "\1", "\1\4\0\0", string.rep("\255", 20), string.rep("\0", 500)}) do
  M.files["appdata/save.dat"] = bad
  package.loaded["own"] = nil
  local o = require("own")
  o.load()
  assert(o.starter() >= 0 and o.starter() <= 36, "corrupt save leaked a bad starter")
  assert(o.balls() >= 0 and o.balls() <= 255)
  for id = 1, 36 do local _ = o.has(id); local _ = o.caught(id) end
end

print("test_own: OK")
