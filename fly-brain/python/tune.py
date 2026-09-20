"""Guided parameter sweep and robustness pass for a spec (default: tests.DEFAULT_SPEC, or FLY_SPEC / --spec).

Stages follow the brief's order, so interactions are not chased out of order:
  1 activity     D7 inhibition off, landmark on: do EPG neurons fire at all?
  2 single bump  scan w_de: one bump after T1 (too low: ring lights up; too high: dies)
  3 persistence  scan w_ee: T2 (bump held 2000 ticks with no input)
  4 rotation     scan w_pe, w_ep: T3 (push-pull drive turns CCW, faster with drive)
Each scan reports the passing window of its test; `--center` then moves every
weight to the geometric middle of its FULL-SUITE (T1-T8, all seeds) window,
because an edge value is a knife edge the fixed-point port will fall off.

Robustness: every weight at 1 +/- delta one at a time, plus all 2^5 sign
corners with every weight perturbed at once, on all seeds, full suite. The
margin is the largest delta on the grid at which every configuration passes.

  python tune.py --stages          report stages 1-4 around the current spec
  python tune.py --center          centre each weight in its full-suite window (prints, does not write)
  python tune.py --robustness      margin grid; --write records it in the spec
"""
import argparse
import dataclasses
import itertools
import json
import os
from multiprocessing import Pool

import numpy as np

import connectome
import tests
from model_float import Input, load_spec

GAINS = ("w_ee", "w_ed", "w_de", "w_ep", "w_pe", "w_dd", "w_dp", "w_pp")
WEIGHTS = GAINS[:5]  # replaced in __main__ by the gains the spec actually uses (non-zero)
SOURCE = None        # spec["connectome"], set in __main__ and passed to workers with every job
                     # (on Windows, pool workers re-import this module and never see __main__'s globals)
# Multiplicative factors, symmetric in log space; the middle point is exactly 1.0 (the spec value).
SCAN = np.round(np.exp(np.linspace(np.log(0.5), np.log(2.0), 21)), 4)
DELTAS = (0.10, 0.15, 0.20, 0.25, 0.30)


def scaled(p, factors):
    return dataclasses.replace(p, **{k: getattr(p, k) * f for k, f in factors.items()})


def _suite(args):
    p, pr, seeds, source = args
    return {n: r.passed for n, r in tests.run_suite(p, pr, seeds, source).items()}


def run_many(configs, pr, seeds, pool):
    """Full suite for each Params in configs -> list of {test: passed}."""
    return pool.map(_suite, [(p, pr, seeds, SOURCE) for p in configs])


# ------------------------------------------------------------------ stages --

def _stage_run(args):
    p, pr, seed, stage, source = args
    cx = connectome.build(p, source)
    if stage == 1:
        run = tests.run_protocol(cx, p, tests.t1_phases(cx, p, pr)[:1], seed)
        return float(run.spikes[:, cx.idx["EPG"]].mean() * 1000)
    name = {2: "T1", 3: "T2", 4: "T3"}[stage]
    run = tests.run_protocol(cx, p, tests.protocol_phases(name, cx, p, pr), seed)
    return {2: tests.check_t1, 3: tests.check_t2, 4: tests.check_t3}[stage](run)[0]


def stages(p, pr, seeds, pool):
    """Stages 1-4 in the brief's order; each prints the passing window of its own test."""
    rate = pool.map(_stage_run, [(scaled(p, {"w_de": 0.0}), pr, s, 1, SOURCE) for s in seeds])
    print(f"stage 1 activity: w_de=0, landmark on -> EPG mean rate {np.mean(rate):.1f} Hz (silent if 0)")
    for stage, keys in ((2, ("w_de",)), (3, ("w_ee",)), (4, ("w_pe", "w_ep"))):
        for k in keys:
            jobs = [(scaled(p, {k: f}), pr, s, stage, SOURCE) for f in SCAN for s in seeds]
            ok = np.array(pool.map(_stage_run, jobs)).reshape(len(SCAN), len(seeds)).all(axis=1)
            lo, hi = window(ok)
            test = {2: "T1 single bump", 3: "T2 persistence", 4: "T3 rotation"}[stage]
            print(f"stage {stage} {test}: {k} passes for x[{lo:.3f}, {hi:.3f}] around {getattr(p, k):.4g}"
                  if lo is not None else f"stage {stage} {test}: {k} fails at the current value")


def window(ok):
    """Contiguous passing interval of SCAN factors that contains 1.0 -> (lo, hi) or (None, None)."""
    i = int(np.argmin(np.abs(SCAN - 1.0)))
    if not ok[i]:
        return None, None
    a = i
    while a > 0 and ok[a - 1]:
        a -= 1
    b = i
    while b < len(SCAN) - 1 and ok[b + 1]:
        b += 1
    return SCAN[a], SCAN[b]


def center(p, pr, seeds, pool):
    """Move each weight to the geometric middle of its full-suite passing window."""
    for k in WEIGHTS:
        res = run_many([scaled(p, {k: f}) for f in SCAN], pr, seeds, pool)
        lo, hi = window(np.array([all(r.values()) for r in res]))
        if lo is None:
            print(f"{k}: current value fails the suite; not moved")
            continue
        mid = float(np.sqrt(lo * hi))
        edge = " (window reaches the scan edge)" if lo == SCAN[0] or hi == SCAN[-1] else ""
        print(f"{k}: passes x[{lo:.3f}, {hi:.3f}]{edge}; centre x{mid:.3f} -> {getattr(p, k) * mid:.5g}")
        p = scaled(p, {k: mid})
    return p


