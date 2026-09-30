# On-Chain C. elegans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the complete 302-neuron *C. elegans* nervous system on Thru, with each neuron as its own account and synaptic transmission as real balance transfers, driving a 3D worm through a classifier on the command interneurons.

**Architecture:** Three layers. L1 is a C program on ThruVM holding 302 neuron accounts and a packed connectome, stepping a graded-potential model in Q16.16 fixed point. L2 is a five-input winner-take-all classifier reading the command interneurons, writing a 32-byte `BehaviorState`. L3 is an off-chain three.js scene driving follow-the-leader worm kinematics from that state. Correctness comes from one simulation source file compiled twice — once for ThruVM, once natively — asserted bit-for-bit against a Python fixed-point reference, which is itself asserted against a NumPy float reference.

**Tech Stack:** C (ThruVM, RV64IMC_ZBA_ZBB, picolibc), Python 3.11 + NumPy + pytest, TypeScript + three.js + `@thru/sdk`, Thru CLI v0.2.27.

**Spec:** `SPEC.md` (repository root)

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **No floating point in C.** ThruVM is RV64I + M + C + B + Zknh. There is no F or D extension. All on-chain math is Q16.16 fixed point.
- **8-byte-align the start of every array in `Topology`.** ThruVM raises an exception on unaligned access, and a single memory access must not span a 4 KB page boundary. Both traps vanish under this one rule because 4096 is a multiple of 8.
- **Accumulators are `int64_t`.** AVA has 300+ incoming edges; Q16.16 products overflow `int32_t`.
- **Max transaction size is 32 KiB. Max 1,024 accounts per transaction.**
- **Max account data size is 16 MB** (`TSDK_ACCOUNT_DATA_SZ_MAX`).
- **Writable accounts are sorted ascending by address**, so account index ≠ neuron index. The permutation is precomputed offline into `Topology.acct_slot_to_neuron`.
- **Native balance is `uint64` and cannot go negative.** Voltage maps to balance as `balance = (V_mV + 100) * 1000`, clamped to `[1000, 200000]` before every transfer.
- **`dt = 5 ms`**, backward Euler, unconditionally stable.
- **Build flags:** `-Os -march=rv64imc_zba_zbb`. Compressed instructions cost 2 CU against 4 CU for 32-bit; this is the primary CU optimization.
- **Thru is not Solana.** No PDAs-as-signers, no SPL, no address lookup tables, no lamports. Account creation requires a slot-bound state proof.
- **Never commit `provenance.json` assumptions silently.** Synaptic sign is assigned from neurotransmitter identity, not measured. It goes in the README.

## File Structure

```
pipeline/                 Python. Offline data prep + reference simulators.
  connectome.py           Load Cook/c302 CSVs, remap names to dense indices,
                          assign sign and conductance, load positions.
  pack.py                 CSR construction, binary layout, alignment asserts,
                          address derivation and the account-slot permutation.
  refsim.py               Two reference simulators: float64 and Q16.16.
  test_pipeline.py        pytest suite for all of the above.

program/                  C. The on-chain program.
  worm.h                  Shared structs, layout offsets, instruction codes,
                          error codes. THE contract between pack.py and worm.c.
  fixed.h                 Q16.16 helpers and sigmoid LUT interpolation.
  sim.c                   The three-pass timestep. Compiled TWICE: once for
                          ThruVM, once natively. No SDK calls inside.
  worm.c                  Entrypoint, instruction dispatch, account plumbing,
                          transfer settlement, classifier, event emission.
  native_test.c           Native harness. Asserts bit-for-bit against a vector
                          dumped by refsim.py.
  GNUmakefile / Local.mk  Thru build integration.

web/src/                  TypeScript. The front-end.
  chain.ts                Thru client, event/transaction streams, decoders.
  body.ts                 Follow-the-leader kinematics. Pure, no rendering.
  brain.ts                302-node point cloud, edges, transfer particles.
  worm.ts                 Tube mesh, agar plane, fading trail.
  main.ts                 Scene, camera, touch buttons, wiring.
  test_body.ts            Node assert script for the kinematics invariants.

data/                     Committed build artifacts. Nothing fetches at demo time.
  topology.bin  names.json  positions.json  provenance.json  vectors/
```

`sim.c` compiled twice is the load-bearing trick: it makes "is the bug in my math or in the VM?" a question you answer with a diff instead of a night.

---

## Track 0 — Gate (blocking; nobody proceeds past hour 4 without this)

### Task 1: Toolchain, hello-world, and the four measurements

**Files:**
- Create: `program/GNUmakefile`, `program/Local.mk`, `program/hello.c`
- Create: `docs/measurements.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/measurements.md` containing `MAX_BLOCK_COMPUTE_UNITS`, `BLOCKS_PER_SEC`, `CU_PER_STEP_STUB`, `STATE_UNITS_PER_CREATE`. Task 11 reads the first to pick steps-per-transaction. Task 9 reads the fourth to pick the creation batch size.

- [ ] **Step 1: Install the toolchain**

```bash
npm i -g thru
thru dev toolchain install
thru dev sdk install c
thru keys generate worm
thru account create worm
thru faucet withdraw worm 100000
thru --json getversion
```

Expected: `getversion` prints a `thru-node` version, confirming you can reach `https://rpc.alphanet.thru.org`. If this fails, the toolchain is the problem — talk to the organizers, do not push on.

- [ ] **Step 2: Pin the versions**

```bash
thru --json getversion > docs/versions.json
echo "thru cli: $(thru --version)" >> docs/versions.json
ls ~/.thru/sdk/toolchain/ >> docs/versions.json
git add docs/versions.json && git commit -m "chore: pin thru toolchain versions"
```

Thru's own docs say the install flow "will change frequently until v1.0.0". Pin the moment something works.

- [ ] **Step 3: Confirm the SDK accessor names on disk**

The exact spelling of the balance accessor is not in the prose docs. Read it from the installed headers:

```bash
grep -rn "balance" ~/.thru/sdk/c/thru-sdk/thru-sdk/c/tn_sdk_txn.h
grep -rn "account_meta\|tsdk_get_account" ~/.thru/sdk/c/thru-sdk/thru-sdk/c/tn_sdk.h
grep -rn "tsys_account_transfer\|tsys_emit_event" ~/.thru/sdk/c/thru-sdk/thru-sdk/c/tn_sdk_syscall.h
```

Write the confirmed signatures into `docs/measurements.md` under `## SDK accessors`. Every later task that touches balance uses these exact names.

- [ ] **Step 4: Write the hello-world program**

`program/hello.c`:

```c
#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>

TSDK_ENTRYPOINT_FN void start(void) {
    unsigned long long marker = 0xC0FFEEULL;
    tsys_emit_event((unsigned char const *)&marker, sizeof(marker));
    tsdk_return(TSDK_SUCCESS);
}
```

`program/GNUmakefile`:

```makefile
BASEDIR:=$(CURDIR)/build
THRU_C_SDK_DIR:=$(HOME)/.thru/sdk/c/thru-sdk
include $(THRU_C_SDK_DIR)/thru_c_program.mk
```

`program/Local.mk`:

```makefile
$(call make-bin,hello,hello,,-ltn_sdk)
```

- [ ] **Step 5: Build and deploy**

```bash
cd program && make
thru program create hello-worm-v1 build/thruvm/bin/hello.bin
```

Expected: prints a program account address and a meta account address. Record the program address in `docs/measurements.md` — Task 5 needs it for address derivation.

- [ ] **Step 6: Execute it and read the CU counter**

```bash
thru txn execute --fee 1000 <program_address> ""
```

Expected: `Execution result code: 0`, an emitted event with data `eecfc00000000000`, and a printed `Compute Units Consumed`. That CU counter is the measurement instrument for the whole project.

- [ ] **Step 7: Take the four measurements**

```bash
# 1. Block compute ceiling — the number that sets steps-per-transaction.
thru --json getheight
# Then read max_compute_units from a recent block via the Explorer MCP server
# (https://scan.thru.org/api/mcp, tool `get_block`) or StreamBlocks.

# 2. Blocks per second.
thru --json getheight; sleep 10; thru --json getheight   # divide the delta by 10

# 3. CU for a stub step — deferred to Task 11, recorded here when known.

# 4. State units for a 32-byte account create — deferred to Task 9.
```

Write all four into `docs/measurements.md` with the date and the block slot they were read at. Mark 3 and 4 as `PENDING` for now; the tasks that produce them fill them in.

- [ ] **Step 8: Commit**

```bash
git add program/ docs/
git commit -m "chore: thru toolchain gate, hello-world deployed, baseline measurements"
```

---

## Track A — Data pipeline (Python)

### Task 2: Load and remap the connectome

**Files:**
- Create: `pipeline/connectome.py`
- Test: `pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `docs/measurements.md` (program address, for Task 5).
- Produces: `load_connectome() -> Connectome` where `Connectome` is a dataclass with fields `names: list[str]` (302 entries, dense index order), `chem: list[tuple[int,int,int]]` (pre, post, weight), `gap: list[tuple[int,int,int]]` (a, b, weight). Tasks 3, 4 and 5 all consume this.

- [ ] **Step 1: Write the failing test**

`pipeline/test_pipeline.py`:

```python
from pipeline.connectome import load_connectome

def test_connectome_has_302_neurons_and_expected_edge_counts():
    """The hermaphrodite connectome is a fixed, published quantity. If these
    numbers drift, the source data changed under us and every downstream
    conductance is suspect."""
    c = load_connectome()
    assert len(c.names) == 302
    assert len(set(c.names)) == 302, "duplicate neuron names"
    assert 6000 <= len(c.chem) <= 8000, f"chemical edges out of range: {len(c.chem)}"
    assert 1100 <= len(c.gap) <= 1700, f"gap junctions out of range: {len(c.gap)}"

def test_left_right_pairs_stay_distinct():
    """AVAL and AVAR are different cells. Merging them silently halves the
    command layer and the classifier reads garbage."""
    c = load_connectome()
    assert "AVAL" in c.names and "AVAR" in c.names
    assert c.names.index("AVAL") != c.names.index("AVAR")

def test_edge_indices_are_in_range():
    c = load_connectome()
    n = len(c.names)
    for pre, post, w in c.chem:
        assert 0 <= pre < n and 0 <= post < n and w > 0
    for a, b, w in c.gap:
        assert 0 <= a < n and 0 <= b < n and w > 0
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/marc/conductor/workspaces/htn-2026/salem && python -m pytest pipeline/test_pipeline.py -v
```

Expected: `ModuleNotFoundError: No module named 'pipeline.connectome'`.

- [ ] **Step 3: Fetch the source data once, commit it**

```bash
mkdir -p data/raw
curl -L -o data/raw/c302_connectome.csv \
  https://raw.githubusercontent.com/openworm/c302/master/c302/data/CElegansNeuronTables.xls.csv
```

If that URL 404s (the c302 layout moves), fall back to WormWiring's Cook et al. 2019 export and record the actual URL in `data/raw/SOURCE.txt`. Commit the CSV. Nothing fetches at demo time.

- [ ] **Step 4: Implement the loader**

`pipeline/connectome.py`:

```python
"""Loads the C. elegans hermaphrodite connectome and remaps names to dense
indices. The dense index order is FROZEN once topology.bin ships — every
account address derives from it, so reordering invalidates the whole chain."""
import csv
from dataclasses import dataclass, field
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "c302_connectome.csv"

@dataclass
class Connectome:
    names: list[str] = field(default_factory=list)
    chem: list[tuple[int, int, int]] = field(default_factory=list)
    gap: list[tuple[int, int, int]] = field(default_factory=list)

def load_connectome(path: Path = RAW) -> Connectome:
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            pre, post = r["Neuron 1"].strip(), r["Neuron 2"].strip()
            kind, weight = r["Type"].strip(), int(float(r["Nbr"]))
            if pre and post and weight > 0:
                rows.append((pre, post, kind, weight))

    names = sorted({n for pre, post, _, _ in rows for n in (pre, post)})
    idx = {n: i for i, n in enumerate(names)}

    c = Connectome(names=names)
    for pre, post, kind, w in rows:
        # c302 marks gap junctions with an 'EJ' (electrical junction) type;
        # everything else is chemical ('S', 'Sp', 'R', 'Rp').
        if kind.upper().startswith("EJ"):
            c.gap.append((idx[pre], idx[post], w))
        else:
            c.chem.append((idx[pre], idx[post], w))
    return c
```

- [ ] **Step 5: Run the tests**

```bash
python -m pytest pipeline/test_pipeline.py -v
```

Expected: three passes. If `len(names) != 302`, print `sorted(names)` and diff against the WormAtlas cell list — the usual causes are included pharyngeal cells (drop them, they are out of scope per the spec) or included muscle rows.

- [ ] **Step 6: Commit**

```bash
git add pipeline/ data/raw/
git commit -m "feat(pipeline): load and densely index the c elegans connectome"
```

---

### Task 3: Assign synaptic sign and conductance

**Files:**
- Modify: `pipeline/connectome.py`
- Create: `data/neurotransmitters.csv`
- Test: `pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `load_connectome()` from Task 2.
- Produces: `assign_physiology(c: Connectome) -> Physiology` with fields `chem_E_mV: list[int]` (one per chemical edge, 0 for excitatory, −70 for inhibitory), `chem_g: list[float]`, `gap_g: list[float]`, `params: list[NeuronParam]` (302 entries, fields `g_leak, E_leak_mV, C, V_half_mV, k_mV`), and `provenance: dict`.

- [ ] **Step 1: Write the failing test**

```python
from pipeline.connectome import load_connectome, assign_physiology

def test_gaba_neurons_get_inhibitory_reversal_potential():
    """Sign is not in the connectome. If GABAergic cells come out excitatory,
    the reflex circuit has no brake and every drive saturates."""
    c = load_connectome()
    p = assign_physiology(c)
    gaba_idx = {c.names.index(n) for n in ("DD1", "VD1") if n in c.names}
    assert gaba_idx, "expected DD1/VD1 in the connectome"
    for e, (pre, post, w) in enumerate(c.chem):
        if pre in gaba_idx:
            assert p.chem_E_mV[e] == -70, f"GABAergic edge {e} came out excitatory"

def test_every_edge_has_physiology_and_unknowns_are_recorded():
    c = load_connectome()
    p = assign_physiology(c)
    assert len(p.chem_E_mV) == len(c.chem)
    assert len(p.chem_g) == len(c.chem)
    assert len(p.gap_g) == len(c.gap)
    assert len(p.params) == 302
    assert "unknown_transmitter" in p.provenance

def test_conductance_scales_with_contact_count():
    """Edge weight is the number of synaptic contacts. A 10-contact synapse
    must not have the same conductance as a 1-contact synapse."""
    c = load_connectome()
    p = assign_physiology(c)
    weights = [w for _, _, w in c.chem]
    lo = min(range(len(weights)), key=lambda i: weights[i])
    hi = max(range(len(weights)), key=lambda i: weights[i])
    assert p.chem_g[hi] > p.chem_g[lo]
```

- [ ] **Step 2: Run it, watch it fail**

```bash
python -m pytest pipeline/test_pipeline.py -v
```

Expected: `ImportError: cannot import name 'assign_physiology'`.

- [ ] **Step 3: Write the transmitter table**

`data/neurotransmitters.csv` — only the GABAergic cells need listing; everything else defaults excitatory. The 26 GABAergic neurons in the hermaphrodite are published:

```csv
neuron,transmitter
DD1,GABA
DD2,GABA
DD3,GABA
DD4,GABA
DD5,GABA
DD6,GABA
VD1,GABA
VD2,GABA
VD3,GABA
VD4,GABA
VD5,GABA
VD6,GABA
VD7,GABA
VD8,GABA
VD9,GABA
VD10,GABA
VD11,GABA
VD12,GABA
VD13,GABA
AVL,GABA
DVB,GABA
RIS,GABA
RMEL,GABA
RMER,GABA
RMED,GABA
RMEV,GABA
```

- [ ] **Step 4: Implement**

Append to `pipeline/connectome.py`:

