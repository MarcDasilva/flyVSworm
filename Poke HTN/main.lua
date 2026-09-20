

















local W, H = 320, 240



local SPECIES, PER_FILE = 18, 6




local CHUNK = 3
local NAMES = {
  "BULBASAUR","VENUSAUR","CHARMANDER","CHARIZARD","SQUIRTLE","BLASTOISE",
  "PIKACHU","JIGGLYPUFF","PSYDUCK","GENGAR","MAGIKARP","GYARADOS",
  "LAPRAS","EEVEE","SNORLAX","DRAGONITE","MEWTWO","MEW",
}
local SHAKES = 12
local EGG_CELL, MON_CELL = 8, 6


local EGG_X, EGG_Y = math.floor((W - 16 * EGG_CELL) / 2), 40
local MON_X, MON_Y = math.floor((W - 16 * MON_CELL) / 2), 56







local POOL = 49
local NFC_MS = 200



local GREY = {0x6B665C, 0x9A9488, 0xF0EBE0}

screens, pool, layer, flash = {}, {}, nil, nil
target, nfc_ok, hatched = nil, false, false
local cur, live = nil, false
local shakes, painted = 0, nil
local last_uid, last_nfc = nil, 0
local mon_name, mon_art, mon_pal = nil, nil, nil
local egg_pal, egg_frame = nil, {}


local last_ox, lit = 0, false


local seen_flush








