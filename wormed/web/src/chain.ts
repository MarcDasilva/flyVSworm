import { createThruClient } from "@thru/sdk/client";
import { Pubkey, Signature } from "@thru/sdk";
import type { BehaviorState } from "./body.js";

/**
 * Everything on screen that claims to come from the chain comes through here.
 *
 * Reads go DIRECT from the browser to the Thru node over gRPC-Web — the
 * relay signs, it does not relay data. Writes (the two touch buttons) go to
 * the relay, which owns the fee payer's key; see web/relay.mjs.
 */

export type ChainConfig = {
  rpc: string;
  programId: string;
  behaviorAccount: string;
  dtMs: number;
  explorer: string;
};

/** One settled gap junction, as worm.h's worm_xfer_t lays it out. */
export type Transfer = { pre: number; post: number; amount: number };

/** One emitted simulation frame, plus whatever settled in the same chunk. */
export type Frame = {
  step: number;
  mV: Int16Array;
  /** The behavior byte the trace carried. The scene does NOT drive the body
   * from this — the behavior ACCOUNT is the one authority, and reading the
   * same fact from two places is how they end up disagreeing on stage. */
  state: number;
  transfers: Transfer[];
  signature: string;
};

// worm.h's WORM_EVENT_* tags, read as a little-endian u64 from the first
// eight bytes of the payload. VERIFIED against a live alphanet stream: the
// gRPC event carries the WHOLE emitted buffer, tag included — it is `thru
// txn get` that splits the tag off into its own `event_type` field. So the
// tag is the discriminator here, and the transfer event's variable length
// is never asked to stand in for one.
const TAG_TRACE = "WORMTRCE";
const TAG_XFER = "WORMGAPX";
const N_NEURONS = 302;
const TRACE_BYTES = 8 + N_NEURONS * 2 + 8;   // tag + worm_trace_t

function tagOf(p: Uint8Array): string {
  if (p.byteLength < 8) return "";
  return String.fromCharCode(...p.subarray(0, 8));
}

/** What the program emitted, decoded. Unknown tags yield undefined. */
export type DecodedEvent =
  | { kind: "trace"; step: number; state: number; mV: Int16Array }
  | { kind: "xfer"; step: number; transfers: Transfer[] };

export function decodeEvent(p: Uint8Array): DecodedEvent | undefined {
  const tag = tagOf(p);
  if (tag === TAG_TRACE) {
    if (p.byteLength !== TRACE_BYTES) return undefined;
    const d = new DataView(p.buffer, p.byteOffset, p.byteLength);
    return { kind: "trace", mV: voltages(p),
             step: d.getUint32(8 + N_NEURONS * 2, true),
             state: d.getUint8(8 + N_NEURONS * 2 + 4) };
  }
  if (tag === TAG_XFER) {
    if (p.byteLength < 17) return undefined;
    const { step, list } = transfers(p);
    return { kind: "xfer", step, transfers: list };
  }
  return undefined;
}

/**
 * int16 millivolts, zero-copy where the runtime lets us.
 *
 * mV starts at byte 8 of the payload, and 8 is even — so the view is legal
 * exactly when the payload's own byteOffset is even. protobuf-es hands out
 * subarrays of a shared read buffer and makes NO alignment promise; an odd
 * offset throws RangeError, and a throw inside the stream loop kills the
 * whole feed with no error on screen.
 */
function voltages(p: Uint8Array): Int16Array {
  const off = p.byteOffset + 8;
  if (off % 2 === 0) return new Int16Array(p.buffer, off, N_NEURONS);
  return new Int16Array(p.slice(8, 8 + N_NEURONS * 2).buffer);
}

function transfers(p: Uint8Array): { step: number; list: Transfer[] } {
  const d = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const step = d.getUint32(8, true);
  const count = d.getUint32(12, true);
  const list: Transfer[] = [];
  // A truncated payload must yield fewer particles, never a RangeError.
  const have = Math.min(count, Math.floor((p.byteLength - 17) / 8));
  for (let k = 0; k < have; k++) {
    const at = 16 + k * 8;
    list.push({ pre: d.getUint16(at, true), post: d.getUint16(at + 2, true),
                amount: d.getInt32(at + 4, true) });
  }
  return { step, list };
}

/** worm_behavior_t, 32 bytes. gain and the drives are Q16.16. */
export type Behavior = BehaviorState & {
  driveFwd: number; driveRev: number; step: number;
};

function decodeBehavior(data: Uint8Array): Behavior {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    state: (d.getUint8(0) & 3) as 0 | 1 | 2 | 3,
    gain: d.getInt32(4, true) / 65536,
    driveFwd: d.getInt32(8, true) / 65536,
    driveRev: d.getInt32(12, true) / 65536,
    step: d.getUint32(20, true),
  };
}

export type RelayStatus = {
  balance: number; floor: number; faucet: string;
  stepping: boolean; awake: boolean; workerAlive: boolean;
  log: { t: number; op: string; sig?: string; ms?: number; error?: string }[];
};

