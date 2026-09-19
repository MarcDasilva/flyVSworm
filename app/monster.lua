-- 5-byte monster wire payload. Safe to send in a 44-byte badge.radio frame.
-- Byte 0: species (0 = empty)
-- Byte 1: shiny << 7 | level 1..127
-- Byte 2: hp_iv << 5 | shield << 4 | type 0..15
-- Byte 3: atk_iv << 4 | def_iv
-- Byte 4: moveset bitmask

local M = {}

M.BYTES = 5

M.TYPE = {
  NORMAL = 0, FIRE = 1, WATER = 2, GRASS = 3, ELECTRIC = 4, ICE = 5,
  FIGHTING = 6, POISON = 7, GROUND = 8, FLYING = 9, PSYCHIC = 10,
  BUG = 11, ROCK = 12, GHOST = 13, DRAGON = 14, DARK = 15,
}

local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

local function b(n, i)
  return string.byte(n, i) or 0
end

function M.clear()
  return "\0\0\0\0\0"
end

function M.is_empty(n)
  return b(n, 1) == 0
end

function M.init(species, level, typ, shiny, shield, hp_iv, atk_iv, def_iv, moves)
  if species == 0 then
    return M.clear()
  end
  local b1 = clamp(level, 1, 127)
  if shiny then b1 = b1 + 128 end
  local b2 = typ % 16
  if shield then b2 = b2 + 16 end
  b2 = b2 + ((hp_iv % 8) * 32)
  local b3 = ((atk_iv % 16) * 16) + (def_iv % 16)
  return string.char(species, b1, b2, b3, moves % 256)
end

function M.species(n) return b(n, 1) end
function M.level(n) return b(n, 2) % 128 end
function M.is_shiny(n) return b(n, 2) >= 128 end
function M.type(n) return b(n, 3) % 16 end
function M.is_shielded(n) return math.floor(b(n, 3) / 16) % 2 == 1 end
function M.hp_iv(n) return math.floor(b(n, 3) / 32) % 8 end
function M.atk_iv(n) return math.floor(b(n, 4) / 16) % 16 end
function M.def_iv(n) return b(n, 4) % 16 end
function M.moves(n) return b(n, 5) end

function M.has_move(n, slot)
  if slot < 0 or slot > 7 then return false end
  return math.floor(M.moves(n) / (2 ^ slot)) % 2 == 1
end

-- Starter Shield: cannot be wagered, stolen, or traded.
function M.can_transfer(n)
  return not M.is_empty(n) and not M.is_shielded(n)
end

return M
