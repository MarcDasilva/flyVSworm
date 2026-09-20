"""Price -> fly input, and fly -> position.

Input side (DriveMapper): price momentum becomes PUSH-PULL turning drive,
+d on PEN_L and -d on PEN_R. Rising prices turn the bump counterclockwise
(increasing wedge index), falling prices clockwise. PEN_L drive alone is never
used: above the PEN threshold current it turns the bump the wrong way (see
tests.t3_phases).

The trading fly is the rotation-averaged hemibrain ring (spec/params_hemibrain_avg.json,
user decision 2026-09-19); the procedural 56-neuron fly (spec/params.json) is legacy.
Measured turning curve of the trading fly (speed vs push-pull drive, seeds 0-4,
CCW / CW):
    0.2x -> +1.0 / -0.35 wedges/s, 0.5x -> +2.2 / -1.8, 0.9x -> +3.6 / -3.4,
    1.3x -> +4.5 / -4.2, 2.0x -> +5.8 / -5.6
There is no dead zone, but clockwise is slower at low drive: a ~0.3 wedges/s
counterclockwise bias from the measured left/right asymmetry of the wiring.
The drive TARGET jumps straight to min_drive once the signal leaves its dead
band and is capped at max_drive. The APPLIED level still moves by at most
max_step per bar, so the first bar out of the band applies 0.3x.
Safety, measured after 3 s of drive: on the trading fly, abrupt stops and the
stepped ramp-down both keep the bump from every level up to 2.0x. The cap of
1.3x was set on the legacy fly, where abrupt stops lose the bump from 1.2x
(2/20 runs) but the stepped ramp (at most max_step per bar) is safe up to 1.3x
(user decision: the cap rests on the stepped ramp). test_trading checks the
ramp from the cap, an abrupt stop from 1.1x as margin, and min_drive's speed,
on whichever spec the tests run. The legacy fly turns much faster (1.3x ->
~15 wedges/s, dead zone below ~0.3x), so on it the position saturates early.
No drive during the first warmup_bars bars, while the averages fill (on the
first bar the signal is +/-1 whatever the market does).

Output side (Readout): the bump's turning speed is the trade. CCW turning =
long, CW = short, size proportional to speed, scaled by bump strength
(confidence). No single bump -> flat. The landmark input is not used.
Calibrated on the trading fly (user decision: a 500-tick window). Resting
wander over 500 ticks (240 runs x 8 s): 99% under 0.85 wedges/s, max 1.88; at
min_drive (0.6x) every window turns faster than ~1.2 (1st percentile 1.45 CW).
So min_speed 0.8 zeroes almost all resting wander, and full_speed 7.0 keeps the
worst resting blip at a 0.27 position (the tests allow 0.3) while the cap
(~4.4 wedges/s) reaches ~0.63. The 250-tick window made resting blips reach
2.8 wedges/s, too close to the driven speeds.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class DriveParams:
    span_bars: int = 40       # EMA span (bars) of the return and absolute-return averages
    dead_band: float = 0.35   # |signal| below this -> no drive (pure noise exceeds it ~7% of bars)
    full_scale: float = 0.8   # |signal| at which the drive reaches max_drive
    min_drive: float = 0.6    # drive at the dead-band edge, x threshold current (trading fly ~2.3-2.7 wedges/s)
    max_drive: float = 1.3    # drive cap, x threshold current (the max_step-per-bar stop from here is safe)
    max_step: float = 0.3     # largest change of drive level per bar, x threshold current
    warmup_bars: int = 20     # no drive until this many bars have been seen


class DriveMapper:
    """signal = EMA(log return) / EMA(|log return|), in [-1, 1]: trend strength, scale-free."""

    def __init__(self, params=None):
        self.p = params or DriveParams()
        self.alpha = 2.0 / (self.p.span_bars + 1)
        self.ema_r = 0.0
        self.ema_abs = 0.0
        self.signal = 0.0
        self.bars = 0
        self.current = 0.0  # drive level actually applied, after the per-bar step limit

    def update(self, log_return):
        """Feed one bar's log return; returns the signal and moves the applied level one step toward target()."""
        a = self.alpha
        self.ema_r += a * (log_return - self.ema_r)
        self.ema_abs += a * (abs(log_return) - self.ema_abs)
        self.signal = self.ema_r / self.ema_abs if self.ema_abs > 0 else 0.0
        self.bars += 1
        step = float(np.clip(self.target() - self.current, -self.p.max_step, self.p.max_step))
        self.current += step
        return self.signal

    def target(self):
        """Drive level the signal asks for, x threshold current (0 in the dead band or during warm-up)."""
        p, s = self.p, self.signal
        if self.bars < p.warmup_bars or abs(s) < p.dead_band:
            return 0.0
        frac = min(1.0, (abs(s) - p.dead_band) / (p.full_scale - p.dead_band))
        return float(np.sign(s)) * (p.min_drive + frac * (p.max_drive - p.min_drive))

    def level(self):
        """Signed drive level applied now, x threshold current (rate-limited toward target())."""
        return self.current

    def drive(self, threshold_current):
        """(drive_pen_l, drive_pen_r): push-pull, +d on PEN_L and -d on PEN_R."""
        d = self.current * threshold_current
        return d, -d


@dataclass
class ReadoutParams:
    window_ticks: int = 500      # turning speed is measured over this many ticks (5 bars)
    min_speed: float = 0.8       # wedges/s; slower counts as not turning (resting wander: ~99% below)
    full_speed: float = 7.0      # wedges/s that maps to a full position (resting max 1.88 -> 0.27; cap ~4.4 -> ~0.63)
    strength_floor: float = 0.3  # bump strength at or below which confidence is 0 (T1's threshold)
    strength_full: float = 0.8   # bump strength at which confidence is 1


class Readout:
    """Turning speed of the bump -> position in [-1, 1]."""

    def __init__(self, n_wedges, dt_ms, params=None):
        self.p = params or ReadoutParams()
        self.n = n_wedges
        self.dt_ms = dt_ms
        self.unwrapped = []  # unwrapped heading per tick, last window_ticks+1 values
        self.speed = 0.0     # wedges/s, + = CCW
        self.confidence = 0.0
        self.position = 0.0

    def update(self, heading, strength, bumps):
        p = self.p
        if bumps != 1:  # no single bump: heading is meaningless, restart the speed estimate
            self.unwrapped.clear()
            self.speed = self.confidence = self.position = 0.0
            return self.position
        if self.unwrapped:
            prev = self.unwrapped[-1]
            step = (heading - prev + self.n / 2) % self.n - self.n / 2  # shortest way round the ring
            self.unwrapped.append(prev + step)
        else:
            self.unwrapped.append(heading)
        if len(self.unwrapped) > p.window_ticks + 1:
            del self.unwrapped[0]
        span = len(self.unwrapped) - 1
        self.speed = (self.unwrapped[-1] - self.unwrapped[0]) / (span * self.dt_ms) * 1000.0 if span else 0.0
        self.confidence = float(np.clip((strength - p.strength_floor) / (p.strength_full - p.strength_floor), 0, 1))
        if abs(self.speed) < p.min_speed or span < p.window_ticks:
            self.position = 0.0
        else:
            self.position = float(np.clip(self.speed / p.full_speed, -1, 1)) * self.confidence
        return self.position
