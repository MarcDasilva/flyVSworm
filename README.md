# Fly vs Worm

Two nervous systems whose wiring is actually known, running against each
other on the Thru alphanet. The question is narrower than "AI on a
blockchain": can a chain *execute* a nervous system, or only store one?
Almost everything on-chain that calls itself intelligent keeps a hash of a
model that ran somewhere else. Here the arithmetic itself — every membrane
equation, every synapse — runs inside the VM, and every event has a
signature you can open in a block explorer.

| | The worm | The fly |
|---|---|---|
| Animal | *C. elegans* hermaphrodite, all 302 neurons | *Drosophila* central complex, 134 neurons |
| Wiring | Varshney et al. 2011 (White et al. 1986 micrographs) | Janelia hemibrain v1.2.1, rotation-averaged |
| Shape | VirtualWorm tracing (OpenWorm `CElegansNeuroML`) | hemibrain meshes, JRC2018F space |
| Model | graded-potential, backward Euler, Q16.16 | leaky integrate-and-fire, Q16.16 port |
| On chain | the timestep, every synapse, the classifier | anatomy ledger live; brain on the worm's account shape |
| Verified | bit-for-bit through to live chain state | bit-for-bit through native C |
| Output | one behaviour byte, rendered as a crawling animal | a heading bump, read as a trading signal |

To be exact about what is finished: the worm's arithmetic is verified on live
chain state; the fly's is verified through native C. A scoreboard behind the
two desks keeps the standings.

Program accounts (alphanet): worm `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ`
(seed `hello-worm-v1`), fly `taACbGSvPJpP0Wy0QwcL71HVIUIFfWa_f80POFqBJo5Zcf`
(seed `hello-fly-v1`), fly anatomy ledger
`ta-LDQFUM9re6TGcyypp3yVMPJwkbn-2X8EljJdlAY26zK`.

## The worm

**One neuron, one account.** A timestep is a program instruction that reads
all 302 accounts, integrates the membrane equation in Q16.16 fixed point
(backward Euler, dt = 5 ms, one divide per neuron per step) and writes them
back. Gap-junction current settles as real `tsys_account_transfer` calls
between neuron accounts: electrical coupling between two cells is a balance
transfer between two addresses, and a live-chain test asserts the total is
conserved. Chemical events transfer between a reservoir and the postsynaptic
cell, inhibition included.

**The wiring is a 28,564-byte binary with no float in it.** 6,394 chemical
contacts across 2,573 directed edges and 890 gap-junction contacts across 517
undirected junctions, packed as CSR by postsynaptic neuron, per-neuron
parameters and a 257-entry sigmoid lookup table. Every array starts 8-byte
aligned, asserted at build time, because ThruVM faults on unaligned access and
on any access spanning a 4 KB page — a silent overrun in the packing is a
buffer overrun inside the program. Conductance is a contact-count proxy,
`0.1·sqrt(contacts)` chemical and `0.05·sqrt(contacts)` electrical, except
for sixteen escape-circuit edges set by documented function (Chalfie et al.
1985). That override is 4.9× to 40× over the proxy and it is there for a
reason: under the raw proxy a head touch reads fwd 0.147 against rev 0.095
and the worm crawls *toward* the thing that touched it.

**The anatomy is traced, not laid out.** 13,869 segments across all 302
neurons from the VirtualWorm digitisation of the 1986 micrographs, collinear-merged
to 9,429 and drawn in one draw call, each neurite tinted by its own
cell's membrane potential. Nothing in the renderer may move a neuron; the test
suite takes every traced point in the nerve-ring band and asserts it forms an
annulus, occupied in all twelve sectors and hollow where the pharynx is. A
layout function cannot pass that by luck. The first renderer used one, and it
was fiction.

**One synaptic event, one signature.** The live mode (`INSTR_SETTLE_SYNAPSE`)
queues every nonzero current at the 10-step settlement cadence — no
sampling — and the relay signs each as its own transaction. Bulk RPC
submission transports separate signed transactions; it does not combine their
execution. The account balance carries `(V_mV + 100) × 10`, a 0.1 mV
projection of the int32 Q16.16 state in account data, written by settlement
and one settlement behind. "The balance carries the voltage" is the honest
sentence; "the voltage is the balance" is not.

**The brain classifies; the body animates.** Five command interneurons (AVA,
AVD, AVE reverse; AVB, PVC forward) weight into two drives and a
dwell-and-hysteresis state machine emits PAUSE, FORWARD, REVERSE or OMEGA as
one byte. The body plays a published gait (0.40 Hz, 0.26 L/s, 0.65 L
wavelength) on a follow-the-leader kinematic chain that is inextensible by
construction. Locomotion does not emerge from the connectome — for anyone —
and the seam is stated rather than hidden behind a crawling animal. The body
is metered by worm-seconds the chain actually delivered: with the relay
killed mid-crawl it freezes in 0 of 12 samples, where the naive version kept
moving in 8 of 12.