```python
GABA_E_MV = -70
EXCITATORY_E_MV = 0
NT_TABLE = Path(__file__).resolve().parent.parent / "data" / "neurotransmitters.csv"

@dataclass
class NeuronParam:
    g_leak: float = 1.0      # Q8.8 on the wire
    E_leak_mV: int = -70
    C: float = 1.0           # Q8.8 on the wire
    V_half_mV: int = -35     # sigmoid midpoint
    k_mV: int = 10           # sigmoid slope

@dataclass
class Physiology:
    chem_E_mV: list[int] = field(default_factory=list)
    chem_g: list[float] = field(default_factory=list)
    gap_g: list[float] = field(default_factory=list)
    params: list[NeuronParam] = field(default_factory=list)
    provenance: dict = field(default_factory=dict)

def assign_physiology(c: Connectome) -> Physiology:
    gaba = set()
    with open(NT_TABLE, newline="") as f:
        for r in csv.DictReader(f):
            if r["transmitter"].strip().upper() == "GABA":
                gaba.add(r["neuron"].strip())

    known = {n for n in gaba if n in c.names}
    unknown = sorted(set(c.names) - known)

    p = Physiology()
    p.provenance = {
        "sign_source": "neurotransmitter identity; GABA -> inhibitory, else excitatory",
        "gaba_neurons_matched": sorted(known),
        "gaba_neurons_missing_from_connectome": sorted(gaba - known),
        "unknown_transmitter": unknown,
        "caveat": "Synaptic sign is ASSIGNED, not measured. State this in the README.",
    }

    # Conductance proxy: contact count, square-rooted to compress the long tail,
    # then scaled so a median synapse sits near 0.1 (dimensionless, vs g_leak=1.0).
    import math
    for pre, post, w in c.chem:
        p.chem_E_mV.append(GABA_E_MV if c.names[pre] in gaba else EXCITATORY_E_MV)
        p.chem_g.append(0.1 * math.sqrt(w))
    for a, b, w in c.gap:
        p.gap_g.append(0.05 * math.sqrt(w))

    p.params = [NeuronParam() for _ in c.names]
    return p
```

- [ ] **Step 5: Run the tests**

```bash
python -m pytest pipeline/test_pipeline.py -v
```

Expected: six passes.

- [ ] **Step 6: Commit**

```bash
git add pipeline/ data/neurotransmitters.csv
git commit -m "feat(pipeline): assign synaptic sign from transmitter identity and conductance from contact count"
```

---

### Task 4: Anatomical positions

**Files:**
- Modify: `pipeline/connectome.py`
- Test: `pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `Connectome` from Task 2.
- Produces: `neuron_positions(c: Connectome) -> list[tuple[float,float,float]]`, 302 entries in dense index order, each normalized so x ∈ [0,1] runs nose→tail and y,z ∈ [−1,1] are the radial offsets. Task 5 writes these to `positions.json`; `web/src/brain.ts` consumes them.

- [ ] **Step 1: Write the failing test**

```python
from pipeline.connectome import load_connectome, neuron_positions

def test_positions_are_worm_shaped_not_a_hairball():
    """A force-directed layout tells the viewer nothing. The point cloud must
    be anatomically ordered: head cells anterior, tail cells posterior."""
    c = load_connectome()
    pos = neuron_positions(c)
    assert len(pos) == 302
    x = {n: pos[i][0] for i, n in enumerate(c.names)}
    # ALM is an anterior touch cell; PLM is a posterior one. This ordering is
    # the whole point of using real coordinates.
    assert x["ALML"] < x["PLML"], "anterior/posterior axis is inverted or flat"
    assert all(0.0 <= p[0] <= 1.0 for p in pos)
    assert all(-1.0 <= p[1] <= 1.0 and -1.0 <= p[2] <= 1.0 for p in pos)

def test_positions_are_spread_not_degenerate():
    c = load_connectome()
    pos = neuron_positions(c)
    xs = sorted(p[0] for p in pos)
    assert xs[-1] - xs[0] > 0.5, "all neurons collapsed onto one point"
    assert len({round(p[0], 3) for p in pos}) > 50, "too many neurons share an x"
```

- [ ] **Step 2: Run it, watch it fail**

Expected: `ImportError: cannot import name 'neuron_positions'`.

- [ ] **Step 3: Implement with the documented fallback**

The spec allows a fallback if OpenWorm's coordinate file fights back. Implement the fallback directly — it is deterministic, needs no network, and produces the same qualitative layout.

```python
# Anterior-posterior anchor per ganglion, 0.0 = nose, 1.0 = tail tip.
# Source: WormAtlas ganglion organization.
GANGLION_X = {
    "anterior": 0.06, "dorsal": 0.10, "lateral": 0.13, "ventral": 0.17,
    "retrovesicular": 0.28, "ventral_cord": 0.55, "preanal": 0.82,
    "dorsorectal": 0.88, "lumbar": 0.93,
}

# Name-prefix -> ganglion. Longest prefix wins, so ordering matters.
PREFIX_GANGLION = [
    ("IL", "anterior"), ("OL", "anterior"), ("CEP", "anterior"), ("URA", "anterior"),
    ("URB", "anterior"), ("URX", "anterior"), ("URY", "anterior"), ("BAG", "anterior"),
    ("RME", "dorsal"), ("RMD", "dorsal"), ("RID", "dorsal"), ("ALA", "dorsal"),
    ("AVA", "lateral"), ("AVB", "lateral"), ("AVD", "lateral"), ("AVE", "lateral"),
    ("AVH", "lateral"), ("AVJ", "lateral"), ("AIA", "lateral"), ("AIB", "lateral"),
    ("AIY", "lateral"), ("AIZ", "lateral"), ("RIA", "lateral"), ("RIB", "lateral"),
    ("RIM", "lateral"), ("RIV", "lateral"), ("SMD", "lateral"), ("AWA", "lateral"),
    ("AWB", "lateral"), ("AWC", "lateral"), ("ASE", "lateral"), ("ASH", "lateral"),
    ("ADL", "lateral"), ("AFD", "lateral"), ("ALM", "lateral"), ("AVM", "ventral"),
    ("RIH", "ventral"), ("RIF", "ventral"), ("RIG", "ventral"), ("AVK", "ventral"),
    ("AVF", "retrovesicular"), ("AVG", "retrovesicular"), ("RIS", "retrovesicular"),
    ("DA", "ventral_cord"), ("DB", "ventral_cord"), ("DD", "ventral_cord"),
    ("VA", "ventral_cord"), ("VB", "ventral_cord"), ("VC", "ventral_cord"),
    ("VD", "ventral_cord"), ("AS", "ventral_cord"),
    ("PVC", "lumbar"), ("PVD", "lumbar"), ("PVW", "lumbar"), ("PVN", "lumbar"),
    ("PLM", "lumbar"), ("PHA", "lumbar"), ("PHB", "lumbar"), ("PQR", "lumbar"),
    ("PVP", "preanal"), ("PVT", "preanal"), ("DVA", "dorsorectal"),
    ("DVB", "dorsorectal"), ("DVC", "dorsorectal"), ("PDA", "preanal"),
    ("PDB", "preanal"), ("PVM", "ventral_cord"),
]

def _ganglion_of(name: str) -> str:
    for prefix, g in sorted(PREFIX_GANGLION, key=lambda kv: -len(kv[0])):
        if name.startswith(prefix):
            return g
    return "lateral"

def neuron_positions(c: Connectome) -> list[tuple[float, float, float]]:
    """Worm-shaped point cloud: nerve ring cluster at the head, ventral cord
    running the body, tail ganglion at the back. Deterministic — the same
    connectome always yields the same layout, so replays line up."""
    import hashlib, math
    out = []
    # Ventral-cord cells are numbered (DA1..DA9); the number IS the position.
    cord_rank: dict[str, int] = {}
    cord_names = sorted(n for n in c.names if _ganglion_of(n) == "ventral_cord")
    for i, n in enumerate(cord_names):
        cord_rank[n] = i
    n_cord = max(len(cord_names) - 1, 1)

    for name in c.names:
        g = _ganglion_of(name)
        if g == "ventral_cord":
            x = 0.30 + 0.45 * (cord_rank[name] / n_cord)
        else:
            x = GANGLION_X[g]
        # Deterministic radial scatter keyed on the name, so left/right pairs
        # separate without a random seed.
        h = int(hashlib.sha256(name.encode()).hexdigest()[:8], 16)
        angle = (h % 3600) / 3600.0 * 2 * math.pi
        radius = 0.35 + 0.55 * ((h >> 12) % 1000) / 1000.0
        side = -1.0 if name.endswith("L") else (1.0 if name.endswith("R") else 0.0)
        y = radius * math.cos(angle) + 0.25 * side
        z = radius * math.sin(angle)
        # Ventral cord sits ventrally, not scattered around the axis.
        if g == "ventral_cord":
            y, z = -0.75 + 0.1 * math.cos(angle), 0.15 * math.sin(angle)
        out.append((x, max(-1.0, min(1.0, y)), max(-1.0, min(1.0, z))))
    return out
```

- [ ] **Step 4: Run the tests**

```bash
python -m pytest pipeline/test_pipeline.py -v
```

Expected: eight passes.

- [ ] **Step 5: Commit**

```bash
git add pipeline/
git commit -m "feat(pipeline): deterministic worm-shaped neuron positions from ganglion anatomy"
```

---

### Task 5: Pack `topology.bin` with alignment asserts

**Files:**
- Create: `pipeline/pack.py`
- Create: `program/worm.h`
- Test: `pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `load_connectome`, `assign_physiology`, `neuron_positions`.
- Produces: `data/topology.bin`, `data/names.json`, `data/positions.json`, `data/provenance.json`, and `pack.LAYOUT: dict[str, tuple[int, int]]` mapping array name → (byte offset, byte length). `program/worm.h` hardcodes the same offsets. **These two must agree or nothing works.**

- [ ] **Step 1: Freeze the binary layout in `program/worm.h`**

```c
#ifndef WORM_H
#define WORM_H
#include <stdint.h>

#define WORM_MAGIC        0x574F524Du  /* "WORM" */
#define WORM_VERSION      1u
#define N_NEURONS         302
#define N_CHEM            7000   /* upper bound; real count in the header */
#define N_GAP             2800   /* both directions stored */
#define LUT_ENTRIES       257

/* Instruction discriminants. Little-endian u32 at instruction_data[0..4). */
#define INSTR_UPLOAD_CHUNK    1u
#define INSTR_CREATE_NEURONS  2u
#define INSTR_STIMULATE       3u
#define INSTR_STEP            4u
#define INSTR_CLASSIFY        5u

/* Error codes. Returned via tsdk_revert(). */
#define ERR_BAD_INSTR_SIZE    0x1001u
#define ERR_BAD_INSTR_TYPE    0x1002u
#define ERR_BAD_MAGIC         0x1003u
#define ERR_RESIZE_FAILED     0x1004u
#define ERR_STALE_STEP_TAG    0x1005u
#define ERR_ACCOUNT_COUNT     0x1006u
#define ERR_TRANSFER_FAILED   0x1007u

/* Topology header. EVERY array below starts 8-byte aligned — ThruVM faults on
 * unaligned access AND on any access spanning a 4KB page boundary. 4096 is a
 * multiple of 8, so 8-alignment defeats both. pack.py asserts it. */
typedef struct {
    uint32_t magic;          /* 0x00 */
    uint32_t version;        /* 0x04 */
    uint32_t n_neurons;      /* 0x08 */
    uint32_t n_chem;         /* 0x0C */
    uint32_t n_gap;          /* 0x10 */
    uint32_t off_slot_map;   /* 0x14  u16[n_neurons]   */
    uint32_t off_chem_rowptr;/* 0x18  u32[n_neurons+1] */
    uint32_t off_chem_col;   /* 0x1C  u16[n_chem]      */
    uint32_t off_chem_g;     /* 0x20  i16[n_chem] Q8.8 */
    uint32_t off_chem_E;     /* 0x24  i16[n_chem] mV   */
    uint32_t off_gap_rowptr; /* 0x28  u32[n_neurons+1] */
    uint32_t off_gap_col;    /* 0x2C  u16[n_gap]       */
    uint32_t off_gap_g;      /* 0x30  i16[n_gap] Q8.8  */
    uint32_t off_params;     /* 0x34  worm_param_t[n]  */
    uint32_t off_lut;        /* 0x38  i32[257] Q16.16  */
    uint32_t total_sz;       /* 0x3C */
} worm_topology_hdr_t;       /* 64 bytes, naturally aligned, NOT packed */

typedef struct {
    int16_t g_leak;    /* Q8.8 */
    int16_t E_leak_mV;
    int16_t C;         /* Q8.8 */
    int16_t V_half_mV;
    int16_t k_recip;   /* Q8.8 reciprocal of slope — no division in the hot loop */
    int16_t _pad[3];
} worm_param_t;        /* 16 bytes */

/* Per-neuron account data. Voltage lives in the account BALANCE, not here. */
typedef struct {
    uint16_t index;
    char     name[8];
    uint16_t _pad0;
    int32_t  v_next;   /* Q16.16 mV */
    int32_t  i_stim;   /* Q16.16 */
    uint32_t step_tag;
    uint32_t _pad1;
} worm_neuron_t;       /* 32 bytes */

typedef struct {
    uint8_t  state;      /* 0=PAUSE 1=FORWARD 2=REVERSE 3=OMEGA */
    uint8_t  _pad[3];
    int32_t  gain;       /* Q16.16 */
    int32_t  drive_fwd;  /* Q16.16 */
    int32_t  drive_rev;  /* Q16.16 */
    uint32_t entered_at;
    uint32_t step;
    uint64_t block_time; /* Unix ns, from BLOCK_CTX */
} worm_behavior_t;       /* 32 bytes */

/* Voltage <-> native balance. uint64 balance cannot go negative; biological
 * voltage can. The +100mV offset is what makes hyperpolarizing transfers safe. */
#define BAL_OFFSET_MV   100
#define BAL_SCALE       1000
#define BAL_MIN         1000u
#define BAL_MAX         200000u
#endif
```

- [ ] **Step 2: Write the failing test**

```python
import json, struct
from pathlib import Path
from pipeline.pack import build_all, LAYOUT

DATA = Path(__file__).resolve().parent.parent / "data"

def test_every_array_offset_is_8_byte_aligned():
    """ThruVM raises an exception on unaligned access and on any access that
    spans a 4KB page boundary. 4096 is a multiple of 8, so 8-alignment kills
    both. This assert is the entire defense."""
    build_all()
    for name, (off, length) in LAYOUT.items():
        assert off % 8 == 0, f"{name} starts at {off}, not 8-byte aligned"

def test_header_offsets_match_the_layout_table():
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    magic, version, n_neurons, n_chem, n_gap = struct.unpack_from("<IIIII", blob, 0)
    assert magic == 0x574F524D
    assert version == 1
    assert n_neurons == 302
    off_slot_map, off_chem_rowptr, off_chem_col = struct.unpack_from("<III", blob, 0x14)
    assert off_slot_map == LAYOUT["slot_map"][0]
    assert off_chem_rowptr == LAYOUT["chem_rowptr"][0]
    assert off_chem_col == LAYOUT["chem_col"][0]

def test_csr_rowptr_is_monotonic_and_terminates_at_edge_count():
    """A non-monotonic rowptr makes the inner loop read out of bounds, which on
    ThruVM is an access violation and a reverted transaction, not a wrong number."""
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    n_chem = struct.unpack_from("<I", blob, 0x0C)[0]
    off = LAYOUT["chem_rowptr"][0]
    ptrs = struct.unpack_from("<303I", blob, off)
    assert ptrs[0] == 0
    assert all(ptrs[i] <= ptrs[i + 1] for i in range(302))
    assert ptrs[302] == n_chem

def test_gap_junctions_are_stored_symmetrically():
    """A gap junction is ohmic and bidirectional. Storing one direction gives
    a rectifying junction, which is a different piece of physics."""
    from pipeline.connectome import load_connectome
    build_all()
    blob = (DATA / "topology.bin").read_bytes()
    n_gap = struct.unpack_from("<I", blob, 0x10)[0]
    assert n_gap == 2 * len(load_connectome().gap)

def test_sidecar_json_files_are_complete():
    build_all()
    names = json.loads((DATA / "names.json").read_text())
    pos = json.loads((DATA / "positions.json").read_text())
    prov = json.loads((DATA / "provenance.json").read_text())
    assert len(names) == 302 and len(pos) == 302
    assert "caveat" in prov
```

- [ ] **Step 3: Run it, watch it fail**

Expected: `ModuleNotFoundError: No module named 'pipeline.pack'`.

- [ ] **Step 4: Implement the packer**

`pipeline/pack.py`:

