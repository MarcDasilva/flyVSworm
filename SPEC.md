# On-Chain C. elegans on Thru — Specification

**The claim:** the complete 302-neuron nervous system of *C. elegans* runs on Thru, where
every neuron is its own account, membrane voltage is that account's balance, and synaptic
transmission settles as real `tsys_account_transfer` calls between them. A classifier reads
the command interneurons and decides what the worm does. A kinematic body renders that
decision in 3D.

**What is NOT claimed:** that locomotion emerges from the connectome. It doesn't, for
anyone. The brain classifies; the body animates. The seam is stated out loud.

> Every chain parameter below is sourced from Thru's own docs (`llms-full.txt`, v0.2.27).
> Thru is **not** Solana — no PDAs-as-signers, no SPL, no address lookup tables, no
> `lamports`. Four numbers in §8 remain genuinely unmeasured and are marked as such.

---

## 1. What Thru actually gives us

These five facts rewrote the design. Every one is from the spec, not assumed.

| Fact | Source | Consequence |
|---|---|---|
| **1,024 accounts per transaction**, 32 KiB max tx size | Transaction · Limitations | All 302 neurons fit in **one** transaction. No batched-accumulate scheme needed. 302 × 32 B = 9.7 KiB of addresses, well inside 32 KiB. |
| **ISA is RV64I + M + C + B + Zknh — no F, no D** | ISA spec | Fixed point isn't a defensive choice, it's **the only choice**. There is no float in the VM. |
| **CU cost is by instruction *size*, not latency**: 4 CU per 32-bit instr, 2 CU per compressed, +1 CU per byte accessed | Resources · Compute Units | `divu` costs the same 4 CU as `add`. Backward Euler's division is free relative to forward Euler — the last argument for forward Euler evaporates. |
| **Page fault = 4,096 CU**; CoW = 1 MU per 4 KB account page first written | Resources | Touching 302 accounts costs ~1.24M CU in faults, paid **once per transaction**. Amortizes to nothing over 100 timesteps. |
| **`tsys_account_transfer` is a flat 512 CU syscall** on native balance | Syscall 0x03 | Real transfers, no CPI, no token program. 1,400 gap junctions = 716,800 CU. |

Two traps that will cost a night each if missed:

- **Unaligned access raises an exception.** ThruVM enforces strict alignment. `__attribute__((packed))` is correct for *instruction data* (parsed byte-wise) and **wrong** for the hot account data.
- **A single memory access must not span a 4 KB page boundary.** Reading 8 bytes at offset 4093 faults. Both traps vanish under one rule — see §2.2.

---

## 2. Layer 1 — the brain

### 2.1 Account model

**`Topology`** — one account, written once, read-only thereafter. Well under the 16 MB
(`TSDK_ACCOUNT_DATA_SZ_MAX`) cap; also under the 16 MB per-segment addressing limit
(24-bit offset field).

| Field | Type | Bytes |
|---|---|---|
| `magic`, `version`, `n_neurons`, `n_edges` | u32 × 4 | 16 |
| `acct_slot_to_neuron` | u16[302] | 604 |
| `chem_rowptr` | u16[303] | 606 |
| `chem_col` | u16[7000] | 14,000 |
| `chem_g` | i16[7000] | 14,000 |
| `chem_E` | i16[7000] | 14,000 |
| `gap_rowptr` | u16[303] | 606 |
| `gap_col` | u16[2800] | 5,600 |
| `gap_g` | i16[2800] | 5,600 |
| `neuron_param` | struct[302] | 3,624 |
| `sigmoid_lut` | i32[257] | 1,028 |
| **total (with padding)** | | **~60 KB = 15 pages** |

Gap junctions are stored in both directions (1,400 anatomical → 2,800 rows) so the inner
loop is uniform.

**`Neuron`** — 302 accounts, created via `tsys_account_create` with a 32-byte seed derived
from the neuron name. Data is 32 bytes; **voltage lives in the account's native balance**,
not in its data.

| Field | Type | Notes |
|---|---|---|
| `index` | u16 | dense index into Topology |
| `name` | char[8] | `"AVAL"` — so the explorer is readable |
| `v_next` | i32 | Q16.16 double-buffer target |
| `i_stim` | i32 | injected current from `stimulate` |
| `step_tag` | u32 | guards against a stale write landing after a flip |
| `_pad` | | to 32 B, 8-byte aligned |

