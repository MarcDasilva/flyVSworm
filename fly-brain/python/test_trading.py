"""Tests for the market -> fly -> position layer (market.py, trading.py, live.py).

The live tests assert the fly's contract against the drive it ACTUALLY received,
not against the market's nominal trend: a random market path can drift the
other way for a while, and the fly is right to follow what it sees.
"""
import json
import os

import numpy as np

import live
import metrics
import tests
from live import BOOT_TICKS, TICKS_PER_BAR, LiveSession
from market import MarketParams, ReplayMarket, SyntheticMarket
from model_float import load_spec
from trading import DriveMapper, DriveParams, Readout

GOLDEN_PATH = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spec", "golden.json"))
MIN_DRIVE = DriveParams().min_drive
IDLE_POSITION_MAX = 0.3  # |position| allowed after 3 bars without drive (resting-bump hops; 0.2 seen over 60 runs)


def _feed(mapper, returns):
    for r in returns:
        mapper.update(r)
    return mapper


# ---------------------------------------------------------------- mapping --

def test_drive_is_push_pull_and_follows_price_direction():
    dl, dr = _feed(DriveMapper(), [0.001] * 60).drive(1.0)
    assert dl > 0 and dr == -dl  # rising price: +PEN_L, -PEN_R -> counterclockwise
    dl, dr = _feed(DriveMapper(), [-0.001] * 60).drive(1.0)
    assert dl < 0 and dr == -dl  # falling price: clockwise


def test_drive_respects_dead_band_warmup_cap_and_step_limit():
    p = DriveParams()
    m, levels = DriveMapper(), []
    for _ in range(60):
        m.update(0.001)
        levels.append(m.level())
    assert all(lv == 0.0 for lv in levels[:p.warmup_bars - 1])        # no drive while warming up
    assert levels[p.warmup_bars - 1] != 0.0                            # ...and it starts exactly when warm-up ends
    assert max(np.abs(np.diff([0.0] + levels))) <= p.max_step + 1e-12  # never jumps more than max_step per bar
    assert levels[-1] == p.max_drive                                   # saturates at the cap, not above
    assert _feed(DriveMapper(), [0.0] * 60).level() == 0.0             # no movement, no drive


# ----------------------------------------------------------------- market --

def test_market_is_reproducible_and_independent_of_the_brain_stream():
    a, b = SyntheticMarket(3), SyntheticMarket(3)
    assert [a.step() for _ in range(50)] == [b.step() for _ in range(50)]
    brain_first = np.random.default_rng(3).standard_normal()          # what init_state(seed=3) draws from
    market_first = SyntheticMarket(3, MarketParams(volatility=1.0)).step()
    assert market_first != brain_first
    m = SyntheticMarket(7)
    m.shock(-1)
    assert np.isclose(sum(m.pending), -m.params.shock_sigmas * m.params.volatility)


def test_replay_market_plays_the_series_then_goes_flat():
    m = ReplayMarket([0.01, -0.02])
    assert [m.step() for _ in range(4)] == [0.01, -0.02, 0.0, 0.0]
    assert np.isclose(m.price, 100 * np.exp(-0.01))


# ---------------------------------------------------------------- readout --

def test_readout_sign_wraparound_and_no_bump():
    r = Readout(n_wedges=16, dt_ms=1.0)
    h = 14.0
    for _ in range(400):  # +8 wedges/s, crossing 16 -> 0
        h = (h + 0.008) % 16
        pos = r.update(h, strength=0.9, bumps=1)
    assert np.isclose(r.speed, 8.0, atol=0.05) and pos > 0.7  # CCW -> long
    r2 = Readout(n_wedges=16, dt_ms=1.0)
    h = 1.0
    for _ in range(400):
        h = (h - 0.008) % 16
        pos = r2.update(h, strength=0.9, bumps=1)
    assert pos < -0.7  # CW -> short
    assert r2.update(h, strength=0.9, bumps=2) == 0.0  # not a single bump -> flat


# ------------------------------------------------------------- live: fly --

def _bars(session, n, shock_at=None, shock_dir=0):
    levels, positions = [], []
    for b in range(n):
        if b == shock_at:
            session.market.shock(shock_dir)
        session.step(TICKS_PER_BAR)
        levels.append(session.last_bars[0]["level"])
        positions.append(session.last_bars[0]["position"])
    return np.array(levels), np.array(positions)


def _check_contract(levels, positions):
    """Drive held at >= min_drive (same sign) for 3 bars -> position has that sign.
    No drive for 3 bars -> the position is at most resting-bump noise."""
    for k in range(3, len(levels)):
        prev = levels[k - 3:k]
        if np.all(np.abs(prev) >= MIN_DRIVE) and len(set(np.sign(prev))) == 1:
            assert np.sign(positions[k]) == np.sign(prev[-1]), (k, prev, positions[k])
        if np.all(prev == 0):
            assert abs(positions[k]) <= IDLE_POSITION_MAX, (k, positions[k])


