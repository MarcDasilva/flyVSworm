local monster = require("monster")

local F = {}

F.IDLE = 0
F.ENCOUNTER = 1
F.BATTLE = 2
F.TRADE = 3
F.HEIST = 4

F.EVT_NFC_BIOME = 1
F.EVT_NFC_ROCKET = 2
F.EVT_THROW_RESOLVE = 3
F.EVT_BUMP = 4
F.EVT_BUMP_TRADE = 5
F.EVT_CONFIRM = 6
F.EVT_CANCEL = 7
F.EVT_SHAKE = 8
F.EVT_TIMEOUT = 9

F.ENCOUNTER_MS = 20000
F.BATTLE_MS = 30000
F.TRADE_MS = 15000
F.HEIST_MS = 10000

local LIMIT = {
  [F.ENCOUNTER] = F.ENCOUNTER_MS,
  [F.BATTLE] = F.BATTLE_MS,
  [F.TRADE] = F.TRADE_MS,
  [F.HEIST] = F.HEIST_MS,
}

local function enter(fsm, mode, now_ms)
  fsm.mode = mode
  fsm.entered_ms = now_ms
  if mode ~= F.TRADE then
    fsm.trade_acks = 0
  end
  if mode == F.IDLE then
    fsm.wild = monster.clear()
    fsm.stake = monster.clear()
  end
end

function F.init(now_ms)
  local fsm = {
    mode = F.IDLE,
    entered_ms = now_ms,
    biome = 0,
    trade_acks = 0,
    rocket_armed = false,
    wild = monster.clear(),
    stake = monster.clear(),
  }
  return fsm
end

local function on_idle(fsm, evt, extra, now_ms)
  if evt == F.EVT_NFC_BIOME then
    fsm.biome = extra
    enter(fsm, F.ENCOUNTER, now_ms)
  elseif evt == F.EVT_NFC_ROCKET then
    fsm.rocket_armed = true
  elseif evt == F.EVT_BUMP then
    if fsm.rocket_armed then
      fsm.rocket_armed = false
      enter(fsm, F.HEIST, now_ms)
    else
      enter(fsm, F.BATTLE, now_ms)
    end
  elseif evt == F.EVT_BUMP_TRADE then
    fsm.rocket_armed = false
    fsm.trade_acks = 0
    enter(fsm, F.TRADE, now_ms)
  end
end

local function on_encounter(fsm, evt, extra, now_ms)
  if evt == F.EVT_THROW_RESOLVE then
    if extra ~= 0 then
      enter(fsm, F.IDLE, now_ms)
    end
  elseif evt == F.EVT_CANCEL or evt == F.EVT_TIMEOUT then
    enter(fsm, F.IDLE, now_ms)
  end
end

local function on_battle(fsm, evt, now_ms)
  if evt == F.EVT_CANCEL or evt == F.EVT_TIMEOUT or evt == F.EVT_CONFIRM then
    enter(fsm, F.IDLE, now_ms)
  end
end

local function on_trade(fsm, evt, now_ms)
  if evt == F.EVT_CONFIRM then
    fsm.trade_acks = fsm.trade_acks + 1
    if fsm.trade_acks >= 2 then
      enter(fsm, F.IDLE, now_ms)
    end
  elseif evt == F.EVT_CANCEL or evt == F.EVT_TIMEOUT then
    enter(fsm, F.IDLE, now_ms)
  end
end

local function on_heist(fsm, evt, now_ms)
  if evt == F.EVT_SHAKE or evt == F.EVT_TIMEOUT or evt == F.EVT_CANCEL then
    enter(fsm, F.IDLE, now_ms)
  end
end

function F.dispatch(fsm, evt, extra, now_ms)
  if not evt then return fsm.mode end
  if fsm.mode == F.IDLE then
    on_idle(fsm, evt, extra, now_ms)
  elseif fsm.mode == F.ENCOUNTER then
    on_encounter(fsm, evt, extra, now_ms)
  elseif fsm.mode == F.BATTLE then
    on_battle(fsm, evt, now_ms)
  elseif fsm.mode == F.TRADE then
    on_trade(fsm, evt, now_ms)
  elseif fsm.mode == F.HEIST then
    on_heist(fsm, evt, now_ms)
  else
    enter(fsm, F.IDLE, now_ms)
  end
  return fsm.mode
end

function F.tick(fsm, now_ms)
  local limit = LIMIT[fsm.mode]
  if not limit then return fsm.mode end
  if now_ms - fsm.entered_ms >= limit then
    return F.dispatch(fsm, F.EVT_TIMEOUT, 0, now_ms)
  end
  return fsm.mode
end

F.MODE_NAME = {
  [F.IDLE] = "idle",
  [F.ENCOUNTER] = "encounter",
  [F.BATTLE] = "battle",
  [F.TRADE] = "trade",
  [F.HEIST] = "heist",
}

return F