**Balance ↔ voltage.** Native balance is `uint64` and a transfer cannot make it negative
(`INSUFFICIENT_BALANCE`, −38). Biological voltage is negative. So:

```
balance = (V_mV + 100) * 1000       # -80..+20 mV  →  20,000..120,000 units
```

Every neuron is seeded with 20,000 units of headroom below resting potential, which is
what makes hyperpolarizing transfers safe. The program clamps to `[1000, 200000]` before
every transfer.

**`Reservoir`** — one account. The extracellular medium. Chemical synapses transfer
to/from it, which is biologically right: a chemical synapse gates a conductance, so the
presynaptic cell does not lose what the postsynaptic gains. Gap junctions transfer
neuron↔neuron directly, because they *are* conservative. **The two synapse types in a
nervous system have different conservation properties, and the two ledger operations have
the matching ones.** That correspondence is real, not decorative.

**`BehaviorState`** — one account, 32 bytes. Written by L2, streamed to the front-end.

Step-transaction account list: 302 neurons + reservoir + behavior state (read-write),
topology (read-only), plus fee payer at index 0 and program at index 1 = **307 accounts**,
against a limit of 1,024.

> **Trap.** Thru sorts the writable account array **ascending by address**, so account
> index ≠ neuron index. Neuron addresses are deterministic (seed-derived), so compute the
> permutation offline once and ship it in `Topology.acct_slot_to_neuron`. Free at runtime.
> Derive addresses with `thru program derive-address <program_id> <seed>`.

### 2.2 Layout rule that defeats both memory traps

**8-byte-align the start of every array in `Topology`, and use naturally-aligned accesses.**

That's it. A 4 KB page boundary is a multiple of 8, so an 8-byte-aligned array of 2-, 4-,
or 8-byte elements can never have an element straddling a page boundary, and no access is
ever unaligned. The packing script emits explicit padding between arrays and asserts every
offset is `≡ 0 mod 8` before writing the file. One assert, both traps gone.

### 2.3 The numerical model

Graded-potential formulation (Wicks, Roehrig & Rankin 1996 — itself a model of the
tap-withdrawal circuit, i.e. exactly what we demo). Most *C. elegans* neurons do not spike;
they transmit by graded potential. No spike detection, no refractory periods, no threshold
tuning.

**Pass 1 — precompute activations (302 iterations):**

```
s[j] = sigmoid_lut_interp((V[j] - V_half[j]) * recip_k[j])
```

> This pass is the single biggest optimization in the program. `s` depends only on the
> presynaptic neuron, so evaluating it **per neuron** instead of per edge turns 7,000
> sigmoid evaluations into 302. Worth ~570,000 CU per timestep — roughly half the total.

**Pass 2 — accumulate (9,800 iterations):**

```
g_total  = g_leak[i]
gE_total = g_leak[i]*E_leak[i] + i_stim[i]

chemical (j→i):  g = chem_g[e] * s[j]
                 g_total += g ;  gE_total += g * chem_E[e]

gap (j↔i):       g_total += gap_g[e] ;  gE_total += gap_g[e] * V[j]
```

A gap junction `g·(V_i − V_j)` is algebraically a conductance `g` with reversal potential
`V_j`, so it folds into the same accumulator. No second code path.

**Pass 3 — solve (302 iterations), backward Euler:**

```
V_next[i] = (C[i]*V[i] + dt*gE_total) / (C[i] + dt*g_total)
```

Unconditionally stable, so `dt = 5 ms` instead of 0.5 ms — a 10× cut in work — and it
cannot blow up when a conductance is mistuned, which it will be during tuning. One `divu`
per **neuron**, not per synapse, and on Thru that `divu` costs 4 CU, same as an add.

### 2.4 Fixed point

Mandatory: ThruVM has no F or D extension.

