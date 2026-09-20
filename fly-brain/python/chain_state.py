"""The fly brain's presence on Thru, as the backend sees it: a writer thread and a live count.

While the server runs, every synapse in data/chain_manifest.npz becomes one transaction on Thru, sent
one at a time (chain_sync). The neuron wallets are created the same way and normally already exist.
Nothing here is a bulk job: it picks up where the chain left off, and once the chain matches the
manifest the thread idles.

status() is what /api/chain returns and what the page shows:

    transactions   how many the brain has stored: 1 (brain) + neurons + synapses
    neurons        wallets created, of the manifest's total
    synapses       synapses recorded, of the manifest's total
    pending        rows still to send
    sending        whether the writer is running, and its rate
    eta_seconds    pending x the measured seconds per row, so a demo knows what it is watching

Before sending anything the writer runs the same checks as chain_sync's CLI path: the fee payer must
resolve to the brain's authority, and the deployed program and the brain's manifest hash must match
data/chain_deploy.json. It also takes chain_sync's submitter lock, so a hand-run sync cannot sign
with the same key at the same time; sharing a key means sharing its nonce, and both writers stall.
A row that keeps failing (wrong signer, RPC down, stale proof) is not retried forever: after
MAX_FAILS in a row the writer stops sending, keeps the error, and waits.

The count comes from this thread's cursor between reconciles and from the brain account every
CHECK_EVERY rows, so what the page shows stays the chain's number rather than this thread's opinion.
"""
import os
import threading
import time

import chain_deploy

RATE = 5.0          # transactions per second; the CLI path reaches about 0.6/s in practice
ENABLED = False     # server.py sets this from --chain
POLL = 10.0         # seconds between refreshes when there is nothing to send
MAX_FAILS = 5       # consecutive failures before the writer stops sending and waits
COOLDOWN = 60.0     # seconds to wait after that, before looking again
CHECK_EVERY = 100   # rows between reconciling the count with the brain account (see _write)
ACTIVITY = True     # let the running fly choose what to record; False writes the manifest in order
REST_POLL = 0.25    # seconds to wait when the fly has asked for nothing
FLY_SEED = 0        # the backend's own fly, independent of any browser session

_state = {"available": False, "sending": False}
_live = {}          # the running Chain, so stop() can close the node sender it started
_lock = threading.Lock()
_thread = None
_stop = threading.Event()


def _set(**fields):
    with _lock:
        _state.update(fields)


def status():
    """A snapshot for the API: never raises, never blocks on the chain."""
    with _lock:
        return dict(_state)


def _eta(pending, seconds_per_row):
    return round(pending * seconds_per_row) if (pending and seconds_per_row) else None


def _refresh(chain, seconds_per_row=None):
    neurons, synapses, totals = chain.counts()
    pending = (totals[0] - neurons) + (totals[1] - synapses)
    _set(available=True, neurons=f"{neurons}/{totals[0]}", synapses=f"{synapses}/{totals[1]}",
         transactions=1 + neurons + synapses, pending=pending, eta_seconds=_eta(pending, seconds_per_row),
         program=chain.record["program"], brain=chain.record["brain"], network=chain.record.get("network"),
         updated=time.time())
    return neurons, synapses, totals


def _loop():
    """Send one row at a time, for as long as the backend runs."""
    import chain_sync                       # imported here: the API works without the chain tooling
    try:
        chain = chain_sync.Chain()
        # one submitter per fee payer key: a second one races for the nonce and both stall
        with chain_sync.Submitter():
            _write(chain_sync, chain)
    except Exception as e:                  # no record, no CLI, wrong key, wrong brain, or someone
        _set(error=str(e)[:200], sending=False,     # else is already sending
             **({} if status().get("transactions") else {"available": False}))
    finally:
        _set(sending=False)


def _start_fly(manifest, on_chain):
    """The backend's own fly, running in brain real time, whose spiking picks what gets recorded.

    It is its own session, not a browser's: the chain records what the brain does while the backend
    is up, whether or not anyone is watching."""
    import chain_activity
    fly = chain_activity.Activity(manifest, seed=FLY_SEED)
    # where the chain already is. Saved cursors say which rows; failing that the chain was filled in
    # manifest order, and its count says the same thing exactly.
    known = fly.load() or fly.seed_from_count(on_chain)
    if known != on_chain:
        _set(note=f"cursors account for {known} synapses but the chain holds {on_chain}; "
                  f"recording continues from the cursors")
    _live["fly"] = fly
    threading.Thread(target=_fly_loop, args=(fly,), name="chain-fly", daemon=True).start()
    return fly


def _fly_loop(fly):
    """Advance the fly at 1 tick = 1 ms. Falling behind is caught up by resetting the clock, not by
    running fast: a burst of catch-up ticks would recruit neurons that never went quiet."""
    import chain_activity
    period = chain_activity.CHUNK_TICKS / 1000.0
    due = time.monotonic()
    while not _stop.is_set():
        try:
            fly.step()
        except Exception as e:
            _set(error=f"the fly stopped: {str(e)[:150]}")
            return
        due += period
        behind = due - time.monotonic()
        if behind < -1.0:
            due = time.monotonic()
            behind = 0.0
        if behind > 0:
            _stop.wait(behind)


