"""One fly trading a synthetic market, stepped tick by tick for the live frontend.

Timeline: a boot phase identical to T1 (landmark at a quarter of the ring for
100 ticks, then 200 ticks of settle) forms the heading bump; after that the
market produces one bar every TICKS_PER_BAR ticks. At each bar:
  1. the market moves; the position held since the last bar earns that move
  2. the new return updates the momentum signal -> push-pull drive for the next bar
  3. the position is re-set from the fly's turning speed (trading.Readout)
"""
import dataclasses
import hashlib
import json
import os

import numpy as np

import connectome
import metrics
from market import MarketParams, ReplayMarket, SyntheticMarket
from model_float import Input, init_state, load_spec, tick
from trading import DriveMapper, DriveParams, Readout, ReadoutParams

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC_PATH = os.path.normpath(os.environ.get("FLY_SPEC") or os.path.join(HERE, "..", "spec", "params_hemibrain_avg.json"))
TICKS_PER_BAR = 100
BOOT_LANDMARK_TICKS = 100
BOOT_SETTLE_TICKS = 200
BOOT_TICKS = BOOT_LANDMARK_TICKS + BOOT_SETTLE_TICKS
RATE_WINDOW = 50  # ticks; same sliding window as the tests
TREND_RANGE = (-1.0, 1.0)          # market trend limits, sigma per bar
VOLATILITY_RANGE = (0.0005, 0.01)  # market volatility limits, log-return std per bar


def _clamp(x, lo, hi):
    return min(hi, max(lo, float(x)))


def network(cx):
    """Static structure for the frontend: neurons and every nonzero synapse (W[pre, post])."""
    pop_of = np.empty(cx.N, dtype=object)
    for name, sl in cx.idx.items():
        pop_of[np.arange(cx.N)[sl]] = name
    neurons = [{"id": i, "pop": pop_of[i], "wedge": int(cx.wedge_of[i])} for i in range(cx.N)]
    pre, post = np.nonzero(cx.W)
    synapses = [[int(a), int(b), round(float(cx.W[a, b]), 6)] for a, b in zip(pre, post)]
    dp, rp = DriveParams(), ReadoutParams()
    return {"source": cx.source, "n_wedges": cx.n_wedges, "neurons": neurons, "synapses": synapses,
            "populations": list(cx.idx.keys()), "ticks_per_bar": TICKS_PER_BAR, "boot_ticks": BOOT_TICKS,
            "trading": {"min_drive": dp.min_drive, "max_drive": dp.max_drive, "max_step": dp.max_step,
                        "warmup_bars": dp.warmup_bars, "window_ticks": rp.window_ticks, "full_speed": rp.full_speed}}


