# Fly vs Worm

## Inspiration

Two animals have nervous systems we actually know the wiring of. *C. elegans*
was the first — White, Southgate, Thomson & Brenner spent a decade cutting one
hermaphrodite into serial sections and tracing every process by hand, and
published the whole thing in 1986. *Drosophila* came much later, and its
central complex is the part we understand best: a ring of neurons that holds
the fly's heading like a compass needle.

Both are small enough to simulate completely. Neither is a model of a brain —
they *are* the brain, every cell, no sampling.

So the question was not "can we put AI on a blockchain". It was narrower and
more interesting: **can a blockchain execute a nervous system, or can it only
store one?** Almost everything on-chain that calls itself intelligent keeps a
hash of a model that ran somewhere else. We wanted the arithmetic itself —
every membrane equation, every synapse — inside the VM, with a signature you
can open in a block explorer.

That only works if the chain is fast enough to be boring about it. Thru is.

## What it does

**The worm runs on Thru.** All 302 neurons of the *C. elegans* hermaphrodite
nervous system, one on-chain account each. A timestep is a program
instruction: it reads all 302 accounts, integrates the membrane equation in
Q16.16 fixed point, and writes them back. Gap-junction current settles as real
`tsys_account_transfer` calls between neuron accounts — the electrical
coupling between two cells is a balance transfer between two addresses. A
classifier reads the five command interneurons and writes one byte of
behaviour. A browser renders that byte as a crawling animal, with the real
traced anatomy lighting up as the voltages move.

**The fly trades.** A 56-neuron ring attractor from the central complex —
EPG, PEN-left, PEN-right and D7 populations over 16 wedges — takes price
momentum as push-pull turning drive. The heading bump rotates; counterclockwise
is long, clockwise is short, size proportional to turning speed and scaled by
bump strength as a confidence signal. No single bump means flat.

**They compete.** A scoreboard behind the two desks keeps the standings.

To be exact about it: the worm is on chain, the fly runs in Python alongside
it. Putting the fly on chain is the next piece of work, not a thing we are
claiming.

## How we built it

**Data.** Wiring is Varshney, Chen, Paniagua, Hall & Chklovskii (2011), the
canonical re-analysis of the White et al. electron micrographs: 6,394 chemical
synaptic contacts across 2,573 directed edges, 890 gap-junction contacts across
517 undirected junctions. Packed into a 28,564-byte binary — CSR by
postsynaptic neuron, per-neuron parameters, and a 257-entry sigmoid lookup
table. **No float anywhere in the file.**

Shape comes from a second source. The OpenWorm `CElegansNeuroML` cells are the
VirtualWorm tracing by Grove and Sternberg at WormBase — the 1986 micrographs
digitised into 3D and released into the public domain. 13,869 traced segments
across all 302 neurons, collinear-merged to 9,429 for the renderer.

**Brain.** One RISC-V program, a 5,224-byte binary compiled for ThruVM.
Backward Euler, dt = 5 ms, one divide per neuron per step. `sim.c` compiles
unchanged for both the native test harness and the VM, which is what makes the
next part testable.

**The verification chain.** Three implementations of the same timestep, each
asserted against the one above it:

| Link | Assertion |
|---|---|
| numpy float64 → Python Q16.16 | max divergence 0.0238 mV over 400 steps, against a 0.1 mV budget |
| Python Q16.16 → native C | **bit-for-bit**, 400 steps × 302 neurons |
| native C → ThruVM | **bit-for-bit**, 302 neurons on live alphanet |

Bit-for-bit means every one of the 302 int32 values is equal, not close. The
last link is the same source file compiled twice, so what it tests is the
compiler, the VM and the account plumbing — not a fourth rewrite of the
arithmetic.

**Fly.** Leaky integrate-and-fire with exponentially decaying synaptic current,
weights signed in the connectome so there is no separate inhibitory mask. The
wiring is the 16-wedge idealisation of the protocerebral bridge from Hulse et
al. (2021). Parameters came out of random search then evolutionary refinement,
scored not on peak performance but on robustness: nominal plus ten
one-at-a-time ±10% weight perturbations across five seeds, against an eight-test
acceptance protocol.

## Performance on Thru

This is the part that surprised us.

| Number | What it is |
|---|---|
| **363,236 CU/step** | marginal compute cost of one full timestep — 302 neurons, 2,573 chemical edges, 517 gap junctions |
| **9,458 steps per transaction** | the ceiling that buys, against `req_compute_units`' uint32 limit: **47 seconds of worm life in a single transaction** |
| **2.89× real time** | measured end to end: 60,000 timesteps, five minutes of worm life, in 104 seconds of wall clock |
| **23,463,222,550 CU** | total for that run, across 20 transactions of 3,000 steps |
| **9,020 fee units** | what the whole five minutes cost. Fees are exactly 200 units per transaction |
| **0.55–0.75× real time** | the live browser demo, which is latency-bound rather than compute-bound |

The gap between the second row and the last is the honest part. 47 seconds of
worm per transaction is *compute capacity* and says nothing about wall clock.
2.89× is the throughput we actually measured. The browser runs slower than
both because it steps 600 at a time so a click is not stuck behind a long
transaction, and per-transaction latency then dominates. Quoting the first
number as throughput would be the most dishonest sentence available here, so
we keep all three apart.