```python
"""Packs the connectome into the binary layout program/worm.h expects.

The 8-byte alignment assert in _align() is load-bearing: ThruVM faults on
unaligned access and on any single access spanning a 4KB page boundary.
Aligning every array start to 8 makes both impossible, because element sizes
(2, 4, 8) all divide 8 and 4096 is a multiple of 8."""
import json, math, struct
from pathlib import Path
from .connectome import load_connectome, assign_physiology, neuron_positions

DATA = Path(__file__).resolve().parent.parent / "data"
HDR_SZ = 64
LUT_ENTRIES = 257
LAYOUT: dict[str, tuple[int, int]] = {}

def _sigmoid_lut() -> list[int]:
    """257 entries spanning x in [-8, 8], output Q16.16 in [0, 1]. The extra
    entry is the right edge, so interpolation never reads past the end."""
    out = []
    for i in range(LUT_ENTRIES):
        x = -8.0 + 16.0 * i / (LUT_ENTRIES - 1)
        out.append(int(round((1.0 / (1.0 + math.exp(-x))) * 65536)))
    return out

def _q88(v: float) -> int:
    return max(-32768, min(32767, int(round(v * 256))))

def build_all() -> Path:
    c = load_connectome()
    p = assign_physiology(c)
    pos = neuron_positions(c)
    n = len(c.names)

    # --- CSR by POSTSYNAPTIC neuron: row i holds every edge arriving at i. ---
    chem_by_post: list[list[int]] = [[] for _ in range(n)]
    for e, (pre, post, _w) in enumerate(c.chem):
        chem_by_post[post].append(e)

    chem_rowptr, chem_col, chem_g, chem_E = [0], [], [], []
    for i in range(n):
        for e in chem_by_post[i]:
            chem_col.append(c.chem[e][0])
            chem_g.append(_q88(p.chem_g[e]))
            chem_E.append(p.chem_E_mV[e])
        chem_rowptr.append(len(chem_col))

    # Gap junctions stored in BOTH directions so the inner loop is uniform.
    gap_by_node: list[list[tuple[int, int]]] = [[] for _ in range(n)]
    for e, (a, b, _w) in enumerate(c.gap):
        gap_by_node[b].append((a, e))
        gap_by_node[a].append((b, e))

    gap_rowptr, gap_col, gap_g = [0], [], []
    for i in range(n):
        for other, e in gap_by_node[i]:
            gap_col.append(other)
            gap_g.append(_q88(p.gap_g[e]))
        gap_rowptr.append(len(gap_col))

    # --- Account-slot permutation. Thru sorts writable accounts ascending by
    # address, so slot k in the transaction is NOT neuron k.
    #
    # The program derives this map at runtime by reading each account's own
    # index field (Task 10), so this array is a CROSS-CHECK, not the source of
    # truth: if the two ever disagree, address derivation drifted — almost
    # always a changed program id — and every transfer would target the wrong
    # neuron. Keeping it costs 604 bytes and catches a silent, total failure. ---
    from .pack_addr import derive_addresses
    addrs = derive_addresses(c.names)
    order = sorted(range(n), key=lambda i: addrs[i])
    slot_map = [0] * n
    for slot, neuron_idx in enumerate(order):
        slot_map[slot] = neuron_idx

    # --- Emit, 8-aligning every array start. ---
    body = bytearray()
    LAYOUT.clear()

    def _align():
        while (HDR_SZ + len(body)) % 8:
            body.append(0)

    def _put(name: str, fmt: str, values) -> int:
        _align()
        off = HDR_SZ + len(body)
        assert off % 8 == 0, f"{name} misaligned at {off}"
        body.extend(struct.pack(f"<{len(values)}{fmt}", *values))
        LAYOUT[name] = (off, len(values) * struct.calcsize(fmt))
        return off

    off_slot_map    = _put("slot_map",     "H", slot_map)
    off_chem_rowptr = _put("chem_rowptr",  "I", chem_rowptr)
    off_chem_col    = _put("chem_col",     "H", chem_col)
    off_chem_g      = _put("chem_g",       "h", chem_g)
    off_chem_E      = _put("chem_E",       "h", chem_E)
    off_gap_rowptr  = _put("gap_rowptr",   "I", gap_rowptr)
    off_gap_col     = _put("gap_col",      "H", gap_col)
    off_gap_g       = _put("gap_g",        "h", gap_g)

    _align()
    off_params = HDR_SZ + len(body)
    LAYOUT["params"] = (off_params, n * 16)
    for q in p.params:
        body.extend(struct.pack("<hhhhh6x",
                                _q88(q.g_leak), q.E_leak_mV, _q88(q.C),
                                q.V_half_mV, _q88(1.0 / q.k_mV)))

    off_lut = _put("lut", "i", _sigmoid_lut())
    total = HDR_SZ + len(body)

    hdr = struct.pack("<16I",
        0x574F524D, 1, n, len(chem_col), len(gap_col),
        off_slot_map, off_chem_rowptr, off_chem_col, off_chem_g, off_chem_E,
        off_gap_rowptr, off_gap_col, off_gap_g, off_params, off_lut, total)
    assert len(hdr) == HDR_SZ

    DATA.mkdir(exist_ok=True)
    out = DATA / "topology.bin"
    out.write_bytes(hdr + bytes(body))

    (DATA / "names.json").write_text(json.dumps(c.names))
    (DATA / "positions.json").write_text(json.dumps(pos))
    (DATA / "addresses.json").write_text(json.dumps(addrs))
    (DATA / "provenance.json").write_text(json.dumps(p.provenance, indent=2))
    return out

if __name__ == "__main__":
    path = build_all()
    print(f"{path} — {path.stat().st_size} bytes, {path.stat().st_size / 4096:.1f} pages")
```

`pipeline/pack_addr.py`:

```python
"""Derives the 302 neuron account addresses. Thru derives a program account
address from (program_id, 32-byte seed); we shell out to the CLI rather than
reimplementing the derivation, because getting it subtly wrong would only
surface as BAD_ACCOUNT_ADDRESS (-16) at creation time."""
import json, subprocess
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
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
        r = subprocess.run(["thru", "program", "derive-address", pid, seed],
                           capture_output=True, text=True, check=True)
        out.append(r.stdout.strip().split()[-1])
    CACHE.write_text(json.dumps(out))
    return out
```

- [ ] **Step 5: Run the tests**

```bash
python -m pytest pipeline/test_pipeline.py -v
python -m pipeline.pack
```

Expected: all tests pass; the packer prints roughly `data/topology.bin — 61000 bytes, 14.9 pages`. If the size exceeds 16 MB something is very wrong; if it exceeds ~100 KB, check that `n_chem` is not doubled.

- [ ] **Step 6: Commit**

```bash
git add pipeline/ program/worm.h data/topology.bin data/*.json
git commit -m "feat(pipeline): pack connectome to aligned binary layout with account-slot permutation"
```

---

### Task 6: NumPy float reference simulator

**Files:**
- Create: `pipeline/refsim.py`
- Test: `pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `data/topology.bin`.
- Produces: `FloatSim` class with `__init__(topology_path)`, `.V: np.ndarray` (302 float64, mV), `.stimulate(name, current_mV)`, `.step(n=1)`. Task 7 asserts against it.

- [ ] **Step 1: Write the failing test**

```python
import numpy as np
from pipeline.refsim import FloatSim

def test_resting_state_is_stable():
    """With no input, every neuron must sit at its leak reversal potential and
    STAY there. Drift here means the backward-Euler solve is wrong, and every
    later bit-for-bit assert would be comparing two wrong answers."""
    s = FloatSim()
    s.step(400)
    assert np.allclose(s.V, -70.0, atol=0.5), f"resting drift: {s.V.min()}..{s.V.max()}"

def test_stimulating_alm_depolarizes_ava_not_avb():
    """Anterior touch drives the reversal command neuron. If AVB moves more
    than AVA, either the sign assignment or the CSR direction is flipped."""
    s = FloatSim()
    base = s.V.copy()
    s.stimulate("ALML", 40.0)
    s.step(200)
    names = s.names
    d_ava = s.V[names.index("AVAL")] - base[names.index("AVAL")]
    d_avb = s.V[names.index("AVBL")] - base[names.index("AVBL")]
    assert d_ava > 1.0, f"AVA did not depolarize: {d_ava}"
    assert d_ava > d_avb, f"AVB ({d_avb}) beat AVA ({d_ava}) on anterior touch"

def test_backward_euler_is_stable_at_large_conductance():
    """The whole reason for backward Euler. Forward Euler oscillates and blows
    up here; this test is what stops someone 'simplifying' it back."""
    s = FloatSim()
    s.chem_g *= 50.0
    s.stimulate("ALML", 100.0)
    s.step(500)
    assert np.all(np.isfinite(s.V))
    assert s.V.max() < 200.0 and s.V.min() > -300.0, "solution diverged"
```

- [ ] **Step 2: Run it, watch it fail**

Expected: `ModuleNotFoundError: No module named 'pipeline.refsim'`.

- [ ] **Step 3: Implement**

```python
"""Reference simulators. FloatSim is the ground truth for the model; FixedSim
(Task 7) is the ground truth for the arithmetic. The C code is asserted against
FixedSim, and FixedSim against FloatSim. Three links, each independently
checkable — that chain is how you localize a bug on Sunday morning."""
import json, struct
import numpy as np
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DT_MS = 5.0

class FloatSim:
    def __init__(self, topology_path: Path = DATA / "topology.bin"):
        blob = topology_path.read_bytes()
        h = struct.unpack_from("<16I", blob, 0)
        (magic, _ver, self.n, self.n_chem, self.n_gap,
         _slot, o_crp, o_cc, o_cg, o_ce, o_grp, o_gc, o_gg, o_par, o_lut, _tot) = h
        assert magic == 0x574F524D

        u = lambda fmt, cnt, off: np.array(struct.unpack_from(f"<{cnt}{fmt}", blob, off))
        self.chem_rowptr = u("I", self.n + 1, o_crp)
        self.chem_col    = u("H", self.n_chem, o_cc)
        self.chem_g      = u("h", self.n_chem, o_cg).astype(np.float64) / 256.0
        self.chem_E      = u("h", self.n_chem, o_ce).astype(np.float64)
        self.gap_rowptr  = u("I", self.n + 1, o_grp)
        self.gap_col     = u("H", self.n_gap, o_gc)
        self.gap_g       = u("h", self.n_gap, o_gg).astype(np.float64) / 256.0

        par = u("h", self.n * 8, o_par).reshape(self.n, 8)
        self.g_leak  = par[:, 0].astype(np.float64) / 256.0
        self.E_leak  = par[:, 1].astype(np.float64)
        self.C       = par[:, 2].astype(np.float64) / 256.0
        self.V_half  = par[:, 3].astype(np.float64)
        self.k_recip = par[:, 4].astype(np.float64) / 256.0

        self.names = json.loads((DATA / "names.json").read_text())
        self.V = self.E_leak.copy()
        self.i_stim = np.zeros(self.n)

    def stimulate(self, name: str, current: float) -> None:
        self.i_stim[self.names.index(name)] = current

    def step(self, n: int = 1) -> None:
        for _ in range(n):
            s = 1.0 / (1.0 + np.exp(-(self.V - self.V_half) * self.k_recip))
            g_tot  = self.g_leak.copy()
            gE_tot = self.g_leak * self.E_leak + self.i_stim

            # Chemical: conductance gated by presynaptic activation.
            for i in range(self.n):
                for e in range(self.chem_rowptr[i], self.chem_rowptr[i + 1]):
                    g = self.chem_g[e] * s[self.chem_col[e]]
                    g_tot[i]  += g
                    gE_tot[i] += g * self.chem_E[e]
                # Gap: ohmic, so the "reversal potential" IS the partner's V.
                for e in range(self.gap_rowptr[i], self.gap_rowptr[i + 1]):
                    g = self.gap_g[e]
                    g_tot[i]  += g
                    gE_tot[i] += g * self.V[self.gap_col[e]]

            # Backward Euler. Unconditionally stable — this is why dt can be 5ms.
            self.V = (self.C * self.V + DT_MS * gE_tot) / (self.C + DT_MS * g_tot)
```

- [ ] **Step 4: Run the tests**

```bash
python -m pytest pipeline/test_pipeline.py -v -k "resting or alm or euler"
```

Expected: three passes. If `test_stimulating_alm_depolarizes_ava_not_avb` fails, the CSR is built by presynaptic instead of postsynaptic neuron — check Task 5 Step 4's `chem_by_post`.

- [ ] **Step 5: Commit**

```bash
git add pipeline/refsim.py pipeline/test_pipeline.py
git commit -m "feat(pipeline): numpy float64 reference simulator with stability and circuit tests"
```

---

### Task 7: Q16.16 reference simulator and the test-vector dump

**Files:**
- Modify: `pipeline/refsim.py`
- Test: `pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `FloatSim`.
- Produces: `FixedSim` with the same surface but `.V: list[int]` in Q16.16, and `dump_vectors(path)` writing `data/vectors/alm_400.bin` — a little-endian `int32[401][302]` of voltage at every step. `native_test.c` (Task 10) asserts against this file byte-for-byte.

- [ ] **Step 1: Write the failing test**

```python
import numpy as np
from pipeline.refsim import FloatSim, FixedSim, Q16

def test_fixed_tracks_float_within_a_tenth_of_a_millivolt():
    """If fixed-point drifts from float, the model and the arithmetic are BOTH
    suspect and you cannot tell which. 0.1 mV over 400 steps is the budget."""
    f, x = FloatSim(), FixedSim()
    f.stimulate("ALML", 40.0); x.stimulate("ALML", 40.0)
    f.step(400); x.step(400)
    fixed_mV = np.array(x.V, dtype=np.float64) / Q16
    assert np.max(np.abs(fixed_mV - f.V)) < 0.1

def test_fixed_sim_is_deterministic():
    """Two runs must be bit-identical, or the C comparison in Task 10 is
    meaningless."""
    a, b = FixedSim(), FixedSim()
    a.stimulate("PLML", 40.0); b.stimulate("PLML", 40.0)
    a.step(120); b.step(120)
    assert a.V == b.V

def test_accumulator_does_not_overflow_on_the_most_connected_neuron():
    """AVA has 300+ incoming edges. In Q16.16 the products overflow int32 and
    silently wrap. This is the bug the int64 accumulator exists to prevent."""
    x = FixedSim()
    for n in ("ALML", "ALMR", "AVM", "PLML", "PLMR"):
        x.stimulate(n, 80.0)
    x.step(200)
    ava = x.V[x.names.index("AVAL")] / Q16
    assert -200.0 < ava < 200.0, f"AVA wrapped: {ava} mV"

def test_vector_dump_shape_is_exactly_what_the_c_harness_expects():
    from pathlib import Path
    from pipeline.refsim import dump_vectors
    p = dump_vectors()
    assert p.stat().st_size == 401 * 302 * 4
```

- [ ] **Step 2: Run it, watch it fail**

Expected: `ImportError: cannot import name 'FixedSim'`.

- [ ] **Step 3: Implement**

Append to `pipeline/refsim.py`:

```python
Q16 = 65536
LUT_ENTRIES = 257
LUT_SPAN = 8 * Q16        # LUT covers x in [-8, +8]
LUT_STEP_SHIFT = 12       # (16 << 16) / 256 == 4096 == 1 << 12

def q16_mul(a: int, b: int) -> int:
    """Mirrors the C q16_mul exactly, including truncation toward negative
    infinity via arithmetic shift. Python's >> on negative ints already floors,
    which matches RISC-V sra. Do not 'fix' this to round."""
    return (a * b) >> 16

def sigmoid_q16(x: int, lut: list[int]) -> int:
    if x < -LUT_SPAN: x = -LUT_SPAN
    if x >  LUT_SPAN - 1: x = LUT_SPAN - 1
    t = x + LUT_SPAN
    idx = t >> LUT_STEP_SHIFT
    frac = t & ((1 << LUT_STEP_SHIFT) - 1)
    lo, hi = lut[idx], lut[idx + 1]
    return lo + (((hi - lo) * frac) >> LUT_STEP_SHIFT)

class FixedSim(FloatSim):
    def __init__(self, topology_path=DATA / "topology.bin"):
        super().__init__(topology_path)
        blob = topology_path.read_bytes()
        o_lut = struct.unpack_from("<I", blob, 0x38)[0]
        self.lut = list(struct.unpack_from(f"<{LUT_ENTRIES}i", blob, o_lut))
        self.V = [int(v) * Q16 for v in self.E_leak]
        self.i_stim = [0] * self.n
        # Read the raw Q8.8 integers rather than round-tripping through float —
        # a float round-trip would introduce exactly the rounding difference the
        # bit-for-bit assert exists to catch.
        self.q_chem_g = list(struct.unpack_from(
            f"<{self.n_chem}h", blob, struct.unpack_from("<I", blob, 0x20)[0]))
        self.q_chem_E = list(struct.unpack_from(
            f"<{self.n_chem}h", blob, struct.unpack_from("<I", blob, 0x24)[0]))
        self.q_gap_g = list(struct.unpack_from(
            f"<{self.n_gap}h", blob, struct.unpack_from("<I", blob, 0x30)[0]))
        par_off = struct.unpack_from("<I", blob, 0x34)[0]
        par = list(struct.unpack_from(f"<{self.n * 8}h", blob, par_off))
        self.q_g_leak  = [par[i * 8 + 0] for i in range(self.n)]
        self.q_E_leak  = [par[i * 8 + 1] for i in range(self.n)]
        self.q_C       = [par[i * 8 + 2] for i in range(self.n)]
        self.q_V_half  = [par[i * 8 + 3] for i in range(self.n)]
        self.q_k_recip = [par[i * 8 + 4] for i in range(self.n)]
        self.dt = int(DT_MS * Q16)

    def stimulate(self, name: str, current: float) -> None:
        self.i_stim[self.names.index(name)] = int(current * Q16)

    def step(self, n: int = 1) -> None:
        for _ in range(n):
            # Pass 1: activation is per PRESYNAPTIC neuron, so 302 evaluations,
            # not 7000. Roughly half the compute budget lives in this choice.
            s = [sigmoid_q16(q16_mul(self.V[j] - (self.q_V_half[j] * Q16),
                                     self.q_k_recip[j] << 8), self.lut)
                 for j in range(self.n)]
            v_next = [0] * self.n
            for i in range(self.n):
                g_leak = self.q_g_leak[i] << 8          # Q8.8 -> Q16.16
                acc_g = g_leak
                acc_gE = q16_mul(g_leak, self.q_E_leak[i] * Q16) + self.i_stim[i]
                # Pass 2: accumulate. int64 in C; Python ints are arbitrary
                # precision, which is exactly why the overflow test above exists.
                for e in range(self.chem_rowptr[i], self.chem_rowptr[i + 1]):
                    g = q16_mul(self.q_chem_g[e] << 8, s[self.chem_col[e]])
                    acc_g += g
                    acc_gE += q16_mul(g, self.q_chem_E[e] * Q16)
                for e in range(self.gap_rowptr[i], self.gap_rowptr[i + 1]):
                    g = self.q_gap_g[e] << 8
                    acc_g += g
                    acc_gE += q16_mul(g, self.V[self.gap_col[e]])
                # Pass 3: backward Euler. ONE divide per neuron, not per synapse.
                num = q16_mul(self.q_C[i] << 8, self.V[i]) + q16_mul(self.dt, acc_gE)
                den = (self.q_C[i] << 8) + q16_mul(self.dt, acc_g)
                v_next[i] = (num << 16) // den
            self.V = v_next

def dump_vectors(path: Path = DATA / "vectors" / "alm_400.bin") -> Path:
    """The golden vector native_test.c diffs against. 401 frames: the initial
    state plus 400 steps."""
    path.parent.mkdir(parents=True, exist_ok=True)
    x = FixedSim()
    x.stimulate("ALML", 40.0)
    buf = bytearray()
    buf.extend(struct.pack(f"<{x.n}i", *x.V))
    for _ in range(400):
        x.step(1)
        buf.extend(struct.pack(f"<{x.n}i", *x.V))
    path.write_bytes(bytes(buf))
    return path
```

