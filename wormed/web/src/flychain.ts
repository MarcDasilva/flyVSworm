import { createThruClient } from "@thru/sdk/client";
import { Pubkey, Signature } from "@thru/sdk";

/**
 * The fly's half of the chain, and the one place that says what it is.
 *
 * The worm's transactions come OUT of the chain: worm.c integrates the
 * membrane equation on chain and fills an on-chain outbox, and the relay
 * settles what is already there. The fly's model runs in fly-brain/python
 * beside the relay, which derives its synaptic events from the model's own
 * spikes and its own weight matrix and signs them (relay.mjs, flysynapses.mjs).
 * The browser only READS: confirmed receipts straight off the node, exactly as
 * chain.ts does, and the relay's own tally over /api/status. The ledger
 * movement and the signature are real; the arithmetic that produced the event
 * is not on chain. See wormed/program/fly.h.
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

export class FlyChain {
  private thru: ReturnType<typeof createThruClient> | undefined;
  private program = "";
  private cbs: ((s: FlySynapse) => void)[] = [];
  private started = false;
  cfg: FlyConfig | undefined;
  /** What the HUD reports. Confirmed is counted here off the chain; the rest is the relay's
   *  own account of its submissions, copied in from /api/status — and the balance is the fly's
   *  OWN fee payer, not the worm's. See web/flysynapses.mjs. */
  stats = { submitted: 0, confirmed: 0, balance: undefined as number | undefined, error: "" };

  onSynapse(cb: (s: FlySynapse) => void): void { this.cbs.push(cb); }

  /** Loads the config, then opens the read stream.
   *  Idempotent: the fly exhibit may be opened and closed repeatedly. */
  async start(signal: AbortSignal): Promise<void> {
    if (this.started || signal.aborted) return;
    this.started = true;
    try {
      const cfg = await fetch("/fly.json").then(r => r.json() as Promise<FlyConfig>);
      this.cfg = cfg;
      this.thru = createThruClient({ baseUrl: cfg.rpc, callOptions: { timeoutMs: 10_000 } });
      this.program = Pubkey.from(cfg.programId).toHex();
      void this.streamLoop(signal);
    } catch (e) {
      this.started = false;             // a closed relay or model must be retryable
      this.stats.error = String((e as Error)?.message ?? e).slice(0, 120);
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