- Voltages: **Q16.16 signed**, mV. Range ±32,768 mV against a biological ±100 mV. No overflow risk.
- Conductances / reversal potentials: Q8.8 in storage, widened on load.
- Accumulators: **i64**. AVA has 300+ incoming edges; with Q16.16 products, i32 overflows and i64 does not. This line is a bug you don't have to find.
- Sigmoid: 257-entry i32 LUT over ±8, linear interpolation. Deterministic, no transcendentals, ~60 CU.
- Division: `((num as i64) << 16) / den`, saturating-narrow to i32.

### 2.5 Instruction set

| Instruction | Accounts | Effect |
|---|---|---|
| `upload_chunk(offset, bytes)` | Topology (w) | ~30 writes at ~2 KB (32 KiB tx limit) to load the connectome; verifies SHA-256 on the last chunk |
| `create_neurons(batch)` | Neuron × N (w) | `tsys_account_create` + `tsys_account_resize(32)`; ~30 per tx, proof-size bound |
| `stimulate(neuron, current, steps)` | Neuron (w) | sets `i_stim` on a sensory cell |
| `step(n, flags)` | Topology (r), Neuron × 302 (w), Reservoir (w) | runs `n` timesteps; optionally settles transfers and emits a trace event |
| `classify()` | Neuron × 5 (r), BehaviorState (w) | L2, see §3 |

`step` is the whole simulation. Page faults are paid once at entry and amortize across all
`n` timesteps, which is why the per-neuron-account design is affordable at all.

`step_tag` prevents the classic double-buffer bug where a stale write lands after a flip.
Mismatched tag → `tsdk_revert`, not silent corruption.

### 2.6 Compute budget — the real numbers

Derived from Thru's published CU model (4 CU per 32-bit instruction, 2 CU compressed, 1 CU
per byte accessed).

| Component | Per timestep |
|---|---|
| Sigmoid precompute (302 × ~60 CU) | 18,120 |
| Chemical edges (7,000 × ~60 CU) | 420,000 |
| Gap edges (2,800 × ~46 CU) | 128,800 |
| Neuron solve (302 × ~80 CU) | 24,160 |
| Buffer flip (302 × 16 CU) | 4,832 |
| **Arithmetic subtotal** | **~596,000 CU** |

Per-transaction fixed costs:

| Component | Per transaction |
|---|---|
| Page faults, 302 neuron accounts (302 × 4,096) | 1,236,992 |
| Page faults, Topology (15 pages) | 61,440 |
| **Fault subtotal** | **~1.30M CU** |

**A `step(n)` transaction costs ≈ 1.30M + n × 0.60M CU.**

| Steps/tx | CU | Sim time @ dt=5ms | Fault overhead |
|---|---|---|---|
| 1 | 1.9M | 5 ms | 68% |
| 10 | 7.3M | 50 ms | 18% |
| 50 | 31M | 250 ms | 4% |
| 100 | 61M | 500 ms | 2% |
| 200 | 121M | 1.0 s | 1% |

`req_compute_units` is a `uint32`, capping any single transaction at 4,294,967,295 CU —
about 7,000 timesteps, or 35 seconds of worm life. The binding constraint is therefore
**`block.header.max_compute_units`** (a `uint64`, set per block), which is measurement #1
in §8. At 100 steps/tx and one such transaction per block, the worm runs at **500 ms of
biological time per block**.

**Memory units.** 302 CoW pages + ~4 stack/heap + ~2 event = ~308 MU, against a `uint16`
cap of 65,535. Not close. `req_state_units` is 0 during stepping (no account resizes); it
is non-zero only during setup.

**Compile for compressed instructions.** Compressed 16-bit instructions cost 2 CU against
4 CU for 32-bit. Build `-Os -march=rv64imc_zba_zbb` and the inner loops shrink materially —
Thru's own docs flag this as the primary CU optimization. The B extension's `sh1add`/
`sh2add` also save an instruction per array index, and the inner loop is nothing but array
indexing.

### 2.7 Real transfers — the wallet claim, priced

Synaptic settlement runs every `SETTLE_EVERY` timesteps inside `step`. Each
`tsys_account_transfer` is a flat 512 CU with no CPI and no token program.

