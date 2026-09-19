-- KTNH Mon. Collect creatures from NFC stickers and walking, duel nearby
-- badges on a six-type wheel, and take one of theirs when you win.
--
-- Structure: every screen is a full-screen container box built ONCE and then
-- shown or hidden. Widgets are never created after startup and never
-- deleted, because the 512-widget cap is hard and churn is what blows it.
local dex = require("dex")
local own = require("own")

local W, H = 320, 240
-- TRUF (Codex P1): budget is WIDGETS actually created, not queue entries
-- drained. The old-firmware on_tick allowance is 6 ms; a queue entry that
-- fans out into dozens of badge.ui calls (the shared art pool) must not
-- share a tick with several more of its kind, or a single tick blows the
-- allowance exactly the way on_enter's own budget forced this file's
-- staged-construction split in the first place.
local BUILD_WIDGETS = 12     -- widget-creation ceiling per tick while loading
local POOL_CHUNK = 8         -- boxes per staged art_pool defer (8 chunks x 8 = 64)
local LED_MS = 80             -- LED frames are expensive; 12 fps is plenty

screens = {}
SCREEN_ORDER = {"TITLE", "EGG", "STARTER", "MAP", "WALK",
                "ENCOUNTER", "DEX", "COLLECTION", "PAIR", "DUEL"}

-- The classic opening trio, in carousel order. Type ids are wheel positions:
-- 3 Fire, 1 Water, 5 Grass.
STARTER_TYPES = {3, 1, 5}
local SHAKES_TO_HATCH = 12

