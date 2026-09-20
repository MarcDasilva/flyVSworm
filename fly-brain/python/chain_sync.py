"""Keep the brain on Thru caught up with data/chain_manifest.npz, while the backend runs.

Not a bulk load: a reconciling writer. It asks the brain account what it already has, sends the next
pending rows at a gentle rate, and repeats; when the chain matches the manifest it has nothing to do
and idles. Restarting loses nothing, because the resume point is on chain (the brain's counts) and
the program rejects any row that is not the next one, so a retry or a crash cannot double-record.

    python chain_sync.py --status          what the chain has, and what is pending
    python chain_sync.py --rows 10         send the next 10 pending rows and stop
    python chain_sync.py --run             keep going until the chain matches the manifest
    python chain_sync.py --dry-run --rows 3    build the transactions, send nothing

Rows go out in manifest order: the 134 neurons (each creates its account, so it needs a derived
address and a fresh state proof), then the 114,854 synapses (no proof; their accounts exist).

Transaction accounts are passed one --readwrite-accounts flag each, in ascending key order, so an
instruction's account_index is 2 + the account's position in that order (0 is the fee payer, 1 is the
program). The fee payer is passed explicitly, so the run cannot silently sign as whatever key the CLI
config happens to default to. The cursor is kept
locally and re-read from the chain only at startup and after a failure: reading it every row costs a
round trip, and the program is the authority on duplicates anyway.
"""
import argparse
import base64
import collections
import json
import os
import queue
import struct
import subprocess
import threading
import time

import chain_deploy
import chain_tx

SENDER = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sender"))
DATA = chain_tx.DATA
ADDRESSES = os.path.join(DATA, "chain_accounts.json")   # seed -> {address, hex}, a local cache
LOCK = os.path.join(DATA, "chain_sender.lock")          # one submitter per fee payer key
RATE = 5.0                                              # transactions per second
BATCH = 32                                              # synapse rows submitted together
BACKOFF = 5.0                                           # seconds to wait after a failure
CHECK_EVERY = 500                                       # rows between re-reading the brain account


def _take(handle, release=False):
    """Lock (or release) one byte of an open file, without waiting: OSError when someone holds it."""
    handle.seek(1 << 30)                                # a byte past anything we write, so the
    if os.name == "nt":                                 # bookkeeping below never touches the lock
        import msvcrt
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK if release else msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN if release else fcntl.LOCK_EX | fcntl.LOCK_NB)


