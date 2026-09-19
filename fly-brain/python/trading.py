"""Price -> fly input, and fly -> position.

Input side (DriveMapper): price momentum becomes PUSH-PULL turning drive,
+d on PEN_L and -d on PEN_R. Rising prices turn the bump counterclockwise
(increasing wedge index), falling prices clockwise. PEN_L drive alone is never
used: above the PEN threshold current it turns the bump the wrong way (see
tests.t3_phases).

The drive magnitude respects the measured turning curve of the tuned fly
(speed vs push-pull drive, both directions, seeds 0-4):
    below ~0.4x threshold current  bump barely moves (dead zone)
    0.5x -> ~2.4 wedges/s, 0.9x -> ~5.5, 1.3x -> ~13.5, 1.6x -> ~19
so the drive jumps straight to min_drive once the signal leaves its dead band
and is capped at max_drive. Two safety limits, both measured: after 3 s of
drive an ABRUPT stop kills the bump from 1.6x (4/5 seeds) but never from 1.3x
or below, and a ramp-down over 300 ticks is safe from every level up to 1.6x.
So the cap is 1.3x and the drive level changes by at most max_step per bar.
No drive during the first warmup_bars bars, while the averages fill (on the
first bar the signal is +/-1 whatever the market does).

Output side (Readout): the bump's turning speed is the trade. CCW turning =
long, CW = short, size proportional to speed, scaled by bump strength
(confidence). No single bump -> flat. The landmark input is not used.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class DriveParams:
    span_bars: int = 40       # EMA span (bars) of the return and absolute-return averages
    dead_band: float = 0.35   # |signal| below this -> no drive (pure noise exceeds it ~7% of bars)
    full_scale: float = 0.8   # |signal| at which the drive reaches max_drive
    min_drive: float = 0.5    # drive at the dead-band edge, x threshold current (dead zone ends ~0.4-0.5)
    max_drive: float = 1.3    # drive cap, x threshold current (abrupt stops from here are safe)
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
    window_ticks: int = 250      # turning speed is measured over this many ticks
    min_speed: float = 0.5       # wedges/s; slower counts as not turning (bump wander at rest is ~0.1)
    full_speed: float = 10.0     # wedges/s that maps to a full position
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