## The fly

**Measured wiring, then a caveat.** The circuit started as the 16-wedge
abstraction of the protocerebral bridge (Hulse et al. 2021, 56 neurons) and
was replaced with cell-level connectivity from the hemibrain once the
dynamics were tuned and passing: 134 neurons (50 EPG, 21 PEN_L, 21 PEN_R, 42
D7), 11,028 nonzero weights, sign carried in the weight so there is no
separate inhibitory mask. The raw connectivity could not turn — stick-slip
rotation and wells the bump fell into and stayed in — so the deployed weights
are a rotation-averaged rebuild. The weights are measured; the rotational
symmetry is imposed. The fixed-point ring then turns 0.81 wedges in the
correct direction on the golden series.

**Momentum is turning drive.** Price momentum enters as push-pull current
(+d PEN_L, −d PEN_R). The bump rotates counterclockwise for long and clockwise
for short, size proportional to turning speed, scaled by bump strength as a
confidence signal; no single bump means flat. The drive is capped at 1.3×
threshold current and ramps rather than stopping, because an abrupt stop
after three seconds of strong drive kills the bump outright in four of five
seeds. Parameters came from random search, then evolutionary refinement scored
on robustness — nominal plus ten one-at-a-time ±10% weight perturbations over
five seeds — not on peak performance.

**Two chapters on Thru.** The anatomy ledger is live on alphanet with 6,772
transactions behind it. The brain uses the worm's account shape — a neuron's
balance is its membrane potential, a spike is a balance transfer — through
`wormed/program/fly.c`: one synaptic event, one transaction, one `FLY_SYNX`
receipt. Excitatory events move charge pre → post; inhibitory events take it
from the postsynaptic cell to the reservoir, since nothing flows back up an
axon. The panel shows a sample, and says so: the model spikes at 1,000
ticks/s and a transaction confirms in seconds.

**Its own fee payer.** One account is one nonce sequence, and the worm's
thousand-transaction batches strand anything allocated behind them
(measured — see `wormed/web/flysynapses.mjs`).

## The verification chain

Three implementations of the same timestep, each asserted against the one
above it. The last link is the same `sim.c` compiled twice, natively and for
RISC-V, so what it tests is the compiler, the VM and the account plumbing,
not a fourth rewrite of the arithmetic.

| Link | Assertion | Where |
|---|---|---|
| numpy float64 → Python Q16.16 | max divergence 0.0238 mV over 400 steps, 0.1 mV budget | `test_pipeline.py` |
| Python Q16.16 → native C | **bit-for-bit**, 400 steps × 302 neurons | `wormed/program/native_test.c` |
| native C → ThruVM | **bit-for-bit**, 302 neurons after `stimulate("ALML", 40)` + 100 steps, live alphanet | `test_chain.py` |

Bit-for-bit means every one of 302 int32 values equal, not close. It caught
two bugs nothing else would have: C's `/` truncates toward zero where Python's
`//` floors, and they disagree on negative voltages (a resting neuron sits at
−70 mV); and a 32-bit narrowing of the conductance accumulator before the dt
multiply. Both produce plausible-looking animals. The native link has a
negative control — changing one `>> 16` to `/ 65536` fails at step 2, neuron
0, by 3 units — so the assert is load-bearing, not vacuous.

## What it costs on Thru

| Number | What it is |
|---|---|
| **363,236 CU/step** | marginal cost of one full timestep: 302 neurons, 2,573 chemical edges, 517 gap junctions |
| **9,458 steps/transaction** | the ceiling against `req_compute_units`' uint32 limit — 47 s of worm life in one transaction. Compute *capacity*, not throughput |
| **2.89× real time** | measured end to end: 60,000 steps, five minutes of worm life, in 104 s wall clock, 20 transactions of 3,000 steps |
| **9,020 fee units** | the whole five minutes, at exactly 200 units per transaction. All 20 signatures in `wormed/data/benchmark.json` |
| **0.55–0.75× real time** | the browser, which is latency-bound: alphanet ranged 3.7–6.25 s for identical transactions |

The run uses a third of the measured ceiling on purpose. A transaction that
exhausts its compute budget reverts *and is still charged*, and marginal cost
per step rises with anything that adds synapses.

## Caveats

The parts a biologist should attack first.

