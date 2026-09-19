# C. elegans on Thru

The 302-neuron nervous system of *C. elegans* runs on the Thru alphanet. Every
neuron is its own on-chain account. A timestep is a program instruction that
reads all 302 accounts, integrates the membrane equation in Q16.16 fixed point,
and writes them back. Gap-junction current settles as real
`tsys_account_transfer` calls between neuron accounts. A classifier reads the
five command interneurons and writes one byte of behavior. A browser renders
that byte as a crawling animal.

What is claimed: the simulation is on chain, it is the same simulation
end to end, and you can check that yourself — the arithmetic is asserted
bit-for-bit from numpy down to the VM, and every transaction has a signature
you can open in a block explorer.

What is NOT claimed: that locomotion emerges from the connectome. It does not,
for anyone. The brain classifies; the body animates a published gait. The seam
is stated out loud, here and in the caveats below.

Program account: `taXILSqS99UxmqBxrvpcETPQ8j6zd-xmFmK6EQ5xFWrvgQ` (seed
`hello-worm-v1`). ABI: `taTUnO3Mr-xryw6pCHLYhs1oVG1N9JgcBvplQofLjyzxXV`.

## The three layers

**Data** (`wormed/pipeline/`). Varshney et al. 2011 `NeuronConnect.csv`, fetched
from openworm/ConnectomeToolbox and committed verbatim under
`wormed/data/raw/`. 6,394 chemical synaptic contacts across 2,573 directed
edges; 890 gap-junction contacts across 517 undirected junctions. Packed into
`wormed/data/topology.bin` (28,564 bytes): CSR by postsynaptic neuron,
gap junctions in both directions, per-neuron parameters, and a 257-entry
sigmoid lookup table. No float anywhere in the file.

**Brain** (`wormed/program/`). One RISC-V program, a 5,224-byte binary compiled
for ThruVM by the Thru C SDK. `sim.c` is the timestep and compiles unchanged for the
native test harness and for the VM — that shared file is what makes the
bit-for-bit claim testable off chain. Backward Euler, dt = 5 ms, one divide per
neuron per step.

**Body** (`wormed/web/`). Three.js. A follow-the-leader kinematic body: the head
steers, every segment follows the path the head traced, which is why the worm
is inextensible by construction. It reads the behavior byte and the voltage
frames off the node's gRPC event stream. A small Node relay (`relay.mjs`) is
the only process in the demo that can spend: the browser reads the chain
directly but never signs anything.

## The verification chain

Three implementations of the same timestep, each asserted against the one
above it. The last link is the same `sim.c` compiled twice — once natively,
once for RISC-V — so what it tests is the compiler, the VM and the account
plumbing, not a fourth rewrite of the arithmetic:

| Link | Assertion | Where |
|---|---|---|
| numpy float64 → Python Q16.16 | max divergence 0.0238 mV over 400 steps, against a 0.1 mV budget | `test_pipeline.py::test_fixed_tracks_float_within_a_tenth_of_a_millivolt` |
| Python Q16.16 → native C | **bit-for-bit**, 400 steps × 302 neurons | `wormed/program/native_test.c` |
| native C → ThruVM | **bit-for-bit**, 302 neurons after `stimulate("ALML", 40) + 100 steps` on live alphanet | `test_chain.py::test_chain_matches_the_fixed_reference_bit_for_bit` |

"Bit-for-bit" means every one of the 302 int32 values is equal, not close. Two
real bugs were found by this and nothing else: C's `/` truncates toward zero
where Python's `//` floors (they differ on negative voltages), and a 32-bit
narrowing of the conductance accumulator before the dt multiply.

The native link has a negative control: changing `q16_mul`'s `>> 16` to
`/ 65536` makes the test fail at step 2, neuron 0, by 3 units. The assert is
load-bearing, not vacuous.

## Caveats

These are the parts a biologist should attack first. None of them are hidden
further down.

**1. Sixteen conductances are hand-set.** `wormed/data/provenance.json` records
this verbatim:

> These 16 edges are set by documented function (Chalfie et al. 1985), not by
> contact count. Every other conductance is the contact-count proxy. State this
> in the README.

