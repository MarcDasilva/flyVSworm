-- KTNH Mon: catch / battle / trade / heist on the 2026 Hacker Badge.
-- A confirms, B cancels, Start arms a trade bump, HOME confirms exit.
-- Scan an NFC biome sticker, throw the badge to catch, bump to battle.

local monster = require("monster")
local fsm = require("fsm")
local throw = require("throw")

local TYPE_NAME = {
  [0] = "Normal", "Fire", "Water", "Grass", "Electric", "Ice",
  "Fighting", "Poison", "Ground", "Flying", "Psychic",
  "Bug", "Rock", "Ghost", "Dragon", "Dark",
}

local BIOME_TYPE = {
  [0] = monster.TYPE.NORMAL,
  [1] = monster.TYPE.GRASS,
  [2] = monster.TYPE.WATER,
  [3] = monster.TYPE.FIRE,
  [4] = monster.TYPE.ELECTRIC,
  [5] = monster.TYPE.ROCK,
}

local state
local ui = {}
local last_nfc_uid = ""
local last_status = "scan a sticker or bump"
local party = {}
local last_led_ms = 0

local function now()
  return badge.sys.ms()
end

local function spawn_wild(biome)
  local typ = BIOME_TYPE[biome] or monster.TYPE.NORMAL
  local species = 1 + (biome % 15)
  local level = 5 + (badge.sys.random(10))
  local shiny = badge.sys.random(64) == 0
  local hp = badge.sys.random(8)
  local atk = badge.sys.random(16)
  local def = badge.sys.random(16)
  return monster.init(species, level, typ, shiny, false, hp, atk, def, 3)
end

local function describe(n)
  if monster.is_empty(n) then return "empty" end
  local shiny = monster.is_shiny(n) and "* " or ""
  return string.format("%s#%d  Lv%d  %s",
    shiny, monster.species(n), monster.level(n),
    TYPE_NAME[monster.type(n)] or "?")
end

local function set_status(msg)
  last_status = msg
  if ui.status then ui.status:set_text(msg) end
end

