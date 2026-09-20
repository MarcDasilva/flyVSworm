import { createThruClient } from "@thru/sdk/client";
import { Pubkey, Signature } from "@thru/sdk";

/**
 * The fly's half of the chain, and the one place that says what it is.
 *
 * The worm's transactions come OUT of the chain: worm.c integrates the
 * membrane equation on chain and fills an on-chain outbox, and the relay
 * settles what is already there. The fly's model runs in fly-brain/python, so
 * its synaptic events are derived HERE — from the model's own spikes and its
 * own weight matrix, both read off the running server — handed to the relay to
 * sign, and read back off the chain as confirmed receipts. The ledger movement
 * and the signature are real; the arithmetic that produced the event is not on
 * chain. See wormed/program/fly.h.
 *
 * Reads go straight from the browser to the node, exactly as chain.ts does.
 * Writes go to the relay, which owns the fee payer's key.
 */

export type FlyConfig = {
  rpc: string; programId: string; accounts: string[];
  reservoirAccount: string; explorer: string;
};

/** Shaped like chain.ts's Synapse so ONE TransactionList renders both animals. */
export type FlySynapse = {
  pre: number; post: number; amount: number;
  step: number; chemical: boolean; signature: string;
};

const TAG = "FLY_SYNX";
const RECEIPT_BYTES = 24;
/** Weight -> units. MUST match web/flysynapses.mjs's UNITS: the relay writes
 *  the amount the program moves, and a mismatch would have the panel quoting
 *  a number the ledger never saw. */
const UNITS = 100;
/** Events per submission, and how often. The model spikes at 1000 ticks/s and
 *  one transaction confirms in ~2 s, so the panel shows a SAMPLE of the
 *  fly's synaptic traffic, never all of it — say so wherever it is displayed. */
const BATCH = 24;
const SUBMIT_MS = 2000;

/** EPG 0-15, PEN_L 16-31, PEN_R 32-47, D7 48-55 — connectome.build_procedural's
 *  order, which is what the model's neuron indices mean. */
export function flyNames(): string[] {
  const out: string[] = [];
  for (const pop of ["EPG", "PEN_L", "PEN_R"]) for (let i = 0; i < 16; i++) out.push(`${pop}${i}`);
  for (let i = 0; i < 8; i++) out.push(`D7${i}`);
  return out;
}

export function decodeFlyReceipt(p: Uint8Array): Omit<FlySynapse, "signature"> | undefined {
  if (p.byteLength !== RECEIPT_BYTES || p[23] !== 0xa5) return undefined;
  if (String.fromCharCode(...p.subarray(0, 8)) !== TAG) return undefined;
  const d = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const pre = d.getUint16(12, true), post = d.getUint16(14, true);
  const amount = d.getInt32(16, true);
  if (pre >= 56 || post >= 56 || amount === 0) return undefined;
  return { step: d.getUint32(8, true), pre, post, amount, chemical: p[20] === 1 };
}

/** The model's own weight matrix, as outgoing edges in whole ledger units.
 *  An edge that rounds to zero units can never be a transaction and is
 *  dropped here rather than rejected on chain. */
export function outgoingEdges(synapses: [number, number, number][]): Map<number, { post: number; amount: number }[]> {
  const out = new Map<number, { post: number; amount: number }[]>();
  for (const [pre, post, w] of synapses) {
    const amount = Math.round(w * UNITS);
    if (!amount || pre === post) continue;
    const list = out.get(pre) ?? [];
    list.push({ post, amount });
    out.set(pre, list);
  }
  return out;
}

export class FlyChain {
  private thru: ReturnType<typeof createThruClient> | undefined;
  private program = "";
  private edges = new Map<number, { post: number; amount: number }[]>();
  /** Events derived since the last submission, capped. */
  private queued: { tick: number; pre: number; post: number; amount: number }[] = [];
  private submitting = false;
  private lastSubmit = 0;
  private cbs: ((s: FlySynapse) => void)[] = [];
  private started = false;
  cfg: FlyConfig | undefined;
  /** What the HUD reports: submitted by us, confirmed back off the chain, and
   *  the fly's OWN fee payer — not the worm's. See web/flysynapses.mjs. */
  stats = { submitted: 0, confirmed: 0, queued: 0, balance: undefined as number | undefined, error: "" };

