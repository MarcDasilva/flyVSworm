"""Pull the heading-circuit core from hemibrain v1.2.1 into data/cx_csr.npz.

Run this YOURSELF, in your own terminal. It needs your neuPrint token, which it
never prints or saves. It takes the token from the NEUPRINT_APPLICATION_CREDENTIALS
environment variable, or else from a .env file at the repo root (or in fly-brain/)
with a line like  NEUPRINT_APPLICATION_CREDENTIALS=<token>  (NEUPRINT_TOKEN= also works).
From the fly-brain folder:

    .venv/Scripts/python python/extract_hemibrain.py          (Windows: .venv\Scripts\python python\extract_hemibrain.py)

Read-only queries against neuprint.janelia.org:
  1. every neuron whose type matches TYPE_PATTERN (EPG, EPGt, PEN_a(PEN1),
     PEN_b(PEN2), Delta7 and close variants; the loader picks which to use)
  2. all synaptic connections among those neurons, per ROI
  3. the EB synapse locations of the EPG/PEN neurons, to place each on the ring
Writes data/cx_csr.npz and a human-readable summary, data/cx_meta.json.
"""
import datetime
import json
import os
import sys

import numpy as np

from connectome import content_hash

SERVER = "neuprint.janelia.org"
DATASET = "hemibrain:v1.2.1"
TYPE_PATTERN = r"EPG.*|PEN.*|Delta7.*"   # broad on purpose; the summary lists exactly what matched
RING_TYPES = r"^(EPG|PEN)"               # types whose EB synapses place them on the ring
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
TOKEN_VAR = "NEUPRINT_APPLICATION_CREDENTIALS"
TOKEN_KEYS = (TOKEN_VAR, "NEUPRINT_TOKEN")
DOTENV_PATHS = [os.path.normpath(os.path.join(HERE, "..", "..", ".env")),  # repo root
                os.path.normpath(os.path.join(HERE, "..", ".env"))]        # fly-brain/


def token_from_dotenv(path):
    """The neuPrint token from a .env file (KEY=value lines; optional 'export', quotes, comments), or None."""
    if not os.path.isfile(path):
        return None
    found = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip().removeprefix("export ").strip()
            value = value.split(" #", 1)[0]  # drop an inline comment (tokens contain no spaces)
            found[key] = value.strip().strip('"').strip("'")
    for key in TOKEN_KEYS:
        if found.get(key):
            return found[key]
    return None


def build_arrays(neurons, conn, syn):
    """Pure conversion of neuPrint query results to the arrays saved in cx_csr.npz.

    neurons: DataFrame with bodyId, type, instance, status, cropped, pre, post
    conn:    DataFrame with bodyId_pre, bodyId_post, roi, weight (per-ROI synapse counts)
    syn:     DataFrame with bodyId, type ('pre'/'post'), x, y, z (EB synapses only)
    """
    neurons = neurons.sort_values(["type", "instance", "bodyId"]).reset_index(drop=True)
    body = neurons["bodyId"].to_numpy(np.int64)
    index = {b: i for i, b in enumerate(body)}
    n = len(body)

    conn = conn[conn["bodyId_pre"].isin(index) & conn["bodyId_post"].isin(index)]
    pre = conn["bodyId_pre"].map(index).to_numpy(np.int64)
    post = conn["bodyId_post"].map(index).to_numpy(np.int64)
    total = np.zeros((n, n), dtype=np.int64)
    np.add.at(total, (pre, post), conn["weight"].to_numpy(np.int64))
    rows, cols = np.nonzero(total)
    indptr = np.searchsorted(rows, np.arange(n + 1))  # CSR over rows (presynaptic neuron)

    roi_names = sorted(conn["roi"].fillna("None").unique())
    roi_id = {r: i for i, r in enumerate(roi_names)}

    eb = {"pre": np.full((n, 3), np.nan), "post": np.full((n, 3), np.nan)}
    eb_count = {"pre": np.zeros(n, np.int64), "post": np.zeros(n, np.int64)}
    for (b, kind), g in syn.groupby(["bodyId", "type"]):
        if b in index and kind in eb:
            eb[kind][index[b]] = g[["x", "y", "z"]].mean().to_numpy()
            eb_count[kind][index[b]] = len(g)

    def text(col):  # fixed-width unicode, never object arrays (np.load must work with allow_pickle=False)
        return np.array(neurons[col].fillna("").astype(str).tolist(), dtype=str)

    return {
        "body_id": body,
        "type": text("type"),
        "instance": text("instance"),
        "status": text("status"),
        "cropped": neurons["cropped"].fillna(False).astype(bool).to_numpy(),
        # total synapse counts, CSR by presynaptic row: W_counts[pre, post]
        "indptr": indptr, "indices": cols.astype(np.int64), "data": total[rows, cols],
        # per-ROI breakdown of the same connections
        "roi_pre": pre, "roi_post": post, "roi_index": conn["roi"].fillna("None").map(roi_id).to_numpy(np.int64),
        "roi_weight": conn["weight"].to_numpy(np.int64), "roi_names": np.array(roi_names, dtype=str),
        # centroid of each neuron's EB input (post) and output (pre) synapses, NaN if none
        "eb_post_centroid": eb["post"], "eb_post_count": eb_count["post"],
        "eb_pre_centroid": eb["pre"], "eb_pre_count": eb_count["pre"],
    }