local cur = nil
local queue = {}
local qhead = 1
local is_ready = false
local scene = "title"
local last_led = 0
local last_tick_ms = 0
local did_resume = false
local dex_ok = false
local star_idx = 1
local egg_shakes = 0
hatch_target = nil
-- Progress toward the next wild encounter. Counted on MAP and WALK only -
-- everywhere else the player is shaking or throwing the badge, and that
-- motion must not read as walking. target is RESEEDED (40-80) every time it
-- is crossed and starts nonzero, so refresh_map's division by target can
-- never divide by zero.
local meter = 0
local target = 60
local radio_on = false
-- TRUF: on_enter assigns this; build_root reads it. Declared local HERE
-- (rather than where the brief's later task introduces it) so it is never
-- an accidental global in the ticks between this task and that one.
local screens_parent = nil

-- Widgets created so far THIS tick. label/panel/build_root bump it as the
-- ONE ground truth the drain loop measures against; nothing else may create
-- a widget during staged construction. Reset to 0 at the top of each
-- on_tick before the queue is touched.
local built_count = 0

art_pool = nil

-- ---------------------------------------------------------------- helpers

local function label(parent, text, font, colour)
  local l = badge.ui.label(parent, text)
  l:style({text_font = font or 16, text_color = colour or 0xF5F5F5})
  built_count = built_count + 1
  return l
end

local function panel(parent, w, h, colour)
  local b = badge.ui.box(parent, w, h)
  b:style({bg_color = colour or 0x1E2530})
  built_count = built_count + 1
  return b
end

-- `cost` is the caller's declared upper bound on how many widgets `fn` will
-- create. It is ONLY a scheduling hint - the drain loop below uses it to
-- decide whether a SECOND entry may share this tick with the one that just
-- ran, because built_count (the real count) is not known until after fn()
-- runs and a widget, once created, is NEVER deleted to walk it back. Omit
-- cost (nil) and the loop treats fn as unsized and never chains anything
-- after it - safe, just less packed. A single entry ALWAYS runs regardless
-- of cost, sized or not, or an entry whose cost alone exceeds the tick
-- budget would stall construction forever.
function defer(fn, cost)
  queue[#queue + 1] = {fn = fn, cost = cost}
end

function ready()
  return is_ready
end

function resumed()
  return did_resume
end

function current()
  return cur
end

function show(name)
  local s = screens[name]
  if not s then return end
  if cur and screens[cur] then screens[cur].root:hidden(true) end
  -- Walk mode is the ONLY screen outside a duel holding the wake lock, taken
  -- in WALK's own enter(). The release lives HERE, in the router, rather
  -- than duplicated in every screen WALK can lead to (MAP via B, or an
  -- ENCOUNTER spawned mid-walk) - one exit missed there would hold the lock
  -- open and drain the two AA cells for nothing.
  if cur == "WALK" and name ~= "WALK" then badge.sys.wake_lock(false) end
  cur = name
  s.root:hidden(false)
  if s.enter then s.enter() end
end

function led_scene(name)
  scene = name
end

-- ------------------------------------------------------------ LED scenes

-- Every scene derives its phase from badge.sys.ms(), never from a counter.
-- Ticks pause during the HOME confirmation while the clock keeps running; a
-- counter-driven animation freezes and then jumps, a clock-driven one does
-- not.
local function breathe(t, period)
  local p = (t % period) / period
  if p > 0.5 then p = 1 - p end
  return math.floor(p * 2 * 255)
end

local LED = {}

function LED.title(t)
  local r, g, b = badge.me.color()
  local k = breathe(t, 3000)
  badge.led.set_all(math.floor((r or 40) * k / 255),
                    math.floor((g or 180) * k / 255),
                    math.floor((b or 80) * k / 255))
end

function LED.map_idle(t)
  local k = breathe(t, 4000)
  badge.led.set_all(math.floor(20 * k / 255), math.floor(90 * k / 255),
                    math.floor(60 * k / 255))
end

function LED.off(t) end

function LED.egg(t)
  -- Pulse faster as the meter fills, so the badge feels like it is waking up.
  local period = 1200 - egg_shakes * 70
  if period < 200 then period = 200 end
  local k = breathe(t, period)
  badge.led.set_all(k, math.floor(k * 0.8), math.floor(k * 0.4))
end

function LED.walk(t)
  -- One dim pulse every two seconds. WALK holds the wake lock, so the LEDs
  -- are the second-biggest drain in this screen and get the smallest duty
  -- cycle anywhere in the app.
  if (t % 2000) < 120 then badge.led.set(1, 0, 24, 14) end
end

function LED.step_meter(t)
  -- filled is clamped to the 1-6 LED range: meter can run past target for a
  -- tick or two before step_pump() catches up and resets it, and an
  -- unclamped index here would be the one badge.led.set call in the app that
  -- can go out of range with no pcall to catch it.
  local filled = math.floor(meter * 6 / target)
  if filled > 6 then filled = 6 end
  for i = 1, filled do badge.led.set(i, 0, 60, 30) end
end

local function draw_leds(t)
  badge.led.clear()
  local fn = LED[scene] or LED.off
  fn(t)
  badge.led.show()
end

-- ------------------------------------------------------- screen builders

local function build_root(name)
  local b = badge.ui.box(screens_parent, W, H)
  b:set_pos(0, 0)
  b:style({bg_color = 0x101418})
  b:hidden(true)
  screens[name] = {root = b}
  built_count = built_count + 1
  return b
end

local function build_title()
  local root = build_root("TITLE")
  local t = label(root, "KTNH MON", 24, 0x7CFF9A)
  t:align("center", 0, -50)
  local who = label(root, badge.me.name() or "TRAINER", 18)
  who:align("center", 0, -10)
  screens.TITLE.status = label(root, "Loading...", 14, 0x8899AA)
  screens.TITLE.status:align("center", 0, 30)
  local hint = label(root, "A start", 14, 0x8899AA)
  hint:align("bottom_mid", 0, -18)
  screens.TITLE.hint = hint

  screens.TITLE.enter = function() led_scene("title") end
  screens.TITLE.button = function(b)
    if b ~= badge.input.BUTTON.A then return end
    -- A player with no starter has never played; send them to the egg.
    if own.starter() == 0 then show("EGG") else show("MAP") end
  end
end

-- Placeholder builders. Tasks 8 through 24 replace each body; the router and
-- the staged construction contract do not change when they do.
local function build_stub(name)
  return function()
    local root = build_root(name)
    local l = label(root, name, 20)
    l:align("center", 0, 0)
  end
end

-- The stage-1 member of the first family of each starter type. Stage 1 is
-- always the weakest of its family, which keeps the permanently shielded
-- starter off the trophy tier.
function starter_ids()
  local out = {}
  for i = 1, #STARTER_TYPES do
    out[i] = dex.first_of_type(STARTER_TYPES[i])
  end
  return out
end

function starter_index()
  return star_idx
end

function paint_starter()
  local id = starter_ids()[star_idx]
  screens.STARTER.name:set_text(dex.name(id))
  screens.STARTER.info:set_text(
    dex.TYPE_NAME[dex.type(id)] .. "   STRENGTH " .. dex.strength(id))
  dex.paint(art_pool, id, 88, 66, 9)
end

-- Weighted away from strength, so eggs are a trickle toward the types you
-- have not met rather than a shortcut past hunting. Starters are excluded so
-- an egg can NEVER hand out the classic trio a second way.
function roll_hatch()
  local total, starters = 0, {}
  for _, id in ipairs(starter_ids()) do starters[id] = true end
  for id = 1, dex.COUNT do
    if not starters[id] then total = total + (11 - dex.strength(id)) end
  end
  local r = badge.sys.random(total)
  for id = 1, dex.COUNT do
    if not starters[id] then
      r = r - (11 - dex.strength(id))
      if r < 0 then return id end
    end
  end
  return 1
end

local function build_egg()
  local root = build_root("EGG")
  local t = label(root, "SHAKE TO HATCH", 20, 0xFFD9A8)
  t:align("top_mid", 0, 24)
  screens.EGG.meter = badge.ui.bar(root, 0, SHAKES_TO_HATCH, 0)
  built_count = built_count + 1
  screens.EGG.meter:set_size(220, 18)
  screens.EGG.meter:align("bottom_mid", 0, -44)
  screens.EGG.msg = label(root, "An egg!", 16, 0x8899AA)
  screens.EGG.msg:align("bottom_mid", 0, -18)

  screens.EGG.enter = function()
    egg_shakes = 0
    screens.EGG.meter:set_value(0)
    -- The very first egg leads to the carousel; every later one, bought with
    -- a chest, reveals a single creature.
    if own.starter() == 0 then
      hatch_target = nil
      screens.EGG.msg:set_text("Your first partner is inside")
    else
      hatch_target = roll_hatch()
      screens.EGG.msg:set_text("Eggs left: " .. own.eggs())
    end
    led_scene("egg")
  end

  screens.EGG.tick = function(now)
    -- A HOME confirmation pauses ticks. Restarting the meter is kinder than
    -- silently keeping progress the player cannot see accumulating.
    if resumed() then
      egg_shakes = 0
      screens.EGG.meter:set_value(0)
    end
    if badge.sensor.shake() then
      egg_shakes = egg_shakes + 1
      screens.EGG.meter:set_value(math.min(egg_shakes, SHAKES_TO_HATCH))
    end
    if egg_shakes >= SHAKES_TO_HATCH then
      egg_shakes = 0
      -- MUST agree with enter()'s branch: enter() decided whether this egg
      -- is the carousel-opener or a single hatch, and that choice cannot
      -- flip between the two without stranding a player mid-shake.
      if own.starter() == 0 then
        show("STARTER")
      else
        own.take_egg()
        own.record_catch(hatch_target)
        own.save()
        show("MAP")
      end
    end
  end

  screens.EGG.button = function(b)
    if b == badge.input.BUTTON.B and own.starter() ~= 0 then show("MAP") end
  end
end

local function build_starter()
  local root = build_root("STARTER")
  local t = label(root, "CHOOSE YOUR PARTNER", 18, 0x7CFF9A)
  t:align("top_mid", 0, 12)
  screens.STARTER.name = label(root, "", 20)
  screens.STARTER.name:align("top_mid", 0, 42)
  screens.STARTER.info = label(root, "", 14, 0x8899AA)
  screens.STARTER.info:align("bottom_mid", 0, -40)
  local hint = label(root, "LEFT RIGHT choose   A confirm", 14, 0x8899AA)
  hint:align("bottom_mid", 0, -16)

  screens.STARTER.enter = function()
    star_idx = 1
    paint_starter()
  end
  screens.STARTER.button = function(b)
    local B = badge.input.BUTTON
    if b == B.RIGHT then
      star_idx = star_idx % 3 + 1
      paint_starter()
    elseif b == B.LEFT then
      star_idx = (star_idx + 1) % 3 + 1
      paint_starter()
    elseif b == B.A then
      -- Persist NOW, not on_exit: a power cut right after picking is the
      -- worst moment to lose the only creature the player has.
      own.set_starter(starter_ids()[star_idx])
      own.save()
      show("MAP")
    end
  end
end

function walking()
  return cur == "WALK"
end

function spawn_meter() return meter end
function spawn_target() return target end

function refresh_map()
  local held, seen = 0, 0
  for id = 1, dex.COUNT do
    if own.has(id) then held = held + 1 end
    if own.caught(id) > 0 then seen = seen + 1 end
  end
  screens.MAP.held:set_text("HELD " .. held .. " / " .. dex.COUNT)
  screens.MAP.pdex:set_text("POKEDEX " .. seen .. " / " .. dex.COUNT)
  screens.MAP.items:set_text("BALLS " .. own.balls() .. "   EGGS " .. own.eggs())
  screens.MAP.radio:set_text(radio_on and "radio on" or "radio off")
  -- Clamped to 100: meter can run past target for a tick before step_pump()
  -- catches it, and set_value only requires an integer, not a bounded one.
  local pct = math.floor(meter * 100 / target)
  if pct > 100 then pct = 100 end
  screens.MAP.bar:set_value(pct)
end

-- Steps are credited ONLY on MAP and WALK. Everywhere else the player is
-- shaking or throwing the badge, and those motions would read as walking.
function step_counted()
  return cur == "MAP" or cur == "WALK"
end

-- The seam Task 12's real accelerometer-derived step detector calls into.
-- Kept separate from any sensor read so this task's test can advance the
-- meter without synthesising a gait.
function add_step_for_test()
  if not step_counted() then return end
  own.add_step()
  meter = meter + 1
  if cur == "WALK" then
    screens.WALK.count:set_text(tostring(own.steps()))
    local pct = math.floor(meter * 100 / target)
    if pct > 100 then pct = 100 end
    screens.WALK.bar:set_value(pct)
  end
end

function step_pump()
  if meter >= target then
    meter = 0
    target = 40 + badge.sys.random(41)
    spawn_wild()
  end
end

function toggle_radio()
  if radio_on then
    radio_on = false
    badge.radio.disable()
  else
    radio_on = badge.radio.enable() and true or false
  end
  refresh_map()
end

-- A deliberate named seam: Task 13 replaces this body with a real encounter.
-- Kept as a call boundary so the step loop above is testable before
-- ENCOUNTER exists as anything but a stub.
function spawn_wild()
  show("ENCOUNTER")
end

local function build_map()
  local root = build_root("MAP")
  local who = label(root, badge.me.name() or "TRAINER", 20, 0x7CFF9A)
  who:align("top_left", 12, 10)
  screens.MAP.held = label(root, "", 16)
  screens.MAP.held:align("top_left", 12, 44)
  screens.MAP.pdex = label(root, "", 16)
  screens.MAP.pdex:align("top_left", 12, 68)
  screens.MAP.items = label(root, "", 16)
  screens.MAP.items:align("top_left", 12, 92)
  screens.MAP.radio = label(root, "", 14, 0x8899AA)
  screens.MAP.radio:align("top_left", 12, 116)
  screens.MAP.bar = badge.ui.bar(root, 0, 100, 0)
  -- bar bypasses label/panel, so it must bump the widget-creation counter
  -- itself or staged construction undercounts this tick - see build_egg's
  -- meter bar for the same rule.
  built_count = built_count + 1
  screens.MAP.bar:set_size(280, 12)
  screens.MAP.bar:align("bottom_mid", 0, -54)
  screens.MAP.hint1 = label(root, "A scan  UP dex  DOWN held  LEFT duel", 14, 0x8899AA)
  screens.MAP.hint1:align("bottom_mid", 0, -32)
  screens.MAP.hint2 = label(root, "RIGHT radio  START walk  HOME exit", 14, 0x8899AA)
  screens.MAP.hint2:align("bottom_mid", 0, -14)

  screens.MAP.enter = function()
    dex.hide_pool(art_pool)
    led_scene("map_idle")
    refresh_map()
  end
  screens.MAP.tick = function(now)
    step_pump()
  end
  screens.MAP.button = function(b)
    local B = badge.input.BUTTON
    if b == B.UP then show("DEX")
    elseif b == B.DOWN then show("COLLECTION")
    elseif b == B.LEFT then show("PAIR")
    elseif b == B.START then show("WALK")
    elseif b == B.RIGHT then toggle_radio()
    elseif b == B.A then screens.MAP.radio:set_text("Hold a sticker to the back")
    end
  end
end

local function build_walk()
  local root = build_root("WALK")
  screens.WALK.count = label(root, "0", 24, 0x46B355)
  screens.WALK.count:align("center", 0, -20)
  screens.WALK.bar = badge.ui.bar(root, 0, 100, 0)
  built_count = built_count + 1  -- bar bypasses label/panel; see build_map
  screens.WALK.bar:set_size(240, 10)
  screens.WALK.bar:align("center", 0, 20)
  local hint = label(root, "walking - B back", 14, 0x44505C)
  hint:align("bottom_mid", 0, -14)

  screens.WALK.enter = function()
    -- The wake lock is the expensive part, and this is the ONLY place
    -- outside a duel that takes it - the badge runs on two AA alkalines and
    -- there is no background execution, so steps only accrue while
    -- something holds the badge awake. show() releases it on every way out.
    badge.sys.wake_lock(true)
    dex.hide_pool(art_pool)
    led_scene("walk")
    screens.WALK.count:set_text(tostring(own.steps()))
  end
  screens.WALK.tick = function(now)
    step_pump()
  end
  screens.WALK.button = function(b)
    if b == badge.input.BUTTON.B then show("MAP") end
  end
end

-- ------------------------------------------------------------- lifecycle

function on_enter(root)
  screens_parent = root
  last_tick_ms = badge.sys.ms()

  dex_ok = dex.load()
  own.load()

  -- The title screen IS the loading screen: build it now, queue everything
  -- else. This is the pattern the guide prescribes for large boards, and it
  -- is what keeps on_enter inside even the 250 ms old-firmware budget.
  build_title()
  show("TITLE")

  -- TRUF R4: 64 boxes, not 48 - Task 5 sized the shared pool contract at 64
  -- and measured the worst-case creature (34 runs) against it.
  --
  -- TRUF (Codex P1): dex.new_pool(parent, 64) in ONE defer put 64 badge.ui
  -- calls in a single queue entry, and BUILD_WIDGETS only gates what the
  -- drain loop below is willing to run per tick - it cannot see inside an
  -- entry it hasn't called yet. Eight defers of 8 boxes each, merged here
  -- (never inside dex.lua, which Task 5 owns), keeps every entry small
  -- enough that the loop's per-tick ceiling actually holds.
  art_pool = {}
  for i = 1, 8 do
    defer(function()
      local chunk = dex.new_pool(screens_parent, POOL_CHUNK)
      for j = 1, #chunk do art_pool[#art_pool + 1] = chunk[j] end
      built_count = built_count + #chunk
    end, POOL_CHUNK)
  end
  -- EGG (root + 2 labels + 1 bar = 4), STARTER (root + 4 labels = 5), MAP
  -- (root + 7 labels + 1 bar = 9) and WALK (root + 2 labels + 1 bar = 4) get
  -- their real widget counts here; every other name is still a build_stub
  -- placeholder at its fixed root+label cost of 2. A wrong number here just
  -- re-widens the per-tick overrun Task 7 closed - see BUILD_WIDGETS above.
  local builders = {EGG = build_egg, STARTER = build_starter,
                    MAP = build_map, WALK = build_walk}
  local builder_cost = {EGG = 4, STARTER = 5, MAP = 9, WALK = 4}
  for i = 2, #SCREEN_ORDER do
    local name = SCREEN_ORDER[i]
    local fn = builders[name]
    if fn then
      defer(fn, builder_cost[name])
    else
      defer(build_stub(name), 2)  -- build_root + one label, always exactly 2
    end
  end
  defer(function()
    is_ready = true
    screens.TITLE.status:set_text(dex_ok and "Ready" or "dex.txt missing")
  end, 0)
end

function on_tick()
  local now = badge.sys.ms()

  -- A gap this large means ticks were paused - almost always the HOME
  -- confirmation dialog, which does not notify Lua when it closes. Anything
  -- timing-sensitive must restart rather than fast-forward.
  did_resume = (now - last_tick_ms) > 300
  last_tick_ms = now

  if not is_ready then
    built_count = 0
    while qhead <= #queue do
      local item = queue[qhead]
      -- The FIRST entry of a tick always runs, sized or not, or one
      -- oversized entry (the art-pool chunks, at 8 of a 12 budget) stalls
      -- construction forever. Every entry after it only runs if its
      -- declared cost still fits what's left of BUILD_WIDGETS - checked
      -- BEFORE the call, because a widget once created is never deleted
      -- and built_count (the real count) is only known AFTER fn() runs.
      if built_count > 0 then
        local cost = item.cost
        if not cost or built_count + cost > BUILD_WIDGETS then break end
      end
      item.fn()
      qhead = qhead + 1
    end
  end

  local s = screens[cur]
  if s and s.tick then s.tick(now) end

  if now - last_led >= LED_MS then
    last_led = now
    draw_leds(now)
  end
end

function on_button(b, kind)
  if kind ~= badge.input.KIND.PRESSED then return end
  if not is_ready then return end
  local s = screens[cur]
  if s and s.button then s.button(b) end
end

function on_exit()
  own.save()
  -- HOME quits the app directly without routing through show(), so a player
  -- who exits while WALK is current would otherwise leave the lock held
  -- through the reboot the badge needs to clear it.
  badge.sys.wake_lock(false)
  badge.led.clear()
  badge.led.show()
end