  onSynapse(cb: (s: FlySynapse) => void): void { this.cbs.push(cb); }

  /** Loads the config and the model's wiring, then opens the read stream.
   *  Idempotent: the fly exhibit may be opened and closed repeatedly. */
  async start(signal: AbortSignal): Promise<void> {
    if (this.started || signal.aborted) return;
    this.started = true;
    try {
      const [cfg, network] = await Promise.all([
        fetch("/fly.json").then(r => r.json() as Promise<FlyConfig>),
        fetch("/fly/api/network").then(r => r.json() as Promise<{ synapses: [number, number, number][] }>),
      ]);
      this.cfg = cfg;
      this.edges = outgoingEdges(network.synapses);
      this.thru = createThruClient({ baseUrl: cfg.rpc, callOptions: { timeoutMs: 10_000 } });
      this.program = Pubkey.from(cfg.programId).toHex();
      void this.streamLoop(signal);
    } catch (e) {
      this.started = false;             // a closed relay or model must be retryable
      this.stats.error = String((e as Error)?.message ?? e).slice(0, 120);
    }
  }

  /** Every spike in a frame becomes its outgoing synaptic events. */
  observe(tick: number, spiked: ArrayLike<number>): void {
    if (!this.edges.size) return;
    for (let i = 0; i < spiked.length; i++) {
      for (const edge of this.edges.get(spiked[i]) ?? [])
        this.queued.push({ tick, pre: spiked[i], post: edge.post, amount: edge.amount });
    }
    // Bounded, and the NEWEST are kept: a backlog the chain can never catch up
    // with would have the panel showing firing that is minutes old.
    if (this.queued.length > 4096) this.queued.splice(0, this.queued.length - 4096);
    this.stats.queued = this.queued.length;
  }

  /** Call once a frame. Submits at most one batch per SUBMIT_MS. */
  tick(now: number): void {
    if (this.submitting || !this.cfg || now - this.lastSubmit < SUBMIT_MS) return;
    if (!this.queued.length) return;
    this.lastSubmit = now;
    this.submitting = true;
    void this.submit().finally(() => { this.submitting = false; });
  }

  private async submit(): Promise<void> {
    // A UNIFORM sample of what the model produced this window, not the
    // strongest events: taking the largest weights would show only the one
    // population that has them and read as the whole circuit.
    const pool = this.queued;
    this.queued = [];
    this.stats.queued = 0;
    const events = [];
    for (let i = 0; i < BATCH && pool.length; i++)
      events.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    try {
      const r = await fetch("/api/fly/synapses", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
      });
      const body = await r.json() as { submitted?: number; balance?: number; error?: string };
      if (!r.ok) throw Error(body.error ?? `relay ${r.status}`);
      this.stats.submitted += body.submitted ?? 0;
      if (body.balance !== undefined) this.stats.balance = body.balance;
      this.stats.error = "";
    } catch (e) {
      this.stats.error = String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 120);
    }
  }

  /** The node drops a subscription on any hiccup; reopen until aborted. */
  private async streamLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        for await (const { event } of this.thru!.events.stream({ signal })) {
          if (!event.program || !event.payload) continue;
          if (Pubkey.from(event.program).toHex() !== this.program) continue;
          const decoded = decodeFlyReceipt(event.payload);
          if (!decoded) continue;
          this.stats.confirmed++;
          const signature = event.transactionSignature
            ? Signature.from(event.transactionSignature).toThruFmt() : "";
          this.cbs.forEach(cb => cb({ ...decoded, signature }));
        }
      } catch (err) {
        if (signal.aborted) return;
        console.warn("fly chain: event stream dropped, reconnecting", err);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