# -------------------------------------------------------------- robustness --

def perturbations(delta, corners=True):
    """(label, factors, kind) for one-at-a-time +/-delta ("axis") and, with corners, all 2^len(WEIGHTS)
    sign corners ("corner")."""
    out = [(f"{k}{'+' if s > 0 else '-'}", {k: 1 + s * delta}, "axis") for k in WEIGHTS for s in (1, -1)]
    for signs in (itertools.product((1, -1), repeat=len(WEIGHTS)) if corners else ()):
        out.append(("corner " + "".join("+" if s > 0 else "-" for s in signs),
                    {k: 1 + s * delta for k, s in zip(WEIGHTS, signs)}, "corner"))
    return out


def robustness(p, pr, seeds, pool, deltas=DELTAS, corners=True):
    """Largest delta on the grid at which every perturbation passes T1-T8 on every seed, reported
    separately for one-at-a-time perturbations and for those plus all sign corners (None without corners)."""
    # None = fails already at the smallest delta on the grid (not "zero tolerance measured")
    margins, failures, alive = {"axis": None, "axis+corner": None}, {}, {"axis": True, "axis+corner": True}
    for d in deltas:
        perts = perturbations(d, corners)
        res = run_many([scaled(p, f) for _, f, _ in perts], pr, seeds, pool)
        bad = [(lab, kind, [t for t, ok in r.items() if not ok]) for (lab, _, kind), r in zip(perts, res)
               if not all(r.values())]
        n_axis = sum(k == "axis" for *_, k in perts)
        bad_axis = [b for b in bad if b[1] == "axis"]
        print(f"delta {d:.2f}: axis {n_axis - len(bad_axis)}/{n_axis}, all {len(perts) - len(bad)}/{len(perts)} pass"
              + ("" if not bad else f"; failing: {[(b[0], b[2]) for b in bad[:6]]}{' ...' if len(bad) > 6 else ''}"))
        if bad:
            failures[f"{d:.2f}"] = [[b[0], b[2]] for b in bad]
        alive["axis"] &= not bad_axis
        alive["axis+corner"] &= not bad
        for k in margins:
            if alive[k]:
                margins[k] = d
        if not alive["axis"]:
            break
    if not corners:
        margins["axis+corner"] = None
    return margins, failures


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stages", action="store_true")
    ap.add_argument("--center", action="store_true")
    ap.add_argument("--robustness", action="store_true")
    ap.add_argument("--write", action="store_true", help="with --robustness: record the margin in the spec")
    ap.add_argument("--no-corners", action="store_true",
                    help="with --robustness: one-at-a-time only (corners are never gated; 2^8 of them on the hemibrain)")
    ap.add_argument("--spec", default=None, help="spec file (default spec/params_hemibrain_avg.json, or FLY_SPEC)")
    args = ap.parse_args()
    if args.spec:
        tests.SPEC_PATH = os.path.abspath(args.spec)
    p, spec = load_spec(tests.SPEC_PATH)
    SOURCE = spec.get("connectome")
    WEIGHTS = tuple(g for g in GAINS if getattr(p, g) != 0)
    pr, seeds = spec["protocol"], spec["seeds"]
    with Pool(os.cpu_count()) as pool:
        if args.stages:
            stages(p, pr, seeds, pool)
        if args.center:
            c = center(p, pr, seeds, pool)
            print(json.dumps({k: round(getattr(c, k), 6) for k in WEIGHTS}))
        if args.robustness:
            margins, failures = robustness(p, pr, seeds, pool, corners=not args.no_corners)
            fmt = lambda m: f"+/-{m:.0%}" if m is not None else f"< {DELTAS[0]:.0%} (fails the smallest step)"
            gate = tests.robustness_gate(spec)
            print(f"robustness margin: one-at-a-time {fmt(margins['axis'])} "
                  + (f"(the gate, >= {gate:.0%}); " if gate is not None else "(gate waived for this spec); ")
                  + (f"with all {2 ** len(WEIGHTS)} corners {fmt(margins['axis+corner'])} (recorded, not gated)"
                     if not args.no_corners else "corners not run"))
            if args.write:
                spec["robustness"] = {
                    "margin_one_at_a_time": margins["axis"],
                    "margin_with_corners": margins["axis+corner"],
                    "corners_run": not args.no_corners,  # false: margin_with_corners is null because not measured
                    # what the margins were measured on; tests.py fails if the spec moves away from it
                    "measured_on": tests.robustness_key(spec),
                    "gate": (f"margin_one_at_a_time >= {gate} (user decision)" if gate is not None else
                             "waived for this spec (user decision, see _robustness_gate_note)")
                            + "; corners are recorded but not gated. A null margin = fails already at the smallest "
                              "delta (for margin_with_corners, only when corners_run is true).",
                    "method": f"{', '.join(WEIGHTS)} scaled by 1+/-delta one at a time ({2 * len(WEIGHTS)} configs), "
                              + (f"and additionally at all 2^{len(WEIGHTS)} sign corners at once ({2 ** len(WEIGHTS)} configs); "
                                 if not args.no_corners else "corners not run (--no-corners; margin_with_corners null); ") +
                              f"{tests.SUITE}, on every seed; "
                              f"margin = largest delta on the grid {list(DELTAS)} at which every config passes",
                    "failures": failures,
                }
                with open(tests.SPEC_PATH, "w") as f:
                    json.dump(spec, f, indent=2)
                print(f"wrote robustness to {tests.SPEC_PATH}")
