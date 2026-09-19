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

local cur = nil
local queue = {}
local qhead = 1
local is_ready = false
local scene = "title"
local last_led = 0
local last_tick_ms = 0
local did_resume = false
local dex_ok = false
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
  for i = 2, #SCREEN_ORDER do
    local name = SCREEN_ORDER[i]
    defer(build_stub(name), 2)  -- build_root + one label, always exactly 2
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
  badge.led.clear()
  badge.led.show()
end