We deliberately run 3,000 steps per transaction against a measured 9,458-step
ceiling. A transaction that exhausts its compute budget reverts **and is still
charged**, and marginal cost per step rises with anything that adds synapses,
so a third of the ceiling is the margin we were willing to pay for.

## Challenges we ran into

**Fixed point across three implementations.** Bit-for-bit is a brutal bar, and
it caught two real bugs that nothing else would have: C's `/` truncates toward
zero where Python's `//` floors — they disagree on negative voltages, and a
resting neuron sits at −70 mV — and a 32-bit narrowing of the conductance
accumulator before the dt multiply. Both produce plausible-looking worms. The
native link has a negative control: changing one `>> 16` to `/ 65536` makes the
test fail at step 2, neuron 0, by 3 units, so we know the assert is
load-bearing rather than vacuous.

**ThruVM alignment.** The VM faults on unaligned access and on any access
spanning a 4 KB page boundary. Every array in the packed binary starts 8-byte
aligned, enforced by a build-time assert over the whole layout, because a
silent overrun there is a buffer overrun inside the program.

**The anatomy was wrong.** The first renderer placed neurons with a
name-prefix table: map `AVA` to the lateral ganglion, scatter it in a
hand-tuned sector. It looked plausible and it was fiction. Replacing it with
the VirtualWorm tracing meant the nerve ring had to *emerge* — and we now test
for exactly that, taking every traced point in the nerve-ring band and
asserting it forms an annulus, occupied in all twelve sectors and hollow in
the middle where the pharynx is. A layout function cannot pass that by luck.

**The animal moved when the chain did not.** The browser reads the behaviour
account directly, and that account keeps returning its last byte forever once
nothing is writing to it. We killed the relay mid-crawl and measured: 24
seconds later the worm was still moving in 8 of 12 samples, stuck in FORWARD,
with no transactions behind it. A timeout could not fix it — gaps between
played frames reach 10.7 s in healthy operation. The body is now metered by
worm-seconds the chain actually delivered, and the same test freezes it in 0
of 12.

**Tuning the fly was mostly learning what breaks it.** The starting parameters
saturated every population. The working regime has a dead zone where small
drives produce no rotation at all, and an abrupt stop after three seconds of
strong drive kills the bump outright from 1.6× threshold current in four of
five seeds — so the trading drive is capped at 1.3× and ramps rather than
stopping. Every one of those limits is measured, not guessed.

**Reverted transactions still cost money**, and the alphanet's latency is
erratic — the benchmark's 20 identical transactions ranged 3.7 s to 6.25 s.

## Accomplishments that we're proud of

**Bit-for-bit from numpy to the VM.** Not "close enough". Every one of 302
int32 values equal at every checked step, through a float reference, a
fixed-point port, native C and RISC-V on a live chain.

**Five minutes of worm life on chain in 104 seconds**, at 9,020 fee units,
with all 20 signatures recorded and openable in a block explorer.

**Electrical synapses that are actually transfers.** Gap-junction settlement
moves real balance between real accounts and conserves the total — there is a
live-chain test that asserts the conservation.

**A nerve ring that emerges instead of being drawn.** The head reads as a head
because the animal's geometry says so.

**A caveats section with fourteen entries.** Sixteen conductances are hand-set
from Chalfie et al. (1985) and we state the exact distortion: 4.9× to 40× over
the contact-count proxy. Synaptic sign is assigned, not measured. Locomotion is
classifier-driven and does not emerge from the connectome — the brain
classifies, the body plays a published gait, and we say so in the README rather
than letting a crawling animal imply otherwise.

## What we learned

**Compute capacity and throughput are different numbers** and conflating them
is the easiest way to mislead people about a chain. We now quote three
separate figures with three separate meanings.

**Fixed point is a discipline, not a datatype.** Every rounding decision has to
be identical in three languages or the last link fails, and the failures are
never where you expect — a division sign convention, a narrowing cast.

**A demo that shows something is making a claim.** If the worm moves, a viewer
concludes the chain is running. So the worm may only move on time the chain
delivered, and the transaction panel labels its own automatic touches
`auto-stim` rather than `stimulate`, so an injected stimulus is never passed
off as spontaneous behaviour.

**The interesting constraint was never the neuron count.** 302 neurons is not
hard. Making 302 neurons produce identical bits on a VM, on a chain, for a fee
you can print — that is the work.

## What's next for Fly vs Worm

**Close the emergence gap.** Right now the ventral-cord motor neurons are
simulated like every other cell and then ignored: the classifier picks a
behaviour and the body plays a published gait. The honest version drives the
body from the motor neurons themselves. That needs a muscle model and it is the
single biggest thing standing between this and a worm that really crawls
because of its connectome.

**Put the fly on chain too.** It is already fixed-point-ready and only 56
neurons — a fraction of the worm's compute — so the same instruction shape
should carry it, and then the competition happens entirely on Thru.

**Measured synapse positions.** Neuron geometry is traced, but the connectome
gives pre/post pairs with no coordinates, so a firing transfer is drawn cell
body to cell body. Closest approach between two arbors would be a defensible
estimate; EM synapse coordinates would be better.

**More of the animal.** 279 of the 302 neurons carry connectivity in this
dataset — the 20 pharyngeal neurons were reconstructed separately by Albertson
& Thomson (1976) and never folded in. Merging that source would wire up the
pharynx.
