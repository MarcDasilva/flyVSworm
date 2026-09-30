import { createThruClient } from "@thru/sdk/client";
import { Filter, FilterParamValue, PageRequest, Pubkey, Signature } from "@thru/sdk";
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
  synapseTransactions?: boolean;
};

/** One settled gap junction, as worm.h's worm_xfer_t lays it out. */
export type Transfer = { pre: number; post: number; amount: number };
export type Synapse = Transfer & { step: number; chemical: boolean; signature: string };

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
  | { kind: "xfer"; step: number; transfers: Transfer[] }
  | { kind: "synapse"; step: number; pre: number; post: number; amount: number; chemical: boolean };

export function decodeEvent(p: Uint8Array): DecodedEvent | undefined {
  const tag = tagOf(p);
  if (tag === "WORMSYNX") {
    if (p.byteLength !== 24 || p[23] !== 0xa5 || p[20] > 1) return undefined;
    const d = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const pre = d.getUint16(12, true), post = d.getUint16(14, true);
    const amount = d.getInt32(16, true);
    if (pre >= N_NEURONS || post >= N_NEURONS || amount === 0) return undefined;
    return { kind: "synapse", step: d.getUint32(8, true), pre, post, amount, chemical: p[20] === 1 };
  }
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

export type Standing = { specimen: string; profit: number; trades: number; updated: number };

export type RelayStatus = {
  balance: number; floor: number; faucet: string;
  stepping: boolean; awake: boolean; workerAlive: boolean;
  log: { t: number; op: string; sig?: string; ms?: number; error?: string }[];
  /** The relay's ledger (wormed/web/store.mjs), ranked and totalled. Absent from an older relay
   *  or one whose database would not open — the board falls back to what the page has counted. */
  transactions?: number;
  standings?: Standing[];
  /** The relay's account of the fly it drives (relay.mjs) — absent from an older relay. */
  fly?: { model: "live" | "offline"; frames: number; submitted: number; balance?: number; error: string };
};

/** Floor on the gap between played frames. The chain delivers a burst every
 *  few seconds and this spreads it; at 8 ms a backed-up queue drains at up to
 *  125 frames/s, which is what makes the cloud look alive rather than
 *  stepping. Raise it if the queue never empties. */
const PLAY_FLOOR_MS = 8;
/** Ceiling on that gap. 400 ms plus a deep queue was unrecoverable. */
const PLAY_CEIL_MS = 150;
/** burstMs is an estimate of the arrival period; clamp it so one stall does
 *  not poison the average. */
const BURST_MS_MIN = 400;
const BURST_MS_MAX = 6000;
/** Most frames one tick may play. Bounds a stall from strobing the cloud. */
const CATCHUP_MAX = 40;

export class ChainFeed {
  private thru;
  private program: string;
  private queue: Frame[] = [];
  private frameCbs: ((f: Frame) => void)[] = [];
  private synapseCbs: ((s: Synapse) => void)[] = [];
  private behaviorCbs: ((b: Behavior) => void)[] = [];
  private statusCbs: ((s: RelayStatus) => void)[] = [];
  private partial = new Map<number, Partial<Frame>>();
  private lastPlay = 0;
  private lastArrival = 0;
  private burstMs = 5000;
  private lastSynapseAt = -Infinity;
  private lastRecoveryAt = -Infinity;
  private recovering = false;
  /** Frames delivered to the scene, and events seen — the HUD's proof of life. */
  stats = { frames: 0, events: 0, transfers: 0, lastStep: 0, lag: 0, burstMs: 0, interval: 0 };

  constructor(private readonly cfg: ChainConfig) {
    this.thru = createThruClient({ baseUrl: cfg.rpc, callOptions: { timeoutMs: 10_000 } });
    this.program = Pubkey.from(cfg.programId).toHex();
  }

  onFrame(cb: (f: Frame) => void): void { this.frameCbs.push(cb); }
  onSynapse(cb: (s: Synapse) => void): void { this.synapseCbs.push(cb); }
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
      if (this.cfg.synapseTransactions) this.push({ ...ev, transfers: [], signature });
      else this.merge(ev.step, { mV: ev.mV, state: ev.state, signature });
    } else if (ev.kind === "synapse") {
      this.lastSynapseAt = performance.now();
      this.stats.transfers++;
      this.synapseCbs.forEach(cb => cb({ ...ev, signature }));
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
      // Clamped: a startup stall or a stream reconnect is a multi-SECOND gap,
      // and letting that into the average pins the play interval at its
      // ceiling forever, after which the queue can never drain.
      if (gap > 200) {
        const g = Math.min(gap, BURST_MS_MAX);
        this.burstMs = Math.min(BURST_MS_MAX,
          Math.max(BURST_MS_MIN, this.burstMs * 0.7 + g * 0.3));
      }
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
    const interval = Math.min(PLAY_CEIL_MS,
      Math.max(PLAY_FLOOR_MS, this.burstMs / this.queue.length));
    this.stats.burstMs = Math.round(this.burstMs);
    this.stats.interval = Math.round(interval);
    if (now - this.lastPlay < interval) return undefined;

    // Play every frame that came DUE since the last tick, not a fixed number.
    // A fixed budget ties playback to the render rate, and on a slow renderer
    // (software WebGL manages about 1 fps with 9,400 neurites) that caps
    // playback far below the arrival rate — the queue then only grows and the
    // oldest frames are dropped at the cap, so the cloud drifts further and
    // further behind the chain. Bounded so one long stall cannot dump the
    // whole queue into a single frame.
    const due = Math.floor((now - this.lastPlay) / interval);
    const budget = Math.max(1, Math.min(CATCHUP_MAX, due));
    this.lastPlay = now;
    let f: Frame | undefined;
    for (let i = 0; i < budget && this.queue.length; i++) {
      f = this.queue.shift()!;
      this.stats.frames++;
      this.stats.lastStep = f.step;
      this.frameCbs.forEach(cb => cb(f!));
    }
    this.stats.lag = this.queue.length;
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
      // A stream may miss a burst during reconnect. Recover recent confirmed
      // receipts independently so this read cannot hold up the viewer heartbeat.
      const now = performance.now();
      if (this.cfg.synapseTransactions && !this.recovering &&
          now - this.lastSynapseAt > 2000 && now - this.lastRecoveryAt > 3000) {
        this.recovering = true;
        this.lastRecoveryAt = now;
        void this.recoverSynapses(signal).catch(err => {
          if (!signal.aborted) console.warn("chain: receipt recovery failed", err);
        }).finally(() => { this.recovering = false; });
      }
      try {
        const s = await (await fetch("/api/status")).json() as RelayStatus;
        this.statusCbs.forEach(cb => cb(s));
      } catch { /* the relay may not be up; the chain half still works */ }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  private async recoverSynapses(signal: AbortSignal): Promise<void> {
    const height = await this.thru.blocks.getBlockHeight();
    // Only recent blocks: reopening the exhibit must not replay old history
    // as present activity. The playback queue deduplicates stream/recovery overlap.
    const from = height.finalized > 80n ? height.finalized - 80n : 0n;
    const result = await this.thru.events.list({
      filter: new Filter({
        expression: `event.slot >= uint(${from}) && event.program.value == params.address && bytesPrefix(event.payload, params.prefix)`,
        params: { address: FilterParamValue.pubkey(this.cfg.programId),
          prefix: FilterParamValue.bytes(new TextEncoder().encode("WORMSYNX")) },
      }),
      page: new PageRequest({ pageSize: 1000 }),
    });
    if (signal.aborted) return;
    for (const event of result.events.reverse()) {
      if (event.payload && event.transactionSignature)
        this.ingest(event.payload, Signature.from(event.transactionSignature).toThruFmt());
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