Every one of the sixteen is a real anatomical connection in the Varshney data,
with 1 to 19 contacts; none are invented. But setting them all to 2.0
overrides the proxy by **4.6x to 40x**, and the three largest — `ALML~AVM`,
`PLML~PVCL`, `PLMR~PVCR`, each a single-contact gap junction — are stretched
40x. The justification: sqrt(contact count) measures contact *area*, not
synaptic gain. Under the untuned proxy, ALML's largest command-layer output is
to PVC, so a head touch reads fwd = 0.147 against rev = 0.095 — the worm crawls
*toward* the thing that touched it, which is the opposite of forty years of
ablation work. The sixteen pairs, their contact counts and the exact override
are in `wormed/pipeline/connectome.py` (`ESCAPE_CHEM`, `ESCAPE_GAP`,
`ESCAPE_G`), and a build-time assert fails if any of them stops matching the
source data. `PLML~PVCL` is the weakest of them: PLML has exactly one chemical
synapse in this dataset and PLMR carries the posterior touch output.

**2. Synaptic sign is assigned, never measured.** Also from
`provenance.json`:

> Synaptic sign is ASSIGNED, not measured. State this in the README.

26 GABAergic neurons get an inhibitory reversal potential; the other 276 are
assumed excitatory. The connectome data has no polarity field, so there is
nothing to measure against. The matched and unmatched neuron lists are in
`provenance.json`.

**3. Every other conductance is a contact-count proxy**, `0.1·sqrt(contacts)`
for chemical synapses and `0.05·sqrt(contacts)` for gap junctions. Contact
count is anatomy. Conductance is physiology. They are not the same quantity.

**4. Locomotion is classifier-driven, not emergent.** Five command interneurons
(AVA, AVD, AVE for reverse; AVB, PVC for forward) are weighted into two drive
numbers, and a dwell-and-hysteresis state machine picks PAUSE, FORWARD, REVERSE
or OMEGA. The body then plays a published crawling gait — 0.40 Hz, 0.26 body
lengths/s, 0.65 L wavelength, 0.80 rad peak tangent swing. No muscle is
simulated, and no motor neuron drives anything. The ventral-cord motor neurons
are simulated like every other cell and then ignored by the body.

**5. Three gap junctions are self-loops.** RIBL, RIBR and VA8 are each
gap-junctioned to themselves in the source data. A cell cannot gap-junction to
itself; this is a reconstruction artifact in the published dataset, and it is
kept as-is rather than silently cleaned. It is not free: a self term adds to
both accumulators, leaving the resting potential unchanged but slowing those
three cells' effective time constant by about 5%. Settlement skips them (the
dedup guard skips `j <= i`), and none of the three is in the demo circuit.

**6. 279 of the 302 neurons carry connectivity.** `NeuronConnect.csv` covers
only the extrapharyngeal nervous system. The 20 pharyngeal neurons (I1-I6,
M1-M5, MCL/R, MI, NSML/R) plus CANL, CANR and VC6 have no chemical or gap
synapse in this source. They exist as cells, as dense indices and as on-chain
accounts, and they integrate their own leak current; they are simply not part
of a circuit this dataset describes. "302 neurons, one account each" is true.
"302 neurons wired together" is not.

**7. The account balance is a projection of voltage, not the voltage.** The
simulation's source of truth is `v_next` in account *data*: int32 Q16.16,
resolving about 1.5e-5 mV. The *balance* carries
`(V_mV + 100) × 10`, which resolves 0.1 mV, and is written by settlement, not
by the timestep. So the balance genuinely moves with membrane potential and
genuinely moves by real transfers — but at display precision, and one
settlement behind. Any claim of the form "the voltage IS the balance" should be
read as "the balance carries the voltage to 0.1 mV". At that scale, 334 of the
514 genuine gap junctions cleared the rounding floor in the measured snapshot
and produced a real transfer of 1 to 17 units; the rest carried less than
0.1 mV of current and rounded to nothing. The count moves with how polarized
the network is — a resting worm settles fewer junctions than a touched one.

**8. Three different speed numbers, and they mean three different things.**

| Number | What it is |
|---|---|
| 9,458 steps per transaction = **47 s of worm per transaction** | *Compute capacity.* Marginal cost is 363,236 CU/step against `req_compute_units`' uint32 ceiling. It says nothing about wall-clock throughput. |
| **2.89x real time** | *Measured end to end*, `wormed/data/benchmark.json`: 300 s of worm in 104 s, 20 transactions of 3,000 steps. |
| **0.55-0.75x real time** | *The live browser demo.* It steps 600 at a time so a click is not stuck behind a long transaction; per-transaction latency then dominates and the worm runs slower than life. |

The first is not a throughput claim, and quoting it as one would be the most
dishonest sentence available here.