local function paint_mode()
  local mode = fsm.MODE_NAME[state.mode] or "?"
  ui.mode:set_text(string.upper(mode))
  if state.mode == fsm.ENCOUNTER then
    ui.detail:set_text(describe(state.wild))
    ui.hint:set_text("throw the badge to catch   B cancel")
  elseif state.mode == fsm.BATTLE then
    ui.detail:set_text("peer battle")
    ui.hint:set_text("A finish   B flee")
  elseif state.mode == fsm.TRADE then
    ui.detail:set_text("acks " .. tostring(state.trade_acks) .. "/2")
    ui.hint:set_text("A confirm   B cancel")
  elseif state.mode == fsm.HEIST then
    ui.detail:set_text("shake to break the siphon")
    ui.hint:set_text("10s or you lose a monster")
  else
    ui.detail:set_text("party " .. tostring(#party))
    ui.hint:set_text("NFC catch   bump battle   Start+bump trade")
  end
end

local function leds_for_mode(t)
  badge.led.clear()
  if state.mode == fsm.ENCOUNTER then
    local pulse = 80 + math.floor((math.sin(t / 180) + 1) * 70)
    badge.led.set(1, 40, pulse, 40)
    badge.led.set(2, 40, pulse, 40)
  elseif state.mode == fsm.BATTLE then
    badge.led.set(1, 220, 40, 40)
    badge.led.set(6, 220, 40, 40)
    badge.led.set(5, 220, 40, 40)
    badge.led.set(2, 40, 80, 220)
    badge.led.set(3, 40, 80, 220)
    badge.led.set(4, 40, 80, 220)
  elseif state.mode == fsm.TRADE then
    badge.led.set_all(40, 180, 80)
  elseif state.mode == fsm.HEIST then
    local on = math.floor(t / 120) % 2 == 0
    if on then badge.led.set_all(220, 30, 30) end
  else
    local r, g, b = badge.me.color()
    r = r or 40
    g = g or 180
    b = b or 80
    badge.led.set(1, r, g, b)
    badge.led.set(2, r, g, b)
  end
  badge.led.show()
end

local function catch_roll(grade)
  local base = 40
  local m = throw.multiplier_tenths(grade)
  return badge.sys.random(100) < math.floor(base * m / 10)
end

function on_enter(root)
  party = {}
  state = fsm.init(now())
  local thrower = throw.init()
  state.thrower = thrower

  local bg = badge.ui.box(root, 320, 240)
  bg:set_pos(0, 0)
  bg:style({ bg_color = 0x101418 })

  local title = badge.ui.label(root, "KTNH MON")
  title:style({ text_font = 20, text_color = 0x7CFF9A })
  title:align("top_mid", 0, 10)

  ui.mode = badge.ui.label(root, "IDLE")
  ui.mode:style({ text_font = 24 })
  ui.mode:align("top_mid", 0, 42)

  ui.detail = badge.ui.label(root, "party 0")
  ui.detail:align("center", 0, -8)

  ui.status = badge.ui.label(root, last_status)
  ui.status:style({ text_color = 0xAABBCC, text_font = 14 })
  ui.status:align("center", 0, 28)

  ui.hint = badge.ui.label(root, "NFC catch   bump battle")
  ui.hint:style({ text_color = 0x8899AA, text_font = 14 })
  ui.hint:align("bottom_mid", 0, -18)

  badge.nfc.enable()
  badge.radio.enable()
  badge.radio.on_recv(function(_, _, payload)
    if type(payload) ~= "string" or #payload < 2 then return end
    if payload:sub(1, 2) == "B:" then
      fsm.dispatch(state, fsm.EVT_BUMP, 0, now())
      paint_mode()
    elseif payload:sub(1, 2) == "T:" then
      fsm.dispatch(state, fsm.EVT_BUMP_TRADE, 0, now())
      paint_mode()
    end
  end)

  paint_mode()
  leds_for_mode(now())
end

function on_tick()
  local t = now()
  fsm.tick(state, t)

  local ax, ay, az = badge.sensor.accel()
  if ax then
    if throw.feed(state.thrower, ax, ay, az) then
      local grade = state.thrower.last_grade
      if state.mode == fsm.ENCOUNTER then
        if catch_roll(grade) then
          party[#party + 1] = state.wild
          set_status("caught " .. throw.GRADE_NAME[grade])
          fsm.dispatch(state, fsm.EVT_THROW_RESOLVE, grade, t)
        else
          set_status("broke free (" .. throw.GRADE_NAME[grade] .. ")")
          fsm.dispatch(state, fsm.EVT_THROW_RESOLVE, 0, t)
        end
        paint_mode()
      end
    end
  end

  if badge.sensor.shake() then
    fsm.dispatch(state, fsm.EVT_SHAKE, 0, t)
    set_status("heist broken")
    paint_mode()
  end

  local card = badge.nfc.card()
  if card and card.uid and card.uid ~= last_nfc_uid then
    last_nfc_uid = card.uid
    local text = badge.nfc.read_text()
    if text and string.find(string.lower(text), "rocket", 1, true) then
      fsm.dispatch(state, fsm.EVT_NFC_ROCKET, 0, t)
      set_status("rocket armed")
    else
      local biome = 0
      if text then biome = (#text + #card.uid) % 6 end
      state.wild = spawn_wild(biome)
      fsm.dispatch(state, fsm.EVT_NFC_BIOME, biome, t)
      set_status("wild appeared")
    end
    paint_mode()
  end

  if t - last_led_ms >= 80 then
    last_led_ms = t
    leds_for_mode(t)
  end
end

function on_button(button, kind)
  if kind ~= badge.input.KIND.PRESSED then return end
  local B = badge.input.BUTTON
  local t = now()
  if button == B.A then
    fsm.dispatch(state, fsm.EVT_CONFIRM, 0, t)
    paint_mode()
  elseif button == B.B then
    fsm.dispatch(state, fsm.EVT_CANCEL, 0, t)
    set_status("cancelled")
    paint_mode()
  elseif button == B.START then
    badge.radio.send("T:1")
    set_status("trade ping sent")
  elseif button == B.UP then
    badge.radio.send("B:1")
    set_status("battle ping sent")
  end
end

function on_exit()
  badge.led.clear()
  badge.led.show()
  badge.store.set_int("party", #party)
end