class LiveSession:
    """market: any object with step() -> log return, .price and .params (default: SyntheticMarket(seed)).
    Pass a ReplayMarket to drive the fly with a fixed series. One market per session: every session
    steps its market once per bar, so two flies sharing one market object would each advance it.
    Give each fly its own ReplayMarket(returns) to show them the same series."""

    def __init__(self, seed=0, market_params=None, drive_params=None, readout_params=None, spec_path=None,
                 market=None):
        spec_path = spec_path or SPEC_PATH
        self.p, spec = load_spec(spec_path)
        self.spec = spec
        self.landmark_current = spec["protocol"]["landmark_current"]
        self.cx = connectome.build(self.p, spec.get("connectome"))
        self.epg_wedge = self.cx.wedge_of[self.cx.idx["EPG"]]
        self.seed = seed
        self.state = init_state(self.cx, self.p, seed)
        self.market = market if market is not None else SyntheticMarket(seed, market_params or MarketParams())
        self.market_start = dataclasses.asdict(self.market.params)  # for replay
        self.events = []  # [tick, event] for every applied control, for exact replay
        self.mapper = DriveMapper(drive_params)
        self.readout = Readout(self.cx.n_wedges, self.p.dt, readout_params)
        self.threshold_current = self.p.v_thresh / self.p.tau
        self.epg = self.cx.idx["EPG"]
        self.hist = np.zeros((RATE_WINDOW, self.cx.N), dtype=bool)
        self.counts = np.zeros(self.cx.N)
        self.t = 0
        self.drive_l = self.drive_r = 0.0
        self.position = 0.0  # traded position, fraction of equity, set at bar close
        self.equity = 1.0
        self.heading, self.strength, self.bumps = 0.0, 0.0, 0
        self.bump_violations = 0  # ticks after boot without exactly one bump (checked every tick)

    def apply(self, msg):
        """Apply a market control at the current tick and log it. Returns True if it changed anything.
        {"type": "market", "trend": x, "volatility": y} (either key) or {"type": "shock", "direction": +-1}.
        Raises ValueError/TypeError on malformed values."""
        if not isinstance(self.market, SyntheticMarket):
            return False
        kind, ev = msg.get("type"), None
        if kind == "market":
            ev = {"type": "market"}
            if "trend" in msg:
                self.market.params.trend = ev["trend"] = _clamp(msg["trend"], *TREND_RANGE)
            if "volatility" in msg:
                self.market.params.volatility = ev["volatility"] = _clamp(msg["volatility"], *VOLATILITY_RANGE)
        elif kind == "shock" and msg.get("direction") in (1, -1):
            self.market.shock(msg["direction"])
            ev = {"type": "shock", "direction": msg["direction"]}
        if ev is None or len(ev) == 1:
            return False
        self.events.append([self.t, ev])
        return True

    def made_with(self):
        """Everything besides seed and events that decides a run: brain spec and trading parameters in use."""
        return {"spec": {"model": self.spec["model"], "protocol": self.spec["protocol"],
                         "connectome": self.spec.get("connectome")},
                "drive": dataclasses.asdict(self.mapper.p), "readout": dataclasses.asdict(self.readout.p),
                "ticks_per_bar": TICKS_PER_BAR, "boot_ticks": BOOT_TICKS, "rate_window": RATE_WINDOW}

    def fingerprint(self):
        """Exact end state, for checking a replay."""
        return {"t": self.t, "price": self.market.price, "equity": self.equity, "position": self.position,
                "heading": self.heading, "bump_violations": self.bump_violations}

    def export(self):
        """Everything needed to re-run this session exactly (see replay), plus a check of where it ended."""
        if not isinstance(self.market, SyntheticMarket):
            raise TypeError("export() only covers SyntheticMarket sessions; re-run a ReplayMarket from its returns")
        return {"seed": self.seed, "market_seed": self.market.seed, "market_start": self.market_start,
                "events": self.events, "t": self.t, "made_with": self.made_with(), "final": self.fingerprint()}

    @classmethod
    def replay(cls, run, until=None, verify=True, **kwargs):
        """Rebuild a session from export(): same seed, same starting market, events at the same ticks.
        With verify (and no `until`), raises ValueError if the parameters in use differ from the run's
        made_with or the replay does not end exactly where the run did."""
        market = SyntheticMarket(run.get("market_seed", run["seed"]), MarketParams(**run["market_start"]))
        s = cls(seed=run["seed"], market=market, **kwargs)
        end = run["t"] if until is None else until
        if verify and "made_with" in run and s.made_with() != run["made_with"]:
            raise ValueError("replay: parameters differ from the ones this run was made with")
        for t, ev in run["events"]:
            if t > end:
                break
            s.step(t - s.t)
            s.apply(ev)
        s.step(end - s.t)
        if verify and until is None and "final" in run and s.fingerprint() != run["final"]:
            raise ValueError(f"replay ended at {s.fingerprint()}, the run ended at {run['final']}")
        return s

    @property
    def phase(self):
        return "boot" if self.t < BOOT_TICKS else "live"

    def _input(self):
        if self.t < BOOT_LANDMARK_TICKS:
            return Input(landmark_wedge=self.cx.n_wedges // 4, landmark_current=self.landmark_current,
                         landmark_active=True, noise_amp=self.p.noise_amp)
        return Input(drive_pen_l=self.drive_l, drive_pen_r=self.drive_r, noise_amp=self.p.noise_amp)

    def _bar(self):
        before = self.market.price
        r = self.market.step()
        self.equity *= 1.0 + self.position * (self.market.price / before - 1.0)
        self.mapper.update(r)
        self.drive_l, self.drive_r = self.mapper.drive(self.threshold_current)
        self.position = self.readout.position
        return {"t": self.t, "price": self.market.price, "ret": r, "signal": self.mapper.signal,
                "level": self.mapper.level(), "drive_l": self.drive_l, "drive_r": self.drive_r,
                "position": self.position, "equity": self.equity}

    def step(self, n_ticks):
        """Advance n_ticks brain ticks. Returns a frame: spikes, bars closed, and the current readouts."""
        spikes, bars = [], []
        for _ in range(n_ticks):
            live = self.t >= BOOT_TICKS
            if live and (self.t - BOOT_TICKS) % TICKS_PER_BAR == 0:
                bars.append(self._bar())
            tick(self.state, self.cx, self._input(), self.p)
            slot = self.t % RATE_WINDOW
            self.counts += self.state.spikes.astype(float) - self.hist[slot]
            self.hist[slot] = self.state.spikes
            spikes.extend([self.t, int(i)] for i in np.flatnonzero(self.state.spikes))
            rate_epg = self.counts[self.epg] * (1000.0 / (RATE_WINDOW * self.p.dt))
            rate_epg = metrics.wedge_rates(rate_epg, self.epg_wedge, self.cx.n_wedges)
            h, s = metrics.heading(rate_epg, self.cx.n_wedges)
            self.heading, self.strength = float(h), float(s)
            self.bumps = metrics.bump_count(rate_epg)
            if live:
                self.readout.update(self.heading, self.strength, self.bumps)
                self.bump_violations += self.bumps != 1
            self.t += 1
        self.last_bars = bars  # unrounded, for goldens
        return self.frame(spikes, bars)

    def frame(self, spikes=(), bars=()):
        rates = self.counts * (1000.0 / (RATE_WINDOW * self.p.dt))
        return {
            "t": self.t, "phase": self.phase, "spikes": list(spikes), "bars": [_round(b) for b in bars],
            "rates": [round(float(x), 1) for x in rates],
            "wedge_rates": [round(float(x), 1) for x in
                            metrics.wedge_rates(rates[self.epg], self.epg_wedge, self.cx.n_wedges)],
            "heading": round(self.heading, 4), "strength": round(self.strength, 4), "bumps": self.bumps,
            "speed": round(self.readout.speed, 4), "confidence": round(self.readout.confidence, 4),
            "signal": round(self.mapper.signal, 4), "level": round(self.mapper.level(), 4),
            "drive_l": round(self.drive_l, 6), "drive_r": round(self.drive_r, 6),
            "position": round(self.position, 4), "equity": round(self.equity, 6), "price": round(self.market.price, 4),
            "landmark": self.t < BOOT_LANDMARK_TICKS,
            "warming_up": self.mapper.bars < self.mapper.p.warmup_bars,
            "bump_violations": self.bump_violations,
            "market": {"trend": self.market.params.trend, "volatility": self.market.params.volatility},
        }


