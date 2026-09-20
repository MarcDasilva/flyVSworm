"""T1-T8 acceptance tests for the float ring attractor.

Every tN returns a Result: pass/fail plus the measured values, so a failure
says how far off it was. Each test runs on every seed in the spec and
passes only if all seeds pass. Result.summary lists the failing seeds and shows
the measured values of the first one; Result.report() shows every seed.

Metrics are sampled every tick from the 50-tick sliding-window rates. T5
ignores the first window-1 ticks of each run (window not yet full) and, in T4,
the switch window of a 180-degree landmark jump (see t4_switch_window).
Landmark positions are relative to n_wedges (a quarter and three quarters
round the ring), never hardcoded wedge numbers.

T2 and T3 run from EVERY start wedge (the landmark sets the bump there first)
and pass only if every start passes: a ring with a few resting spots holds
and turns from some headings and not others. T5 and T6 cover all these runs.

Direction convention: counterclockwise = increasing wedge index. The CCW turn
is push-pull drive (+d PEN_L, -d PEN_R); T3 asserts the direction. See
t3_phases for why PEN_L drive alone is not enough.

Besides T1-T8, pytest also checks that the robustness margin and the golden
trajectory hash in spec/ were produced from the current parameters.

Run:  pytest tests.py        or        python run.py --test
"""
import functools
import hashlib
import json
import os
from dataclasses import dataclass, field

import numpy as np
import pytest

import connectome
import metrics
from model_float import Input, init_state, load_spec, tick

HERE = os.path.dirname(os.path.abspath(__file__))
# FLY_SPEC selects the spec. Default: the rotation-averaged hemibrain ring, the trading fly (user decision);
# spec/params.json is the legacy procedural 56-neuron fly. Each spec has its own golden file:
# spec/params_hemibrain_avg.json -> spec/golden_hemibrain_avg.json, spec/params.json -> spec/golden.json.
DEFAULT_SPEC = os.path.normpath(os.path.join(HERE, "..", "spec", "params_hemibrain_avg.json"))
SPEC_PATH = os.path.normpath(os.environ.get("FLY_SPEC") or DEFAULT_SPEC)
LEGACY_SPEC = os.path.normpath(os.path.join(HERE, "..", "spec", "params.json"))


def golden_path(spec_path):
    """spec/params<X>.json -> spec/golden<X>.json"""
    g = os.path.join(os.path.dirname(spec_path), os.path.basename(spec_path).replace("params", "golden", 1))
    assert g != spec_path, f"spec file name must contain 'params' (got {spec_path})"
    return g


GOLDEN_PATH = golden_path(SPEC_PATH)
# The cheap record checks (robustness record, golden hash) also run on the legacy fly, so a change to shared
# code (tick, metrics, connectome) cannot break it unseen; T1-T8 themselves run on SPEC_PATH only.
RECORD_SPECS = sorted({SPEC_PATH, LEGACY_SPEC})
WINDOW = 50
POPULATIONS = ("EPG", "PEN_L", "PEN_R", "D7")


# ---------------------------------------------------------------- protocols --

@dataclass
class Phase:
    label: str
    ticks: int
    inp: Input


@dataclass
class Run:
    cx: object
    phases: list        # [(label, start, stop)] in ticks
    inputs: list        # Input per phase, aligned with phases
    spikes: np.ndarray  # (T, N) bool
    rates: np.ndarray   # (T, N) Hz, sliding window
    heading: np.ndarray # (T,) wedges
    strength: np.ndarray
    bumps: np.ndarray   # (T,) int
    final_v: np.ndarray = None  # membrane potentials after the last tick (a copy)

    def span(self, label_prefix):
        """(start, stop) covering every phase whose label starts with label_prefix."""
        hits = [(a, b) for lab, a, b in self.phases if lab.startswith(label_prefix)]
        return hits[0][0], hits[-1][1]


def run_protocol(cx, p, phases, seed):
    s = init_state(cx, p, seed)
    total = sum(ph.ticks for ph in phases)
    spikes = np.zeros((total, cx.N), dtype=bool)
    spans, t = [], 0
    for ph in phases:
        spans.append((ph.label, t, t + ph.ticks))
        for _ in range(ph.ticks):
            tick(s, cx, ph.inp, p)
            spikes[t] = s.spikes
            t += 1
    r = metrics.rate_series(spikes, WINDOW, p.dt)
    r_wedge = metrics.wedge_rates(r[:, cx.idx["EPG"]], cx.wedge_of[cx.idx["EPG"]], cx.n_wedges)
    h, strength = metrics.heading(r_wedge, cx.n_wedges)
    bumps = np.array([metrics.bump_count(row) for row in r_wedge])
    return Run(cx, spans, [ph.inp for ph in phases], spikes, r, h, strength, bumps, s.v.copy())


