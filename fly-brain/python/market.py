"""Price series that drive the fly.

SyntheticMarket: log-price random walk with a user-set trend and volatility,
plus pump/dump shocks spread over a few bars. Its random stream is a SPAWNED
child of the seed (SeedSequence(seed, spawn_key=(1,))), so it never shares
draws with the brain's Generator, which is default_rng(seed).

ReplayMarket: a fixed list of log returns, for tests, goldens, and feeding
exactly the same series to another implementation (e.g. the fixed-point port).
"""
import math
from dataclasses import dataclass, field

import numpy as np


@dataclass
class MarketParams:
    start_price: float = 100.0
    volatility: float = 0.002  # std of the log return per bar
    trend: float = 0.0         # drift per bar, in units of volatility (0.3 = +0.3 sigma per bar)
    shock_sigmas: float = 16.0  # total size of a pump/dump, in units of volatility
    shock_bars: int = 10       # bars a pump/dump is spread over


@dataclass
class SyntheticMarket:
    seed: int
    params: MarketParams = field(default_factory=MarketParams)

    def __post_init__(self):
        self.rng = np.random.default_rng(np.random.SeedSequence(self.seed, spawn_key=(1,)))
        self.log_price = math.log(self.params.start_price)
        self.pending = []  # extra log return still to be added, one entry per coming bar

    @property
    def price(self):
        return math.exp(self.log_price)

    def shock(self, direction):
        """Queue a pump (+1) or dump (-1): shock_sigmas of volatility spread evenly over shock_bars."""
        p = self.params
        per_bar = direction * p.shock_sigmas * p.volatility / p.shock_bars
        for i in range(p.shock_bars):
            if i < len(self.pending):
                self.pending[i] += per_bar
            else:
                self.pending.append(per_bar)

    def step(self):
        """Advance one bar. Returns the bar's log return."""
        p = self.params
        r = p.trend * p.volatility + p.volatility * self.rng.standard_normal()
        if self.pending:
            r += self.pending.pop(0)
        self.log_price += r
        return r


class ReplayMarket:
    """Plays back a fixed sequence of log returns (then flat). No randomness, no shocks."""

    def __init__(self, returns, start_price=100.0):
        self.returns = [float(r) for r in returns]
        self.i = 0
        self.log_price = math.log(start_price)
        self.params = MarketParams(start_price=start_price, volatility=0.0)

    @property
    def price(self):
        return math.exp(self.log_price)

    def shock(self, direction):
        raise TypeError("ReplayMarket plays a fixed series; shocks are not supported")

    def step(self):
        r = self.returns[self.i] if self.i < len(self.returns) else 0.0
        self.i += 1
        self.log_price += r
        return r