def summarize(arrays):
    types = arrays["type"]
    n = len(types)
    counts = {t: int((types == t).sum()) for t in sorted(set(types))}
    pathway = {}
    rows = np.repeat(np.arange(n), np.diff(arrays["indptr"]))
    for r, c, w in zip(rows, arrays["indices"], arrays["data"]):
        key = f"{types[r]} -> {types[c]}"
        pathway[key] = pathway.get(key, 0) + int(w)
    return {"neurons": n, "types": counts, "connections": int(len(arrays["data"])),
            "synapses": int(arrays["data"].sum()),
            "pathway_synapses": dict(sorted(pathway.items(), key=lambda kv: -kv[1]))}


def fetch():
    from neuprint import Client, NeuronCriteria as NC, SynapseCriteria as SC
    from neuprint import fetch_adjacencies, fetch_neurons, fetch_synapses
    if not os.environ.get(TOKEN_VAR):
        for path in DOTENV_PATHS:
            token = token_from_dotenv(path)
            if token:
                os.environ[TOKEN_VAR] = token  # this process only; never printed or written anywhere
                print(f"using the neuPrint token from {path}")
                break
    if not os.environ.get(TOKEN_VAR):
        sys.exit(f"No neuPrint token: set {TOKEN_VAR}, or put {TOKEN_VAR}=<token> in {DOTENV_PATHS[0]}")
    # Keep a reference and pass it explicitly: neuprint holds its default client only weakly,
    # so an unreferenced Client(...) is garbage-collected before the first query.
    client = Client(SERVER, DATASET)  # token read from the environment
    neurons, _ = fetch_neurons(NC(type=TYPE_PATTERN, regex=True), client=client)
    print(f"fetched {len(neurons)} neurons of types {sorted(neurons['type'].unique())}")
    ids = neurons["bodyId"].tolist()
    _, conn = fetch_adjacencies(NC(bodyId=ids), NC(bodyId=ids), client=client)
    print(f"fetched {len(conn)} per-ROI connection rows")
    ring_ids = neurons.loc[neurons["type"].str.match(RING_TYPES), "bodyId"].tolist()
    syn = fetch_synapses(NC(bodyId=ring_ids), SC(rois="EB", primary_only=True), client=client)
    print(f"fetched {len(syn)} EB synapses of {len(ring_ids)} EPG/PEN neurons")
    return neurons, conn, syn


def main():
    import neuprint
    neurons, conn, syn = fetch()
    arrays = build_arrays(neurons, conn, syn)
    meta = {"server": SERVER, "dataset": DATASET, "type_pattern": TYPE_PATTERN,
            "fetched_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "neuprint_python": neuprint.__version__,
            "content_sha256": content_hash(arrays),  # over the arrays only: same connectome, same hash
            **summarize(arrays)}
    os.makedirs(DATA, exist_ok=True)
    np.savez_compressed(os.path.join(DATA, "cx_csr.npz"), meta=json.dumps(meta), **arrays)
    with open(os.path.join(DATA, "cx_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps({k: meta[k] for k in ("neurons", "types", "connections", "synapses", "content_sha256")}, indent=2))
    print(f"wrote {os.path.join(DATA, 'cx_csr.npz')} and cx_meta.json")


if __name__ == "__main__":
    main()