- [ ] **Step 4: Run the tests**

```bash
python -m pytest pipeline/test_pipeline.py -v
python -c "from pipeline.refsim import dump_vectors; print(dump_vectors())"
```

Expected: all pass. `test_fixed_tracks_float_within_a_tenth_of_a_millivolt` failing by a large margin usually means a Q8.8→Q16.16 shift is missing somewhere (look for a `<< 8`).

- [ ] **Step 5: Commit**

```bash
git add pipeline/refsim.py pipeline/test_pipeline.py data/vectors/
git commit -m "feat(pipeline): Q16.16 reference simulator and golden test vectors"
```

---

## Track B — Chain program (C)

### Task 8: Fixed-point header and the timestep, native-only

**Files:**
- Create: `program/fixed.h`, `program/sim.c`, `program/native_test.c`
- Modify: `program/Local.mk`

**Interfaces:**
- Consumes: `program/worm.h` (Task 5), `data/vectors/alm_400.bin` (Task 7).
- Produces: `void worm_step(worm_sim_t *sim, uint32_t n)` and `worm_sim_bind(worm_sim_t*, void const *topology, int32_t *V, int32_t *i_stim)`. Task 11 calls `worm_step` from the on-chain program. **`sim.c` makes no SDK calls** — that is what lets it compile natively.

- [ ] **Step 1: Write the failing native test**

`program/native_test.c`:

```c
/* Diffs the native build of sim.c against the Python Q16.16 reference,
 * bit-for-bit. When the on-chain worm goes silent, this is the test that says
 * whether the bug is in the arithmetic or in the VM. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "worm.h"
#include "sim.h"

int main(void) {
    FILE *ft = fopen("../data/topology.bin", "rb");
    if (!ft) { fprintf(stderr, "run pipeline/pack.py first\n"); return 2; }
    fseek(ft, 0, SEEK_END); long tsz = ftell(ft); fseek(ft, 0, SEEK_SET);
    void *topo = malloc(tsz);
    if (fread(topo, 1, tsz, ft) != (size_t)tsz) return 2;
    fclose(ft);

    FILE *fv = fopen("../data/vectors/alm_400.bin", "rb");
    if (!fv) { fprintf(stderr, "run refsim.dump_vectors() first\n"); return 2; }
    static int32_t golden[401][N_NEURONS];
    if (fread(golden, sizeof(golden), 1, fv) != 1) return 2;
    fclose(fv);

    static int32_t V[N_NEURONS], i_stim[N_NEURONS];
    worm_sim_t sim;
    worm_sim_bind(&sim, topo, V, i_stim);
    worm_sim_reset(&sim);

    for (int i = 0; i < N_NEURONS; i++)
        if (V[i] != golden[0][i]) {
            fprintf(stderr, "initial state mismatch at %d: %d != %d\n",
                    i, V[i], golden[0][i]);
            return 1;
        }

    i_stim[worm_name_index(&sim, "ALML")] = (int32_t)(40 * 65536);

    for (int f = 1; f <= 400; f++) {
        worm_step(&sim, 1);
        for (int i = 0; i < N_NEURONS; i++) {
            if (V[i] != golden[f][i]) {
                fprintf(stderr, "step %d neuron %d: C=%d python=%d (delta %d)\n",
                        f, i, V[i], golden[f][i], V[i] - golden[f][i]);
                return 1;
            }
        }
    }
    printf("OK: 400 steps x 302 neurons bit-for-bit against the Q16.16 reference\n");
    return 0;
}
```

- [ ] **Step 2: Run it, watch it fail**

```bash
cd program && gcc -O0 -g -I. native_test.c sim.c -o /tmp/native_test && /tmp/native_test
```

Expected: compile failure — `sim.h: No such file or directory`.

- [ ] **Step 3: Write `program/fixed.h`**

```c
#ifndef WORM_FIXED_H
#define WORM_FIXED_H
#include <stdint.h>

/* ThruVM has no F or D extension. Fixed point is not a preference. */
#define Q16            65536
#define LUT_SPAN       (8 * Q16)   /* LUT covers x in [-8, +8] */
#define LUT_STEP_SHIFT 12          /* (16 << 16) / 256 == 4096 == 1 << 12 */

/* Arithmetic shift on a negative value floors toward -inf, matching RISC-V
 * sra AND Python's >>. The reference simulator relies on this — do NOT
 * "fix" it to round-to-nearest or the bit-for-bit assert breaks. */
static inline int32_t q16_mul(int32_t a, int32_t b) {
    return (int32_t)(((int64_t)a * (int64_t)b) >> 16);
}

/* 257th entry is the right edge, so interpolation never reads past the end. */
static inline int32_t sigmoid_q16(int32_t x, int32_t const *lut) {
    if (x < -LUT_SPAN)     x = -LUT_SPAN;
    if (x >  LUT_SPAN - 1) x =  LUT_SPAN - 1;
    int32_t t    = x + LUT_SPAN;
    int32_t idx  = t >> LUT_STEP_SHIFT;
    int32_t frac = t & ((1 << LUT_STEP_SHIFT) - 1);
    int32_t lo = lut[idx], hi = lut[idx + 1];
    return lo + (int32_t)(((int64_t)(hi - lo) * frac) >> LUT_STEP_SHIFT);
}
#endif
```

- [ ] **Step 4: Write `program/sim.h` and `program/sim.c`**

`program/sim.h`:

```c
#ifndef WORM_SIM_H
#define WORM_SIM_H
#include <stdint.h>
#include "worm.h"

typedef struct {
    worm_topology_hdr_t const *hdr;
    uint16_t const *slot_map;
    uint32_t const *chem_rowptr, *gap_rowptr;
    uint16_t const *chem_col, *gap_col;
    int16_t  const *chem_g, *chem_E, *gap_g;
    worm_param_t const *params;
    int32_t  const *lut;
    int32_t  *V;       /* Q16.16 mV, caller-owned, n_neurons entries */
    int32_t  *i_stim;  /* Q16.16,    caller-owned, n_neurons entries */
    int32_t   s[N_NEURONS];       /* activation scratch, pass 1 */
    int32_t   v_next[N_NEURONS];  /* double buffer, pass 3 */
    int32_t   dt;
} worm_sim_t;

void worm_sim_bind(worm_sim_t *sim, void const *topology, int32_t *V, int32_t *i_stim);
void worm_sim_reset(worm_sim_t *sim);
void worm_step(worm_sim_t *sim, uint32_t n);
int  worm_name_index(worm_sim_t const *sim, char const *name);
#endif
```

`program/sim.c`:

```c
/* The timestep. Compiled TWICE — once for ThruVM, once natively — so a
 * disagreement between chain and laptop localizes to the VM, not the math.
 * NO SDK CALLS BELONG IN THIS FILE. */
#include "sim.h"
#include "fixed.h"

#define DT_Q16 (5 * Q16)   /* dt = 5 ms. Backward Euler is unconditionally
                            * stable, which is what buys 5 ms over 0.5 ms. */

static inline void const *at(void const *base, uint32_t off) {
    return (void const *)((unsigned char const *)base + off);
}

void worm_sim_bind(worm_sim_t *sim, void const *topo, int32_t *V, int32_t *i_stim) {
    worm_topology_hdr_t const *h = (worm_topology_hdr_t const *)topo;
    sim->hdr         = h;
    sim->slot_map    = (uint16_t const *)at(topo, h->off_slot_map);
    sim->chem_rowptr = (uint32_t const *)at(topo, h->off_chem_rowptr);
    sim->chem_col    = (uint16_t const *)at(topo, h->off_chem_col);
    sim->chem_g      = (int16_t  const *)at(topo, h->off_chem_g);
    sim->chem_E      = (int16_t  const *)at(topo, h->off_chem_E);
    sim->gap_rowptr  = (uint32_t const *)at(topo, h->off_gap_rowptr);
    sim->gap_col     = (uint16_t const *)at(topo, h->off_gap_col);
    sim->gap_g       = (int16_t  const *)at(topo, h->off_gap_g);
    sim->params      = (worm_param_t const *)at(topo, h->off_params);
    sim->lut         = (int32_t  const *)at(topo, h->off_lut);
    sim->V = V; sim->i_stim = i_stim; sim->dt = DT_Q16;
}

void worm_sim_reset(worm_sim_t *sim) {
    for (uint32_t i = 0; i < sim->hdr->n_neurons; i++) {
        sim->V[i] = (int32_t)sim->params[i].E_leak_mV * Q16;
        sim->i_stim[i] = 0;
    }
}

void worm_step(worm_sim_t *sim, uint32_t n) {
    uint32_t const N = sim->hdr->n_neurons;
    for (uint32_t it = 0; it < n; it++) {
        /* Pass 1. Activation depends ONLY on the presynaptic neuron, so this
         * is 302 sigmoid evaluations instead of 7000. Worth ~570k CU/step —
         * roughly half the budget. Moving it into the edge loop is the single
         * most expensive "simplification" available. */
        for (uint32_t j = 0; j < N; j++) {
            worm_param_t const *p = &sim->params[j];
            int32_t x = q16_mul(sim->V[j] - ((int32_t)p->V_half_mV * Q16),
                                (int32_t)p->k_recip << 8);
            sim->s[j] = sigmoid_q16(x, sim->lut);
        }

        for (uint32_t i = 0; i < N; i++) {
            worm_param_t const *p = &sim->params[i];
            int32_t g_leak = (int32_t)p->g_leak << 8;   /* Q8.8 -> Q16.16 */
            /* int64: AVA has 300+ incoming edges and Q16.16 products overflow
             * int32. This declaration IS the fix. */
            int64_t acc_g  = g_leak;
            int64_t acc_gE = (int64_t)q16_mul(g_leak, (int32_t)p->E_leak_mV * Q16)
                           + sim->i_stim[i];

            /* Pass 2a: chemical. Conductance gated by presynaptic activation. */
            for (uint32_t e = sim->chem_rowptr[i]; e < sim->chem_rowptr[i + 1]; e++) {
                int32_t g = q16_mul((int32_t)sim->chem_g[e] << 8,
                                    sim->s[sim->chem_col[e]]);
                acc_g  += g;
                acc_gE += q16_mul(g, (int32_t)sim->chem_E[e] * Q16);
            }
            /* Pass 2b: gap. An ohmic junction g*(Vi-Vj) is algebraically a
             * conductance g with reversal potential Vj — SAME accumulator,
             * no second code path. */
            for (uint32_t e = sim->gap_rowptr[i]; e < sim->gap_rowptr[i + 1]; e++) {
                int32_t g = (int32_t)sim->gap_g[e] << 8;
                acc_g  += g;
                acc_gE += q16_mul(g, sim->V[sim->gap_col[e]]);
            }

            /* Pass 3: backward Euler. ONE divide per NEURON, not per synapse —
             * and on ThruVM divu costs 4 CU, the same as add, because cost is
             * charged by instruction SIZE, not latency. */
            int32_t C = (int32_t)p->C << 8;
            int64_t num = (int64_t)q16_mul(C, sim->V[i])
                        + (int64_t)q16_mul(sim->dt, (int32_t)acc_gE);
            int64_t den = (int64_t)C + (int64_t)q16_mul(sim->dt, (int32_t)acc_g);
            sim->v_next[i] = (int32_t)((num << 16) / den);
        }

        for (uint32_t i = 0; i < N; i++) sim->V[i] = sim->v_next[i];
    }
}

int worm_name_index(worm_sim_t const *sim, char const *name) {
    (void)sim;
    /* Names live in the neuron ACCOUNTS, not the topology, so the native
     * harness resolves through a table the packer emits. Task 9 fills this in
     * on-chain; natively we read data/names.json via native_test.c. */
    extern int worm_native_name_index(char const *);
    return worm_native_name_index(name);
}
```

Add to `native_test.c`, above `main`:

```c
/* Native-only name resolution. On-chain the name is in the account itself. */
static char g_names[N_NEURONS][12];
static int g_names_loaded = 0;

int worm_native_name_index(char const *name) {
    if (!g_names_loaded) {
        FILE *f = fopen("../data/names.json", "rb");
        if (!f) return -1;
        static char buf[65536];
        size_t n = fread(buf, 1, sizeof(buf) - 1, f); buf[n] = 0; fclose(f);
        int k = 0; char *p = buf;
        while ((p = strchr(p, '"')) && k < N_NEURONS) {
            char *end = strchr(++p, '"');
            if (!end) break;
            size_t len = (size_t)(end - p);
            if (len > 11) len = 11;
            memcpy(g_names[k], p, len); g_names[k][len] = 0;
            k++; p = end + 1;
        }
        g_names_loaded = 1;
    }
    for (int i = 0; i < N_NEURONS; i++)
        if (strcmp(g_names[i], name) == 0) return i;
    return -1;
}
```

- [ ] **Step 5: Run the native test**

```bash
cd program && gcc -O0 -g -I. native_test.c sim.c -o /tmp/native_test && /tmp/native_test
```

Expected: `OK: 400 steps x 302 neurons bit-for-bit against the Q16.16 reference`.

If it reports a mismatch at step 1, the divergence is in a single operation — print `acc_g` and `acc_gE` for that neuron from both sides. If it matches for 50 steps then drifts, suspect the `int32_t` narrowing casts inside the backward-Euler solve: `acc_gE` can legitimately exceed int32 and the cast truncates. That narrowing is deliberate only because `q16_mul` takes int32; if the vector test fails here, widen `q16_mul` to an int64 overload for that call site and regenerate the Python reference to match.

- [ ] **Step 6: Commit**

```bash
git add program/fixed.h program/sim.h program/sim.c program/native_test.c
git commit -m "feat(program): Q16.16 timestep, bit-for-bit against the python reference"
```

---

### Task 9: `upload_chunk` and `create_neurons`

**Files:**
- Create: `program/worm.c`
- Create: `pipeline/deploy.py`
- Modify: `program/Local.mk`

**Interfaces:**
- Consumes: `sim.h`, `worm.h`.
- Produces: a deployed program answering `INSTR_UPLOAD_CHUNK` and `INSTR_CREATE_NEURONS`; `pipeline/deploy.py` exposing `upload_topology()` and `create_all_neurons()`. Task 11 needs both to have run.

- [ ] **Step 1: Write `program/worm.c` with the two setup instructions**

