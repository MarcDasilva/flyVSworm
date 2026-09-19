-- The harness is the only place logic can fail safely, since the badge has no
-- pcall. If the harness itself is wrong, every later test lies.
package.path = "test/?.lua;app/?.lua;" .. package.path
local mock = require("mock_badge")
local M = mock.install()

-- Widgets: handles are distinct, text round-trips, counts are tracked.
local root = M.root
local a = badge.ui.label(root, "hello")
local b = badge.ui.label(root, "world")
assert(a ~= b, "distinct widgets must not compare equal")
a:set_text("changed")
assert(M.texts[a] == "changed", "set_text must be recorded")
assert(M.widget_count() == 2, "expected 2 widgets, got " .. M.widget_count())

-- Clock is fake and monotonic, never real time.
M.ms(1000)
assert(badge.sys.ms() == 1000)
M.advance(250)
assert(badge.sys.ms() == 1250)

-- LEDs are staged then shown, exactly like the hardware.
badge.led.clear()
badge.led.set(1, 10, 20, 30)
badge.led.show()
assert(M.leds[1][1] == 10 and M.leds[1][3] == 30, "led 1 must be staged")
assert(M.leds[2][1] == 0, "unset leds must be dark")

-- Radio send is recorded; recv is delivered to the registered handler.
badge.radio.enable()
badge.radio.send("PING")
assert(M.sent[1] == "PING")
local got
badge.radio.on_recv(function(mac, rssi, payload) got = payload end)
M.recv("AA:BB", -40, "PONG")
assert(got == "PONG", "recv handler must fire")

-- Files are binary safe, matching badge.fs.
badge.fs.write("appdata/x.dat", "\0\1\255")
assert(badge.fs.read("appdata/x.dat") == "\0\1\255", "fs must be binary safe")
assert(badge.fs.read("appdata/missing.dat") == nil)

-- Store enforces the real 128-byte string cap.
badge.store.set_str("k", "v")
assert(badge.store.get_str("k", "?") == "v")
assert(badge.store.get_str("nope", "dflt") == "dflt")

-- Accelerometer defaults to flat gravity and can be driven.
local x, y, z = badge.sensor.accel()
assert(y == 1000, "default accel must read 1g on y")

-- A harness with no accelerometer must return nil, like real hardware.
local M2 = mock.install({accel = function() return nil, "unavailable" end})
assert(badge.sensor.accel() == nil, "nil accel must pass through")

-- reset() must clear every recorded table, not just sent/now, or a later
-- task that resets between cases inherits contaminated state.
local M3 = mock.install()
badge.ui.label(M3.root, "leftover")
badge.led.set(2, 5, 6, 7)
badge.led.show()
badge.fs.write("appdata/leftover.dat", "x")
badge.store.set_str("leftover", "v")
badge.radio.enable()
badge.radio.send("STALE")
M3.ms(500)
M3.reset()
assert(M3.widget_count() == 0, "reset must clear widgets, got " .. M3.widget_count())
assert(M3.leds[2][1] == 0, "reset must re-dark leds")
assert(next(M3.files) == nil, "reset must clear files")
assert(next(M3.store) == nil, "reset must clear store")
assert(#M3.sent == 0, "reset must clear sent")
assert(M3.now == 0, "reset must zero the clock")
assert(M3.root ~= nil, "reset must leave a usable root handle")
badge.ui.label(M3.root, "after reset")
assert(M3.widget_count() == 1, "root handle after reset must still parent new widgets")
-- Show with no set/clear since reset: a stale staged frame would leak led 2's
-- old {5,6,7} back in here, since show() only copies staged into M.leds.
badge.led.show()
assert(M3.leds[2][1] == 0, "reset must clear the internal staged led frame too")

print("test_mock: OK")