def t1_phases(cx, p, pr, start=None):
    """Landmark, then settle. start: the landmark wedge (default a quarter round the ring)."""
    landmark = Input(landmark_wedge=cx.n_wedges // 4 if start is None else start,
                     landmark_current=pr["landmark_current"], landmark_active=True, noise_amp=p.noise_amp)
    return [Phase("T1 landmark", 100, landmark),
            Phase("T1 settle", 200, Input(noise_amp=p.noise_amp))]


def t3_phases(p, pr):
    """Push-pull turning drive: +d to PEN_L and -d to PEN_R at each level.

    PEN_L drive alone does not work in this model: above the PEN threshold
    current every PEN_L fires, D7 absorbs the uniform part, and the saturating
    LIF response leaves PEN_L's bump-shaped output SMALLER than PEN_R's, so the
    bump turns clockwise. Below threshold it stays pinned to the wedge lattice.
    Pulling PEN_R down while pushing PEN_L up gives graded CCW rotation.
    """
    return [Phase(f"T3 drive_pen_l=+{d:g}, drive_pen_r=-{d:g}", 1000,
                  Input(drive_pen_l=d, drive_pen_r=-d, noise_amp=p.noise_amp))
            for d in pr["t3_drive_levels"]]


def protocol_phases(name, cx, p, pr, start=None):
    base = t1_phases(cx, p, pr, start)
    if name == "T1":
        return base
    if name == "T2":
        return base + [Phase("T2 hold", 2000, Input(noise_amp=p.noise_amp))]
    if name == "T3":
        return base + t3_phases(p, pr)
    if name == "demo":  # the T1 -> T2 -> T3 sequence plotted in out/reference.png
        return base + [Phase("T2 hold", 2000, Input(noise_amp=p.noise_amp))] + t3_phases(p, pr)
    if name == "T4":
        return base + [Phase("T4 landmark", 500, Input(
            landmark_wedge=3 * cx.n_wedges // 4, landmark_current=pr["landmark_current"],
            landmark_active=True, noise_amp=p.noise_amp)),
            Phase("T4 settle", 200, Input(noise_amp=p.noise_amp))]
    if name == "T7":
        return base + [Phase("T7 noise", 5000, Input(noise_amp=pr["t7_noise_amp"]))]
    if name == "T8":
        d = pr["t8_drive"]
        return base + [Phase("T8 L=R drive", 1000, Input(drive_pen_l=d, drive_pen_r=d, noise_amp=p.noise_amp))]
    raise KeyError(name)


PROTOCOLS = ("T1", "T2", "T3", "T4", "T7", "T8")
FROM_EVERY_WEDGE = ("T2", "T3")  # run once per start wedge, keyed "T2@<wedge>"
# What the checks are; part of the robustness key, so a record measured under other checks is stale.
SUITE = "T1-T8; T2 (with set-at <= 1 wedge) and T3 from every start wedge"


# ------------------------------------------------------------ per-seed checks --

def circ_dist(a, b, n):
    return np.abs((np.asarray(a) - b + n / 2) % n - n / 2)


def check_t1(run):
    t = run.span("T1")[1] - 1
    b, st = int(run.bumps[t]), float(run.strength[t])
    return b == 1 and st > 0.3, {"bump_count": b, "strength": st, "heading": float(run.heading[t])}


def check_t2(run):
    """Held with no input, and held WHERE the landmark set it: without the set-at
    check, a ring that pulls every bump into a few resting spots passes."""
    a, z = run.span("T2")
    n = run.cx.n_wedges
    seg = metrics.unwrap(run.heading[a - 1:z], n)  # start from the end of T1
    net = float(abs(seg[-1] - seg[0]))
    set_at = float(circ_dist(run.heading[a - 1], run.inputs[0].landmark_wedge, n))
    bmin, bmax = int(run.bumps[a:z].min()), int(run.bumps[a:z].max())
    return bmin == 1 and bmax == 1 and net < 1.0 and set_at <= 1.0, {
        "net_drift": net, "set_at_error": set_at, "bump_min": bmin, "bump_max": bmax}