class Submitter:
    """The exclusive right to submit transactions for the fee payer key, held for a run.

    Two processes signing with the same key race for its nonce: each builds on the last nonce it
    saw, so the slower one is rejected (NONCE_TOO_LOW) and, because the chain keeps moving, so is
    every row it sends after that. A backend writer and a hand-run `--rows` is enough to do it. The
    operating system drops this lock when the holder exits, so a crash does not strand it."""

    def __enter__(self):
        self.handle = open(LOCK, "a+")
        try:
            _take(self.handle)
        except OSError:
            self.handle.seek(0)
            holder = self.handle.readline().strip() or "another process"
            self.handle.close()
            raise RuntimeError(f"{holder} is already submitting with this key; two submitters race "
                               "for the fee payer's nonce and both stall. It keeps the lock while "
                               f"it lives, including between retries ({LOCK})") from None
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(f"pid {os.getpid()} since {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        self.handle.flush()
        return self

    def __exit__(self, *exc):
        try:
            _take(self.handle, release=True)
        finally:
            self.handle.close()


def thru(*args, rpc=None):
    """Run the thru CLI and return stdout; raises RuntimeError on a non-zero exit."""
    cmd = chain_deploy.thru_cmd() + list(args) + ["--quiet"]
    if rpc:
        cmd += ["--url", rpc]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        text = (out.stderr or out.stdout).strip()
        raise RuntimeError(text.splitlines()[-1] if text else f"thru {' '.join(args)} failed")
    return out.stdout


def field(text, label):
    for line in text.splitlines():
        if label in line:
            return line.split(":", 1)[1].strip()
    raise RuntimeError(f"no {label!r} in: {text.strip()[:200]}")


class Sender:
    """The Node signer (sender/sender.mjs), kept running: the CLI costs ~2.4 s a row in process
    startup alone, where this builds, signs and submits in place (~0.4 s, waiting for execution).
    Falls back to None when Node or its packages are missing, and the CLI path is used instead."""

    TIMEOUT = 45.0          # a row waits at most this long; the SDK's own tracking gives up at 30 s
    BATCH_TIMEOUT = 120.0   # a batch waits longer still: the sender's own tracking gives up at 90 s

    def __init__(self, record):
        env = dict(os.environ, THRU_PROGRAM=record["program"], THRU_FEE_PAYER=record["authority"])
        if record.get("rpc"):
            env["THRU_RPC"] = record["rpc"]
        self.proc = subprocess.Popen(["node", "sender.mjs"], cwd=SENDER, env=env, text=True, bufsize=1,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, shell=(os.name == "nt"))
        # both streams are drained by threads: a blocking readline would hang the writer if node
        # stalls or dies, and the page would keep showing "sending" forever
        self.replies, self.errors = queue.Queue(), collections.deque(maxlen=20)
        self._pump(self.proc.stdout, self.replies.put)
        self._pump(self.proc.stderr, self.errors.append)
        hello = json.loads(self._reply(self.TIMEOUT) or "{}")
        if not hello.get("ready"):
            raise RuntimeError(f"the sender did not start: {hello}")
        self.id = 0

    def _pump(self, stream, sink):
        threading.Thread(target=lambda: [sink(line) for line in iter(stream.readline, "")],
                         daemon=True).start()

    def _reply(self, timeout):
        try:
            return self.replies.get(timeout=timeout)
        except queue.Empty:
            raise RuntimeError(f"the sender did not answer in {timeout:g}s{self._why()}") from None

    def _why(self):
        """Whatever node said on the way down, so a crash is diagnosable."""
        tail = "".join(self.errors).strip().splitlines()
        return f": {tail[-1][:150]}" if tail else ""

    @classmethod
    def maybe(cls, record, log=None):
        try:
            return cls(record)
        except Exception as e:                      # no node, no install, no key: use the CLI
            if log:
                log(f"sender unavailable ({str(e)[:80]}); falling back to the thru CLI")
            return None

    def _ask(self, request, timeout):
        self.id += 1
        try:
            self.proc.stdin.write(json.dumps(dict(request, id=self.id)) + "\n")
            self.proc.stdin.flush()
        except OSError as e:
            raise RuntimeError(f"the sender stopped ({e}){self._why()}") from None
        deadline = time.monotonic() + timeout
        while True:                 # a late reply from a timed-out row must not answer this one
            reply = json.loads(self._reply(max(1.0, deadline - time.monotonic())))
            if reply.get("id") == self.id:
                return reply

    def send(self, accounts, payload):
        """Submit one instruction and wait for the node to execute it (rows must land in order)."""
        reply = self._ask({"accounts": accounts, "data": payload.hex()}, self.TIMEOUT)
        if reply.get("error") or not reply.get("executed"):
            raise RuntimeError(reply.get("error", "not executed"))
        return reply.get("signature", "sent")

    def send_batch(self, rows):
        """Submit a run of rows together -> how many executed, in order, and why the run stopped.

        Rows after a failure are not counted even if the node executed them: the program keys each
        row to the brain's current count, so once one is missing the rest are writing the wrong
        index. The caller re-reads the chain and rebuilds from there."""
        reply = self._ask({"op": "batch", "rows": rows}, self.BATCH_TIMEOUT)
        if reply.get("error"):
            raise RuntimeError(reply["error"])
        landed, results = reply.get("landed", 0), reply.get("results", [])
        stopped = results[landed].get("error") if landed < len(results) else None
        return landed, stopped

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.terminate()
        except Exception:
            pass


class Chain:
    """The CLI, the deployment record and the address cache, held open for a sync run."""

    def __init__(self, record=None):
        if record is None:
            with open(chain_deploy.RECORD) as f:
                record = json.load(f)
        self.record = record
        self.rpc = record.get("rpc")
        self.fee_payer = record.get("fee_payer", "default")   # the CLI key name that signs
        self.cache = {}
        if os.path.exists(ADDRESSES):
            with open(ADDRESSES) as f:
                self.cache = json.load(f)
        if self.cache.get("program") != self.record["program"]:
            self.cache = {"program": self.record["program"]}
        # keep only entries in the current {address, hex} form (an older cache held bare addresses)
        self.cache = {k: v for k, v in self.cache.items() if k == "program" or isinstance(v, dict)}
        self.cache.setdefault(BRAIN, {"address": record["brain"], "hex": self.pubkey_hex(record["brain"])})
        self.sender = None          # set by use_sender(); address derivation and proofs stay on the CLI

    # ------------------------------------------------------------- accounts --

    def address(self, seed_text):
        """(address, key bytes) for a seed, derived once and cached: each derivation is a CLI call."""
        hit = self.cache.get(seed_text)
        if not hit:
            out = thru("program", "derive-address", self.record["program"], seed_text, rpc=self.rpc)
            address = field(out, "Derived Address")
            key = field(thru("util", "convert", "pubkey", "thrufmt-to-hex", address, rpc=self.rpc), "Hex public key")
            hit = self.cache[seed_text] = {"address": address, "hex": key}
            with open(ADDRESSES, "w") as f:
                json.dump(self.cache, f, indent=1)
        return hit["address"], bytes.fromhex(hit["hex"])

    def account_list(self, seeds):
        """Accounts sorted ascending (as transactions require) -> (addresses, index per seed)."""
        pairs = {s: self.address(s) for s in dict.fromkeys(seeds)}
        order = sorted(pairs, key=lambda s: pairs[s][1])
        return [pairs[s][0] for s in order], {s: 2 + i for i, s in enumerate(order)}

    def state_proof(self, address):
        """A fresh 'creating' proof for an account that does not exist yet."""
        return bytes.fromhex(field(thru("txn", "make-state-proof", "creating", address, rpc=self.rpc),
                                   "Proof Data (hex)"))

    # --------------------------------------------------------------- brain --

    def counts(self):
        """(neurons, synapses, totals) from the brain account: the resume point."""
        out = thru("getaccountinfo", self.record["brain"], "--json", rpc=self.rpc)
        data = base64.b64decode(json.loads(out)["account_info"]["data"])
        _, _, _, neurons, synapses, neuron_total, synapse_total = struct.unpack_from("<BB2sIIII", data)
        return neurons, synapses, (neuron_total, synapse_total)

    def pubkey_hex(self, address):
        return field(thru("util", "convert", "pubkey", "thrufmt-to-hex", address, rpc=self.rpc), "Hex public key")

    def signer(self):
        """The address the fee payer key resolves to: it must be the brain's authority, or every row
        is rejected after paying for a state proof."""
        return field(thru("getbalance", self.fee_payer, rpc=self.rpc), "Account")

    def use_sender(self, log=None):
        """Sign and submit through the Node sender when it is available (about 6x the CLI's rate)."""
        self.sender = self.sender or Sender.maybe(self.record, log)
        return self.sender is not None

    def execute(self, accounts, payload, dry_run=False):
        if dry_run:
            return f"[dry run] {len(payload)} bytes, accounts {','.join(a[:8] for a in accounts)}"
        if self.sender:
            return self.sender.send(accounts, payload)
        flags = [x for a in accounts for x in ("--readwrite-accounts", a)]   # one flag per account
        out = thru("txn", "execute", "--fee", "0", "--fee-payer", self.fee_payer, *flags,
                   self.record["program"], payload.hex(), rpc=self.rpc)
        for label in ("Signature", "signature"):
            try:
                return field(out, label)
            except RuntimeError:
                pass
        return "sent"


# ------------------------------------------------------------------- rows --

BRAIN = "\0brain"       # a key for the brain account in an account list (not a seed)


def send_neuron(chain, m, row, dry_run=False):
    """CreateNeuron for manifest row `row`: derives its account and proves it does not exist yet."""
    i, body, cls, wedge, sign, seed_text = next(chain_tx.neuron_rows(m, start=row))
    address, _ = chain.address(seed_text)
    accounts, index = chain.account_list([BRAIN, seed_text])
    proof = b"" if dry_run else chain.state_proof(address)
    payload = chain_tx.create_neuron(index[BRAIN], index[seed_text], i, body, cls, wedge, sign, proof=proof)
    return chain.execute(accounts, payload, dry_run), f"neuron {i} ({cls} {body})"


def send_synapse(chain, m, row, dry_run=False):
    """AddSynapse for manifest row `row`, against the two neurons' accounts."""
    i, pre, post, pre_body, post_body, pre_xyz, post_xyz = next(chain_tx.synapse_rows(m, start=row))
    pre_seed = chain_tx.NEURON_SEED.format(body_id=pre_body)
    post_seed = chain_tx.NEURON_SEED.format(body_id=post_body)
    accounts, index = chain.account_list([BRAIN, pre_seed, post_seed])   # a self-synapse lists one neuron
    payload = chain_tx.add_synapse(index[BRAIN], index[pre_seed], index[post_seed], i,
                                   pre_body, post_body, pre_xyz, post_xyz)
    return chain.execute(accounts, payload, dry_run), f"synapse {i} ({pre_body} -> {post_body})"


def _row(chain, m, manifest_row, chain_index):
    """One AddSynapse transaction: manifest_row says which synapse, chain_index where it lands.

    The two are the same in a manifest-order run and differ when the fly's activity picks the
    order (chain_activity): the program only requires chain_index to be the brain's next count."""
    body = m["wallet_body_id"]
    pre, post = int(m["syn_pre"][manifest_row]), int(m["syn_post"][manifest_row])
    pre_body, post_body = int(body[pre]), int(body[post])
    pre_seed = chain_tx.NEURON_SEED.format(body_id=pre_body)
    post_seed = chain_tx.NEURON_SEED.format(body_id=post_body)
    accounts, index = chain.account_list([BRAIN, pre_seed, post_seed])
    payload = chain_tx.add_synapse(index[BRAIN], index[pre_seed], index[post_seed], chain_index,
                                   pre_body, post_body,
                                   m["syn_pre_xyz"][manifest_row], m["syn_post_xyz"][manifest_row])
    return {"accounts": accounts, "data": payload.hex()}


def synapse_batch(chain, m, start, count):
    """`count` AddSynapse rows from `start`, built and addressed but not sent."""
    last = min(start + count, len(m["syn_pre"]))
    return [_row(chain, m, i, i) for i in range(start, last)]


def send_chosen(chain, m, manifest_rows, first_index, log=print):
    """Send the given manifest rows, numbered from first_index -> how many landed, in order.

    This is the activity-ordered path: the rows are whichever synapses the fly just exercised, and
    they take the next chain indices in the order given. As in any batch, only a leading run of
    successes counts, because the program keys each row to the brain's count at the time."""
    if not manifest_rows:
        return 0
    rows = [_row(chain, m, row, first_index + n) for n, row in enumerate(manifest_rows)]
    if not chain.sender or len(rows) < 2:
        chain.execute(rows[0]["accounts"], bytes.fromhex(rows[0]["data"]))
        return 1
    landed, stopped = chain.sender.send_batch(rows)
    if stopped and landed < len(rows):
        log(f"the run stopped after {landed}/{len(rows)} ({stopped})")
        if not landed:
            raise RuntimeError(stopped)
    return landed


def send_synapses(chain, m, start, count, log):
    """Send up to `count` synapse rows from `start` -> how many landed, in order.

    A row sent on its own waits a slot for its own execution, which is about a second: at 114k rows
    that is a day and a half. A batch is signed with consecutive nonces and submitted together, and
    the runtime runs a fee payer's transactions in nonce order, so the rows still execute in the
    order the program requires -- a slot's worth at a time instead of one."""
    if not chain.sender or count < 2:
        _, what = send_synapse(chain, m, start)
        log(what)
        return 1
    landed, stopped = chain.sender.send_batch(synapse_batch(chain, m, start, count))
    log(f"synapses {start}-{start + landed - 1}: {landed} landed" if landed else
        f"synapse {start}: nothing landed")
    if stopped and landed < count:
        log(f"the run stopped at synapse {start + landed} ({stopped})")
        if not landed:
            raise RuntimeError(stopped)     # nothing moved: let the caller re-read and back off
    return landed


def sync(rows=None, run=False, dry_run=False, rate=RATE, log=print, chain=None):
    """Send pending rows until `rows` are sent, or (with run) until the chain matches the manifest.

    The cursor lives here: seeded from the chain, advanced on each row, re-read only after a failure."""
    chain = chain or Chain()
    m = chain_tx.load_manifest()
    if dry_run:
        return _sync(chain, m, rows, run, dry_run, rate, log)
    with Submitter():                       # nothing is signed outside this
        return _sync(chain, m, rows, run, dry_run, rate, log)


def _sync(chain, m, rows, run, dry_run, rate, log):
    if not dry_run:
        signer = chain.signer()
        if signer != chain.record["authority"]:
            raise RuntimeError(f"the fee payer {chain.fee_payer!r} signs as {signer}, but the brain's "
                               f"authority is {chain.record['authority']}: every row would be rejected")
        # once, not per row: is the deployed program ours, and is this brain writing our manifest?
        problems, _ = chain_deploy.on_chain(chain.record)
        if problems:
            raise RuntimeError("; ".join(problems))
    neurons, synapses, totals = chain.counts()
    sent, interval, since_check = 0, (1.0 / rate if rate else 0.0), 0
    while (rows is None or sent < rows) and (neurons, synapses) < totals:
        if since_check >= CHECK_EVERY:      # the cursor below is ours; every so often take the
            since_check = 0                 # chain's, so a long run cannot drift away from it
            neurons, synapses, totals = chain.counts()
        started = time.monotonic()
        try:
            if neurons < totals[0]:                     # wallets first, one at a time: each one
                result, what = send_neuron(chain, m, neurons, dry_run)   # carries its own proof
                neurons += 1
                just = 1
                log(f"{what}: {result[:28]}")
            elif dry_run:
                result, what = send_synapse(chain, m, synapses, dry_run)
                synapses += 1
                just = 1
                log(f"{what}: {result[:28]}")
            else:
                want = min(BATCH, totals[1] - synapses, rows - sent if rows else BATCH)
                just = send_synapses(chain, m, synapses, want, log)
                synapses += just
            sent += just
            since_check += just
        except RuntimeError as e:
            log(f"failed ({e}); re-reading the chain and retrying in {BACKOFF:g}s")
            time.sleep(BACKOFF)
            neurons, synapses, totals = chain.counts()
            continue
        if rows is None and not run:
            break
        # hold the average to `rate`, counting rows rather than batches
        time.sleep(max(0.0, just * interval - (time.monotonic() - started)))
    if (neurons, synapses) >= totals:
        log(f"chain matches the manifest: {neurons} neurons, {synapses} synapses")
    return sent


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="what the chain has, and what is pending")
    ap.add_argument("--rows", type=int, default=None, help="send this many pending rows, then stop")
    ap.add_argument("--run", action="store_true", help="keep going until the chain matches the manifest")
    ap.add_argument("--dry-run", action="store_true", help="build the transactions but send nothing")
    ap.add_argument("--rate", type=float, default=RATE, help=f"transactions per second (default {RATE:g})")
    ap.add_argument("--cli", action="store_true", help="use the thru CLI per transaction instead of the sender")
    args = ap.parse_args()
    if args.status:
        chain = Chain()
        neurons, synapses, totals = chain.counts()
        print(f"on chain: {neurons}/{totals[0]} neurons, {synapses}/{totals[1]} synapses; "
              f"{totals[0] - neurons + totals[1] - synapses} rows pending")
    else:
        chain = Chain()
        if not args.cli and not args.dry_run:
            chain.use_sender(log=print)
        sync(rows=args.rows, run=args.run, dry_run=args.dry_run, rate=args.rate, chain=chain)