export class ChainFeed {
  private thru;
  private program: string;
  private queue: Frame[] = [];
  private frameCbs: ((f: Frame) => void)[] = [];
  private behaviorCbs: ((b: Behavior) => void)[] = [];
  private statusCbs: ((s: RelayStatus) => void)[] = [];
  private partial = new Map<number, Partial<Frame>>();
  private lastPlay = 0;
  private lastArrival = 0;
  private burstMs = 5000;
  /** Frames delivered to the scene, and events seen — the HUD's proof of life. */
  stats = { frames: 0, events: 0, transfers: 0, lastStep: 0, lag: 0 };

  constructor(private readonly cfg: ChainConfig) {
    this.thru = createThruClient({ baseUrl: cfg.rpc });
    this.program = Pubkey.from(cfg.programId).toHex();
  }

  onFrame(cb: (f: Frame) => void): void { this.frameCbs.push(cb); }
  onBehavior(cb: (b: Behavior) => void): void { this.behaviorCbs.push(cb); }
  onStatus(cb: (s: RelayStatus) => void): void { this.statusCbs.push(cb); }

  start(signal: AbortSignal): void {
    void this.streamLoop(signal);
    void this.pollLoop(signal);
  }

  /**
   * The node drops the subscription on any hiccup and the demo must not need
   * a page reload to come back, so the stream is re-opened until aborted.
   */
  private async streamLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        for await (const { event } of this.thru.events.stream({ signal })) {
          if (!event.program || !event.payload) continue;
          if (Pubkey.from(event.program).toHex() !== this.program) continue;
          this.ingest(event.payload,
                      event.transactionSignature
                        ? Signature.from(event.transactionSignature).toThruFmt() : "");
        }
      } catch (err) {
        if (signal.aborted) return;
        console.warn("chain: event stream dropped, reconnecting", err);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  /**
   * Trace and transfer events for the SAME step arrive as two events of one
   * transaction, and the particles belong with the voltages they moved — so
   * a step is held back until both halves are in, or until the next step
   * makes it clear the other half is not coming.
   */
  private ingest(payload: Uint8Array, signature: string): void {
    this.stats.events++;
    const ev = decodeEvent(payload);
    if (!ev) return;
    if (ev.kind === "trace") {
      this.merge(ev.step, { mV: ev.mV, state: ev.state, signature });
    } else {
      this.stats.transfers += ev.transfers.length;
      this.merge(ev.step, { transfers: ev.transfers, signature });
    }
  }

  private merge(step: number, part: Partial<Frame>): void {
    // worm.c emits trace-then-settle per chunk, so a NEW trace proves the
    // previous step's transfer event is either already here or was never
    // emitted (the step ran without bit3). Either way that frame plays now
    // rather than waiting for an event that is not coming.
    if (part.mV) this.flushBefore(step);
    const held = this.partial.get(step) ?? { step };
    Object.assign(held, part);
    this.partial.set(step, held);
    if (held.mV && held.transfers) {
      this.partial.delete(step);
      this.push(held as Frame);
    }
  }

  private flushBefore(step: number): void {
    for (const [k, v] of this.partial) {
      if (k >= step) continue;
      this.partial.delete(k);
      // A transfer event with no frame behind it has nothing to draw against.
      if (v.mV) this.push({ transfers: [], ...v } as Frame);
    }
  }

  private push(f: Frame): void {
    const now = performance.now();
    if (this.lastArrival) {
      const gap = now - this.lastArrival;
      if (gap > 200) this.burstMs = this.burstMs * 0.7 + gap * 0.3;  // burst period
    }
    this.lastArrival = now;
    this.queue.push(f);
    this.queue.sort((a, b) => a.step - b.step);
    if (this.queue.length > 120) this.queue.splice(0, this.queue.length - 120);
  }

  /**
   * Playback pacing. Frames land in bursts — one transaction carries twenty
   * of them — so replaying them the moment they arrive would strobe the
   * whole brain and then freeze for three seconds. Spreading the queue over
   * the measured burst period instead keeps the cloud moving continuously,
   * and shows every frame the chain actually computed.
   */
  tick(): Frame | undefined {
    if (!this.queue.length) return undefined;
    const now = performance.now();
    const interval = Math.min(400, Math.max(40, this.burstMs / this.queue.length));
    if (now - this.lastPlay < interval) return undefined;
    this.lastPlay = now;
    const f = this.queue.shift()!;
    this.stats.frames++;
    this.stats.lastStep = f.step;
    this.stats.lag = this.queue.length;
    this.frameCbs.forEach(cb => cb(f));
    return f;
  }

  /** The behavior account is the ONE authority on what the body is doing. */
  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const acc = await this.thru.accounts.get(this.cfg.behaviorAccount);
        const bytes = acc.data?.data;
        if (bytes && bytes.byteLength >= 32) {
          const b = decodeBehavior(bytes);
          this.behaviorCbs.forEach(cb => cb(b));
        }
      } catch (err) {
        console.warn("chain: behavior read failed", err);
      }
      try {
        const s = await (await fetch("/api/status")).json() as RelayStatus;
        this.statusCbs.forEach(cb => cb(s));
      } catch { /* the relay may not be up; the chain half still works */ }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  /** Both buttons. The browser NEVER holds the fee payer key — relay.mjs does. */
  async touch(neuron: string): Promise<string> {
    const r = await fetch("/api/touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ neuron }),
    });
    const body = await r.json();
    return r.ok ? `queued ${neuron}` : `RELAY: ${body.error}`;
  }
}
