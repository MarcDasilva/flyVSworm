-- Streaming throw detector. Feed milligravity samples from badge.sensor.accel().
-- Y is pitch; X/Z are lateral axes used for straightness.

local T = {}

T.START_MG = 1800
T.END_MG = 600
T.END_HOLD = 4
T.WINDOW = 40
T.MIN_SAMPLES = 8
T.CALIB_SAMPLES = 25
T.GRAVITY_MG = 1000

T.NONE = 0
T.NICE = 1
T.GREAT = 2
T.EXCELLENT = 3

T.GRADE_NAME = {
  [T.NONE] = "miss",
  [T.NICE] = "nice",
  [T.GREAT] = "great",
  [T.EXCELLENT] = "excellent",
}

local function abs(v)
  if v < 0 then return -v end
  return v
end

function T.multiplier_tenths(grade)
  if grade == T.EXCELLENT then return 20 end
  if grade == T.GREAT then return 15 end
  if grade == T.NICE then return 10 end
  return 0
end

function T.grade_from_peak(peak_y, straightness)
  if peak_y >= 3500 and straightness >= 200 then return T.EXCELLENT end
  if peak_y >= 2500 and straightness >= 140 then return T.GREAT end
  if peak_y >= T.START_MG then return T.NICE end
  return T.NONE
end

local function straightness_score(peak_y, lat_energy, n)
  if n == 0 or peak_y <= 0 then return 0 end
  local fwd = peak_y * peak_y * n
  local denom = fwd + lat_energy
  if denom == 0 then return 0 end
  return math.floor((fwd * 255) / denom)
end

function T.init()
  return {
    phase = "calibrating",
    calib_n = 0,
    n = 0,
    below_end = 0,
    g_ax = 0, g_ay = 0, g_az = 0,
    grav_x = 0, grav_y = T.GRAVITY_MG, grav_z = 0,
    peak_y = 0,
    lat_energy = 0,
    last_grade = T.NONE,
    last_mult_tenths = 0,
  }
end

function T.set_gravity(d, ax, ay, az)
  d.grav_x = ax
  d.grav_y = ay
  d.grav_z = az
  d.phase = "armed"
  d.calib_n = T.CALIB_SAMPLES
end

local function begin_tracking(d, dy, dx, dz)
  d.phase = "tracking"
  d.n = 1
  d.below_end = 0
  d.peak_y = abs(dy)
  d.lat_energy = dx * dx + dz * dz
end

local function finish_throw(d)
  local straight = straightness_score(d.peak_y, d.lat_energy, d.n)
  local grade = T.NONE
  if d.n >= T.MIN_SAMPLES then
    grade = T.grade_from_peak(d.peak_y, straight)
  end
  d.last_grade = grade
  d.last_mult_tenths = T.multiplier_tenths(grade)
  d.phase = "armed"
  d.n = 0
  d.below_end = 0
  d.peak_y = 0
  d.lat_energy = 0
  return grade ~= T.NONE
end

function T.feed(d, ax, ay, az)
  if d.phase == "calibrating" then
    d.g_ax = d.g_ax + ax
    d.g_ay = d.g_ay + ay
    d.g_az = d.g_az + az
    d.calib_n = d.calib_n + 1
    if d.calib_n >= T.CALIB_SAMPLES then
      d.grav_x = math.floor(d.g_ax / T.CALIB_SAMPLES)
      d.grav_y = math.floor(d.g_ay / T.CALIB_SAMPLES)
      d.grav_z = math.floor(d.g_az / T.CALIB_SAMPLES)
      d.phase = "armed"
    end
    return false
  end

  local dx = ax - d.grav_x
  local dy = ay - d.grav_y
  local dz = az - d.grav_z
  local abs_y = abs(dy)

  if d.phase == "armed" then
    if abs_y >= T.START_MG then
      begin_tracking(d, dy, dx, dz)
    end
    return false
  end

  if d.n < T.WINDOW then
    d.n = d.n + 1
    if abs_y > d.peak_y then d.peak_y = abs_y end
    d.lat_energy = d.lat_energy + dx * dx + dz * dz
  end

  if abs_y < T.END_MG then
    d.below_end = d.below_end + 1
  else
    d.below_end = 0
  end

  if d.below_end >= T.END_HOLD or d.n >= T.WINDOW then
    return finish_throw(d)
  end
  return false
end

return T