def _record(chain, m, fly, first_index):
    """Send what the fly has asked for -> (rows landed, what to show)."""
    rows = fly.take(chain_sync_batch())
    if not rows:
        return 0, None
    fly.save()          # cursors before the send: a crash then loses a row rather than repeating it
    import chain_sync
    landed = chain_sync.send_chosen(chain, m, rows, first_index, log=lambda _: None)
    if landed < len(rows):
        fly.give_back(rows[landed:])
    return landed, f"{landed} synapse{'' if landed == 1 else 's'} the fly just recruited"


def chain_sync_batch():
    import chain_sync
    return chain_sync.BATCH


def _write(chain_sync, chain):
    """The writer proper, with the submitter's lock held."""
    # the same guards as the CLI path: right signer, right program, right manifest
    signer = chain.signer()
    if signer != chain.record["authority"]:
        raise RuntimeError(f"the fee payer {chain.fee_payer!r} signs as {signer}, but the brain's "
                           f"authority is {chain.record['authority']}")
    problems, _ = chain_deploy.on_chain(chain.record)
    if problems:
        raise RuntimeError("; ".join(problems))
    chain.use_sender()                  # the Node signer when it is there, the CLI when it is not
    _live["chain"] = chain
    neurons, synapses, totals = _refresh(chain)
    import chain_tx
    m = chain_tx.load_manifest()
    fly = _start_fly(m, synapses) if ACTIVITY else None
    _set(sending=True, rate=None if fly else RATE, sender="node" if chain.sender else "cli",
         driven_by="the fly's activity" if fly else "manifest order")
    fails, seconds_per_row, since_check = 0, None, 0
    while not _stop.is_set():
        if (neurons, synapses) >= totals:   # caught up: idle until something changes
            _set(sending=False)
            _stop.wait(POLL)
            try:
                neurons, synapses, totals = _refresh(chain, seconds_per_row)
            except Exception as e:
                _set(error=str(e)[:200])
            continue
        if fails >= MAX_FAILS:              # something is persistently wrong: stop paying for retries
            _set(sending=False, note=f"paused after {fails} failures; retrying in {COOLDOWN:g}s")
            _stop.wait(COOLDOWN)
            fails = 0
            try:
                neurons, synapses, totals = _refresh(chain, seconds_per_row)
            except Exception as e:
                _set(error=str(e)[:200])
            continue
        started = time.monotonic()
        try:
            if neurons < totals[0]:                 # wallets one at a time: each carries a proof
                _, what = chain_sync.send_neuron(chain, m, neurons)
                neurons, just = neurons + 1, 1
            elif fly is not None:                   # the fly picks what to record (chain_activity)
                just, what = _record(chain, m, fly, synapses)
                synapses += just
            else:                                   # synapses a batch at a time (chain_sync.BATCH)
                want = min(chain_sync.BATCH, totals[1] - synapses)
                just = chain_sync.send_synapses(chain, m, synapses, want, log=lambda _: None)
                synapses += just
                what = (f"synapses {synapses - just}-{synapses - 1}" if just > 1
                        else f"synapse {synapses - 1}")
            fails = 0
            if not just:
                # the fly is re-using wiring the chain already has: nothing to record, so rest.
                # This is the normal state between turns, not a fault.
                _set(sending=False, error=None, note=None, updated=time.time(),
                     **(fly.status() if fly else {"resting": True}))
                _stop.wait(REST_POLL)
                continue
            took = (time.monotonic() - started) / just
            seconds_per_row = took if seconds_per_row is None else 0.8 * seconds_per_row + 0.2 * took
            pending = (totals[0] - neurons) + (totals[1] - synapses)
            since_check += just
            _set(last=what, transactions=1 + neurons + synapses, note=None, sending=True,
                 neurons=f"{neurons}/{totals[0]}", synapses=f"{synapses}/{totals[1]}",
                 pending=pending, eta_seconds=None if fly else _eta(pending, seconds_per_row),
                 seconds_per_row=round(seconds_per_row, 2), error=None, updated=time.time(),
                 **(fly.status() if fly else {}))
            # the count above is this thread's cursor, advanced a row at a time. Every so often take
            # it from the brain account instead: then a row that was counted but did not land shows
            # up as the count standing still, rather than as a number that quietly runs ahead of the
            # chain. This is the page's number, so it has to be the chain's.
            if since_check >= CHECK_EVERY:
                since_check = 0
                neurons, synapses, totals = _refresh(chain, seconds_per_row)
        except Exception as e:              # a failed row: re-read the chain and carry on
            fails += 1
            _set(error=str(e)[:200])
            _stop.wait(chain_sync.BACKOFF)
            try:
                neurons, synapses, totals = _refresh(chain, seconds_per_row)
            except Exception as e2:
                _set(error=str(e2)[:200])
            continue
        # In activity mode the fly sets the pace -- it asks for about 4.6 rows a second and the
        # chain can take more than that -- so a clock here would only blur the resting periods.
        # Manifest mode has no such governor and holds the average to RATE, counting rows.
        if not fly:
            _stop.wait(max(0.0, (just / RATE if RATE else 0.0) - (time.monotonic() - started)))
    _set(sending=False)


def start():
    """Start the writer, unless it is switched off or there is no deployment to write to."""
    global _thread
    if not ENABLED:
        _set(available=os.path.exists(chain_deploy.RECORD), sending=False, note="not enabled (server.py --chain)")
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="chain-sync", daemon=True)
    _thread.start()


def stop():
    _stop.set()
    if _thread:
        _thread.join(timeout=5.0)
    chain = _live.pop("chain", None)
    if chain and chain.sender:
        chain.sender.close()            # don't leave the node child running
