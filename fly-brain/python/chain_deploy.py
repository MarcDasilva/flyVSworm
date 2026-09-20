"""What is deployed on Thru, and what it was built from: data/chain_deploy.json.

The data files carry content hashes so a claim about them can be checked rather than trusted; this
does the same for the chain. It pins the program binary's sha256 and the artifacts it was built and
fed from (ABI, manifest, weight table), next to the on-chain addresses, so "the program at this
address is this source" is a check, not a promise.

    python chain_deploy.py --write --program ta... --meta ta... --brain ta... --authority ta...
    python chain_deploy.py --verify     (re-hash the local files and compare with the record)
    python chain_deploy.py --on-chain   (fetch the deployed program and brain, compare, show progress)
"""
import argparse
import base64
import hashlib
import json
import os
import shutil
import struct
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
RECORD = os.path.join(DATA, "chain_deploy.json")
BINARY = os.path.join(ROOT, "chain", "build", "thruvm", "bin", "tn_fly_brain_c.bin")
SOURCES = {
    "chain/fly_brain.abi.yaml": os.path.join(ROOT, "chain", "fly_brain.abi.yaml"),
    "chain/examples/tn_fly_brain.c": os.path.join(ROOT, "chain", "examples", "tn_fly_brain.c"),
    "chain/examples/tn_fly_brain.h": os.path.join(ROOT, "chain", "examples", "tn_fly_brain.h"),
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def content_hashes():
    """The hashes of what the program is fed: the brain map and the integer weight table."""
    out = {}
    for name in ("chain_manifest", "chain_weights"):
        path = os.path.join(DATA, f"{name}.json")
        if os.path.exists(path):
            with open(path) as f:
                out[f"data/{name}.npz"] = json.load(f)["content_sha256"]
    return out


def build_record(**on_chain):
    if not os.path.exists(BINARY):
        raise FileNotFoundError(f"{BINARY}: build the program first (see chain/GNUmakefile)")
    return {
        "program_binary": {"file": os.path.relpath(BINARY, ROOT).replace("\\", "/"),
                           "sha256": sha256_file(BINARY), "bytes": os.path.getsize(BINARY)},
        "sources": {name: sha256_file(path) for name, path in SOURCES.items()},
        "inputs": content_hashes(),
        **on_chain,
    }


def verify():
    """Re-hash the local files and compare with the record. Returns a list of problems."""
    with open(RECORD) as f:
        rec = json.load(f)
    bad = []
    if os.path.exists(BINARY):
        got = sha256_file(BINARY)
        if got != rec["program_binary"]["sha256"]:
            bad.append(f"the built binary is {got[:12]}, the record says {rec['program_binary']['sha256'][:12]}")
    else:
        bad.append(f"{BINARY} is missing: nothing to compare the record against")
    for name, path in SOURCES.items():
        got = sha256_file(path)
        if got != rec["sources"].get(name):
            bad.append(f"{name} changed since the record was written")
    for name, h in content_hashes().items():
        if rec["inputs"].get(name) != h:
            bad.append(f"{name} is {h[:12]}, the record says {str(rec['inputs'].get(name))[:12]}")
    return bad


def thru_cmd():
    """The thru CLI as an argv prefix (on Windows it is a .cmd shim, which needs cmd /c)."""
    exe = shutil.which("thru")
    if not exe:
        raise FileNotFoundError("the thru CLI is not installed")
    return ["cmd", "/c", exe] if exe.lower().endswith(".cmd") else [exe]


def account_data(pubkey, rpc=None):
    """The account's data bytes, read over RPC."""
    cmd = thru_cmd() + ["getaccountinfo", pubkey, "--json", "--quiet"]
    if rpc:
        cmd += ["--url", rpc]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return base64.b64decode(json.loads(out.stdout)["account_info"]["data"])


def on_chain(record=None):
    """Compare the chain with the record: the deployed bytecode, and the brain's manifest and counts.
    Returns (problems, progress) — progress is what a resumed submission starts from."""
    if record is None:
        with open(RECORD) as f:
            record = json.load(f)
    rpc = record.get("rpc")
    bad, progress = [], {}
    deployed = account_data(record["program"], rpc)
    got = hashlib.sha256(deployed).hexdigest()
    if got != record["program_binary"]["sha256"]:
        bad.append(f"the deployed program is {got[:12]} ({len(deployed)} bytes), "
                   f"the record says {record['program_binary']['sha256'][:12]}")
    if record.get("brain"):
        d = account_data(record["brain"], rpc)
        version, kind, _, neurons, synapses, neuron_total, synapse_total = struct.unpack_from("<BB2sIIII", d)
        manifest = d[20:52].hex()
        if (version, kind) != (1, 0):
            bad.append(f"the brain account is version {version} kind {kind}, expected 1 and 0")
        if manifest != record["inputs"].get("data/chain_manifest.npz"):
            bad.append(f"the brain is writing manifest {manifest[:12]}, the record has "
                       f"{str(record['inputs'].get('data/chain_manifest.npz'))[:12]}")
        progress = {"neurons": f"{neurons}/{neuron_total}", "synapses": f"{synapses}/{synapse_total}",
                    "next_neuron_row": neurons, "next_synapse_row": synapses}
    return bad, progress


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="write data/chain_deploy.json")
    ap.add_argument("--verify", action="store_true", help="check the record against the local files")
    ap.add_argument("--on-chain", action="store_true", help="check the deployed program and brain over RPC")
    for field in ("network", "rpc", "program", "meta", "brain", "authority", "toolchain", "cli", "deployed"):
        ap.add_argument(f"--{field}", default=None)
    args = ap.parse_args()
    if args.on_chain:
        problems, progress = on_chain()
        print("\n".join(problems) if problems else "the deployed program and brain match data/chain_deploy.json")
        if progress:
            print(f"submission progress: {progress['neurons']} neurons, {progress['synapses']} synapses "
                  f"(resume at neuron row {progress['next_neuron_row']}, synapse row {progress['next_synapse_row']})")
        raise SystemExit(1 if problems else 0)
    if args.verify:
        problems = verify()
        print("\n".join(problems) if problems else
              f"data/chain_deploy.json matches the local files (binary {sha256_file(BINARY)[:12]})")
        raise SystemExit(1 if problems else 0)
    fields = {k: v for k, v in vars(args).items() if k not in ("write", "verify", "on_chain") and v is not None}
    record = build_record(**fields)
    if args.write:
        with open(RECORD, "w") as f:
            json.dump(record, f, indent=2)
    print(json.dumps(record, indent=1))
