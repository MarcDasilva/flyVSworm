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

print("test_mock: OK")