def check_t3(run):
    a, z = run.span("T3")
    u = metrics.unwrap(run.heading[a - 1:z], run.cx.n_wedges)[1:]
    vel = []
    for lab, s0, s1 in run.phases:
        if lab.startswith("T3"):
            ticks = np.arange(s0, s1)
            vel.append(float(np.polyfit(ticks, u[s0 - a:s1 - a], 1)[0] * 1000.0))
    ccw = all(v > 0 for v in vel)
    increasing = all(v2 > v1 for v1, v2 in zip(vel, vel[1:]))
    return ccw and increasing, {"velocity_wedges_per_1000": vel, "ccw": ccw, "increasing": increasing}


def t3_margin(measured):
    """Smallest of the slowest velocity and the velocity steps (T3 needs all > 0)."""
    v = measured["velocity_wedges_per_1000"]
    return min([v[0]] + [b - a for a, b in zip(v, v[1:])])


def from_every_wedge(runs, name, check, worst):
    """check on the run from each start wedge; passes only if every start passes.
    Reports the failing starts and the measured values of the worst start."""
    res = {int(k.split("@")[1]): check(r) for k, r in runs.items() if k.startswith(name + "@")}
    bad = [w for w, (ok, _) in res.items() if not ok]
    show = max(res, key=lambda w: worst(res[w][1]))
    return not bad, {"starts_passed": f"{len(res) - len(bad)}/{len(res)}", "failing_starts": bad,
                     "worst_start": show, **res[show][1]}


def check_t4(run):
    """The landmark must MOVE a live bump: a single bump exists when the landmark
    jumps, the heading reaches the new wedge inside the landmark phase, and the
    bump is still single and there after the landmark turns off. Without the
    start and end checks, a dead ring passes because the landmark alone makes
    the target EPG neurons fire."""
    a, z = run.span("T4 landmark")
    end = run.span("T4 settle")[1] - 1
    target = run.inputs[[lab for lab, *_ in run.phases].index("T4 landmark")].landmark_wedge
    n = run.cx.n_wedges
    d = circ_dist(run.heading[a:z], target, n)
    hit = np.flatnonzero(d <= 1.0)
    first = int(hit[0]) if hit.size else None
    bump_start, bump_end = int(run.bumps[a - 1]), int(run.bumps[end])
    final = float(circ_dist(run.heading[end], target, n))
    ok = bump_start == 1 and first is not None and bump_end == 1 and final <= 1.0
    return ok, {"bump_at_start": bump_start, "ticks_to_within_1": first, "min_dist": float(d.min()),
                "bump_after_off": bump_end, "final_dist_after_off": final}


def t4_switch_window(run):
    """Ticks [start, stop) exempt from T5 in T4: from the landmark jump until one
    rate window after the heading first reaches the new wedge. A bump that jumps
    180 degrees shows at both positions in the 50-tick window for up to a window,
    so bump_count reads 2 there by construction. None if T4 never reaches it."""
    a, z = run.span("T4 landmark")
    if run.bumps[a - 1] != 1:  # no live bump to switch: nothing to exempt
        return None
    target = run.inputs[[lab for lab, *_ in run.phases].index("T4 landmark")].landmark_wedge
    hit = np.flatnonzero(circ_dist(run.heading[a:z], target, run.cx.n_wedges) <= 1.0)
    return (a, a + int(hit[0]) + WINDOW) if hit.size else None


def check_t5(runs):
    # Sample only once the rate window is full: until then the window reaches
    # back before tick 0 and counts that time as silent, so the profile is
    # built from the first few spikes after onset, not a 50-tick rate.
    worst, where, exempt = 0, [], None
    for name, r in runs.items():
        keep = np.zeros(r.bumps.size, dtype=bool)
        keep[WINDOW - 1:] = True
        if name == "T4" and (sw := t4_switch_window(r)) is not None:
            keep[sw[0]:sw[1]] = False
            exempt = sw[1] - sw[0]
        b = int(r.bumps[keep].max())
        if b > worst:
            worst, where = b, [name]
        elif b == worst:
            where.append(name)
    return worst <= 1, {"max_bump_count": worst, "in": "all runs" if len(where) == len(runs) else where,
                        "t4_switch_ticks_exempt": exempt}