| Settlement scope | Transfers | CU per settlement | Amortized @ every 20 steps |
|---|---|---|---|
| Gap junctions only (1,400) | 1,400 | 716,800 | 35,840 CU/step — **+6%** |
| Chemical only (7,000, via Reservoir) | 7,000 | 3,584,000 | 179,200 CU/step — **+30%** |
| Everything (8,400) | 8,400 | 4,300,800 | 215,040 CU/step — **+36%** |
| Demo circuit only (~40) | 40 | 20,480 | 1,024 CU/step — **+0.2%** |

**Default: settle all 1,400 gap junctions plus the demo circuit's chemical synapses, every
20 steps.** That is +6% CU for a fully real, explorer-visible transaction trail on the
conservative-by-physics half of the connectome, plus every edge the demo actually
highlights. Full chemical settlement is a flag; turn it on for the benchmark run.

The README says exactly this: which edges settle as transfers, at what interval, and that
the intervening timesteps update `v_next` in account data rather than balance. Stating it
is stronger than blurring it.

### 2.8 Front-end trace via events

`tsys_emit_event` costs `512 + data_sz` CU. One event per emitted frame carrying 302
voltages as i16 (Q8.8 mV) = 604 bytes → **1,116 CU**. Emit every 4th timestep and the
overhead is 0.05%.

This is how the front-end gets a dense voltage trace — streaming one event beats reading
302 accounts by any measure. Consume via `StreamingService/StreamEvents` (gRPC-Web in the
browser), with `StreamAccountUpdates` for balances and `StreamTransactions` for the
signature feed.

---

## 3. Layer 2 — the classifier

### 3.1 Why this is principled

The command interneurons **are** the worm's behavioral classifier. That is their documented
function: AVA/AVD/AVE drive backward locomotion, AVB/PVC drive forward. Reading them and
taking the winner is not a hack bolted onto the biology — it is where the biology puts the
decision. Motor neurons downstream execute; command interneurons choose.

### 3.2 Definition

```
d(n) = clamp((V[n] - E_leak[n]) / 20mV, 0, 1)

drive_rev = 0.5*d(AVA) + 0.3*d(AVD) + 0.2*d(AVE)
drive_fwd = 0.6*d(AVB) + 0.4*d(PVC)
```

Weights come from known circuit dominance (AVA is the principal reversal command cell, AVB
the principal forward one), not from fitting. Fitting would need training data that does
not exist.

### 3.3 State machine

```
THRESH_ON   = 0.35
THRESH_OFF  = 0.20      # hysteresis band
DWELL_MIN   = 300 ms    # 60 steps at dt=5ms
OMEGA_HOLD  = 800 ms
```

| From | Condition | To |
|---|---|---|
| any | `drive_rev > THRESH_ON` and `> drive_fwd`, dwell satisfied | `REVERSE` |
| any | `drive_fwd > THRESH_ON` and `> drive_rev`, dwell satisfied | `FORWARD` |
| `REVERSE` | held ≥ `OMEGA_HOLD`, then `drive_rev < THRESH_OFF` | `OMEGA` |
| `OMEGA` | animation complete (1.0 s) | `FORWARD` |
| any | both drives `< THRESH_OFF` for ≥ `DWELL_MIN` | `PAUSE` |

Hysteresis and dwell are not polish. A bare argmax flickers at the crossover, and a
flickering worm reads as broken.

The `REVERSE → OMEGA → FORWARD` chain is real behavior: a worm that reverses after a head
touch usually terminates the reversal with an omega turn and departs on a new heading.
Getting that sequence right is worth more to a watching biologist than anything else in the
demo.

### 3.4 Output

`BehaviorState`, 32 bytes, rewritten every 20 timesteps (100 ms sim time, far faster than
behavior changes):

```
state       u8    # 0=PAUSE 1=FORWARD 2=REVERSE 3=OMEGA
gain        i32   # Q16.16, winning drive → undulation frequency
drive_fwd   i32   # Q16.16, for the UI
drive_rev   i32
entered_at  u32   # step index, front-end uses this for phase continuity
step        u32
block_time  u64   # from BLOCK_CTX, Unix ns — drives the replay clock
```

`block_time` comes free from ThruVM's `BLOCK_CTX` segment (offset `0x08`, Unix nanoseconds),
which also exposes a 512-block rolling history at 4 KB stride. The front-end uses it to pace
replay against real chain time rather than guessing.

The entire brain→body interface is these 32 bytes.