```c
#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include <string.h>
#include "worm.h"
#include "sim.h"
#include "fixed.h"   /* Q16 and q16_mul — Tasks 10-12 use both here */

/* Topology is account index 2 during setup, read-only during stepping. */
#define ACC_TOPOLOGY 2u

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint32_t offset;
    uint32_t len;
    /* payload bytes follow */
} upload_args_t;

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t count;
    /* count * { uint16 acct_idx; uint16 neuron_idx; char name[8];
                 uint8 seed[32]; uint32 proof_sz; uint8 proof[] } follows */
} create_args_t;

static void do_upload(uchar const *data, ulong sz) {
    if (sz < sizeof(upload_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    upload_args_t const *a = (upload_args_t const *)data;
    if (sz != sizeof(upload_args_t) + a->len) tsdk_revert(ERR_BAD_INSTR_SIZE);

    if (tsys_set_account_data_writable(ACC_TOPOLOGY) != TSDK_SUCCESS)
        tsdk_revert(ERR_RESIZE_FAILED);

    /* Resize once, on the first chunk, to the full declared size. Growing
     * incrementally would re-charge memory units on every chunk. */
    if (a->offset == 0) {
        uint32_t total = *(uint32_t const *)(data + sizeof(upload_args_t) + 0x3C);
        if (tsys_account_resize(ACC_TOPOLOGY, total) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
    }
    unsigned char *dst = (unsigned char *)tsdk_get_account_data_ptr(ACC_TOPOLOGY);
    memcpy(dst + a->offset, data + sizeof(upload_args_t), a->len);
    tsdk_return(TSDK_SUCCESS);
}

static void do_create(uchar const *data, ulong sz) {
    if (sz < sizeof(create_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    create_args_t const *a = (create_args_t const *)data;
    uchar const *p = data + sizeof(create_args_t);
    uchar const *end = data + sz;

    for (uint16_t k = 0; k < a->count; k++) {
        if (p + 2 + 2 + 8 + 32 + 4 > end) tsdk_revert(ERR_BAD_INSTR_SIZE);
        uint16_t acct_idx  = *(uint16_t const *)p; p += 2;
        uint16_t neuron_ix = *(uint16_t const *)p; p += 2;
        char const *name   = (char const *)p;      p += 8;
        uchar const *seed  = p;                    p += 32;
        uint32_t proof_sz  = *(uint32_t const *)p; p += 4;
        if (p + proof_sz > end) tsdk_revert(ERR_BAD_INSTR_SIZE);

        if (tsys_account_create(acct_idx, seed, p, proof_sz) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        p += proof_sz;

        if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        if (tsys_account_resize(acct_idx, sizeof(worm_neuron_t)) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);

        worm_neuron_t *nd = (worm_neuron_t *)tsdk_get_account_data_ptr(acct_idx);
        memset(nd, 0, sizeof(*nd));
        nd->index = neuron_ix;
        memcpy(nd->name, name, 8);
    }
    tsdk_return(TSDK_SUCCESS);
}

TSDK_ENTRYPOINT_FN void start(void) {
    tsdk_txn_t const *txn = tsdk_get_txn();
    uchar const *data = tsdk_txn_get_instr_data(txn);
    ulong sz = tsdk_txn_get_instr_data_sz(txn);
    if (sz < sizeof(uint32_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);

    switch (*(uint32_t const *)data) {
        case INSTR_UPLOAD_CHUNK:   do_upload(data, sz); break;
        case INSTR_CREATE_NEURONS: do_create(data, sz); break;
        default:                   tsdk_revert(ERR_BAD_INSTR_TYPE);
    }
    tsdk_return(TSDK_SUCCESS);
}
```

`program/Local.mk`:

```makefile
$(call make-bin,worm,worm,sim,-ltn_sdk)
```

- [ ] **Step 2: Build and deploy**

```bash
cd program && make
thru program upgrade hello-worm-v1 build/thruvm/bin/worm.bin
```

Expected: build succeeds; upgrade keeps the program address stable (so `data/addresses.json` stays valid).

- [ ] **Step 3: Write the uploader**

`pipeline/deploy.py`:

```python
"""Chunked upload and account creation. Chunk size is bounded by Thru's 32 KiB
transaction limit; 2 KiB leaves ample room for the header, account addresses
and hex encoding overhead."""
import json, struct, subprocess
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
CHUNK = 2048

def _program_id() -> str:
    from .pack_addr import _program_id as pid
    return pid()

def _topology_account() -> str:
    r = subprocess.run(["thru", "program", "derive-address", _program_id(), "topology"],
                       capture_output=True, text=True, check=True)
    return r.stdout.strip().split()[-1]

def _exec(readwrite: list[str], hexdata: str) -> str:
    cmd = ["thru", "txn", "execute", "--fee", "100000",
           "--readwrite-accounts", ",".join(readwrite),
           _program_id(), hexdata]
    r = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return r.stdout

def upload_topology() -> None:
    blob = (DATA / "topology.bin").read_bytes()
    topo = _topology_account()
    for off in range(0, len(blob), CHUNK):
        piece = blob[off:off + CHUNK]
        payload = struct.pack("<III", 1, off, len(piece)) + piece
        out = _exec([topo], payload.hex())
        print(f"chunk {off:6d}/{len(blob)} -> {out.splitlines()[0]}")

def create_all_neurons(batch: int = 20) -> None:
    """Thru sorts the writable array ascending, so the account index for a
    neuron is its position in the SORTED batch, not its position in the group.
    Getting this wrong writes every neuron's name into the wrong account and
    the failure only surfaces much later as a scrambled classifier."""
    names = json.loads((DATA / "names.json").read_text())
    addrs = json.loads((DATA / "addresses.json").read_text())
    for start in range(0, len(names), batch):
        group = list(range(start, min(start + batch, len(names))))
        rw = sorted(addrs[i] for i in group)
        body = bytearray(struct.pack("<IH", 2, len(group)))
        for i in group:
            pb = _make_proof(addrs[i])
            seed = f"neuron-{names[i]}".encode().ljust(32, b"\0")[:32]
            body += struct.pack("<HH", 2 + rw.index(addrs[i]), i)
            body += names[i].encode().ljust(8, b"\0")[:8]
            body += seed + struct.pack("<I", len(pb)) + pb
        print(_exec(rw, body.hex()).splitlines()[0])
```

- [ ] **Step 3b: Create the three singleton accounts**

`upload_topology()` resizes and writes the topology account, so that account must
already exist — and so must the reservoir and behavior accounts that Tasks 11 and 12
transfer against. Add a fourth instruction to `program/worm.h`:

```c
#define INSTR_CREATE_SINGLETONS 6u
```

and to `program/worm.c`, above `start()`:

```c
typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t count;
    /* count * { uint16 acct_idx; uint32 data_sz; uint8 seed[32];
                 uint32 proof_sz; uint8 proof[] } follows */
} create_singleton_args_t;

/* Topology, reservoir and behavior are program-owned accounts with no neuron
 * header. The reservoir must ALSO be funded — chemical settlement transfers
 * against it, and an empty reservoir fails with INSUFFICIENT_BALANCE (-38). */
static void do_create_singletons(uchar const *data, ulong sz) {
    if (sz < sizeof(create_singleton_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    create_singleton_args_t const *a = (create_singleton_args_t const *)data;
    uchar const *p = data + sizeof(create_singleton_args_t);
    uchar const *end = data + sz;

    for (uint16_t k = 0; k < a->count; k++) {
        if (p + 2 + 4 + 32 + 4 > end) tsdk_revert(ERR_BAD_INSTR_SIZE);
        uint16_t acct_idx = *(uint16_t const *)p; p += 2;
        uint32_t data_sz  = *(uint32_t const *)p; p += 4;
        uchar const *seed = p;                    p += 32;
        uint32_t proof_sz = *(uint32_t const *)p; p += 4;
        if (p + proof_sz > end) tsdk_revert(ERR_BAD_INSTR_SIZE);

        if (tsys_account_create(acct_idx, seed, p, proof_sz) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        p += proof_sz;
        if (tsys_set_account_data_writable(acct_idx) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        if (data_sz && tsys_account_resize(acct_idx, data_sz) != TSDK_SUCCESS)
            tsdk_revert(ERR_RESIZE_FAILED);
        if (data_sz) {
            unsigned char *d = (unsigned char *)tsdk_get_account_data_ptr(acct_idx);
            memset(d, 0, data_sz);
        }
    }
    tsdk_return(TSDK_SUCCESS);
}
```

Dispatch arm: `case INSTR_CREATE_SINGLETONS: do_create_singletons(data, sz); break;`

And to `pipeline/deploy.py`:

```python
def _derive(seed: str) -> str:
    r = subprocess.run(["thru", "program", "derive-address", _program_id(), seed],
                       capture_output=True, text=True, check=True)
    return r.stdout.strip().split()[-1]

def _reservoir_account() -> str: return _derive("reservoir")
def _behavior_account()  -> str: return _derive("behavior")

def _make_proof(addr: str) -> bytes:
    r = subprocess.run(["thru", "txn", "make-state-proof", "creating", addr],
                       capture_output=True, text=True, check=True)
    return bytes.fromhex(r.stdout.strip().split()[-1])

def create_singletons() -> None:
    """Topology, reservoir and behavior. Must run BEFORE upload_topology().
    Topology gets size 0 here — upload_topology resizes it to the real size on
    the first chunk, so memory units are charged once rather than per chunk."""
    specs = [(_topology_account(), "topology", 0),
             (_reservoir_account(), "reservoir", 0),
             (_behavior_account(),  "behavior", 32)]
    rw = sorted(a for a, _, _ in specs)      # Thru requires ascending order
    body = bytearray(struct.pack("<IH", 6, len(specs)))
    for addr, seed_str, size in specs:
        pb = _make_proof(addr)
        seed = seed_str.encode().ljust(32, b"\0")[:32]
        body += struct.pack("<HI", 2 + rw.index(addr), size)
        body += seed + struct.pack("<I", len(pb)) + pb
    print(_exec(rw, body.hex()).splitlines()[0])

def fund_reservoir(amount: int = 302 * 200000) -> None:
    """Chemical settlement transfers against the reservoir. Size it to cover
    every neuron sitting at BAL_MAX simultaneously — cheap insurance against a
    mid-demo INSUFFICIENT_BALANCE."""
    subprocess.run(["thru", "txn", "transfer", "worm", _reservoir_account(),
                    str(amount)], check=True)
```

- [ ] **Step 4: Run it, in this order**

```bash
python -c "from pipeline.deploy import create_singletons; create_singletons()"
python -c "from pipeline.deploy import fund_reservoir;  fund_reservoir()"
python -c "from pipeline.deploy import upload_topology; upload_topology()"
python -c "from pipeline.deploy import create_all_neurons; create_all_neurons()"
```

Order matters: the singletons must exist before the topology upload resizes one of
them, and the reservoir must hold balance before any settlement runs.

Expected: ~30 upload transactions and ~16 creation transactions, all with result code 0. State proofs are slot-bound — if you see `INVALID_PROOF_SLOT (-33)`, the proofs went stale between generation and submission; lower `batch` so each transaction submits sooner.

- [ ] **Step 5: Record measurement #4**

The creation output prints `State Units Consumed`. Write it into `docs/measurements.md` replacing `STATE_UNITS_PER_CREATE: PENDING`. If it is near the `uint16` ceiling of 65,535 per transaction, drop `batch` accordingly.

- [ ] **Step 6: Verify on chain**

```bash
thru account show $(python -c "import json;print(json.load(open('data/addresses.json'))[0])")
```

Expected: a 32-byte account owned by the worm program, with a readable neuron name in its data.

- [ ] **Step 7: Commit**

```bash
git add program/worm.c program/Local.mk pipeline/deploy.py docs/measurements.md
git commit -m "feat(program): chunked topology upload and 302 neuron account creation"
```

---

### Task 10: `step(n)` on chain, asserted against native

**Files:**
- Modify: `program/worm.c`
- Modify: `pipeline/deploy.py`
- Test: `pipeline/test_chain.py`

**Interfaces:**
- Consumes: `worm_step` from Task 8, the accounts from Task 9.
- Produces: `INSTR_STEP` and `INSTR_STIMULATE` on chain; `pipeline/deploy.py::run_steps(n)` and `read_voltages() -> list[int]`.

- [ ] **Step 1: Write the failing chain test**

`pipeline/test_chain.py`:

```python
"""Live-chain tests. Slow and network-dependent — run with -m chain.
These are the fourth and last link in the verification chain:
numpy -> fixed python -> native C -> ThruVM."""
import pytest
from pipeline.refsim import FixedSim
from pipeline.deploy import reset_sim, stimulate, run_steps, read_voltages

pytestmark = pytest.mark.chain

def test_chain_matches_the_fixed_reference_bit_for_bit():
    """If the chain disagrees with native C, the bug is in the VM or in the
    account plumbing — never in the arithmetic, because Task 8 already proved
    that. That is the entire value of this assert."""
    ref = FixedSim()
    ref.stimulate("ALML", 40.0)
    ref.step(100)

    reset_sim()
    stimulate("ALML", 40.0)
    run_steps(100)
    got = read_voltages()

    mismatches = [(i, a, b) for i, (a, b) in enumerate(zip(got, ref.V)) if a != b]
    assert not mismatches, f"{len(mismatches)} neurons differ, first: {mismatches[0]}"

def test_balance_encodes_voltage_within_rounding():
    """Voltage lives in the BALANCE. If the offset encoding is wrong, transfers
    underflow and the whole wallet story collapses."""
    from pipeline.deploy import read_balances
    reset_sim(); run_steps(20)
    vs, bs = read_voltages(), read_balances()
    for v, b in zip(vs, bs):
        expected = int((v / 65536 + 100) * 1000)
        assert abs(int(b) - expected) <= 1
        assert 1000 <= int(b) <= 200000
```

- [ ] **Step 2: Run it, watch it fail**

```bash
python -m pytest pipeline/test_chain.py -v -m chain
```

Expected: `ImportError: cannot import name 'reset_sim'`.

- [ ] **Step 3: Add the stepping instructions to `program/worm.c`**

Insert before `start()`:

```c
/* Thru sorts the ENTIRE writable account array ascending by address, so the
 * singletons do NOT land at fixed indices — they interleave with the neurons
 * wherever their addresses happen to sort. The client knows the sort order, so
 * it passes the three singleton slots in the instruction data, exactly as
 * Thru's own counter example passes account_index. Everything else in the
 * writable array is a neuron, identified by the index field in its own data. */
typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint32_t n_steps;
    uint32_t flags;        /* bit0: settle  bit1: emit trace  bit2: reset */
    uint32_t settle_every;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
    uint16_t _pad;
} step_args_t;

static uint16_t ACC_TOPO, ACC_RESERVOIR, ACC_BEHAVIOR;

/* Forward declarations: do_step calls both. Tasks 11 and 12 supply the bodies;
 * Step 3 of this task adds no-op stubs so it compiles today. */
static void emit_trace(uint32_t step);
static void settle_transfers(uint32_t flags);

typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t neuron_idx;
    int32_t  current;      /* Q16.16 */
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
} stim_args_t;

/* classify() takes the same three slots and nothing else. */
typedef struct __attribute__((packed)) {
    uint32_t instr;
    uint16_t acc_topology;
    uint16_t acc_reservoir;
    uint16_t acc_behavior;
} classify_args_t;

static int32_t g_V[N_NEURONS];
static int32_t g_stim[N_NEURONS];
static worm_sim_t g_sim;

static uint16_t g_neuron_to_slot[N_NEURONS];

/* Builds the neuron -> account-slot map by reading each account's own index
 * field, rather than trusting a fixed layout. Every one of these accounts is
 * page-faulted by the step anyway, so the 2-byte read is free. The precomputed
 * slot_map is then used ONLY as a cross-check — if the two disagree, address
 * derivation drifted (usually a changed program id) and every later transfer
 * would go to the wrong neuron. */
static void bind_accounts(uint16_t a_topo, uint16_t a_res, uint16_t a_beh) {
    ACC_TOPO = a_topo; ACC_RESERVOIR = a_res; ACC_BEHAVIOR = a_beh;

    void const *topo = tsdk_get_account_data_ptr(ACC_TOPO);
    worm_sim_bind(&g_sim, topo, g_V, g_stim);
    if (g_sim.hdr->magic != WORM_MAGIC) tsdk_revert(ERR_BAD_MAGIC);

    tsdk_txn_t const *txn = tsdk_get_txn();
    ulong n_rw = tsdk_txn_readwrite_account_cnt(txn);
    uint32_t found = 0;
    for (ulong slot = 2; slot < 2 + n_rw; slot++) {
        if (slot == ACC_TOPO || slot == ACC_RESERVOIR || slot == ACC_BEHAVIOR) continue;
        worm_neuron_t const *nd =
            (worm_neuron_t const *)tsdk_get_account_data_ptr(slot);
        if (nd->index >= g_sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
        g_neuron_to_slot[nd->index] = (uint16_t)slot;
        found++;
    }
    if (found != g_sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
}

static void load_state(void) {
    for (uint32_t i = 0; i < g_sim.hdr->n_neurons; i++) {
        uint16_t slot = g_neuron_to_slot[i];
        worm_neuron_t const *nd =
            (worm_neuron_t const *)tsdk_get_account_data_ptr(slot);
        /* Voltage is reconstructed from the BALANCE, which is the source of
         * truth; v_next in data is only the double buffer. */
        uint64_t bal = tsdk_get_account_meta(slot)->balance;
        g_V[i]    = (int32_t)(((int64_t)bal - (int64_t)BAL_OFFSET_MV * BAL_SCALE)
                              * Q16 / BAL_SCALE);
        g_stim[i] = nd->i_stim;
    }
}

static uint64_t v_to_balance(int32_t v_q16) {
    int64_t mv = (int64_t)v_q16 * BAL_SCALE / Q16;
    int64_t b  = mv + (int64_t)BAL_OFFSET_MV * BAL_SCALE;
    if (b < (int64_t)BAL_MIN) b = BAL_MIN;
    if (b > (int64_t)BAL_MAX) b = BAL_MAX;
    return (uint64_t)b;
}

static void store_state(uint32_t tag) {
    for (uint32_t i = 0; i < g_sim.hdr->n_neurons; i++) {
        uint16_t slot = g_neuron_to_slot[i];
        worm_neuron_t *nd = (worm_neuron_t *)tsdk_get_account_data_ptr(slot);
        if (nd->step_tag > tag) tsdk_revert(ERR_STALE_STEP_TAG);
        nd->v_next   = g_V[i];
        nd->step_tag = tag;
    }
}

static void do_step(uchar const *data, ulong sz) {
    if (sz != sizeof(step_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    step_args_t const *a = (step_args_t const *)data;
    bind_accounts(a->acc_topology, a->acc_reservoir, a->acc_behavior);

    /* Freshly created accounts have zero balance, which decodes to -100mV, not
     * the leak reversal potential. Reset seeds V from the topology parameters
     * and lets settlement push real balance into every neuron from the
     * reservoir — that first settlement is what makes the accounts non-empty. */
    if (a->flags & 4u) worm_sim_reset(&g_sim);
    else               load_state();

    uint32_t done = 0;
    do {
        uint32_t chunk = a->settle_every ? a->settle_every : a->n_steps;
        if (chunk > a->n_steps - done) chunk = a->n_steps - done;
        if (chunk) worm_step(&g_sim, chunk);
        done += chunk;
        if (a->flags & 2u) emit_trace(done);
        if (a->flags & 1u) settle_transfers(a->flags);   /* Task 11 */
    } while (done < a->n_steps);

    store_state(done);
    tsdk_return(TSDK_SUCCESS);
}

static void do_stimulate(uchar const *data, ulong sz) {
    if (sz != sizeof(stim_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    stim_args_t const *a = (stim_args_t const *)data;
    bind_accounts(a->acc_topology, a->acc_reservoir, a->acc_behavior);
    if (a->neuron_idx >= g_sim.hdr->n_neurons) tsdk_revert(ERR_ACCOUNT_COUNT);
    uint16_t slot = g_neuron_to_slot[a->neuron_idx];
    worm_neuron_t *nd = (worm_neuron_t *)tsdk_get_account_data_ptr(slot);
    nd->i_stim = a->current;
    tsdk_return(TSDK_SUCCESS);
}
```

