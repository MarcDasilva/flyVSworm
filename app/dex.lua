-- Species table. dex.txt is held as ONE string with an offset index; the
-- alternative, 36 separate line strings, roughly doubles the heap cost of
-- the largest single allocation in the app.
local M = {}

M.COUNT = 36

-- Type ids ARE positions on the duel wheel. Reordering this table silently
-- changes every matchup in the game - see duel.lua's compare().
M.TYPE = {WATER = 1, NORMAL = 2, FIRE = 3, ICE = 4, GRASS = 5, ELECTRIC = 6}
M.TYPE_NAME = {"WATER", "NORMAL", "FIRE", "ICE", "GRASS", "ELECTRIC"}

-- {body, shade, accent} per type. Accent is always bright enough to read as
-- an eye against its own body colour on the badge's dark theme.
M.TYPE_COLOR = {
  {0x2F6FE0, 0x1B4794, 0xBFE0FF},  -- Water
  {0x9A9488, 0x6B665C, 0xF0EBE0},  -- Normal
  {0xE0452F, 0x94291B, 0xFFD9A8},  -- Fire
  {0x6FC8E0, 0x3E8AA0, 0xEAFBFF},  -- Ice
  {0x46B355, 0x2A7034, 0xE2FFD1},  -- Grass
  {0xE0C02F, 0x9A821B, 0xFFF8C2},  -- Electric
}

local raw = nil          -- the whole file, one string
local starts = {}        -- starts[id] = byte offset of that line
local stops = {}         -- stops[id]  = byte offset of its last character

-- Shared bounds guard: NEVER let a nil/string/float/out-of-range value reach
-- a table lookup or a == comparison against a live field, or a garbage input
-- silently matches whatever that lookup defaults to (see first_of_type below).
local function in_range(n, lo, hi)
  return type(n) == "number" and n == math.floor(n) and n >= lo and n <= hi
end

local function valid(id)
  return in_range(id, 1, M.COUNT)
end

-- One shared parse. Called per accessor rather than cached, because caching
-- 36 parsed rows costs more heap than re-matching the handful of lines a
-- screen actually touches.
local function fields(id)
  if not valid(id) or not raw then return nil end
  local line = string.sub(raw, starts[id], stops[id])
  return string.match(line, "^(%d+) (%u+) (%d) (%d+) (%d+) ([0-3]+)$")
end

function M.load()
  local data, err = badge.fs.read("dex.txt")
  if not data then return false, err or "dex.txt missing" end
  raw = data
  starts, stops = {}, {}
  local i, n = 1, 0
  while i <= #raw do
    local nl = string.find(raw, "\n", i, true)
    local last = (nl and nl - 1) or #raw
    if last >= i then
      n = n + 1
      starts[n] = i
      stops[n] = last
    end
    if not nl then break end
    i = nl + 1
  end
  if n ~= M.COUNT then
    raw = nil
    return false, "expected " .. M.COUNT .. " species, found " .. n
  end
  return true
end

function M.name(id)
  local _, nm = fields(id)
  return nm
end

function M.type(id)
  local _, _, t = fields(id)
  return t and tonumber(t) or nil
end

function M.strength(id)
  local _, _, _, s = fields(id)
  return s and tonumber(s) or nil
end

function M.family(id)
  local _, _, _, _, f = fields(id)
  return f and tonumber(f) or nil
end

function M.art(id)
  local _, _, _, _, _, a = fields(id)
  return a
end

function M.first_of_type(t)
  -- A nil/garbage t must never match: before load(), M.type(id) is nil for
  -- every id, and nil == nil would otherwise hand back species 1 as a false
  -- answer to the starter carousel and nest spawns instead of failing loud.
  if not in_range(t, 1, 6) then return nil end
  for id = 1, M.COUNT do
    if M.type(id) == t then return id end
  end
  return nil
end

return M