---

## 4. Layer 3 — the body

Off-chain TypeScript. It must look right, and looking right is a kinematics problem, not a
physics problem. Do not attempt physics.

### 4.1 Segments

24 segments — anatomically motivated: the 95 body-wall muscles sit in four quadrants
(dorsal-left/right, ventral-left/right) of roughly 24 rows each.

### 4.2 Follow-the-leader kinematics

**Model curvature, then integrate to get position. Never write `y = A·sin(x)` directly.**
A sine curve stretches as it oscillates, and a stretching worm reads as wrong instantly
even to someone who has never seen a nematode. This is the single choice that separates a
convincing worm from a wiggling line.

```
phase    += 2π * f * dt * direction     # +1 forward, -1 reverse
head_bend = A * sin(phase)
heading  += head_bend * dt * TURN_GAIN
head_pos += heading_vector * speed * dt
path.unshift(head_pos)                  # ring buffer of head positions

for k in 1..23:
    segment[k] = point_on_path_at_arclength(k * L/24)
```

Gives you for free: an inextensible body, a travelling wave (the path itself carries the
history of head bends), and realistic turning. About 30 lines. Reversal is the same code
with the tail leading.

**Wave direction.** Forward: the wave travels head → tail. Backward: tail → head. This
falls out of which end leads — which is why follow-the-leader is correct rather than
convenient.

### 4.3 Gait constants

Seeded from published *C. elegans* crawling kinematics. **Every one is a tuning knob.**
Final values come from holding the render beside real worm video and adjusting until it
stops looking wrong; a model this simple cannot predict what the eye catches.

| Parameter | Crawl (agar) | Swim (liquid) |
|---|---|---|
| Body length `L` | 1.0 mm | 1.0 mm |
| Frequency `f` | 0.45 Hz | 1.8 Hz |
| Wavelength `λ` | 0.65 L (~1.5 waves on the body) | 1.5 L (a long C-shape) |
| Bend amplitude `A` | 0.13 rad/segment | 0.20 rad/segment |
| Forward speed | 0.15 mm/s (≈0.45 × wave speed; rest is slip) | 0.35 mm/s |
| Reverse speed | 0.12 mm/s | — |
| Max diameter | 0.08 L, tapered at nose and tail | same |

`gain` from L2 scales `f`. Default to crawl; swim is a toggle, not a state.

### 4.4 Omega turn

A scripted 1.0 s animation, not an emergent one. Ramp a ventral bias onto the anterior
third (to ~0.45 rad over 400 ms, hold 200 ms, release over 400 ms) with forward speed near
zero. The head sweeps toward the tail, the body forms the Ω, the worm departs rotated
130–180°. Take the new heading from accumulated bend, not from a random number, so replays
are deterministic.

### 4.5 Rendering

- **Substrate.** A textured plane (agar). Real worms crawl in 2D; making it swim through an empty void would be less accurate, not more. The 3D is in the scene and the orbiting camera.
- **Body.** `TubeGeometry` over a Catmull-Rom curve through the 24 points, radius tapered. Rebuilt per frame; 24 control points is nothing.
- **Track.** A fading trail on the agar. Cheap, and it makes reversals and omega turns legible at a glance.

### 4.6 Brain visualization

- **Positions.** Real anatomical coordinates from OpenWorm. Fallback if that file fights back: anterior-posterior position from the WormAtlas cell list × ganglion grouping for lateral offset + deterministic jitter. Either way the result is worm-shaped — nerve ring at the head, ventral cord down the body, tail ganglion. **Never a force-directed layout**; it produces a hairball that tells the viewer nothing.
- **Nodes.** 302 spheres coloured by voltage (blue −80 mV → red +20 mV). Label AVA, AVB, ALM, PLM, AVD, PVC.
- **Edges.** Static thin lines for the connectome; a particle animates along an edge when its transfer settles, coloured by sign.
- **Feed.** `StreamTransactions` drives a scrolling panel of real signatures, each clickable through to `scan.thru.org`. The Explorer MCP server (`https://scan.thru.org/api/mcp`) is also live, which means a judge can point an agent at the chain and verify the claim independently.

