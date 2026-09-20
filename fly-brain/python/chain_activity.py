"""Which synapse the running fly has just exercised, and therefore what Thru records next.

The chain records a synapse the first time the fly uses it, so the order rows land in is the order
the brain recruited them, not the manifest's order. The program allows this: ADD_SYNAPSE only
requires the row to carry the next chain index and the two neuron accounts to match the body IDs in
the instruction, never that the row sits at its manifest position. What the manifest hash on the
brain account pins is therefore the *catalogue* a row must come from, not the sequence.

What counts as "exercised" needs care. A ring attractor never falls silent: the ~68 neurons under
the bump keep firing at about 55 Hz whether the fly is turning or holding a heading, so "fired
recently" would be true of half the brain at all times and the writer would never rest. The signal
that does go quiet is recruitment -- a neuron firing after SILENT_TICKS of nothing. Measured on the
trading fly, that is 0-2 neurons a second while the fly holds course, nothing at all for seconds at
a time, then 10-27 in the second it turns.

There is no backlog (the user's choice). The fly opens roughly 3.2 million synapses a second and
Thru accepts around 5-8 rows a second, so any queue that keeps what it cannot send would stay full
forever and the counter would climb at a constant rate no matter what the fly did. Instead the queue
is small and simply stops accepting: a recruited neuron offers BURST of its unwritten rows if there
is room, and offers them again next time it is recruited if there was not. Nothing is lost and
nothing accumulates, so the counter surges when the fly explores and sits still when it does not.

A neuron's own rows are written in manifest order, so what has been recorded is exactly a cursor per
neuron -- 134 integers, which is the whole of the resume state (data/chain_cursors.json).
"""
import json
import os
import threading

import numpy as np

import chain_tx
import live

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
CURSORS = os.path.join(chain_tx.DATA, "chain_cursors.json")

SILENT_TICKS = 500      # quiet this long, then a spike, and the neuron counts as recruited (0.5 s)
# One row per recruitment. Measured on the trading fly, that asks for 4.6 rows/s, which the chain
# (about 8/s) can absorb, so the queue empties between turns and the count visibly rests. At 2 the
# fly asks for 6.7/s, the queue never drains, and the count climbs steadily whatever the fly does --
# which is the behaviour this whole design exists to avoid.
BURST = 1
QUEUE_MAX = 64          # the whole queue: past this the fly's activity is simply not recorded
CHUNK_TICKS = 100       # ticks per step(), one market bar


def model_body_ids(session):
    """Neuron index -> hemibrain body ID, from the file whose row order the model uses."""
    source = session.spec.get("connectome") or {}
    kind = source.get("source", "procedural")
    if kind in ("hemibrain", "hemibrain_averaged"):
        rows = source["file"]
    elif kind == "hemibrain_blend":         # the blend keeps the averaged ring's row order
        rows = source["averaged"]["file"]
    else:
        raise RuntimeError(f"the chain needs a hemibrain connectome to map neurons to body IDs, "
                           f"not {kind!r}: this fly's neurons have no hemibrain identity")
    with np.load(os.path.join(ROOT, rows), allow_pickle=False) as f:
        body_id = [int(b) for b in f["body_id"]]
    if len(body_id) != session.cx.N:
        raise RuntimeError(f"{rows}: {len(body_id)} body IDs for {session.cx.N} neurons")
    return body_id