**9. Alphanet latency is erratic.** The benchmark's 20 identical transactions
ranged 3.7 s to 6.25 s. An earlier session saw 1.0 s to 26.3 s for the same
transaction type, and one step transaction died on the CLI's 30 s timeout. The
relay logs a failed transaction and carries on; there is no code fix for this
on our side.

**10. Touch latency is seconds, not milliseconds.** A touch is three
transactions — stimulate, step, classify — because neither the CLI nor the SDK
accepts more than one instruction per transaction. That is 6-7.5 s of chain
minimum. On screen it is longer: in the two rehearsals below, click to HUD
state change took 16.0 s and 17.4 s, because the touch also queues behind the
step transaction already in flight and the front-end plays voltage frames back
at the worm's own rate rather than as fast as they arrive. Shortening it needs
a new on-chain instruction that does all three.

**11. The gait was never tuned against real worm video.** The constants sit
inside published ranges and the body passes geometric invariants
(inextensibility to 0.60% worst-segment drift, frame-rate invariance to five
digits, nose-first forward and tail-first reverse). Whether it *reads* as an
animal is unverified. The omega turn is the weakest of these: the classifier's
entry into and exit from OMEGA is tested on chain, but the rendered turn is
only checked geometrically — that the direction of travel changes by more than
a threshold — not against how a real animal turns.

**12. Idle means PAUSE, and a paused worm stands still.** With nobody touching
it, both drives sit near 0.016, under the classifier's release threshold, so
the honest output is PAUSE. A permanent small stimulus would keep it crawling
and would be a fabrication.

## Cost and operations

Fee is exactly 200 units per transaction, and **a reverted transaction is still
charged**. Measured today: the live-chain test suite costs 10,760 units, the
benchmark 9,020, a 45-second demo rehearsal about 2,800. Continuous stepping
with a viewer attached runs 4,400-6,000 units/minute.

The fee payer running dry surfaces as `vm_error -509
TN_RUNTIME_TXN_ERR_INSUFFICIENT_FEE_PAYER_BALANCE`, which reads exactly like a
program fault three frames deep in a JSON dump. Check before you start, not
after:

```bash
thru getbalance worm
thru faucet withdraw worm 10000   # cap is 10,000 per call, repeatable
```

`wormed/scripts/benchmark.py` and `relay.mjs` both preflight against the
20,000-unit floor `deploy.py` defines, and print that faucet command instead of
failing into the chain.

## Validation

Every suite, run on this commit against the live alphanet. Not "tests pass" —
these are the counts and the output.

Offline pipeline, 28 tests:

```
$ python3 -m pytest wormed/pipeline/test_pipeline.py -q
............................                                             [100%]
28 passed in 22.36s
```

Native C against the Python Q16.16 reference:

```
$ cd wormed/program && gcc -O0 -g -I. native_test.c sim.c -o /tmp/nt && /tmp/nt
OK: 400 steps x 302 neurons bit-for-bit against the Q16.16 reference
```

Front-end, typecheck plus three suites:

```
$ cd wormed/web && npx tsc --noEmit && npm test
OK: body kinematics invariants hold
OK: scene holds 10 objects, 7 materials across 120 frames; worm crawled 2.05 L and stayed within 0.418 of the origin
OK: chain event decode holds at every byte offset, tag and truncation
```

Live chain, 8 tests, 4 minutes, ~10,760 units:

```
$ python3 -m pytest wormed/pipeline/test_chain.py -v -m chain
test_chain_matches_the_fixed_reference_bit_for_bit PASSED                [ 12%]
test_balance_encodes_voltage_within_rounding PASSED                      [ 25%]
test_gap_junction_settlement_conserves_total_balance PASSED              [ 37%]
test_head_touch_drives_reverse_and_tail_touch_drives_forward PASSED      [ 50%]
test_classifier_does_not_flicker_at_the_crossover PASSED                 [ 62%]
test_trace_event_is_the_expected_size PASSED                             [ 75%]
test_gap_settlement_emits_the_transfers_it_made PASSED                   [ 87%]
test_sustained_reversal_releases_into_an_omega_turn PASSED               [100%]

======================== 8 passed in 240.98s (0:04:00) =========================
```

Two of these asserts have negative controls, run by hand, because an assert
that cannot fail is worse than no assert:

- Reverting `q16_mul` to round-toward-zero breaks the native bit-for-bit test
  at step 2.
