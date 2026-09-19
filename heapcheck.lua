--[==[badge-app
slug=heapcheck
name=Heap Check
icon=HP
api=2
]==]
-- Smallest app that still answers something. No art, no tables, no pool.
-- If THIS cannot run, the memory problem is the badge's state, not the app.
--
--   on screen   firmware, free heap, widget count
--   A           add 8 boxes and re-read the numbers
--   B           re-read the numbers without allocating
--
-- Widgets are only ever created on a button press, so reaching the first
-- screen proves compile and on_enter both survived.

local info, parent
local added = 0

local function show()
  local s = badge.sys.stats()
  info:set_text("fw " .. tostring(badge.sys.version())
    .. "\nlua " .. s.lua_used .. " / " .. s.lua_limit
    .. "\nfree " .. s.free_heap
    .. "\nwidgets " .. s.widgets
    .. "\nadded " .. added
    .. "\nA +8 boxes   B refresh")
end

function on_enter(root)
  parent = root
  info = badge.ui.label(root, "")
  info:align("top_left", 6, 6)
  show()
end

function on_button(b, kind)
  if kind ~= badge.input.KIND.PRESSED then return end
  if b == badge.input.BUTTON.A then
    for _ = 1, 8 do
      local w = badge.ui.box(parent, 4, 4)
      w:set_pos(4 + (added % 70) * 4, 120 + math.floor(added / 70) * 4)
      w:set_color(0x44FF88)
      added = added + 1
    end
  end
  show()
end