def golden_returns(volatility=0.002):
    """Fixed log-return series for the trading golden: calm, uptrend, calm, downtrend, calm.
    Exact decimal arithmetic only (no RNG, no trig) so it is identical on every machine."""
    wiggle = (0.9, -1.1, 0.4, -0.2, 1.3, -0.7, -0.6, 0.0)  # sums to zero
    segments = ((30, 0.0), (60, 0.6), (40, 0.0), (60, -0.6), (30, 0.0))  # (bars, drift in volatilities)
    out, i = [], 0
    for bars, drift in segments:
        for _ in range(bars):
            out.append(volatility * (drift + wiggle[i % len(wiggle)]))
            i += 1
    return out


def trading_records(seed=0, returns=None, spec_path=None):
    """Bar records of a fly trading a ReplayMarket: the trading layer's reference output."""
    returns = golden_returns() if returns is None else returns
    s = LiveSession(seed=seed, market=ReplayMarket(returns), spec_path=spec_path)
    s.step(BOOT_TICKS)
    bars = []
    for _ in range(len(returns)):
        s.step(TICKS_PER_BAR)
        bars.extend(s.last_bars)
    return bars, s.bump_violations


def trading_digest(seed=0, spec_path=None):
    bars, violations = trading_records(seed, spec_path=spec_path)
    payload = json.dumps({"bars": bars, "bump_violations": violations}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def trading_key():
    """What the trading golden depends on besides the brain spec."""
    return {"drive": dataclasses.asdict(DriveParams()), "readout": dataclasses.asdict(ReadoutParams()),
            "ticks_per_bar": TICKS_PER_BAR, "boot_ticks": BOOT_TICKS, "rate_window": RATE_WINDOW}


def _round(bar):
    return {k: (round(v, 6) if isinstance(v, float) else v) for k, v in bar.items()}