class Activity:
    """A fly running in the backend, and the synapse rows its spiking asks Thru to record."""

    def __init__(self, manifest, spec_path=None, seed=0, silent_ticks=SILENT_TICKS,
                 burst=BURST, queue_max=QUEUE_MAX):
        self.silent_ticks, self.burst, self.queue_max = silent_ticks, burst, queue_max
        self.session = live.LiveSession(seed=seed, spec_path=spec_path or live.SPEC_PATH)

        syn_pre = manifest["syn_pre"]
        if np.any(np.diff(syn_pre) < 0):
            raise RuntimeError("the manifest's synapses are not grouped by presynaptic neuron; "
                               "a per-neuron cursor would not describe what has been written")
        wallets = len(manifest["wallet_body_id"])
        # rows [begin[w], end[w]) belong to neuron w, in manifest order
        self.begin = np.searchsorted(syn_pre, np.arange(wallets), "left")
        self.end = np.searchsorted(syn_pre, np.arange(wallets), "right")

        # the model orders its neurons its own way; body IDs are the common key
        manifest_of_body = {int(b): i for i, b in enumerate(manifest["wallet_body_id"])}
        try:
            self.to_manifest = np.array([manifest_of_body[b] for b in model_body_ids(self.session)],
                                        np.int64)
        except KeyError as e:
            raise RuntimeError(f"the running fly has neuron {e} but the manifest does not: "
                               f"the brain on chain is not the brain that is running") from None

        self.pre = syn_pre
        # `done` is what the chain has: it only moves when a row lands, and it is what gets saved.
        # `cursor` is how far rows have been handed out, so the same row is not offered twice while
        # it waits. Anything between the two is in flight; on a restart cursor drops back to done
        # and those rows are simply offered again, which is why a crash cannot duplicate a synapse.
        self.done = self.begin.copy()
        self.cursor = self.begin.copy()
        self.last_spike = np.full(self.session.cx.N, -(1 << 62), np.int64)
        self.queue = []
        self.recruited = 0          # recruitment events seen, for the status line
        self.dropped = 0            # offers the queue had no room for (they come round again)
        # the fly runs in one thread and the writer drains in another; reentrant because save()
        # reads the cursors through written()
        self.lock = threading.RLock()

    # ------------------------------------------------------------------ state --

    def seed_from_count(self, n):
        """Set the cursors as if the first n manifest rows were written -- which is exactly what a
        manifest-order run leaves behind, since the rows are grouped by presynaptic neuron. This is
        how a chain filled in manifest order is handed over to the fly without writing anything
        twice."""
        with self.lock:
            self.cursor = np.minimum(np.maximum(n, self.begin), self.end)
        return self.written()

    def load(self, path=CURSORS):
        """Resume where a previous run left off. Returns how many rows it accounts for."""
        if not os.path.exists(path):
            return 0
        with open(path) as f:
            saved = json.load(f)
        cursor = np.array(saved["cursor"], np.int64)
        if len(cursor) != len(self.cursor) or np.any(cursor < self.begin) or np.any(cursor > self.end):
            raise RuntimeError(f"{path}: cursors do not fit this manifest; delete it to start over")
        self.cursor = cursor
        return self.written()

    def save(self, path=CURSORS):
        """Record the cursors before the rows they cover are sent.

        Saving first means a crash loses rows rather than repeating them: a repeat would put the
        same synapse on the chain twice, where a loss just leaves one unrecorded."""
        with self.lock:
            state = {"cursor": [int(c) for c in self.cursor], "written": int(self.written())}
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, path)       # atomic: a torn file would lose every cursor, not one

    def written(self):
        with self.lock:
            return int((self.cursor - self.begin).sum())

    # ------------------------------------------------------------------- live --

    def step(self, ticks=CHUNK_TICKS):
        """Advance the fly and queue what its newly recruited neurons ask to record."""
        frame = self.session.step(ticks)        # outside the lock: the writer must not wait on it
        with self.lock:
            for t, i in frame["spikes"]:
                if t - self.last_spike[i] >= self.silent_ticks:
                    self._offer(int(self.to_manifest[i]))
                self.last_spike[i] = t
        return frame

    def _offer(self, wallet):
        """A neuron fired after being quiet: record a couple more of its synapses, if there is room."""
        self.recruited += 1
        for _ in range(self.burst):
            if len(self.queue) >= self.queue_max:
                self.dropped += 1       # no backlog: it will offer these again when it next fires
                return
            if self.cursor[wallet] >= self.end[wallet]:
                return                  # every synapse this neuron makes is already on the chain
            self.queue.append(int(self.cursor[wallet]))
            self.cursor[wallet] += 1

    def take(self, n):
        """Up to n manifest rows to send now, oldest first."""
        with self.lock:
            taken, self.queue = self.queue[:n], self.queue[n:]
            return taken

    def give_back(self, rows):
        """Rows that did not land: they are still unwritten, so send them again first."""
        with self.lock:
            self.queue[:0] = rows

    def status(self):
        with self.lock:
            return {"queued": len(self.queue), "recruited": self.recruited,
                    "resting": not self.queue, "brain_ticks": int(self.session.t),
                    "neurons_complete": int((self.cursor >= self.end).sum())}