At 1/20th playback you watch one touch propagate: ALM lights, particles run into AVA, AVA's
colour climbs, A-class motor neurons follow, `BehaviorState` flips to `REVERSE`, and *then*
the worm backs up. Slow motion is a feature — at biological speed it's a blur.

---

## 5. Data pipeline (offline, Python)

Runs before the clock starts; output is committed so nothing depends on a website being up
during the event.

1. **Source.** Cook et al. 2019 matrices (WormWiring), or the connectome CSVs in OpenWorm's `c302` repo — permissively licensed, already cleaned. Prefer c302; cross-check totals against Cook (≈7,000 chemical, ≈1,400 gap, 302 neurons).
2. **Name remap.** Canonical names → dense indices 0–301. Emit `names.json`. Keep left/right pairs (`AVAL`/`AVAR`) distinct — do not merge.
3. **Sign assignment.** The connectome gives connectivity, not sign. Assign `E_syn` from neurotransmitter identity: ACh and glutamate → excitatory (`E = 0 mV`), GABA → inhibitory (`E = −70 mV`). Unknown defaults excitatory and is logged to `provenance.json`. **This is an assumption, not data — say so in the README.**
4. **Conductances.** Uniform default scaled by synapse count (the connectome's edge weight is the number of synaptic contacts — a reasonable proxy). Hand-tune only the ~15 demo cells. Do not attempt to tune 7,000.
5. **Addresses.** Derive all 302 account addresses from name seeds, sort ascending, emit `acct_slot_to_neuron`. This is the permutation from §2.1 and it must be regenerated if the program ID changes.
6. **Pack.** CSR → the §2.1 layout, **asserting every array offset is `≡ 0 mod 8`** (§2.2). Emit `topology.bin` + SHA-256 for on-chain verification.
7. **Positions.** `positions.json` for the front-end.

---

## 6. Verification

Non-negotiable. When the worm goes silent on Sunday morning, this is the only thing that
tells you whether the bug is in your fixed-point math or in the VM.

1. **NumPy reference.** Float64, same model, same dt. Written first.
2. **Fixed-point reference.** Same Python, Q16.16 integer math mirroring the C exactly. Assert it tracks the float version within 0.1 mV over 2,000 steps.
3. **C simulator, native build.** Assert **bit-for-bit** against (2) for all 302 neurons at every step.
4. **On-chain.** Same stimulus, read back all 302 balances, assert bit-for-bit against (3). Use `thru debug` re-execution when it disagrees.

Each stage compares only against the previous one, so a failure localizes immediately.

**Runnable behavioral check.** Stimulate ALM, step 400, assert `BehaviorState.state ==
REVERSE`. Stimulate PLM, step 400, assert `FORWARD`. If the circuit or classifier breaks,
this fails. Everything else can be eyeballed.

---

## 7. Setup commands

```bash
npm i -g thru                     # v0.2.27; docs warn the install flow changes pre-1.0
thru dev toolchain install        # RISC-V toolchain → ~/.thru/sdk/toolchain/
thru dev sdk install c            # C SDK → ~/.thru/sdk/c/
thru keys generate worm
thru account create worm
thru faucet withdraw worm 100000  # fund it; writes fail without balance
thru --json getversion            # confirms you can reach rpc.alphanet.thru.org
```

`GNUmakefile`:

```makefile
BASEDIR:=$(CURDIR)/build
THRU_C_SDK_DIR:=$(HOME)/.thru/sdk/c/thru-sdk
include $(THRU_C_SDK_DIR)/thru_c_program.mk
```

Deploy with `thru program create <seed> build/thruvm/bin/worm.bin`, iterate with
`thru program upgrade` (the program address is stable across upgrades). Account-creation
proofs come from `thru txn make-state-proof creating <address>`; they are **slot-bound**, so
generate them fresh and submit promptly or you'll get `INVALID_PROOF_SLOT` (−33).

Publish an ABI (`thru abi prep-for-publish`) so `scan.thru.org` decodes your instructions
and events. Without it the explorer shows opaque bytes, and the explorer *is* the evidence.

---

## 8. Day-zero measurements

Four numbers remain genuinely unknown. Everything else above is sourced. Measure these
before writing simulation code.

| # | Question | Why it matters |
|---|---|---|
| 1 | `block.header.max_compute_units` on alphanet | Sets steps-per-transaction. The whole schedule bends around this. Read it from any recent block via Explorer MCP or `StreamBlocks`. |
| 2 | Blocks per second on alphanet | With #1, gives the worm's wall-clock speed. Sample `getheight` twice. |
| 3 | Actual CU for a 1-step `step()` | Validates the §2.6 estimate. The CLI prints `Compute Units Consumed` on every transaction — this is a five-minute measurement, so do it on a stub. |
| 4 | State units charged for a 32-byte account create | Spec says this section is "changing frequently". Bounds the setup batch size. |

**Hour-four gate.** If a hello-world isn't deployed by hour four, the toolchain is the
problem, not the plan — talk to the organizers rather than pushing on. Thru is v0.2.x with
an install flow its own docs say "will change frequently until v1.0.0". Pin every version
the moment something works.

---

## 9. Build order — 48 hours

| Hours | Work | Owner |
|---|---|---|
| 0–4 | Toolchain, hello-world on alphanet, §8 measurements, versions pinned | chain |
| 0–4 | Data pipeline: connectome → CSR → `topology.bin`, `names.json`, `positions.json` | data |
| 0–6 | Front-end scaffold on **mock data**: 3D scene, 302 nodes, worm mesh, two buttons | front-end |
| 4–10 | NumPy reference, then fixed-point reference, assert agreement | data |
| 4–12 | C simulator native, bit-for-bit against reference | chain |
| 10–16 | `upload_chunk` + `create_neurons`; all 302 accounts live on chain | chain |
| 12–20 | Follow-the-leader kinematics, gait tuned against real worm video | front-end |
| 16–24 | `step(n)` on-chain, bit-for-bit against native C | chain |
| 18–24 | `classify()` + `BehaviorState`; behavioral check green | data |
| 24–30 | Measure real CU, tune steps-per-tx, enable transfer settlement, publish ABI | chain |
| 24–34 | Wire front-end to chain: `StreamEvents`, `StreamTransactions`, particles, feed | front-end |
| 30–36 | Sustained stepping; record a full 302-neuron run with signatures | chain |
| 34–40 | Omega turn, trail, polish | front-end |
| 40–44 | README with caveats stated plainly, slide, rehearse the demo twice | all |
| 44–48 | Buffer | it will be consumed |

Three people: chain, data + reference sim, front-end. Two works if the front-end starts on
mock data Friday night — which the schedule assumes anyway, so do it regardless.

---

## 10. Out of scope — deliberately

Stated here so nobody relitigates it at hour 30.

- **Body physics.** No fluid dynamics, no elastic rod. Kinematics only.
- **Emergent locomotion.** The connectome has no conductances and no proprioceptive feedback. OpenWorm has been at this for over a decade. The classifier is the answer.
- **The male 385-neuron variant.** Stretch goal, not a plan.
- **Pharyngeal nervous system.** Separate, mostly autonomous, adds nothing visible.
- **Neuromodulation.** Monoamines and neuropeptides aren't in the wiring diagram.
- **Tuning 7,000 conductances.** Tune 15. Ship.
- **A crypto-economic story.** There isn't one and it doesn't need one.

---

## 11. What to say on stage

> This is the complete nervous system of *C. elegans* — 302 neurons, 7,000 chemical
> synapses, 1,400 gap junctions — running on Thru. Every neuron is its own account. Its
> membrane voltage is its balance. Synaptic transmission settles as real transfers you can
> look up on the explorer.
>
> Gap junctions are electrically conservative, so they settle as transfers between neurons.
> Chemical synapses aren't, so they settle against a reservoir. That's not a metaphor we
> chose — it's what those two synapse types actually do.
>
> All 302 neurons fit in one Thru transaction, because Thru allows a thousand accounts per
> transaction. One transaction is a hundred timesteps of a living nervous system.
>
> We don't claim the crawling emerges from the connectome. Nobody can do that yet. What the
> connectome *does* determine is the decision: touch the head, the mechanosensory neurons
> fire, the command interneurons flip to reverse, the worm backs up. Fifteen cells, in the
> textbooks for forty years, and you can watch it one transaction at a time.

Every sentence is checkable. That is the point.
