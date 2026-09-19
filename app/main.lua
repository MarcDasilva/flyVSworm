-- KTNH Mon. Collect creatures from NFC stickers and walking, duel nearby
-- badges on a six-type wheel, and take one of theirs when you win.
--
-- Structure: every screen is a full-screen container box built ONCE and then
-- shown or hidden. Widgets are never created after startup and never
-- deleted, because the 512-widget cap is hard and churn is what blows it.
local dex = require("dex")
local own = require("own")

local W, H = 320, 240
local BUILD_BATCH = 10        -- widgets per tick during staged construction
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

art_pool = nil

-- ---------------------------------------------------------------- helpers

local function label(parent, text, font, colour)
  local l = badge.ui.label(parent, text)
  l:style({text_font = font or 16, text_color = colour or 0xF5F5F5})
  return l
end

local function panel(parent, w, h, colour)
  local b = badge.ui.box(parent, w, h)
  b:style({bg_color = colour or 0x1E2530})
  return b
end

function defer(fn)
  queue[#queue + 1] = fn
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
  defer(function() art_pool = dex.new_pool(screens_parent, 64) end)
  for i = 2, #SCREEN_ORDER do
    local name = SCREEN_ORDER[i]
    defer(build_stub(name))
  end
  defer(function()
    is_ready = true
    screens.TITLE.status:set_text(dex_ok and "Ready" or "dex.txt missing")
  end)
end

function on_tick()
  local now = badge.sys.ms()

  -- A gap this large means ticks were paused - almost always the HOME
  -- confirmation dialog, which does not notify Lua when it closes. Anything
  -- timing-sensitive must restart rather than fast-forward.
  did_resume = (now - last_tick_ms) > 300
  last_tick_ms = now

  if not is_ready then
    local built = 0
    while qhead <= #queue and built < BUILD_BATCH do
      queue[qhead]()
      qhead = qhead + 1
      built = built + 1
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