Add stubs for the two functions Tasks 11 and 12 supply, so this task compiles and
tests on its own:

```c
static void emit_trace(uint32_t step) { (void)step; }          /* Task 12 */
static void settle_transfers(uint32_t flags) { (void)flags; }  /* Task 11 */
```

and the dispatch arms:

```c
case INSTR_STEP:      do_step(data, sz); break;
case INSTR_STIMULATE: do_stimulate(data, sz); break;
```

> **Note on `tsdk_get_account_meta`:** use the exact accessor name confirmed in Task 1 Step 3. If the installed SDK spells it differently, fix it here and nowhere else — this is the only call site.

- [ ] **Step 4: Add the client helpers to `pipeline/deploy.py`**

```python
def _step_accounts() -> list[str]:
    """Thru sorts the ENTIRE writable array ascending by address, so the three
    singletons interleave with the neurons. Sort everything together here and
    let _slots() tell the program where the singletons landed."""
    return sorted(json.loads((DATA / "addresses.json").read_text())
                  + [_topology_account(), _reservoir_account(), _behavior_account()])

def _slots() -> tuple[int, int, int]:
    """Account index of topology, reservoir, behavior. Index 0 is the fee payer
    and index 1 is the program, so the writable array starts at 2."""
    ordered = _step_accounts()
    return (ordered.index(_topology_account()) + 2,
            ordered.index(_reservoir_account()) + 2,
            ordered.index(_behavior_account()) + 2)

def run_steps(n: int, settle_every: int = 0, emit: bool = False,
              reset: bool = False) -> str:
    flags = (1 if settle_every else 0) | (2 if emit else 0) | (4 if reset else 0)
    payload = struct.pack("<IIII", 4, n, flags, settle_every) \
            + struct.pack("<HHHH", *_slots(), 0)
    return _exec(_step_accounts(), payload.hex())

def stimulate(name: str, current_mV: float) -> str:
    names = json.loads((DATA / "names.json").read_text())
    payload = struct.pack("<IHi", 3, names.index(name), int(current_mV * 65536)) \
            + struct.pack("<HHH", *_slots())
    return _exec(_step_accounts(), payload.hex())

def read_balances() -> list[int]:
    out = []
    for a in json.loads((DATA / "addresses.json").read_text()):
        r = subprocess.run(["thru", "--json", "account", "show", a],
                           capture_output=True, text=True, check=True)
        out.append(int(json.loads(r.stdout)["balance"]))
    return out

def read_voltages() -> list[int]:
    Q, OFF, SCALE = 65536, 100, 1000
    return [int((b - OFF * SCALE) * Q // SCALE) for b in read_balances()]

def reset_sim() -> str:
    """Reset V to the leak potentials AND settle, so every neuron account ends
    up holding real balance rather than the zero it was created with."""
    return run_steps(0, settle_every=1, reset=True)
```

- [ ] **Step 5: Build, deploy, run the chain test**

```bash
cd program && make && thru program upgrade hello-worm-v1 build/thruvm/bin/worm.bin
cd .. && python -m pytest pipeline/test_chain.py -v -m chain
```

Expected: both tests pass. A mismatch here — given Task 8 is green — is account plumbing, almost always the slot permutation. Print `g_neuron_to_slot` via `tsdk_printf` and compare against `data/addresses.json` sorted.

- [ ] **Step 6: Record measurement #3**

Run a single-step transaction and read the printed `Compute Units Consumed`:

```bash
python -c "from pipeline.deploy import run_steps; print(run_steps(1))"
python -c "from pipeline.deploy import run_steps; print(run_steps(51))"
```

Subtract: `(CU@51 - CU@1) / 50` is the marginal per-step cost, and `CU@1 - that` is the fixed page-fault cost. Write both into `docs/measurements.md`. The spec predicts ~600k marginal and ~1.30M fixed; if the marginal is more than 2× the prediction, check that the build used `-Os -march=rv64imc_zba_zbb`.

- [ ] **Step 7: Pick steps-per-transaction and commit**

```
STEPS_PER_TX = floor(0.8 * MAX_BLOCK_COMPUTE_UNITS - FIXED_CU) / MARGINAL_CU
```

Record it. Then:

```bash
git add program/worm.c pipeline/deploy.py pipeline/test_chain.py docs/measurements.md
git commit -m "feat(program): on-chain step and stimulate, bit-for-bit against the reference"
```

---

### Task 11: Transfer settlement — the wallet claim

**Files:**
- Modify: `program/worm.c`
- Test: `pipeline/test_chain.py`

**Interfaces:**
- Consumes: `do_step`'s settle hook.
- Produces: real `tsys_account_transfer` calls; `settle_gap_junctions()` and `settle_chemical(demo_only)`.

- [ ] **Step 1: Write the failing test**

```python
def test_gap_junction_settlement_conserves_total_balance():
    """Gap junctions are electrically conservative — current out of one cell is
    current into the other. If total balance moves, they are being settled as
    mint/burn, which is the WRONG physics and the wrong claim on stage."""
    from pipeline.deploy import read_balances, reset_sim, run_steps
    reset_sim(); run_steps(20)
    before = sum(read_balances())
    run_steps(20, settle_every=20)
    after = sum(read_balances())
    assert before == after, f"gap settlement leaked {after - before} units"

def test_settlement_emits_real_transfers_on_chain():
    from pipeline.deploy import reset_sim, run_steps, count_transfers_in_last_tx
    reset_sim()
    out = run_steps(20, settle_every=20)
    assert count_transfers_in_last_tx(out) >= 1000, "no transfer trail to show"
```

- [ ] **Step 2: Run it, watch it fail**

Expected: `test_settlement_emits_real_transfers_on_chain` fails — `settle_every` is accepted but does nothing yet.

- [ ] **Step 3: Implement settlement**

Add to `program/worm.c`:

```c
/* Gap junctions settle as TRANSFERS because they are conservative: current out
 * of one cell IS current into the other. Chemical synapses settle against the
 * reservoir because they are NOT conservative — a chemical synapse gates a
 * conductance, the presynaptic cell does not lose what the postsynaptic gains.
 * The two ledger operations match the two physics. That is the claim. */
static void settle_transfers(uint32_t flags) {
    uint32_t const N = g_sim.hdr->n_neurons;

    /* Reconcile every neuron's balance to its simulated voltage. Each delta is
     * one real 512-CU transfer against the reservoir; the gap-junction pairs
     * below then move balance neuron-to-neuron, conserving the total. */
    for (uint32_t i = 0; i < N; i++) {
        uint16_t slot = g_neuron_to_slot[i];
        uint64_t want = v_to_balance(g_V[i]);
        uint64_t have = tsdk_get_account_meta(slot)->balance;
        if (want == have) continue;
        ulong rc = (want > have)
            ? tsys_account_transfer(ACC_RESERVOIR, slot, want - have)
            : tsys_account_transfer(slot, ACC_RESERVOIR, have - want);
        if (rc != TSDK_SUCCESS) tsdk_revert(ERR_TRANSFER_FAILED);
    }

    if (!(flags & 1u)) return;

    /* Gap junctions, one transfer per anatomical junction in the direction of
     * net current. Stored symmetrically, so take each pair once (j > i). */
    for (uint32_t i = 0; i < N; i++) {
        for (uint32_t e = g_sim.gap_rowptr[i]; e < g_sim.gap_rowptr[i + 1]; e++) {
            uint32_t j = g_sim.gap_col[e];
            if (j <= i) continue;
            int32_t g = (int32_t)g_sim.gap_g[e] << 8;
            int32_t flow = q16_mul(g, g_sim.V[i] - g_sim.V[j]);
            if (flow == 0) continue;
            uint16_t si = g_neuron_to_slot[i], sj = g_neuron_to_slot[j];
            uint64_t amt = (uint64_t)((flow < 0 ? -flow : flow) / Q16);
            if (amt == 0) continue;
            uint16_t from = (flow > 0) ? si : sj;
            uint16_t to   = (flow > 0) ? sj : si;
            if (tsdk_get_account_meta(from)->balance < amt + BAL_MIN) continue;
            if (tsys_account_transfer(from, to, amt) != TSDK_SUCCESS)
                tsdk_revert(ERR_TRANSFER_FAILED);
        }
    }
}
```

This replaces the Task 10 stub of the same name. `do_step` already calls it inside
the loop under `flags & 1`, so no other change is needed.

Add the helper to `pipeline/deploy.py`:

```python
def count_transfers_in_last_tx(output: str) -> int:
    """The CLI prints one line per balance-changing operation. Fall back to
    parsing the JSON transaction details if the plain output is terse."""
    return sum(1 for line in output.splitlines() if "transfer" in line.lower())
```

- [ ] **Step 4: Build, deploy, test**

```bash
cd program && make && thru program upgrade hello-worm-v1 build/thruvm/bin/worm.bin
cd .. && python -m pytest pipeline/test_chain.py -v -m chain
```

Expected: all four chain tests pass. `INSUFFICIENT_BALANCE (-38)` means the `BAL_MIN` guard is too tight — the 20,000-unit headroom below resting potential exists precisely so hyperpolarizing transfers have somewhere to come from. Confirm the reservoir was funded.

- [ ] **Step 5: Measure the settlement overhead**

```bash
python -c "from pipeline.deploy import run_steps; print(run_steps(100))"
python -c "from pipeline.deploy import run_steps; print(run_steps(100, settle_every=20))"
```

Expected: roughly +6%, per the spec's estimate for 1,400 gap junctions at 512 CU each amortized over 20 steps. Record the actual figure — the README quotes it.

- [ ] **Step 6: Commit**

```bash
git add program/worm.c pipeline/deploy.py pipeline/test_chain.py
git commit -m "feat(program): settle gap junctions as conservative transfers, chemical against reservoir"
```

---

### Task 12: Classifier, behavior state, and the trace event

**Files:**
- Modify: `program/worm.c`
- Test: `pipeline/test_chain.py`

**Interfaces:**
- Produces: `INSTR_CLASSIFY`; a 604-byte trace event per emitted frame; `pipeline/deploy.py::read_behavior() -> dict`.

- [ ] **Step 1: Write the failing behavioral test**

```python
def test_head_touch_drives_reverse_and_tail_touch_drives_forward():
    """THE behavioral regression test. Fifteen cells, forty years of
    literature, one assert. If this fails the demo is dead, and nothing else
    in the suite would have told you."""
    from pipeline.deploy import reset_sim, stimulate, run_steps, classify, read_behavior
    REVERSE, FORWARD = 2, 1

    reset_sim(); stimulate("ALML", 40.0); run_steps(400); classify()
    assert read_behavior()["state"] == REVERSE

    reset_sim(); stimulate("PLML", 40.0); run_steps(400); classify()
    assert read_behavior()["state"] == FORWARD

def test_classifier_does_not_flicker_at_the_crossover():
    """A bare argmax oscillates when the two drives are close, and a flickering
    worm reads as broken. Hysteresis plus dwell is what stops it."""
    from pipeline.deploy import reset_sim, stimulate, run_steps, classify, read_behavior
    reset_sim(); stimulate("ALML", 12.0); stimulate("PLML", 12.0)
    seen = []
    for _ in range(10):
        run_steps(40); classify()
        seen.append(read_behavior()["state"])
    assert len(set(seen)) <= 2, f"state thrashed across {set(seen)}"

def test_trace_event_is_the_expected_size():
    from pipeline.deploy import run_steps, last_event_bytes
    run_steps(4, emit=True)
    assert len(last_event_bytes()) == 302 * 2 + 8
```

- [ ] **Step 2: Run it, watch it fail**

Expected: `ImportError: cannot import name 'classify'`.

- [ ] **Step 3: Implement the classifier and trace**

Add to `program/worm.c`:

```c
/* Command interneuron indices, resolved once from names at bind time. The
 * command layer IS the worm's behavioral classifier — that is its documented
 * function, not a convenience we invented. */
static int16_t IX_AVA = -1, IX_AVD = -1, IX_AVE = -1, IX_AVB = -1, IX_PVC = -1;

static void resolve_command_neurons(void) {
    for (uint32_t i = 0; i < g_sim.hdr->n_neurons; i++) {
        worm_neuron_t const *nd =
            (worm_neuron_t const *)tsdk_get_account_data_ptr(g_neuron_to_slot[i]);
        int16_t ix = (int16_t)nd->index;
        if (!memcmp(nd->name, "AVAL", 4)) IX_AVA = ix;
        else if (!memcmp(nd->name, "AVDL", 4)) IX_AVD = ix;
        else if (!memcmp(nd->name, "AVEL", 4)) IX_AVE = ix;
        else if (!memcmp(nd->name, "AVBL", 4)) IX_AVB = ix;
        else if (!memcmp(nd->name, "PVCL", 4)) IX_PVC = ix;
    }
}

/* Normalize against the cell's OWN resting potential, 20mV full scale. */
static int32_t drive_of(int16_t ix) {
    if (ix < 0) return 0;
    int32_t d = g_V[ix] - (int32_t)g_sim.params[ix].E_leak_mV * Q16;
    d = q16_mul(d, Q16 / 20);
    if (d < 0) d = 0;
    if (d > Q16) d = Q16;
    return d;
}

#define THRESH_ON   (Q16 * 35 / 100)
#define THRESH_OFF  (Q16 * 20 / 100)
#define DWELL_MIN   60     /* 300 ms at dt=5ms */
#define OMEGA_HOLD  160    /* 800 ms */

static void do_classify(uchar const *data, ulong sz) {
    if (sz != sizeof(classify_args_t)) tsdk_revert(ERR_BAD_INSTR_SIZE);
    classify_args_t const *a = (classify_args_t const *)data;
    bind_accounts(a->acc_topology, a->acc_reservoir, a->acc_behavior);
    load_state();
    resolve_command_neurons();

    int32_t rev = q16_mul(Q16 * 50 / 100, drive_of(IX_AVA))
                + q16_mul(Q16 * 30 / 100, drive_of(IX_AVD))
                + q16_mul(Q16 * 20 / 100, drive_of(IX_AVE));
    int32_t fwd = q16_mul(Q16 * 60 / 100, drive_of(IX_AVB))
                + q16_mul(Q16 * 40 / 100, drive_of(IX_PVC));

    worm_behavior_t *b = (worm_behavior_t *)tsdk_get_account_data_ptr(ACC_BEHAVIOR);
    uint32_t held = b->step - b->entered_at;
    uint8_t next = b->state;

    if (b->state == 3u) {                      /* OMEGA runs to completion */
        if (held >= 200u) next = 1u;           /* 1.0 s, then FORWARD */
    } else if (b->state == 2u && held >= OMEGA_HOLD && rev < THRESH_OFF) {
        next = 3u;                             /* sustained reversal, released */
    } else if (held >= DWELL_MIN) {
        if (rev > THRESH_ON && rev > fwd)      next = 2u;
        else if (fwd > THRESH_ON && fwd > rev) next = 1u;
        else if (rev < THRESH_OFF && fwd < THRESH_OFF) next = 0u;
    }

    if (next != b->state) { b->state = next; b->entered_at = b->step; }
    b->gain = (rev > fwd) ? rev : fwd;
    b->drive_fwd = fwd;
    b->drive_rev = rev;
    b->block_time = *(uint64_t const *)TSDK_ADDR(0x00, 0x0004, 0x08);
    tsdk_return(TSDK_SUCCESS);
}
```