1. Synaptic sign is assigned, not measured: 26 GABAergic neurons inhibitory, 276 assumed excitatory. The data has no polarity field.
2. Contact count is anatomy; conductance is physiology. The proxy conflates them.
3. 279 of 302 neurons carry connectivity. The 20 pharyngeal neurons plus CANL/R and VC6 exist as cells and accounts and integrate their own leak, and are wired to nothing in this source.
4. Three gap junctions (RIBL, RIBR, VA8) are self-loops in the published data, kept as-is: about 5% on those cells' time constants, none in the demo circuit.
5. Synapse *sites* are not in either dataset. A firing transfer is drawn cell body to cell body along a convention, not a path any process takes.
6. The gait was never tuned against real worm video; it passes geometric invariants (inextensibility to 0.60% drift, frame-rate invariance to five digits) and nothing else.
7. The demo injects sensory input (`auto-stim` / `auto-rel` in the log, alternating head and tail every 22 s) because without input the model settles to PAUSE.
8. A touch is three transactions — stimulate, step, classify — since neither the CLI nor the SDK takes more than one instruction per transaction: 16–17 s click to HUD in rehearsal.
9. The fly's rotational symmetry is imposed on measured weights, above.

## Running it

The page is static on Vercel (`wormed/web`); the relay with its SQLite ledger
(`store.mjs`, `node:sqlite`, no dependency) and the fly model run as one
container on Fly.io with `exhibit.db` on a volume, so standings survive a
redeploy. The relay is the only process that can spend; the browser reads the
chain directly and never signs.

```bash
npm i -g thru && thru keygen new worm && thru faucet withdraw worm 10000
pip3 install -r wormed/requirements.txt
python3 -c "from wormed.pipeline.pack import build_all; build_all()"        # deterministic; topology.bin is byte-identical
python3 -m pytest wormed/pipeline/test_pipeline.py wormed/pipeline/test_morphology.py -q
cd wormed/program && gcc -O0 -g -I. native_test.c sim.c -o /tmp/nt && /tmp/nt
make && thru program create worm-v1 build/thruvm/bin/worm.bin
cd ../.. && python3 -c "from wormed.pipeline.deploy import *; \
  create_singletons(); upload_topology(); create_all_neurons(); fund_reservoir()"
python3 -m wormed.pipeline.deploy_fly setup
python3 -m pytest wormed/pipeline/test_chain.py -v -m chain                    # 8 tests, ~4 min, ~10,760 units
python3 -c "from wormed.pipeline.deploy import write_chain_config; write_chain_config()"
cd wormed/web && npm install && node relay.mjs & npx vite
```

A dry fee payer surfaces as `vm_error -509 INSUFFICIENT_FEE_PAYER_BALANCE`,
three frames deep in a JSON dump. `benchmark.py` and `relay.mjs` preflight
against a 20,000-unit floor and print the faucet command instead. Continuous
stepping with a viewer attached runs 4,400–6,000 units/min; the relay pauses
after 15 s without one.

## Validation

Offline pipeline 25 passed, traced anatomy 11 passed, native C `OK: 400 steps
x 302 neurons bit-for-bit`, front-end `tsc --noEmit` plus three suites, live
chain 8 passed in 240.98 s. Two asserts have hand-run negative controls:
reverting `q16_mul`'s rounding breaks the native link at step 2, and running
the OMEGA sequence without releasing the stimulus leaves the classifier in
REVERSE at rev 0.686. Demo rehearsal over headless Chrome against alphanet:
42.8 s and 49.2 s end to end, both reading the chain's own drive numbers off
the HUD (`rev 0.686 / fwd 0.511` on head touch) and opening a signature in
`scan.thru.org`. Not verified: that the animation looks right — nobody
watched software WebGL at 20 fps.

## Where to look

| | |
|---|---|
| `docs/measurements.md` | every number measured on chain, with the command that produced it |
| `docs/devpost.md` | the submission writeup |
| `wormed/data/provenance.json` | what the pipeline assumed, written by the pipeline |
| `wormed/data/benchmark.json` | the recorded run, signature by signature |
| `wormed/program/sim.c` | the timestep, compiled for both targets |
| `wormed/program/worm.c`, `fly.c` | instruction dispatch, settlement, the classifier; the fly's synapse receipt |
| `wormed/pipeline/connectome.py` | the sixteen overridden edges, with a build-time assert against the source |
| `wormed/BEHAVIOR_CLASSIFIER.md` | the Buy/Sell heuristic and the paper-account rules |
| `fly-brain/python/` | the fly model, tuning and trading readout |

## What's next

Drive the body from the ventral-cord motor neurons instead of a classifier —
that needs a muscle model and it is the one thing between this and a worm
that crawls because of its connectome. Measured synapse positions: closest
approach between two arbors would be defensible, EM coordinates better. Fold
in Albertson & Thomson (1976) to wire the pharynx. Add a second fly.