- Running the OMEGA sequence *without* releasing the stimulus leaves the
  classifier in REVERSE with rev = 0.686 — so the release condition in
  `test_sustained_reversal_releases_into_an_omega_turn` is what the test is
  actually measuring.

Demo rehearsal, headless Chrome over CDP against alphanet, cold relay and a
fresh browser each time: **42.8 s and 49.2 s** end to end, against a 90-second
target. Both clicked head and tail, both read the chain's own drive numbers off
the HUD (`rev 0.686 / fwd 0.511` on head touch, `fwd 0.535 / rev 0.235` on tail
touch — the same numbers the offline reference produces), and both opened a
signature from the feed in `scan.thru.org` (HTTP 200). No page errors. What
this does not verify: that the animation looks right. Headless software WebGL
rendered at 20 fps, and nobody watched it.

## Reproducing it

```bash
# 1. Toolchain and a funded fee payer
npm i -g thru                       # 0.3.16+c55cda22 here
thru keygen new worm && thru faucet withdraw worm 10000

# 2. Build the connectome (offline; writes wormed/data/)
pip3 install -r wormed/requirements.txt
python3 -c "from wormed.pipeline.pack import build_all; build_all()"

# 3. The offline half of the verification chain
python3 -m pytest wormed/pipeline/test_pipeline.py -q
cd wormed/program && gcc -O0 -g -I. native_test.c sim.c -o /tmp/nt && /tmp/nt

# 4. Build and deploy the program, then record its address
make                                 # -> build/thruvm/bin/worm.bin
thru program create worm-v1 build/thruvm/bin/worm.bin
#   put the program account into docs/measurements.md's PROGRAM_ADDRESS line,
#   and delete wormed/data/addresses.json — neuron addresses derive from the
#   program account, and that file is a cache that will happily serve the old
#   ones

# 5. Create 305 accounts and upload the connectome (~45 transactions)
cd ../.. && python3 -c "from wormed.pipeline.deploy import *; \
  create_singletons(); upload_topology(); create_all_neurons(); fund_reservoir()"

# 6. The on-chain half of the verification chain
python3 -m pytest wormed/pipeline/test_chain.py -v -m chain

# 7. The recorded full-animal run -> wormed/data/benchmark.json
python3 -m wormed.scripts.benchmark

# 8. The demo
python3 -c "from wormed.pipeline.deploy import write_chain_config; write_chain_config()"
cd wormed/web && npm install && node relay.mjs &
npx vite
```

Step 2 rewrites `wormed/data/` from the raw CSV and is deterministic —
`topology.bin` is byte-identical across runs. Changing anything in step 2
invalidates the golden vector and the deployed topology both: regenerate
`wormed/data/vectors/alm_400.bin`, re-upload, and re-run steps 3 and 6.

## The recorded run

`wormed/scripts/benchmark.py` runs 60,000 timesteps — 302 neurons, every
synapse, five minutes of worm life — as 20 transactions of 3,000 steps, with
gap-junction and reservoir settlement every 20 steps. It is recorded, not live:
`wormed/data/benchmark.json` holds all 20 signatures, the compute units each
transaction consumed, the per-transaction latency and the behavior the
classifier reported after each one. Any of it can be opened in the explorer.

3,000 steps per transaction is a third of the measured 9,458-step ceiling. The
headroom is deliberate: a transaction that exhausts its compute budget reverts
*and is still charged*, and the marginal cost per step rises with any change
that adds synapses.

The run walks the state machine rather than holding one state: quiet, head
touch, reversal, release into the omega turn, forward, quiet, tail touch,
forward, quiet.

```
batch  4 step  15000 REVERSE fwd 0.511 rev 0.686
batch  7 step  24000 OMEGA   fwd 0.016 rev 0.007
batch  8 step  27000 FORWARD fwd 0.016 rev 0.007
batch 12 step  39000 FORWARD fwd 0.535 rev 0.235
```

23,463,222,550 compute units, 9,020 fee units, 104 seconds of wall clock.

## Where to look

| | |
|---|---|
| `docs/measurements.md` | every number measured on chain, with the command that produced it |
| `wormed/data/provenance.json` | what the pipeline assumed, written by the pipeline itself |
| `wormed/data/benchmark.json` | the recorded run, signature by signature |
| `SPEC.md` | the design, including two places where reality corrected it |
| `wormed/program/worm.c` | instruction dispatch, settlement, the classifier |
| `wormed/program/sim.c` | the timestep, compiled for both targets |