Replace the Task 10 `emit_trace` stub:

```c
/* One event per frame: 302 voltages as i16 millivolts, then the step counter
 * and the behavior state. Costs 512 + 612 CU, so emitting every 4th step is
 * 0.05% overhead. Streaming one event beats reading 302 accounts by every
 * measure the front-end cares about.
 *
 * The 8-byte tail keeps the payload 8-aligned, which matters because
 * web/src/chain.ts builds an Int16Array VIEW over the received buffer rather
 * than copying it. */
typedef struct __attribute__((packed)) {
    int16_t  mV[N_NEURONS];
    uint32_t step;
    uint8_t  state;
    uint8_t  _pad[3];
} worm_trace_t;

static void emit_trace(uint32_t step) {
    static worm_trace_t frame;
    uint32_t const N = g_sim.hdr->n_neurons;
    for (uint32_t i = 0; i < N; i++) frame.mV[i] = (int16_t)(g_V[i] >> 16);
    frame.step = step;
    worm_behavior_t const *b =
        (worm_behavior_t const *)tsdk_get_account_data_ptr(ACC_BEHAVIOR);
    frame.state = b->state;
    tsys_emit_event((uchar const *)&frame, sizeof(frame));
}
```

Add `case INSTR_CLASSIFY: do_classify(data, sz); break;` to the dispatch, and to `pipeline/deploy.py`:

```python
def classify() -> str:
    return _exec(_step_accounts(), struct.pack("<IHHH", 5, *_slots()).hex())

def read_behavior() -> dict:
    r = subprocess.run(["thru", "--json", "account", "show", _behavior_account()],
                       capture_output=True, text=True, check=True)
    raw = bytes.fromhex(json.loads(r.stdout)["data"])
    state, gain, fwd, rev, entered, step, bt = struct.unpack("<B3xiiiIIQ", raw[:32])
    return {"state": state, "gain": gain, "drive_fwd": fwd,
            "drive_rev": rev, "entered_at": entered, "step": step, "block_time": bt}

def last_event_bytes() -> bytes:
    r = subprocess.run(["thru", "--json", "txn", "last"], capture_output=True,
                       text=True, check=True)
    return bytes.fromhex(json.loads(r.stdout)["events"][-1]["data"])
```

- [ ] **Step 4: Build, deploy, test**

```bash
cd program && make && thru program upgrade hello-worm-v1 build/thruvm/bin/worm.bin
cd .. && python -m pytest pipeline/test_chain.py -v -m chain
```

Expected: all seven chain tests pass. If `test_head_touch_drives_reverse_and_tail_touch_drives_forward` fails, tune the ~15 demo-circuit conductances in `assign_physiology` — and only those. Do not tune 7,000.

- [ ] **Step 5: Write and publish the ABI so the explorer decodes everything**

Without an ABI, `scan.thru.org` shows opaque bytes — and the explorer is the evidence
for the whole claim. The seed must match the program seed or tooling cannot associate
the two.

`abi/worm.yaml`:

```yaml
name: worm
version: "1.0.0"
description: "C. elegans nervous system: 302 neurons as accounts, synapses as transfers"
seed: hello-worm-v1
network: alphanet

types:
  UploadChunk:
    fields:
      - { name: offset, type: uint32 }
      - { name: len,    type: uint32 }
      - { name: bytes,  type: bytes, length_from: len }
  Stimulate:
    fields:
      - { name: neuron_idx, type: uint16 }
      - { name: current,    type: int32, description: "Q16.16 mV" }
  Step:
    fields:
      - { name: n_steps,      type: uint32 }
      - { name: flags,        type: uint32, description: "bit0 settle, bit1 trace, bit2 reset" }
      - { name: settle_every, type: uint32 }
  Classify:
    fields: []

instructions:
  root: WormInstruction
  discriminant: { name: instruction_type, type: uint32 }
  variants:
    - { value: 1, name: upload_chunk,      type: UploadChunk }
    - { value: 3, name: stimulate,         type: Stimulate }
    - { value: 4, name: step,              type: Step }
    - { value: 5, name: classify,          type: Classify }

accounts:
  Neuron:
    size: 32
    fields:
      - { name: index,    type: uint16 }
      - { name: name,     type: string, length: 8 }
      - { name: _pad0,    type: uint16 }
      - { name: v_next,   type: int32 }
      - { name: i_stim,   type: int32 }
      - { name: step_tag, type: uint32 }
      - { name: _pad1,    type: uint32 }
  Behavior:
    size: 32
    fields:
      - { name: state,      type: uint8 }
      - { name: _pad,       type: bytes, length: 3 }
      - { name: gain,       type: int32 }
      - { name: drive_fwd,  type: int32 }
      - { name: drive_rev,  type: int32 }
      - { name: entered_at, type: uint32 }
      - { name: step,       type: uint32 }
      - { name: block_time, type: uint64 }

events:
  Trace:
    fields:
      - { name: mV,    type: array, element: int16, length: 302 }
      - { name: step,  type: uint32 }
      - { name: state, type: uint8 }
      - { name: _pad,  type: bytes, length: 3 }
```

```bash
thru abi flatten abi/worm.yaml -o abi/worm.flat.yaml
thru abi reflect abi/worm.flat.yaml          # roundtrip check BEFORE publishing
thru abi prep-for-publish abi/worm.flat.yaml --target-network alphanet
thru program publish-abi hello-worm-v1 abi/worm.flat.yaml
```

Run `thru abi reflect` first. Publishing a broken ABI means re-publishing under demo
pressure, and the roundtrip check takes seconds.

- [ ] **Step 6: Commit**

```bash
git add program/worm.c pipeline/deploy.py pipeline/test_chain.py abi/
git commit -m "feat(program): command-interneuron classifier, behavior state, trace events"
```

---

## Track C — Front-end (TypeScript)

Track C starts Friday night against mock data and does not block on Tracks A or B.

### Task 13: Follow-the-leader body kinematics

**Files:**
- Create: `web/src/body.ts`, `web/src/test_body.ts`, `web/package.json`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `class WormBody` with `constructor(segments = 24)`, `update(dt: number, state: BehaviorState): void`, `readonly points: Vec3[]` (24 entries, metres), and `type BehaviorState = { state: 0|1|2|3; gain: number }`. Tasks 14 and 15 consume `points`.

- [ ] **Step 1: Write the failing test**

`web/src/test_body.ts`:

```ts
// Run: npx tsx src/test_body.ts
import { strict as assert } from "node:assert";
import { WormBody } from "./body.js";

function dist(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// THE invariant. A worm modelled as y = A*sin(x) stretches as it oscillates,
// and a stretching worm reads as wrong instantly. Curvature-then-integrate is
// the only thing that holds segment length fixed.
{
  const w = new WormBody(24);
  for (let i = 0; i < 2000; i++) w.update(1 / 60, { state: 1, gain: 1 });
  const seg = 1.0 / 24;
  for (let k = 1; k < w.points.length; k++) {
    const d = dist(w.points[k - 1], w.points[k]);
    assert.ok(Math.abs(d - seg) < seg * 0.05,
      `segment ${k} length ${d} drifted from ${seg} — body is stretching`);
  }
}

// Forward and reverse must actually move the worm in opposite directions along
// its own axis, or the classifier's output is invisible.
{
  const f = new WormBody(24);
  for (let i = 0; i < 600; i++) f.update(1 / 60, { state: 1, gain: 1 });
  const fwdTravel = dist(f.points[0], [0, 0, 0]);
  assert.ok(fwdTravel > 0.02, `forward barely moved: ${fwdTravel}`);

  const r = new WormBody(24);
  for (let i = 0; i < 600; i++) r.update(1 / 60, { state: 2, gain: 1 });
  assert.ok(dist(r.points[0], [0, 0, 0]) > 0.01, "reverse did not move");
  assert.ok(r.points[0][0] !== f.points[0][0], "forward and reverse identical");
}

// PAUSE must stop translation but keep the body coherent.
{
  const w = new WormBody(24);
  for (let i = 0; i < 300; i++) w.update(1 / 60, { state: 1, gain: 1 });
  const before = [...w.points[0]];
  for (let i = 0; i < 300; i++) w.update(1 / 60, { state: 0, gain: 0 });
  assert.ok(dist(w.points[0], before) < 0.005, "PAUSE still translating");
}

console.log("OK: body kinematics invariants hold");
```

- [ ] **Step 2: Scaffold and run it, watch it fail**

```bash
mkdir -p web/src && cd web
npm init -y && npm i -D typescript tsx && npm i three
npx tsx src/test_body.ts
```

Expected: `Cannot find module './body.js'`.

- [ ] **Step 3: Implement**

`web/src/body.ts`:

```ts
export type BehaviorState = { state: 0 | 1 | 2 | 3; gain: number };
type Vec3 = [number, number, number];

// Published C. elegans crawling kinematics on agar. EVERY value here is a
// tuning knob — final numbers come from holding the render next to real worm
// video. A model this simple cannot predict what the eye catches.
const L = 1.0;              // body length, mm
const FREQ_CRAWL = 0.45;    // Hz
const AMP = 0.13;           // rad per segment
const SPEED_FWD = 0.15;     // mm/s, ~0.45x wave speed; the rest is slip
const SPEED_REV = 0.12;
const TURN_GAIN = 2.2;
const OMEGA_SECONDS = 1.0;
const OMEGA_PEAK = 0.45;    // rad of ventral bias on the anterior third

export class WormBody {
  readonly points: Vec3[];
  private path: Vec3[] = [];
  private head: Vec3 = [0, 0, 0];
  private heading = 0;
  private phase = 0;
  private omegaT = 0;
  private readonly seg: number;

  constructor(private readonly segments = 24) {
    this.seg = L / segments;
    this.points = Array.from({ length: segments }, (_, k) =>
      [-k * this.seg, 0, 0] as Vec3);
    // Seed the path so segments have somewhere to sit on frame one.
    for (let k = 0; k < segments * 8; k++) this.path.push([-k * this.seg / 8, 0, 0]);
  }

  update(dt: number, b: BehaviorState): void {
    const gain = Math.max(0.2, Math.min(1.5, b.gain));
    const dir = b.state === 2 ? -1 : 1;
    const moving = b.state === 1 || b.state === 2;
    const speed = b.state === 1 ? SPEED_FWD : b.state === 2 ? SPEED_REV : 0;

    this.phase += 2 * Math.PI * FREQ_CRAWL * gain * dt * dir;

    // Omega turn: a scripted ventral bias, deterministic so replays line up.
    let bias = 0;
    if (b.state === 3) {
      this.omegaT = Math.min(this.omegaT + dt, OMEGA_SECONDS);
      const t = this.omegaT / OMEGA_SECONDS;
      bias = OMEGA_PEAK * (t < 0.4 ? t / 0.4 : t < 0.6 ? 1 : (1 - t) / 0.4);
    } else {
      this.omegaT = 0;
    }

    // Curvature first. Integrating it is what keeps the body inextensible.
    const bend = AMP * Math.sin(this.phase) + bias;
    this.heading += bend * TURN_GAIN * dt * (b.state === 3 ? 3 : 1);

    if (moving || b.state === 3) {
      const v = b.state === 3 ? SPEED_FWD * 0.15 : speed;
      this.head = [
        this.head[0] + Math.cos(this.heading) * v * dt,
        this.head[1] + Math.sin(this.heading) * v * dt,
        0,
      ];
      this.path.unshift([...this.head] as Vec3);
      if (this.path.length > 4000) this.path.pop();
    }

    // Segments trail the head at fixed arc length along the path it actually
    // travelled. This is where inextensibility, the travelling wave, and
    // realistic turning all come from at once.
    for (let k = 0; k < this.segments; k++) {
      this.points[k] = this.pointAtArcLength(k * this.seg);
    }
  }

  private pointAtArcLength(target: number): Vec3 {
    let acc = 0;
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1], b = this.path[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (acc + d >= target) {
        const t = d === 0 ? 0 : (target - acc) / d;
        return [a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t,
                a[2] + (b[2] - a[2]) * t];
      }
      acc += d;
    }
    return [...this.path[this.path.length - 1]] as Vec3;
  }
}
```

- [ ] **Step 4: Run the test**

```bash
cd web && npx tsx src/test_body.ts
```

Expected: `OK: body kinematics invariants hold`. A segment-length failure means the path ring buffer is too short for the body — raise the seed count in the constructor.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/src/body.ts web/src/test_body.ts
git commit -m "feat(web): follow-the-leader worm kinematics with inextensibility invariant"
```

---

### Task 14: 3D scene — worm, agar, brain, on mock data

**Files:**
- Create: `web/src/worm.ts`, `web/src/brain.ts`, `web/src/main.ts`, `web/index.html`

**Interfaces:**
- Consumes: `WormBody.points`, `data/positions.json`, `data/names.json`.
- Produces: `class WormMesh { update(points: Vec3[]): void }`, `class BrainCloud { setVoltages(mV: Int16Array): void; fireEdge(pre: number, post: number): void }`. Task 15 calls both from the chain stream.

- [ ] **Step 1: Write `web/src/worm.ts`**

```ts
import * as THREE from "three";

// Real worms crawl in 2D on agar. Rendering them swimming through an empty
// void would be LESS accurate, not more — the 3D lives in the scene and the
// orbiting camera, not in the locomotion.
export class WormMesh {
  readonly group = new THREE.Group();
  private mesh?: THREE.Mesh;
  private trail: THREE.Vector3[] = [];
  private trailLine: THREE.Line;

  constructor(private readonly scene: THREE.Scene) {
    const agar = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x1b2a25, roughness: 0.95 }));
    agar.rotation.x = -Math.PI / 2;
    agar.position.y = -0.02;
    scene.add(agar);

    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x3d5a50, transparent: true, opacity: 0.6 }));
    scene.add(this.trailLine);
    scene.add(this.group);
  }

  update(points: [number, number, number][]): void {
    const pts = points.map(p => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts);
    // Taper: thin at nose and tail, thickest mid-body. 0.08 * L max diameter.
    const geo = new THREE.TubeGeometry(curve, 96, 0.018, 10, false);
    const positions = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const t = (i / positions.count);
      const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.45;
      const c = curve.getPoint(Math.min(0.999, t));
      positions.setXYZ(i,
        c.x + (positions.getX(i) - c.x) * taper,
        c.y + (positions.getY(i) - c.y) * taper,
        c.z + (positions.getZ(i) - c.z) * taper);
    }
    positions.needsUpdate = true;

    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xd8cfa8, roughness: 0.4, transparent: true, opacity: 0.92 }));
    this.group.add(this.mesh);

    this.trail.push(pts[0].clone());
    if (this.trail.length > 900) this.trail.shift();
    this.trailLine.geometry.dispose();
    this.trailLine.geometry = new THREE.BufferGeometry().setFromPoints(this.trail);
  }
}
```

- [ ] **Step 2: Write `web/src/brain.ts`**

```ts
import * as THREE from "three";

const COLD = new THREE.Color(0x2b6cb0);  // -80 mV
const HOT  = new THREE.Color(0xe53e3e);  // +20 mV

export class BrainCloud {
  readonly group = new THREE.Group();
  private readonly nodes: THREE.InstancedMesh;
  private readonly colors: Float32Array;
  private readonly particles: { mesh: THREE.Mesh; t: number;
                                a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private readonly pos: THREE.Vector3[];

  constructor(scene: THREE.Scene,
              positions: [number, number, number][],
              private readonly names: string[],
              edges: [number, number][]) {
    // Real anatomical coordinates. NEVER a force-directed layout — that gives
    // a hairball that tells the viewer nothing.
    this.pos = positions.map(p =>
      new THREE.Vector3(p[0] * 3.2 - 1.6, 1.4 + p[1] * 0.32, p[2] * 0.32));

    this.nodes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.014, 8, 8),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      positions.length);
    const m = new THREE.Matrix4();
    this.colors = new Float32Array(positions.length * 3);
    this.pos.forEach((p, i) => {
      this.nodes.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      COLD.toArray(this.colors, i * 3);
    });
    this.nodes.instanceColor =
      new THREE.InstancedBufferAttribute(this.colors, 3);
    this.group.add(this.nodes);

