-- Host-side fake of the badge runtime. Mirrors docs/badge-ide-README.md
-- closely enough that a bug here is a bug there: same 1-based LED indices,
-- same staged-then-show LED model, same binary-safe fs, same nil-plus-error
-- sensor returns, same 128-byte store cap.
local mock = {}

local function widget(M, kind, is_root)
  local w = {__kind = kind}
  -- root is host-provided, not app-created; widget_count() tracks only what
  -- the app itself allocates, matching the interface's "live widgets created".
  if not is_root then M.widgets[#M.widgets + 1] = w end
  function w:set_text(t) M.texts[self] = t end
  function w:set_pos(x, y)
    assert(x == math.floor(x), "set_pos x must be an integer, got " .. tostring(x))
    assert(y == math.floor(y), "set_pos y must be an integer, got " .. tostring(y))
    M.pos[self] = {x, y}
  end
  function w:set_size(a, b)
    assert(a == math.floor(a) and b == math.floor(b), "set_size needs integers")
    M.size[self] = {a, b}
  end
  function w:align(n, dx, dy) M.align[self] = {n, dx, dy} end
  function w:set_color(c) M.color[self] = c end
  function w:set_value(v)
    assert(v == math.floor(v), "set_value needs an integer, got " .. tostring(v))
    M.value[self] = v
  end
  function w:set_range(lo, hi) M.range[self] = {lo, hi} end
  function w:set_border(c, n) end
  function w:set_font_size(s) end
  function w:style(t) M.style[self] = t end
  function w:hidden(v) M.hidden[self] = v and true or false end
  function w:clickable(v) end
  function w:bring_to_front() end
  function w:type() return kind end
  return w
end

function mock.install(opts)
  opts = opts or {}
  local M = {
    widgets = {}, texts = {}, pos = {}, size = {}, align = {}, color = {},
    value = {}, range = {}, style = {}, hidden = {},
    leds = {}, sent = {}, files = {}, store = {},
    now = 0, recv_handler = nil, radio_on = false, nfc_on = false,
    shake_queue = 0, dropped = 0, exited = false,
  }
  for i = 1, 6 do M.leds[i] = {0, 0, 0} end
  local staged = {}
  for i = 1, 6 do staged[i] = {0, 0, 0} end

  local accel = opts.accel or function() return 0, 1000, 0 end

  badge = {
    ui = {
      screen_width = 320, screen_height = 240,
      theme = {background = 0x101418, text = 0xF5F5F5, panel = 0x1E2530},
      label = function(p, t) local w = widget(M, "label"); M.texts[w] = t; return w end,
      box = function(p, a, b) return widget(M, "box") end,
      bar = function(p, lo, hi, v) local w = widget(M, "bar"); M.value[w] = v; return w end,
      arc = function(p, lo, hi, v) return widget(M, "arc") end,
    },
    led = {
      count = function() return 6 end,
      clear = function() for i = 1, 6 do staged[i] = {0, 0, 0} end end,
      set = function(i, r, g, b)
        assert(i >= 1 and i <= 6, "LED index must be 1-6, got " .. tostring(i))
        assert(r == math.floor(r) and g == math.floor(g) and b == math.floor(b),
          "LED channels must be integers")
        staged[i] = {r, g, b}
      end,
      set_all = function(r, g, b) for i = 1, 6 do staged[i] = {r, g, b} end end,
      show = function() for i = 1, 6 do M.leds[i] = {staged[i][1], staged[i][2], staged[i][3]} end end,
    },
    sensor = {
      accel = accel,
      shake = function()
        if M.shake_queue > 0 then M.shake_queue = M.shake_queue - 1; return true end
        return false
      end,
      tap = function() return false end,
      orientation = function() return "flat_up" end,
    },
    input = {
      BUTTON = {A = 1, B = 2, HOME = 3, DOWN = 4, LEFT = 5, RIGHT = 6, UP = 7, AUX1 = 8, START = 9},
      KIND = {PRESSED = 1, RELEASED = 2},
      is_down = function() return false end,
      held = function() return 0 end,
    },
    sys = {
      ms = function() return M.now end,
      uptime = function() return math.floor(M.now / 1000) end,
      log = function(s) end,
      random = function(n) if n then return math.random(0, n - 1) end return math.random(0, 2 ^ 31) end,
      heap = function() return 20000 end,
      gc_step = function() end,
      version = function() return "mock" end,
      wake_lock = function(v) M.wake = v end,
      stats = function() return {lua_used = 20000, lua_peak = 24000, lua_limit = 98304,
        widgets = #M.widgets, uptime_ms = M.now, free_heap = 59588} end,
    },
    store = {
      set = function(k, v) M.store[k] = v end,
      get = function(k, d) local v = M.store[k]; if v == nil then return d end; return v end,
      set_int = function(k, v) M.store[k] = math.floor(v) end,
      get_int = function(k, d) local v = M.store[k]; if v == nil then return d end; return v end,
      set_str = function(k, v)
        assert(#v <= 128, "store strings are capped at 128 bytes, got " .. #v)
        assert(not v:find("\n"), "store strings cannot contain newlines")
        M.store[k] = v
      end,
      get_str = function(k, d) local v = M.store[k]; if v == nil then return d end; return v end,
    },
    me = {
      name = function() return opts.name or "MARC" end,
      role = function() return 1 end,
      role_name = function() return "Hacker" end,
      color = function() return 124, 255, 154 end,
      badge_id = function() return opts.badge_id or "HTN0001" end,
      provisioned = function() return true end,
    },
    contacts = {
      count = function() return 0 end,
      get = function(i) return nil, "out of range" end,
    },
    app = {
      slug = function() return "ktnh_mon" end,
      name = function() return "KTNH Mon" end,
      exit = function() M.exited = true end,
    },
    fs = {
      write = function(p, d) M.files[p] = d; return true end,
      append = function(p, d) M.files[p] = (M.files[p] or "") .. d; return true end,
      read = function(p)
        if M.files[p] == nil then return nil, "no such file" end
        return M.files[p]
      end,
      exists = function(p) return M.files[p] ~= nil end,
      remove = function(p) local had = M.files[p] ~= nil; M.files[p] = nil; return had end,
      list = function() local o = {} for k in pairs(M.files) do o[#o + 1] = k end return o end,
      mkdir = function() return true end,
    },
    nfc = {
      enable = function() M.nfc_on = (opts.nfc ~= false); return M.nfc_on end,
      disable = function() M.nfc_on = false end,
      card = function() return M.card end,
      read_text = function() return M.card_text end,
      clear = function() M.card = nil end,
    },
    radio = {
      enable = function() M.radio_on = (opts.radio ~= false); return M.radio_on end,
      disable = function() M.radio_on = false end,
      send = function(p)
        assert(#p >= 1 and #p <= 44, "radio payload must be 1-44 bytes, got " .. #p)
        M.sent[#M.sent + 1] = p
        return true
      end,
      on_recv = function(f) M.recv_handler = f end,
      mac = function() return opts.mac or "AA:BB:CC:DD:EE:01" end,
      dropped = function() return M.dropped end,
    },
  }

  M.card = opts.card
  M.card_text = opts.card_text
  M.root = widget(M, "box", true)

  function M.reset()
    M.sent = {}
    M.now = 0
  end
  function M.ms(v) M.now = v end
  function M.advance(n) M.now = M.now + n end
  function M.widget_count() return #M.widgets end
  function M.recv(mac, rssi, payload)
    if M.recv_handler then M.recv_handler(mac, rssi, payload) end
  end
  function M.shake(n) M.shake_queue = M.shake_queue + (n or 1) end
  function M.press(b)
    if on_button then on_button(b, badge.input.KIND.PRESSED) end
    if on_button then on_button(b, badge.input.KIND.RELEASED) end
  end
  function M.tick(n)
    for _ = 1, (n or 1) do
      M.advance(20)
      if on_tick then on_tick() end
    end
  end
  return M
end

return mock