def check_t6(runs, p):
    # A neuron at its refractory ceiling fires every refrac_ticks+1 ticks, so a
    # window holds at least window // (refrac_ticks+1) of its spikes (50 // 3
    # at refrac 2, i.e. 320 Hz; some windows catch one more). Reaching that
    # count is "at ceiling".
    ceiling = (WINDOW // (p.refrac_ticks + 1)) * 1000.0 / (WINDOW * p.dt)
    means, peak = {}, 0.0
    for name, r in runs.items():
        T = r.spikes.shape[0]
        for pop in POPULATIONS:
            sl = r.cx.idx[pop]
            means[(name, pop)] = r.spikes[:, sl].sum() / (r.spikes[:, sl].shape[1] * T * p.dt) * 1000.0
        peak = max(peak, float(r.rates.max()))
    lo_key = min(means, key=means.get)
    hi_key = max(means, key=means.get)
    ok = means[lo_key] >= 5.0 and means[hi_key] <= 60.0 and peak < ceiling
    return ok, {"min_pop_mean": (lo_key, float(means[lo_key])), "max_pop_mean": (hi_key, float(means[hi_key])),
                "peak_window_rate": peak, "ceiling": ceiling}


def check_t7(run):
    a, z = run.span("T7")
    total = run.rates[a:z, run.cx.idx["EPG"]].sum(axis=1)
    return bool(total.min() > 0), {"min_total_epg_rate": float(total.min())}


def check_t8(run):
    a, z = run.span("T8")
    u = metrics.unwrap(run.heading[a - 1:z], run.cx.n_wedges)
    exc = float(np.abs(u - u[0]).max())
    total = run.rates[a:z, run.cx.idx["EPG"]].sum(axis=1)
    bmin, bmax = int(run.bumps[a:z].min()), int(run.bumps[a:z].max())
    ok = exc <= 2.0 and bmin == 1 and bmax == 1 and total.min() > 0
    return ok, {"max_excursion": exc, "bump_min": bmin, "bump_max": bmax, "min_total_epg_rate": float(total.min())}


# ----------------------------------------------------------------- results --

@dataclass
class Result:
    name: str
    passed: bool
    per_seed: dict = field(default_factory=dict)  # seed -> (passed, measured)

    @property
    def summary(self):
        """One line: failing seeds, and the measured values of the first failing seed (or first seed if all pass)."""
        bad = [s for s, (ok, _) in self.per_seed.items() if not ok]
        show = bad[0] if bad else next(iter(self.per_seed))
        tag = "PASS" if self.passed else f"FAIL seeds {bad}"
        return f"{self.name} {tag} | seed {show}: {_fmt(self.per_seed[show][1])}"

    def report(self):
        """Every seed's pass/fail and measured values, one per line."""
        return "\n".join([self.name] + [f"  seed {s} {'pass' if ok else 'FAIL'}: {_fmt(m)}"
                                        for s, (ok, m) in self.per_seed.items()])


def _fmt(m):
    def f(v):
        if isinstance(v, float):
            return f"{v:.3g}"
        if isinstance(v, (list, tuple)):
            return "[" + ", ".join(f(x) for x in v) + "]"
        return str(v)
    return ", ".join(f"{k}={f(v)}" for k, v in m.items())


def run_all_protocols(cx, p, pr, seed, names=PROTOCOLS):
    runs = {}
    for n in names:
        for w in (range(cx.n_wedges) if n in FROM_EVERY_WEDGE else [None]):
            runs[n if w is None else f"{n}@{w}"] = run_protocol(cx, p, protocol_phases(n, cx, p, pr, w), seed)
    return runs


def evaluate(runs, p):
    """All eight checks for one seed's protocol runs -> {test: (passed, measured)}."""
    return {
        "T1": check_t1(runs["T1"]),
        "T2": from_every_wedge(runs, "T2", check_t2, worst=lambda m: m["net_drift"] + m["set_at_error"]),
        "T3": from_every_wedge(runs, "T3", check_t3, worst=lambda m: -t3_margin(m)),
        "T4": check_t4(runs["T4"]),
        "T5": check_t5(runs),
        "T6": check_t6(runs, p),
        "T7": check_t7(runs["T7"]),
        "T8": check_t8(runs["T8"]),
    }


def run_suite(p, pr, seeds, source=None):
    """T1-T8 on every seed. source = spec["connectome"] (None: the procedural model)."""
    cx = connectome.build(p, source)
    results = {n: Result(n, True) for n in ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8")}
    for seed in seeds:
        for name, (ok, measured) in evaluate(run_all_protocols(cx, p, pr, seed), p).items():
            results[name].per_seed[seed] = (bool(ok), measured)
            results[name].passed &= bool(ok)
    return results


def format_results(results):
    return "\n".join(r.summary for r in results.values())


# ------------------------------------------------------------------ pytest --

@functools.lru_cache(maxsize=1)
def _suite():
    p, spec = load_spec(SPEC_PATH)
    return run_suite(p, spec["protocol"], spec["seeds"], spec.get("connectome"))


def _check(name):
    r = _suite()[name]
    print(r.summary)
    assert r.passed, r.summary


def robustness_key(spec):
    """The spec values a robustness margin is only valid for."""
    return {"model": spec["model"], "protocol": spec["protocol"], "seeds": spec["seeds"],
            "connectome": spec.get("connectome"), "suite": SUITE}


def _ring(values_at):
    """A ring of connectome.N_WEDGES rates with {index: Hz} set (negative index counts from the end)."""
    r = np.zeros(connectome.N_WEDGES)
    for i, v in values_at.items():
        r[i] = v
    return r


def test_bump_count_jittery_single_bump_is_one():
    # seed 0, T1 ticks 50-51 under the untuned params: one bump with a dip below half-peak
    assert metrics.bump_count(_ring({3: 40, 4: 60, 5: 20, 6: 40, 7: 20})) == 1
    # fast T3 rotation wrapping 15 -> 0, with wedge 0 dipping below half-peak for one tick
    assert metrics.bump_count(_ring({-4: 20, -3: 80, -2: 100, -1: 80, 0: 40, 1: 60})) == 1


def test_bump_count_stray_spikes_are_no_bump():
    # a dying ring: two isolated single spikes (seeds 2 and 4, T4 settle, untuned params)
    assert metrics.bump_count(_ring({-5: 20, -3: 20})) == 0
    assert metrics.bump_count(_ring({})) == 0


def test_bump_count_real_double_bumps_are_two():
    n = connectome.N_WEDGES
    assert metrics.bump_count(_ring({3: 60, 4: 120, 5: 60, n // 2 + 3: 80, n // 2 + 4: 120, n // 2 + 5: 80})) == 2
    assert metrics.bump_count(_ring({2: 60, 3: 120, 4: 60, 7: 60, 8: 120, 9: 60})) == 2  # 2-wedge gap


ROBUSTNESS_GATE = 0.10  # each weight at 1 +/- 10%, one at a time, must pass T1-T8 on every seed


def robustness_gate(spec):
    """The spec's gate: ROBUSTNESS_GATE unless the spec sets "robustness_gate" (null = waived by the user,
    with the reason in "_robustness_gate_note"; the record must still be current)."""
    return spec["robustness_gate"] if "robustness_gate" in spec else ROBUSTNESS_GATE


@pytest.mark.parametrize("spec_path", RECORD_SPECS, ids=os.path.basename)
def test_robustness_record_is_current(spec_path):
    """The margin in the spec was measured on the current values, and meets the spec's gate if it has one."""
    _, spec = load_spec(spec_path)
    rec = spec.get("robustness")
    assert rec is not None, "no robustness record: run  python tune.py --robustness --write"
    assert rec["measured_on"] == robustness_key(spec), (
        "stale robustness record: spec changed since  python tune.py --robustness --write")
    gate, m = robustness_gate(spec), rec["margin_one_at_a_time"]
    if gate is None:
        assert spec.get("_robustness_gate_note"), "a waived gate needs its reason in _robustness_gate_note"
        return
    assert m is not None and m >= gate, (
        f"robustness gate failed: one-at-a-time margin {m} < {gate} (see spec robustness.failures)")


def golden_digest(p, pr, seed, source=None):
    """sha256 over the demo run's spike raster and final membrane potentials: a
    regression lock on the exact reference trajectory, not just its behaviour."""
    cx = connectome.build(p, source)
    run = run_protocol(cx, p, protocol_phases("demo", cx, p, pr), seed)
    h = hashlib.sha256()
    h.update(np.packbits(run.spikes).tobytes())
    h.update(run.final_v.astype("<f8").tobytes())
    return h.hexdigest()


def golden_key(spec):
    return {"model": spec["model"], "protocol": spec["protocol"], "connectome": spec.get("connectome")}


@pytest.mark.parametrize("spec_path", RECORD_SPECS, ids=os.path.basename)
def test_golden_trajectory(spec_path):
    p, spec = load_spec(spec_path)
    with open(golden_path(spec_path)) as f:
        g = json.load(f)
    assert g["made_with"] == golden_key(spec), (
        f"{golden_path(spec_path)} was made with different params: regenerate with  python run.py --golden --spec ...")
    assert golden_digest(p, spec["protocol"], g["seed"], spec.get("connectome")) == g["sha256"], (
        f"reference trajectory changed (spike raster or final v differ from {golden_path(spec_path)})")


def test_T1(): _check("T1")
def test_T2(): _check("T2")
def test_T3(): _check("T3")
def test_T4(): _check("T4")
def test_T5(): _check("T5")
def test_T6(): _check("T6")
def test_T7(): _check("T7")
def test_T8(): _check("T8")