    const lineGeo = new THREE.BufferGeometry().setFromPoints(
      edges.flatMap(([a, b]) => [this.pos[a], this.pos[b]]));
    this.group.add(new THREE.LineSegments(lineGeo,
      new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.16 })));

    scene.add(this.group);
  }

  setVoltages(mV: Int16Array): void {
    const c = new THREE.Color();
    for (let i = 0; i < mV.length; i++) {
      const t = Math.min(1, Math.max(0, (mV[i] + 80) / 100));
      c.copy(COLD).lerp(HOT, t).toArray(this.colors, i * 3);
    }
    (this.nodes.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  fireEdge(pre: number, post: number, excitatory = true): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 6),
      new THREE.MeshBasicMaterial({ color: excitatory ? 0xfbbf24 : 0x60a5fa }));
    this.group.add(mesh);
    this.particles.push({ mesh, t: 0, a: this.pos[pre], b: this.pos[post] });
  }

  tick(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt * 1.6;
      if (p.t >= 1) {
        this.group.remove(p.mesh); p.mesh.geometry.dispose();
        this.particles.splice(i, 1); continue;
      }
      p.mesh.position.lerpVectors(p.a, p.b, p.t);
    }
  }

  labelIndex(name: string): number { return this.names.indexOf(name); }
}
```

- [ ] **Step 3: Write `web/src/main.ts` with a mock driver**

```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WormBody, type BehaviorState } from "./body.js";
import { WormMesh } from "./worm.js";
import { BrainCloud } from "./brain.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(2, 4, 2); scene.add(key);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 2.2, 2.6);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
new OrbitControls(camera, renderer.domElement);

const positions = await (await fetch("/data/positions.json")).json();
const names: string[] = await (await fetch("/data/names.json")).json();
const edges: [number, number][] =
  await (await fetch("/data/edges.json")).json().catch(() => []);

const body = new WormBody(24);
const worm = new WormMesh(scene);
const brain = new BrainCloud(scene, positions, names, edges);

// MOCK driver. Task 15 replaces this with the chain stream; everything
// downstream of `behavior` is identical either way.
let behavior: BehaviorState = { state: 1, gain: 1 };
const mockV = new Int16Array(names.length).fill(-70);
document.getElementById("touch-head")!.onclick = () => {
  behavior = { state: 2, gain: 1.1 };
  setTimeout(() => (behavior = { state: 3, gain: 1 }), 2500);
  setTimeout(() => (behavior = { state: 1, gain: 1 }), 3500);
};
document.getElementById("touch-tail")!.onclick = () =>
  (behavior = { state: 1, gain: 1.2 });

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  body.update(dt, behavior);
  worm.update(body.points);
  brain.tick(dt);
  brain.setVoltages(mockV);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`web/index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>C. elegans on Thru</title>
<style>
  body { margin: 0; overflow: hidden; background: #0b0f14;
         font: 14px ui-monospace, monospace; color: #cbd5e1; }
  #ui { position: fixed; top: 16px; left: 16px; display: flex; gap: 8px; }
  button { padding: 10px 16px; background: #1e293b; color: #e2e8f0;
           border: 1px solid #334155; border-radius: 6px; cursor: pointer; }
  button:hover { background: #334155; }
  #feed { position: fixed; right: 16px; top: 16px; width: 320px; height: 60vh;
          overflow: hidden; font-size: 11px; line-height: 1.5; opacity: 0.85; }
</style></head>
<body>
  <div id="ui">
    <button id="touch-head">Touch head</button>
    <button id="touch-tail">Touch tail</button>
  </div>
  <div id="feed"></div>
  <script type="module" src="/src/main.ts"></script>
</body></html>
```

- [ ] **Step 4: Emit `data/edges.json` from the pipeline**

Append to `pipeline/pack.py`'s `build_all()`, before the return:

```python
    # Edge list for the front-end. Subsample to the strongest 1500 so the line
    # geometry stays legible rather than becoming a grey fog.
    ranked = sorted(range(len(c.chem)), key=lambda e: -c.chem[e][2])[:1500]
    (DATA / "edges.json").write_text(
        json.dumps([[c.chem[e][0], c.chem[e][1]] for e in ranked]))
```

- [ ] **Step 5: Run it**

```bash
cd web && npm i -D vite && npx vite --open
```

Expected: an orbitable 3D scene with an agar plane, a tapered worm undulating forward, a worm-shaped point cloud of 302 nodes above it, and two working buttons. Head-touch should visibly reverse, omega-turn, then resume forward.

- [ ] **Step 6: Tune the gait against real video**

Open any *C. elegans* crawling video beside the render. Adjust `FREQ_CRAWL`, `AMP`, and `SPEED_FWD` in `body.ts` until it stops looking wrong. This is a by-eye step and it is the only way — a model this simple cannot predict what the eye catches. Commit the tuned values with a one-line note on what you compared against.

- [ ] **Step 7: Commit**

```bash
git add web/ pipeline/pack.py data/edges.json
git commit -m "feat(web): 3D scene with tapered worm, agar, trail, and anatomical brain cloud"
```

---

### Task 15: Wire the front-end to the chain

**Files:**
- Create: `web/src/chain.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `BehaviorState`, `BrainCloud`, the deployed program.
- Produces: `class ChainFeed` with `onFrame(cb: (mV: Int16Array) => void)`, `onBehavior(cb: (b: BehaviorState) => void)`, `onTransfer(cb: (pre: number, post: number) => void)`, `touchHead()`, `touchTail()`.

- [ ] **Step 1: Write `web/src/chain.ts`**

```ts
import { createThruClient } from "@thru/sdk/client";
import type { BehaviorState } from "./body.js";

const RPC = import.meta.env.VITE_THRU_RPC ?? "https://rpc.alphanet.thru.org";

// The whole brain->body interface is 32 bytes of BehaviorState plus a 612-byte
// trace event per frame. Streaming events beats polling 302 accounts by every
// measure that matters here.
export class ChainFeed {
  private thru = createThruClient({ baseUrl: RPC });
  private frameCbs: ((mV: Int16Array) => void)[] = [];
  private behaviorCbs: ((b: BehaviorState) => void)[] = [];
  private transferCbs: ((pre: number, post: number) => void)[] = [];

  constructor(private readonly programId: string,
              private readonly behaviorAccount: string,
              private readonly neuronAddresses: string[]) {}

  onFrame(cb: (mV: Int16Array) => void) { this.frameCbs.push(cb); }
  onBehavior(cb: (b: BehaviorState) => void) { this.behaviorCbs.push(cb); }
  onTransfer(cb: (pre: number, post: number) => void) { this.transferCbs.push(cb); }

  async start(): Promise<void> {
    const addrIndex = new Map(this.neuronAddresses.map((a, i) => [a, i]));

    // Trace events: 302 int16 millivolts + an 8-byte tail.
    void (async () => {
      for await (const ev of this.thru.streaming.streamEvents({})) {
        const data = ev.data as Uint8Array;
        if (data.byteLength !== 302 * 2 + 8) continue;
        const mV = new Int16Array(data.buffer, data.byteOffset, 302);
        this.frameCbs.forEach(cb => cb(mV));
      }
    })();

    // Transfers: one particle per settled synapse.
    void (async () => {
      for await (const tx of this.thru.streaming.streamTransactions({})) {
        for (const t of tx.transfers ?? []) {
          const pre = addrIndex.get(t.from), post = addrIndex.get(t.to);
          if (pre !== undefined && post !== undefined) {
            this.transferCbs.forEach(cb => cb(pre, post));
          }
        }
        this.appendFeed(tx.signature);
      }
    })();

    // BehaviorState: poll the one account. 32 bytes, 4 Hz, not worth streaming.
    setInterval(async () => {
      const acc = await this.thru.accounts.get(this.behaviorAccount);
      const d = new DataView((acc.data as Uint8Array).buffer);
      this.behaviorCbs.forEach(cb => cb({
        state: d.getUint8(0) as 0 | 1 | 2 | 3,
        gain: d.getInt32(4, true) / 65536,
      }));
    }, 250);
  }

  private appendFeed(sig: string): void {
    const feed = document.getElementById("feed");
    if (!feed) return;
    const row = document.createElement("div");
    const a = document.createElement("a");
    a.href = `https://scan.thru.org/tx/${sig}`;
    a.target = "_blank";
    a.textContent = sig.slice(0, 24) + "...";
    a.style.color = "#7dd3fc";
    row.appendChild(a);
    feed.prepend(row);
    while (feed.childElementCount > 40) feed.lastElementChild?.remove();
  }

  // Touch buttons submit a real stimulate transaction, then a step batch.
  async touchHead(): Promise<void> { await this.stimulate("ALML"); }
  async touchTail(): Promise<void> { await this.stimulate("PLML"); }

  private async stimulate(_name: string): Promise<void> {
    // The demo drives stimulate + step from a small local relay rather than
    // signing in the browser — the fee payer key stays off the client.
    await fetch("/api/touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ neuron: _name }),
    });
  }
}
```

- [ ] **Step 2: Write the relay**

`web/relay.mjs` — keeps the fee-payer key off the browser:

```js
import { createServer } from "node:http";
import { execFile } from "node:child_process";

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/touch") {
    res.writeHead(404).end(); return;
  }
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    const { neuron } = JSON.parse(body);
    if (!/^[A-Z]{2,4}[LRVD]?[0-9]{0,2}$/.test(neuron)) {
      res.writeHead(400).end("bad neuron name"); return;   // trust boundary
    }
    execFile("python", ["-c",
      `from pipeline.deploy import stimulate, run_steps, classify;` +
      `stimulate(${JSON.stringify(neuron)}, 40.0); run_steps(100, settle_every=20, emit=True); classify()`],
      { cwd: "..", timeout: 60000 },
      (err, out) => {
        res.writeHead(err ? 500 : 200).end(err ? String(err) : out);
      });
  });
}).listen(8787, () => console.log("relay on :8787"));
```

- [ ] **Step 3: Swap the mock driver in `main.ts`**

Replace the mock block with:

```ts
import { ChainFeed } from "./chain.js";

const addresses: string[] = await (await fetch("/data/addresses.json")).json();
const cfg = await (await fetch("/data/chain.json")).json();
const feed = new ChainFeed(cfg.programId, cfg.behaviorAccount, addresses);

let behavior: BehaviorState = { state: 1, gain: 1 };
let voltages = new Int16Array(names.length).fill(-70);

feed.onBehavior(b => (behavior = b));
feed.onFrame(mV => (voltages = mV));
feed.onTransfer((pre, post) => brain.fireEdge(pre, post));
await feed.start();

document.getElementById("touch-head")!.onclick = () => feed.touchHead();
document.getElementById("touch-tail")!.onclick = () => feed.touchTail();
```

and in the render loop replace `brain.setVoltages(mockV)` with `brain.setVoltages(voltages)`.

Emit `data/chain.json` from `pipeline/deploy.py`:

```python
def write_chain_config() -> None:
    (DATA / "chain.json").write_text(json.dumps({
        "programId": _program_id(),
        "behaviorAccount": _behavior_account(),
        "reservoirAccount": _reservoir_account(),
        "topologyAccount": _topology_account(),
    }))
```

- [ ] **Step 4: Run the whole stack**

```bash
python -c "from pipeline.deploy import write_chain_config; write_chain_config()"
cd web && node relay.mjs &
npx vite --open
```

Expected: click **Touch head** → transaction signatures scroll into the feed, particles run along edges into AVA, AVA's node reddens, and the worm reverses, omega-turns, and resumes forward. Click a signature and `scan.thru.org` shows the decoded instruction (this is why Task 12 Step 5 published the ABI).

- [ ] **Step 5: Commit**

```bash
git add web/src/chain.ts web/src/main.ts web/relay.mjs pipeline/deploy.py
git commit -m "feat(web): live chain wiring via event stream, transfer particles, signature feed"
```

---

## Track D — Integration

### Task 16: Full-animal benchmark run and the README

**Files:**
- Create: `README.md`
- Create: `scripts/benchmark.py`

**Interfaces:**
- Consumes: everything.
- Produces: `data/benchmark.json` with the recorded run, and a README stating every caveat.

- [ ] **Step 1: Write the benchmark script**

`scripts/benchmark.py`:

```python
"""Records one full-animal run with real signatures. This is the flex: all 302
neurons, every synapse, on chain. Not live — recorded, and the README says so."""
import json, time
from pathlib import Path
from pipeline.deploy import reset_sim, stimulate, run_steps, classify, read_behavior

DATA = Path(__file__).resolve().parent.parent / "data"
STEPS_PER_TX = 100   # from docs/measurements.md

def main() -> None:
    reset_sim()
    stimulate("ALML", 40.0)
    frames, sigs = [], []
    t0 = time.time()
    for batch in range(20):
        out = run_steps(STEPS_PER_TX, settle_every=20, emit=True)
        sigs.append(out.splitlines()[0])
        classify()
        frames.append(read_behavior())
    wall = time.time() - t0
    sim_ms = 20 * STEPS_PER_TX * 5
    result = {
        "neurons": 302, "steps": 20 * STEPS_PER_TX, "dt_ms": 5,
        "sim_time_ms": sim_ms, "wall_seconds": round(wall, 2),
        "realtime_ratio": round(sim_ms / 1000 / wall, 3),
        "signatures": sigs, "behavior_trace": frames,
    }
    (DATA / "benchmark.json").write_text(json.dumps(result, indent=2))
    print(f"{sim_ms/1000:.1f}s of worm in {wall:.1f}s wall "
          f"({result['realtime_ratio']}x real time)")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
python scripts/benchmark.py
```

Expected: a printed ratio and `data/benchmark.json` with 20 real signatures. Whatever the ratio is, it is the honest number — slower than real time is fine and is what the README quotes.

- [ ] **Step 3: Write the README**

Cover, in this order: what it is; the three layers; **the caveats, unhedged** — that synaptic sign is assigned from neurotransmitter identity rather than measured, that conductances are a contact-count proxy, that locomotion is classifier-driven and not emergent, that intervening timesteps update account data while transfers settle every 20 steps, and the measured real-time ratio; then the verification chain (numpy → fixed python → native C → ThruVM, each bit-for-bit); then how to reproduce. Link `data/provenance.json` and `docs/measurements.md`.

Pull the caveat text from `data/provenance.json` so it cannot drift from what the pipeline actually did.

- [ ] **Step 4: Run every test one final time**

```bash
python -m pytest pipeline/ -v
cd program && gcc -O0 -g -I. native_test.c sim.c -o /tmp/nt && /tmp/nt
cd ../web && npx tsx src/test_body.ts
cd .. && python -m pytest pipeline/test_chain.py -v -m chain
```

Expected: every suite green. Record the actual counts in the README's validation section — "tests pass" is not validation.

- [ ] **Step 5: Rehearse the demo twice, end to end**

Fresh browser, cold relay, click both buttons, open a signature in the explorer. Time it. If it exceeds 90 seconds, cut something.

- [ ] **Step 6: Commit**

```bash
git add README.md scripts/benchmark.py data/benchmark.json
git commit -m "docs: full-animal benchmark run, caveats, and reproduction instructions"
```

---

## Schedule mapping

Tasks map onto the spec's 48-hour budget. Tracks A, B and C run in parallel after the Task 1 gate.

| Hours | Chain | Data | Front-end |
|---|---|---|---|
| 0–4 | **Task 1 (gate)** | Task 2 | Task 13 |
| 4–10 | Task 8 | Tasks 3, 4 | Task 13 |
| 10–16 | Task 9 | Tasks 5, 6 | Task 14 |
| 16–24 | Task 10 | Task 7 | Task 14 |
| 24–30 | Task 11 | assist Task 12 | Task 15 |
| 30–36 | Task 12 | assist Task 12 | Task 15 |
| 36–44 | Task 16 | Task 16 | gait tuning, polish |
| 44–48 | Buffer — it will be consumed | | |

Task 1 blocks everything. Task 5 blocks Tasks 6, 8, 14. Task 8 blocks Task 10. Task 9 blocks Task 10. Task 12 blocks Task 15's behavior wiring, though Task 15 can be built against the mock driver first.

## If you fall behind

Cut in this order. Each line keeps the demo intact.

1. Drop the swim gait. Crawl only.
2. Drop the omega turn. `REVERSE → FORWARD` still reads correctly.
3. Drop chemical settlement entirely; gap junctions alone carry the transfer claim, and they are the conservative half, which is the better story anyway.
4. Drop live stepping; run from `data/benchmark.json` as a recorded replay. The spec anticipates this — the front-end reads the same shapes either way.
5. Give individual accounts to only the 15 demo-circuit cells and keep the other 287 in one bulk account. The visual is identical because that is the circuit being demoed, transaction volume drops 20×, and "every neuron is simulated on-chain, fifteen of them individually addressable" is still true.

**Never cut:** the verification chain in Tasks 6–8, the behavioral regression test in Task 12, or the README caveats. Those are what make the claim checkable, and checkable is the entire pitch.
