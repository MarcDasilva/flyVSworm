-- All player state. NOTHING else in the app reads or writes the save.
--
-- A creature has no per-instance state, so "owning a species" is one bit and
-- the whole collection is 36 bits. That is what lets a duel frame carry an
-- entire collection in 5 bytes.
local dex = require("dex")

local M = {}

local PATH = "appdata/save.dat"
local VERSION = 1
local BM_BYTES = 5          -- ceil(36 / 8)
local TAG_ENTRIES = 24
local TAG_SIZE = 14         -- 8 hex chars of UID prefix + 6 digits of step count

local st

local function fresh()
  local s = {ver = VERSION, starter = 0, bm = {}, dexc = {},
             steps = 0, balls = 0, eggs = 0, tags = {}}
  for i = 1, BM_BYTES do s.bm[i] = 0 end
  for i = 1, dex.COUNT do s.dexc[i] = 0 end
  return s
end

local function valid(id)
  return type(id) == "number" and id == math.floor(id)
     and id >= 1 and id <= dex.COUNT
end

local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

local function byte_at(s, i)
  return string.byte(s, i) or 0
end

-- Bit i of the 36-bit collection lives in byte floor((i-1)/8)+1 at position
-- (i-1)%8. Arithmetic rather than bitwise, because the badge Lua version is
-- unstated and math.floor works on all of them.
local function bit_parts(id)
  local z = id - 1
  return math.floor(z / 8) + 1, 2 ^ (z % 8)
end

function M.has(id)
  if not valid(id) then return false end
  local byte, mask = bit_parts(id)
  return math.floor(st.bm[byte] / mask) % 2 == 1
end

function M.add(id)
  if not valid(id) or M.has(id) then return end
  local byte, mask = bit_parts(id)
  st.bm[byte] = st.bm[byte] + mask
end

function M.remove(id)
  if not valid(id) or not M.has(id) then return end
  local byte, mask = bit_parts(id)
  st.bm[byte] = st.bm[byte] - mask
end

function M.caught(id)
  if not valid(id) then return 0 end
  return st.dexc[id]
end

-- The one asymmetry that matters: add() can be undone by remove(), the
-- Pokedex count cannot. Losing a duel must never erase a record.
function M.record_catch(id)
  if not valid(id) then return end
  M.add(id)
  st.dexc[id] = clamp(st.dexc[id] + 1, 0, 255)
end

function M.starter() return st.starter end

function M.set_starter(id)
  if not valid(id) then return end
  st.starter = id
  M.record_catch(id)
end

function M.is_shielded(id) return valid(id) and st.starter == id end

function M.bitmap()
  local out = {}
  for i = 1, BM_BYTES do out[i] = string.char(st.bm[i] % 256) end
  return table.concat(out)
end