local function cell_at(art, per, base, n)
  local b = string.byte(art, n // per + 2) - 48
  if b > 43 then b = b - 1 end
  for _ = 1, n % per do b = b // base end
  return b % base
end








local function blit(art, pal, x, y, cell, rs, cs, draw)
  local np, n = #pool, 0
  if not art or #art < 2 then return 0 end
  local head = string.byte(art, 1) - 48
  local per, base = head // 8, head % 8
  for row = 0, 15, rs do
    local i, col = row * 16, 0
    while col < 16 do
      local c = cell_at(art, per, base, i + col)
      if c == 0 then
        col = col + cs
      else
        local len = cs
        while col + len < 16
              and cell_at(art, per, base, i + col + len) == c do
          len = len + cs
        end
        n = n + 1
        if draw and n <= np then
          local b = pool[n]
          b:set_pos(x + col * cell, y + row * cell)
          b:set_size(len * cell, rs * cell)
          b:set_color(pal[c])
          b:hidden(false)
        end
        col = col + len
      end
    end
  end
  return n
end






local function paint(art, pal, x, y, cell)
  local np = #pool
  local rs, cs = 2, 1
  if blit(art, pal, x, y, cell, rs, cs, false) > np then
    rs, cs = 2, 2
    if blit(art, pal, x, y, cell, rs, cs, false) > np then
      rs, cs = 4, 4
    end
  end
  local n = blit(art, pal, x, y, cell, rs, cs, true)
  if n > np then n = np end
  for i = n + 1, np do pool[i]:hidden(true) end
  return n
end





local FRAME = 16.67
local WOBBLE, LAST, CRACK_AT, HOLD, FLASH, FADE = 333, 633, 250, 833, 200, 380
local CRACKS = 3
local es = {stage = 0, frame = 0, ox = 0, opa = 0, amp = 0, phase = 0,
            wob = 0, cracked = true, since = 0, last = 0}

local function egg_reset(now)
  es.stage, es.frame, es.ox, es.opa, es.amp = 0, 0, 0, 0, 0
  es.phase, es.wob, es.cracked, es.since, es.last = 0, 0, true, now, now
end

local function egg_crack(now)
  if es.stage >= CRACKS then return end
  es.stage, es.since, es.phase, es.cracked = es.stage + 1, now, 0, false
  es.amp = (es.stage == 1) and 1 or 2
  es.wob = (es.stage == CRACKS) and LAST or WOBBLE
end

local function egg_tick(now, scale)
  local dt = now - es.last
  es.last = now
  if dt < 0 then dt = 0 end


  if dt > 80 then
    es.since = es.since + dt - 80
    dt = 80
  end

  if es.amp > 0 then
    local el = now - es.since


    es.phase = (es.phase + 20 * dt / FRAME) % 256
    es.ox = math.floor(es.amp * scale * math.sin(es.phase * 0.0245437) + 0.5)
    if not es.cracked and el >= CRACK_AT then es.cracked = true end
    if el >= es.wob then
      es.amp, es.ox, es.phase = 0, 0, 0
      if es.stage == CRACKS then es.stage, es.since = 4, now end
    end
  end

  if es.stage == 4 and now - es.since >= HOLD then es.stage, es.since = 5, now end

  if es.stage == 5 then
    local el = now - es.since
    local f = el / FLASH
    es.opa = math.floor((f > 1 and 1 or f) * 255)
    if el >= FLASH then es.stage, es.since = 6, now end
  end

  if es.stage == 6 then
    local el = now - es.since
    local f = el / FADE
    es.opa = math.floor((1 - (f > 1 and 1 or f)) * 255)
    if el >= FADE then es.stage, es.opa = 7, 0 end
  end


  es.frame = (es.stage == 0) and 0
             or (es.stage <= CRACKS and (es.cracked and es.stage or es.stage - 1))
             or CRACKS
end







local led_at = 0

local function leds(r, g, b)
  if r < 0 then r = 0 elseif r > 255 then r = 255 end
  if g < 0 then g = 0 elseif g > 255 then g = 255 end
  if b < 0 then b = 0 elseif b > 255 then b = 255 end
  badge.led.set_all(r, g, b)
  badge.led.show()
end





local function log(s)
  if badge.sys.log then
    badge.sys.log(s .. " free=" .. badge.sys.stats().free_heap)
  end
end

local function nfc_set(on)
  if on then
    if nfc_ok then return end




    for _ = 1, 40 do badge.sys.gc_step() end
    if badge.sys.stats().free_heap < 6000 then
      return
    end
    nfc_ok = badge.nfc.enable()
  elseif nfc_ok then
    badge.nfc.disable()
    nfc_ok = false
  end
end








local ax, ay, az, shook_at, dbg = nil, nil, nil, 0, 0

local function shaking(now)
  if badge.sensor.shake() then return true end
  local x, y, z = badge.sensor.accel()
  if not x then return false end
  if not ax then
    ax, ay, az = x, y, z
    return false
  end
  local d = math.abs(x - ax) + math.abs(y - ay) + math.abs(z - az)
  ax, ay, az = x, y, z


  if d > 900 and now - shook_at > 250 then
    shook_at = now
    return true
  end
  return false
end



local function led_egg(now)
  if now - led_at < 80 then return end
  led_at = now
  if es.opa > 0 then
    leds(es.opa, es.opa, math.floor(es.opa * 0.9))
  elseif es.stage == 7 then

    local c = (mon_pal or GREY)[3]
    leds(c // 65536 % 256, c // 256 % 256, c % 256)
  else

    local k = 90 + es.stage * 40 + (es.amp > 0 and 80 or 0)
    leds(k, math.floor(k * 0.55), 8)
  end
end



local function label(parent, text, size, color)
  local l = badge.ui.label(parent, text)
  l:style({text_font = size, text_color = color})
  return l
end

local function box(parent, w, h, color)
  local b = badge.ui.box(parent, w, h)
  b:style({bg_color = color, border_width = 0, radius = 0})
  return b
end



local function chip(parent, text, x, y)
  local l = badge.ui.label(parent, text)
  l:style({text_font = 14, text_color = 0xD0DCE8, bg_color = 0x2A3544,
           border_width = 1, border_color = 0x6A7888, radius = 4,
           pad_left = 8, pad_right = 8, pad_top = 4, pad_bottom = 4})
  l:set_pos(x, y)
  return l
end



local build = {}

local filled = {}

local function root_of(name)
  if screens[name] then return screens[name].root end
  local r = box(screens_parent, W, H, badge.ui.theme.background)
  r:set_pos(0, 0)
  r:hidden(true)
  screens[name] = {root = r}
  return r
end

function ready() return live end
function current() return cur end






local function pool_free()
  for i = #pool, 1, -1 do
    pool[i]:delete()
    pool[i] = nil
  end
  painted, pool_capped = nil, false
end







local BAND = 12
local pool_capped = false

local function pool_grow()
  if pool_capped or #pool >= POOL then return false end
  local added = 0
  while #pool < POOL and added < BAND do
    if badge.sys.stats().free_heap < 4000 then
      pool_capped = true
      break
    end
    local b = badge.ui.box(layer, 1, 1)
    b:hidden(true)
    pool[#pool + 1] = b
    added = added + 1
  end
  for _ = 1, 8 do badge.sys.gc_step() end


  painted = nil
  if pool_capped or #pool >= POOL then log("pool " .. #pool) end
  return added > 0
end

function show(name)
  local art = (name == "EGG" or name == "MON")

  if art then
    nfc_set(false)
    pool_grow()
  else
    pool_free()



    seen_flush()
    nfc_set(true)
  end

  if not filled[name] then



    for _ = 1, 60 do badge.sys.gc_step() end
    build[name]()
    filled[name] = true


    layer:bring_to_front()
    if flash then flash:bring_to_front() end
  end
  if cur == name then return end
  if cur then screens[cur].root:hidden(true) end

  layer:set_pos(0, 0)
  last_ox = 0
  if flash then flash:hidden(true) end
  lit = false
  cur = name
  screens[name].root:hidden(false)
  screens[name].enter()
end






local function load_species(id)
  target = id
  mon_name, mon_art, mon_pal = NAMES[id], nil, nil
  local file = "dex" .. (1 + (id - 1) // CHUNK) .. ".txt"




  local data
  for try = 1, 3 do
    for _ = 1, 30 do badge.sys.gc_step() end
    data = badge.fs.read(file)
    if data then break end
    log("read failed " .. file .. " try" .. try)
  end
  if data then
    local want, n = (id - 1) % CHUNK + 1, 0
    for line in string.gmatch(data, "[^\r\n]+") do
      n = n + 1
      if n == want then
        local nm, _, _, pal, a = string.match(line,
          "^%d+ (%u+) %d (%d+) (%d+) ([%x,]+) (%S+)$")
        mon_name, mon_art, mon_pal = nm or NAMES[id], a, {}
        if pal then
          for hex in string.gmatch(pal, "%x+") do
            mon_pal[#mon_pal + 1] = tonumber(hex, 16)
          end
        end
        if #mon_pal < 3 then mon_pal = GREY end
        break
      end
    end
  end
  data = nil
  for _ = 1, 20 do badge.sys.gc_step() end
end

local function pick()
  load_species(1 + badge.sys.random(SPECIES))
end




local seen_str, seen_dirty = nil, false

local function seen_get()
  if not seen_str then
    local s = badge.store.get_str("seen", "")
    if #s ~= SPECIES then s = string.rep("0", SPECIES) end
    seen_str = s
  end
  return seen_str
end





local function seen_set(id)
  local s = seen_get()
  seen_str = string.sub(s, 1, id - 1) .. "1" .. string.sub(s, id + 1)
  seen_dirty = true
end




function seen_flush()
  if not seen_dirty then return end
  badge.store.set_str("seen", seen_str)
  if badge.store.get_str("seen", "") == seen_str then seen_dirty = false end
end



local function seen_count(s)
  local n = 0
  s = s or seen_get()
  for i = 1, SPECIES do
    if string.byte(s, i) == 49 then n = n + 1 end
  end
  return n
end


local dex_page, dex_row = 1, 1

local function dex_id(row)
  return (dex_page - 1) * PER_FILE + row
end

local function build_dex()
  local r = root_of("DEX")
  screens.DEX.title = label(r, "", 20, 0xFFD9A8)
  screens.DEX.title:align("top_mid", 0, 20)



  screens.DEX.list = label(r, "", 16, 0x8899AA)
  screens.DEX.list:align("top_mid", 0, 56)

  chip(r, "^v<> NAV    A VIEW    B BACK", 40, 208)

  local rows = {}
  local function draw()
    local seen = seen_get()
    screens.DEX.title:set_text("POKEDEX " .. seen_count(seen) .. "/" .. SPECIES
                               .. "   page " .. dex_page)
    for i = 1, PER_FILE do
      local id = dex_id(i)
      if id <= SPECIES then
        rows[i] = ((i == dex_row) and "> " or "   ")
          .. string.format("%02d  %s", id,
             (string.byte(seen, id) == 49) and NAMES[id] or "- - -")
      else
        rows[i] = ""
      end
    end
    screens.DEX.list:set_text(table.concat(rows, "\n"))
  end

  screens.DEX.enter = function()
    draw()
    leds(0, 40, 90)
  end
  screens.DEX.tick = function() end
  screens.DEX.button = function(b)
    local B = badge.input.BUTTON
    if b == B.B then
      show("SCAN")
    elseif b == B.UP then
      dex_row = (dex_row > 1) and dex_row - 1 or PER_FILE
      draw()
    elseif b == B.DOWN then
      dex_row = (dex_row < PER_FILE) and dex_row + 1 or 1
      draw()
    elseif b == B.LEFT or b == B.RIGHT then
      local last = SPECIES // PER_FILE
      if b == B.LEFT then
        dex_page = (dex_page > 1) and dex_page - 1 or last
      else
        dex_page = (dex_page < last) and dex_page + 1 or 1
      end
      draw()
    elseif b == B.A then
      local id = dex_id(dex_row)
      if id <= SPECIES and string.byte(seen_get(), id) == 49 then






        load_species(id)
        show("MON")
      end
    end
  end
end




local function build_mon()
  local r = root_of("MON")
  screens.MON.name = label(r, "", 24, 0xE2FFD1)
  screens.MON.name:align("top_mid", 0, 22)
  chip(r, "B BACK", 116, 208)

  screens.MON.enter = function()
    screens.MON.name:set_text(string.format("%02d  %s", target or 0,
                                            mon_name or "?"))
    painted = nil
    local pal = mon_pal or GREY
    if mon_art then paint(mon_art, pal, MON_X, MON_Y, MON_CELL) end
    local c = pal[3]
    leds(c // 65536 % 256, c // 256 % 256, c % 256)
  end


  screens.MON.tick = function()
    if pool_grow() then
      paint(mon_art, mon_pal or GREY, MON_X, MON_Y, MON_CELL)
    end
  end
  screens.MON.button = function(b)
    if b == badge.input.BUTTON.B then show("DEX") end
  end
end

local function build_scan()
  local r = root_of("SCAN")
  label(r, "Poke HTN", 24, 0xFFD9A8):align("top_mid", 0, 26)
  screens.SCAN.msg = label(r, "", 20, badge.ui.theme.text)
  screens.SCAN.msg:align("center", 0, -10)
  screens.SCAN.tally = label(r, "", 16, 0x8899AA)
  screens.SCAN.tally:align("center", 0, 24)
  chip(r, "UP POKEDEX     HOME EXIT", 60, 208)

  screens.SCAN.enter = function()
    last_uid = nil
    if nfc_ok then badge.nfc.clear() end


    screens.SCAN.msg:set_text(nfc_ok and "Tap an NFC sticker"
                              or "NFC unavailable - press A")
    screens.SCAN.tally:set_text(seen_count() .. "/" .. SPECIES .. " found")
    leds(0, 50, 120)
  end

  screens.SCAN.tick = function(now)
    if not nfc_ok or now - last_nfc < NFC_MS then return end
    last_nfc = now
    local c = badge.nfc.card()


    if c and c.uid ~= last_uid then
      last_uid = c.uid
      pick()
      show("EGG")
    end
  end

  screens.SCAN.button = function(b)
    local B = badge.input.BUTTON
    if b == B.UP then
      show("DEX")
    elseif b == B.A and not nfc_ok then
      pick()
      show("EGG")
    end
  end
end









local function paint_egg()
  local key = (es.stage >= 6) and -1 or es.frame
  if key ~= painted then
    painted = key
    if key == -1 then
      paint(mon_art, mon_pal or GREY, MON_X, MON_Y, MON_CELL)
    else
      paint(egg_frame[es.frame + 1], egg_pal, EGG_X, EGG_Y, EGG_CELL)
    end
  end
  if es.ox ~= last_ox then
    last_ox = es.ox
    layer:set_pos(es.ox, 0)
  end



  if not flash then return end
  local on = es.opa > 0
  if on then flash:style({bg_color = 0xF8F8F8, bg_opa = es.opa}) end
  if on ~= lit then
    lit = on
    flash:hidden(not on)
  end
end

local function build_egg()
  local r = root_of("EGG")
  screens.EGG.title = label(r, "", 20, 0xFFD9A8)
  screens.EGG.title:align("top_mid", 0, 24)
  screens.EGG.meter = badge.ui.bar(r, 0, SHAKES, 0)
  screens.EGG.meter:set_size(220, 18)
  screens.EGG.meter:align("bottom_mid", 0, -44)
  screens.EGG.msg = label(r, "", 16, 0x8899AA)
  screens.EGG.msg:align("bottom_mid", 0, -18)

  screens.EGG.enter = function()
    ax, ay, az = nil, nil, nil
    shakes, painted, hatched = 0, nil, false
    screens.EGG.meter:set_value(0)
    screens.EGG.title:set_text("SHAKE TO HATCH")
    screens.EGG.msg:set_text("Something is inside")
    egg_reset(badge.sys.ms())
    paint_egg()
  end

  screens.EGG.tick = function(now)
    pool_grow()


    if es.stage < CRACKS and shaking(now) then
      shakes = shakes + 1
      screens.EGG.meter:set_value(shakes < SHAKES and shakes or SHAKES)
      if shakes % 4 == 0 then
        egg_crack(now)
        screens.EGG.title:set_text("THE EGG IS SHAKING")
      end
    end
    egg_tick(now, EGG_CELL)
    paint_egg()
    led_egg(now)
    if es.stage == 7 and not hatched then
      hatched = true
      seen_set(target)
      screens.EGG.title:set_text("IT HATCHED!")
      screens.EGG.msg:set_text((mon_name or "?") .. "   B for the dex")
    end
  end

  screens.EGG.button = function(b)
    local B = badge.input.BUTTON
    if not hatched then return end
    if b == B.B then show("DEX") elseif b == B.A then show("SCAN") end
  end
end

build.SCAN, build.EGG, build.DEX, build.MON = build_scan, build_egg, build_dex, build_mon






function on_enter(root)
  screens_parent = root



  for _ = 1, 30 do badge.sys.gc_step() end
  badge.sys.wake_lock(true)

  local data = badge.fs.read("egg.txt")
  if data then
    local n = 0
    for s in string.gmatch(data, "[^\r\n]+") do
      n = n + 1
      if n == 1 then
        egg_pal = {}
        for hex in string.gmatch(s, "%x+") do
          egg_pal[#egg_pal + 1] = tonumber(hex, 16)
        end
      else
        egg_frame[n - 1] = s
      end
    end
  end
  data = nil
  for _ = 1, 20 do badge.sys.gc_step() end




  build_scan()
  filled.SCAN = true

  layer = box(screens_parent, W, H, badge.ui.theme.background)
  layer:style({bg_opa = 0})
  layer:set_pos(0, 0)





  flash = box(screens_parent, W, H, 0xF8F8F8)
  flash:set_pos(0, 0)
  flash:hidden(true)
  for _ = 1, 20 do badge.sys.gc_step() end



  show("SCAN")
  live = true


  log("ready found" .. seen_count() .. "/" .. SPECIES)
end

function on_tick()
  if live then
    screens[cur].tick(badge.sys.ms())




    for _ = 1, 6 do badge.sys.gc_step() end
  end
end

function on_button(b, kind)
  if live and kind == badge.input.KIND.PRESSED then screens[cur].button(b) end
end

function on_exit()
  live = false
  nfc_set(false)
  leds(0, 0, 0)
  badge.sys.wake_lock(false)







  if flash then flash:delete() flash = nil end
  for i = #pool, 1, -1 do pool[i] = nil end
  if layer then layer:delete() layer = nil end
  for k, s in pairs(screens) do
    if s.root then s.root:delete() end
    screens[k] = nil
  end

  egg_pal, mon_art, mon_pal, mon_name = nil, nil, nil, nil
  for i = #egg_frame, 1, -1 do egg_frame[i] = nil end
  cur, painted = nil, nil
  for _ = 1, 80 do badge.sys.gc_step() end


  seen_flush()
end
