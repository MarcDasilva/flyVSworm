"""Derives the 302 neuron account addresses. Thru derives a program account
address from (program_id, seed); we shell out to the CLI rather than
reimplementing the derivation, because getting it subtly wrong would only
surface as BAD_ACCOUNT_ADDRESS (-16) at creation time."""
import json
import subprocess
from pathlib import Path

# docs/measurements.md lives at the REPO ROOT, not under wormed/ — three
# parents up from this file (wormed/pipeline/pack_addr.py -> wormed/pipeline
# -> wormed -> repo root).
DOCS = Path(__file__).resolve().parent.parent.parent / "docs"
CACHE = Path(__file__).resolve().parent.parent / "data" / "addresses.json"


def _program_id() -> str:
    for line in (DOCS / "measurements.md").read_text().splitlines():
        if line.startswith("PROGRAM_ADDRESS:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("PROGRAM_ADDRESS not in docs/measurements.md — run Task 1 Step 5")


def derive_addresses(names: list[str]) -> list[str]:
    if CACHE.exists():
        cached = json.loads(CACHE.read_text())
        if len(cached) == len(names):
            return cached
    pid = _program_id()
    out = []
    for name in names:
        seed = f"neuron-{name}"
        r = subprocess.run(
            ["thru", "program", "derive-address", "--json", pid, seed],
            capture_output=True, text=True, check=True,
        )
        addr = json.loads(r.stdout)["derive_address"]["derived_address"]
        out.append(addr)
    CACHE.parent.mkdir(exist_ok=True, parents=True)
    CACHE.write_text(json.dumps(out))
    return out