def test_live_contract_holds_on_random_markets_with_one_bump_every_tick():
    for seed in range(3):
        for trend, shock in ((0.5, 0), (-0.5, 0), (0.0, 0), (0.0, 1), (0.0, -1)):
            s = LiveSession(seed=seed, market_params=MarketParams(trend=trend))
            s.step(BOOT_TICKS)
            levels, positions = _bars(s, 120, shock_at=40 if shock else None, shock_dir=shock)
            assert s.bump_violations == 0, (seed, trend, shock)  # checked on every tick, not just at bar ends
            _check_contract(levels, positions)
            if shock:  # a pump/dump turns the drive on in its direction within 2 s
                assert (levels[40:60] * shock).max() >= MIN_DRIVE, (seed, shock, levels[40:60])


def test_fixed_series_turns_the_fly_the_right_way():
    returns = live.golden_returns()  # calm 30, up 60, calm 40, down 60, calm 30 bars
    for seed in range(3):
        bars, violations = live.trading_records(seed=seed, returns=returns)
        pos = np.array([b["position"] for b in bars])
        assert violations == 0
        assert pos[45:90].mean() > 0.3 and pos[145:190].mean() < -0.3  # the later parts of each trend
        assert np.mean(pos[45:90] < 0) == 0 and np.mean(pos[145:190] > 0) == 0


def test_no_price_movement_means_no_drive_and_only_idle_noise():
    s = LiveSession(seed=1, market=ReplayMarket([0.0] * 100))
    s.step(BOOT_TICKS)
    levels, positions = _bars(s, 100)
    assert np.all(levels == 0) and np.all(np.abs(positions) <= IDLE_POSITION_MAX) and s.bump_violations == 0


def test_live_rates_match_metrics_rate_series():
    s = LiveSession(seed=2, market_params=MarketParams(trend=0.5))
    raster = np.zeros((BOOT_TICKS + 700, s.cx.N), dtype=bool)
    for _ in range(BOOT_TICKS + 700):
        f = s.step(1)
        for t, i in f["spikes"]:
            raster[t, i] = True
    expected = metrics.rate_series(raster, live.RATE_WINDOW, s.p.dt)[-1]
    assert np.allclose(f["rates"], np.round(expected, 1))


def test_live_session_replays_exactly_from_its_event_log():
    a = LiveSession(seed=4)
    a.step(700)
    a.apply({"type": "market", "trend": 0.6})
    a.step(1500)
    a.apply({"type": "shock", "direction": -1})
    a.step(900)
    a.apply({"type": "market", "volatility": 0.004, "trend": -0.2})
    a.step(1234)
    run = json.loads(json.dumps(a.export()))  # round-trip through JSON, as the web page's Save run does
    assert len(run["events"]) == 3 and a.market.params.trend == -0.2 and a.market.params.volatility == 0.004
    b = LiveSession.replay(run)  # verify=True: raises unless it ends exactly where `a` did
    assert b.t == a.t and b.market.price == a.market.price and b.equity == a.equity
    assert np.array_equal(b.state.v, a.state.v) and b.heading == a.heading
    early = LiveSession.replay(run, until=1000)  # stops at `until`, skipping later events
    assert early.t == 1000 and len(early.events) == 1
    tampered = dict(run, final=dict(run["final"], equity=run["final"]["equity"] + 1e-9))
    try:
        LiveSession.replay(tampered)
        raise AssertionError("a replay that ends elsewhere must be reported")
    except ValueError:
        pass
    try:
        LiveSession.replay(run, drive_params=DriveParams(span_bars=30))
        raise AssertionError("replaying with different parameters than the run was made with must be refused")
    except ValueError:
        pass
    own = LiveSession(seed=0, market=SyntheticMarket(7))  # market seed differs from the brain seed
    own.apply({"type": "market", "trend": 0.4})
    own.step(1500)
    assert LiveSession.replay(json.loads(json.dumps(own.export()))).market.price == own.market.price
    try:
        LiveSession(seed=0, market=ReplayMarket([0.0])).export()
        raise AssertionError("exporting a ReplayMarket session must fail loudly")
    except TypeError:
        pass


def test_trading_golden():
    _, spec = load_spec(live.SPEC_PATH)
    with open(GOLDEN_PATH) as f:
        g = json.load(f)["trading"]
    assert g["made_with"] == {"spec": tests.golden_key(spec), **live.trading_key()}, (
        "trading golden made with different params: regenerate with  python run.py --golden")
    assert live.trading_digest(g["seed"]) == g["sha256"], "trading layer output changed (bar records differ)"
