"""CLI for the float reference model.

  python run.py --demo     out/weights.png and out/reference.png (T1 -> T2 -> T3)
  python run.py --test     T1-T8 on every seed in spec/params.json
  python run.py --golden   record the golden hashes (brain demo run + trading layer) after changing params
  python run.py --replay FILE   re-run a live session saved from the web page ("Save run") exactly
"""
import argparse
import json
import os

import connectome
import live
import plot
import tests
from model_float import load_spec

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SPEC = os.path.join(ROOT, "spec", "params.json")
OUT = os.path.join(ROOT, "out")


def demo(seed=None):
    p, spec = load_spec(SPEC)
    pr = spec["protocol"]
    seed = spec["seeds"][0] if seed is None else seed
    cx = connectome.build_procedural(p)
    os.makedirs(OUT, exist_ok=True)
    plot.plot_weights(cx, os.path.join(OUT, "weights.png"))

    run = tests.run_protocol(cx, p, tests.protocol_phases("demo", cx, p, pr), seed)
    plot.plot_reference(run, os.path.join(OUT, "reference.png"),
                        f"EPG ring attractor: T1 landmark → T2 hold → T3 push-pull turn (CCW)  ·  seed {seed}")
    print(f"wrote {os.path.join(OUT, 'weights.png')} and {os.path.join(OUT, 'reference.png')}")


def golden(seed=None):
    """Record the golden trajectory hash for the current spec in spec/golden.json."""
    p, spec = load_spec(SPEC)
    seed = spec["seeds"][0] if seed is None else seed
    g = {"protocol": "demo", "seed": seed, "sha256": tests.golden_digest(p, spec["protocol"], seed),
         "made_with": tests.golden_key(spec),
         "trading": {"seed": 0, "returns": "live.golden_returns()", "sha256": live.trading_digest(0),
                     "made_with": {"spec": tests.golden_key(spec), **live.trading_key()}}}
    with open(tests.GOLDEN_PATH, "w") as f:
        json.dump(g, f, indent=2)
    print(f"wrote {tests.GOLDEN_PATH}: {g['sha256']}")


def replay(path):
    """Re-run a saved live session and print where it ended up."""
    with open(path) as f:
        run = json.load(f)
    s = live.LiveSession.replay(run)  # raises if the parameters or the end state differ from the saved run
    print(f"replayed seed {run['seed']} with {len(run['events'])} control events to tick {s.t}, "
          f"matching the saved run exactly: "
          f"price {s.market.price:.4f}, position {s.position:+.4f}, equity {s.equity:.6f}, "
          f"heading {s.heading:.4f}, ticks without a single bump {s.bump_violations}")
    return s


def test():
    p, spec = load_spec(SPEC)
    results = tests.run_suite(p, spec["protocol"], spec["seeds"])
    for r in results.values():
        print(r.report())
    print("\n" + tests.format_results(results))
    return all(r.passed for r in results.values())


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="write out/weights.png and out/reference.png")
    ap.add_argument("--test", action="store_true", help="run T1-T8 on all seeds")
    ap.add_argument("--golden", action="store_true", help="record the golden hashes in spec/golden.json")
    ap.add_argument("--replay", metavar="FILE", help="re-run a live session saved with the page's Save run button")
    ap.add_argument("--seed", type=int, default=None, help="seed for --demo/--golden (default: first spec seed)")
    args = ap.parse_args()
    if not (args.demo or args.test or args.golden or args.replay):
        ap.print_help()
    if args.replay:
        replay(args.replay)
    if args.demo:
        demo(args.seed)
    if args.golden:
        golden(args.seed)
    if args.test:
        raise SystemExit(0 if test() else 1)