-- Decodes a PEER's bitmap. Never trusts length or the spare high bits:
-- byte 5 only carries species 33-36 in its low nibble, and a corrupt save
-- or hostile frame can set the high nibble, so the loop below simply never
-- reads a bit position past species 36.
function M.from_bitmap(s)
  local out = {}
  if type(s) ~= "string" then return out end
  for id = 1, dex.COUNT do
    local z = id - 1
    local b = byte_at(s, math.floor(z / 8) + 1)
    if math.floor(b / 2 ^ (z % 8)) % 2 == 1 then out[#out + 1] = id end
  end
  return out
end

function M.types_held()
  local seen, out = {}, {}
  for id = 1, dex.COUNT do
    if M.has(id) then
      local t = dex.type(id)
      if t and not seen[t] then seen[t] = true; out[#out + 1] = t end
    end
  end
  table.sort(out)
  return out
end

function M.balls() return st.balls end
function M.add_balls(n) st.balls = clamp(st.balls + n, 0, 255) end
function M.spend_ball()
  if st.balls <= 0 then return false end
  st.balls = st.balls - 1
  return true
end

function M.eggs() return st.eggs end
function M.add_egg() st.eggs = clamp(st.eggs + 1, 0, 255) end
function M.take_egg()
  if st.eggs <= 0 then return false end
  st.eggs = st.eggs - 1
  return true
end

function M.steps() return st.steps end
function M.add_step() st.steps = clamp(st.steps + 1, 0, 4294967295) end

-- TRUF ruling R2: the on-disk log holds only an 8-char UID prefix (NTAG UIDs
-- all start "04", so 4 bytes will not collide across one 24-entry log). The
-- in-memory key MUST use the SAME 8-char, space-padded prefix as what
-- save()/load() round-trip, or a query with the full 14-char UID stops
-- matching the instant the save reloads. tag_visit and tag_seen both funnel
-- through this so memory and disk never disagree.
local function tag_key(uid)
  local k = string.sub(uid, 1, 8)
  while #k < 8 do k = k .. " " end
  return k
end

-- Cooldowns are counted in STEPS, not milliseconds: badge.sys.ms() resets on
-- reboot, so a time-based cooldown would be refreshed by a power cycle.
function M.tag_seen(uid)
  local key = tag_key(uid)
  for i = 1, #st.tags do
    if st.tags[i].uid == key then return st.tags[i].step end
  end
  return nil
end

function M.tag_visit(uid)
  local key = tag_key(uid)
  for i = 1, #st.tags do
    if st.tags[i].uid == key then st.tags[i].step = st.steps; return end
  end
  if #st.tags >= TAG_ENTRIES then table.remove(st.tags, 1) end
  st.tags[#st.tags + 1] = {uid = key, step = st.steps}
end

local function u32(v)
  v = math.floor(v) % 4294967296
  return string.char(v % 256, math.floor(v / 256) % 256,
                     math.floor(v / 65536) % 256, math.floor(v / 16777216) % 256)
end

function M.save()
  local p = {string.char(VERSION), string.char(st.starter % 256)}
  for i = 1, BM_BYTES do p[#p + 1] = string.char(st.bm[i] % 256) end
  for i = 1, dex.COUNT do p[#p + 1] = string.char(st.dexc[i] % 256) end
  p[#p + 1] = u32(st.steps)
  p[#p + 1] = string.char(st.balls % 256)
  p[#p + 1] = string.char(st.eggs % 256)
  for i = 1, #st.tags do
    -- st.tags[i].uid is already the 8-char padded key from tag_key(); no
    -- further truncation here, or a re-save of a loaded entry would re-clip it.
    p[#p + 1] = st.tags[i].uid .. string.format("%06d", st.tags[i].step % 1000000)
  end
  badge.fs.write(PATH, table.concat(p))
  badge.store.set_int("sv", VERSION)
  return true
end

-- Never errors. A truncated, empty, absent or garbage file all load as a
-- fresh save, because there is no pcall and a save-format bug would
-- otherwise brick the app on launch with no way back.
function M.load()
  st = fresh()
  local data = badge.fs.read(PATH)
  -- 43 is the end of the Pokedex block: everything before it is essential
  -- state, everything after it is recoverable defaults.
  if type(data) ~= "string" or #data < 43 then return end
  if byte_at(data, 1) ~= VERSION then return end

  local starter = byte_at(data, 2)
  st.starter = (starter >= 1 and starter <= dex.COUNT) and starter or 0
  for i = 1, BM_BYTES do st.bm[i] = byte_at(data, 2 + i) end
  -- Species 37-40 do not exist; clear the spare high bits of the last byte
  -- so a corrupt file cannot make from_bitmap or the UI see a phantom id.
  st.bm[BM_BYTES] = st.bm[BM_BYTES] % 16
  for i = 1, dex.COUNT do st.dexc[i] = byte_at(data, 7 + i) end

  if #data >= 47 then
    st.steps = byte_at(data, 44) + byte_at(data, 45) * 256
             + byte_at(data, 46) * 65536 + byte_at(data, 47) * 16777216
  end
  if #data >= 48 then st.balls = byte_at(data, 48) end
  if #data >= 49 then st.eggs = byte_at(data, 49) end

  local off = 50
  while off + TAG_SIZE - 1 <= #data and #st.tags < TAG_ENTRIES do
    local uid = string.sub(data, off, off + 7)
    local n = tonumber(string.sub(data, off + 8, off + 13))
    if n then st.tags[#st.tags + 1] = {uid = uid, step = n} end
    off = off + TAG_SIZE
  end
end

return M
