"""Pull what the 3D brain view needs from hemibrain v1.2.1 (neuPrint), into data/:

  1. every synapse between the 134 heading-circuit neurons of data/cx_model.npz, with its
     pre (T-bar) and post (PSD) location          -> data/cx_synapses.npz
  2. the non-simulated context shown greyed out: every ExR1, plus every neuron with at least
     PARTNER_MIN_SYNAPSES synapses to or from the circuit -> data/context_neurons.json
  3. meshes of the central-complex neuropils       -> data/rois/<roi>.obj

Needs your neuPrint token, read the same way as extract_hemibrain.py (environment or .env);
it is never printed or saved. Read-only queries. From the fly-brain folder:

    .venv/Scripts/python python/extract_3d.py

Coordinates are stored as neuPrint gives them: hemibrain voxels (8 nm). bake_3d.py converts them.
"""
import datetime
import json
import os
import sys

import numpy as np

from extract_hemibrain import DATASET, DOTENV_PATHS, SERVER, TOKEN_VAR, token_from_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
PARTNER_MIN_SYNAPSES = 200         # candidate pool (426 neurons); bake_3d.py shows the strongest CONTEXT_TOP of them
CONTEXT_TYPES = ("ExR1",)          # always shown, whatever their synapse count
ROIS = ("EB", "PB", "FB", "NO")    # central-complex neuropils drawn as translucent shells


def client():
    from neuprint import Client
    if not os.environ.get(TOKEN_VAR):
        for path in DOTENV_PATHS:
            token = token_from_dotenv(path)
            if token:
                os.environ[TOKEN_VAR] = token  # this process only; never printed or written anywhere
                print(f"using the neuPrint token from {path}")
                break
    if not os.environ.get(TOKEN_VAR):
        sys.exit(f"No neuPrint token: set {TOKEN_VAR}, or put {TOKEN_VAR}=<token> in {DOTENV_PATHS[0]}")
    return Client(SERVER, DATASET)  # keep the reference: neuprint holds its default client only weakly


def circuit_ids():
    with np.load(os.path.join(DATA, "cx_model.npz"), allow_pickle=False) as f:
        return [int(b) for b in f["body_id"]]


def synapses(c, ids):
    from neuprint import NeuronCriteria as NC, fetch_synapse_connections
    df = fetch_synapse_connections(NC(bodyId=ids), NC(bodyId=ids), client=c)
    print(f"fetched {len(df)} synapses among the {len(ids)} circuit neurons")
    df = df.sort_values(["bodyId_pre", "bodyId_post", "x_post", "y_post", "z_post"]).reset_index(drop=True)
    return {
        "pre_body": df["bodyId_pre"].to_numpy(np.int64),
        "post_body": df["bodyId_post"].to_numpy(np.int64),
        "pre_xyz": df[["x_pre", "y_pre", "z_pre"]].to_numpy(np.int32),
        "post_xyz": df[["x_post", "y_post", "z_post"]].to_numpy(np.int32),
    }


def context(c, ids):
    from neuprint import NeuronCriteria as NC, fetch_adjacencies, fetch_neurons
    ids_set = set(ids)
    totals = {}  # partner bodyId -> [synapses onto the circuit, synapses from the circuit]
    for direction, (src, dst) in (("to", (None, NC(bodyId=ids))), ("from", (NC(bodyId=ids), None))):
        _, conn = fetch_adjacencies(src, dst, client=c)
        partner = conn["bodyId_pre"] if direction == "to" else conn["bodyId_post"]
        for b, w in zip(partner, conn["weight"]):
            if b not in ids_set:
                totals.setdefault(int(b), [0, 0])[0 if direction == "to" else 1] += int(w)
    strong = {b for b, (a, z) in totals.items() if a + z >= PARTNER_MIN_SYNAPSES}
    typed, _ = fetch_neurons(NC(type=list(CONTEXT_TYPES)), client=c)
    chosen = sorted(strong | set(typed["bodyId"].astype(int)))
    info, _ = fetch_neurons(NC(bodyId=chosen), client=c)
    info = info.set_index("bodyId")
    out = []
    for b in chosen:
        to_c, from_c = totals.get(b, [0, 0])
        t = info.at[b, "type"] if b in info.index else None
        out.append({"body_id": b, "type": t if isinstance(t, str) else "",
                    "instance": str(info.at[b, "instance"]) if b in info.index else "",
                    "synapses_onto_circuit": to_c, "synapses_from_circuit": from_c,
                    "why": "type" if (isinstance(t, str) and t in CONTEXT_TYPES) else "partner"})
    print(f"{len(totals)} partners in all; {len(strong)} with >= {PARTNER_MIN_SYNAPSES} synapses; "
          f"{len(out)} context neurons including {', '.join(CONTEXT_TYPES)}")
    return out


def roi_meshes(c):
    os.makedirs(os.path.join(DATA, "rois"), exist_ok=True)
    for roi in ROIS:
        c.fetch_roi_mesh(roi, export_path=os.path.join(DATA, "rois", f"{roi}.obj"))
    print(f"wrote ROI meshes for {', '.join(ROIS)}")


def main():
    import neuprint
    c = client()
    ids = circuit_ids()
    syn = synapses(c, ids)
    ctx = context(c, ids)
    roi_meshes(c)
    meta = {"server": SERVER, "dataset": DATASET, "neuprint_python": neuprint.__version__,
            "fetched_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "circuit_neurons": len(ids), "synapses": int(len(syn["pre_body"])), "units": "hemibrain voxels (8 nm)",
            "partner_min_synapses": PARTNER_MIN_SYNAPSES, "context_types": list(CONTEXT_TYPES), "rois": list(ROIS)}
    np.savez_compressed(os.path.join(DATA, "cx_synapses.npz"), meta=json.dumps(meta), **syn)
    with open(os.path.join(DATA, "context_neurons.json"), "w") as f:
        json.dump({"meta": meta, "neurons": ctx}, f, indent=1)
    print(f"wrote data/cx_synapses.npz, data/context_neurons.json and data/rois/")


if __name__ == "__main__":
    main()
