"use client";

import { useEffect, useRef, useState } from "react";

// How many transactions the fly brain has stored on Thru: one per synapse, plus the 134 neuron
// wallets and the brain record itself. The Python backend writes them while it runs and serves the
// running totals; this only reads them, so the number on screen is the chain's, not the browser's.
//
// The number moves when the fly does. A synapse is recorded the first time the brain recruits it,
// so holding a heading records nothing and a turn records a burst -- the stillness is the fly
// re-using wiring the chain already has, not the backend having stopped.
interface ChainStatus {
  available?: boolean;
  transactions?: number;
  neurons?: string;
  synapses?: string;
  pending?: number;
  sending?: boolean;
  resting?: boolean;        // the fly is asking for nothing: every synapse it used is on chain
  queued?: number;          // synapses it has asked for and the chain has not taken yet
  recruited?: number;       // neurons that have woken since the backend started
  eta_seconds?: number | null;
  network?: string;
  error?: string | null;
  note?: string | null;
}

const POLL_MS = 1000;   // the backend serves this from memory, so a one-second tick is cheap

const hours = (seconds: number) =>
  seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : `${Math.round(seconds / 60)} min`;

export default function ChainCounter() {
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(false);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next: ChainStatus = await (await fetch("/api/chain", { cache: "no-store" })).json();
        if (!live) return;
        if (next.transactions !== undefined && next.transactions !== previous.current) {
          if (previous.current !== null) {          // flash when new synapses land
            setTick(true);
            setTimeout(() => live && setTick(false), 180);
          }
          previous.current = next.transactions;
        }
        // keep the last good reading rather than blanking: a writer that pauses still has a count
        if (next.transactions !== undefined) setStatus(next);
        setStale(next.available === false);
      } catch {
        if (live) setStale(true);                   // the backend is not answering; hold the number
      }
      if (live) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  if (!status?.transactions) return null;           // nothing has ever been read: stay out of the way

  const trouble = stale ? "backend not answering" : status.error ? `stalled: ${status.error}` : status.note;
  const left = status.pending
    ? `${status.pending.toLocaleString()} to go${status.eta_seconds ? `, ~${hours(status.eta_seconds)}` : ""}`
    : "complete";
  // resting is the fly re-using wiring already on chain, which is most of the time
  const doing = stale ? null
    : status.resting ? "resting — the fly is re-using wiring already recorded"
    : status.queued ? `recording ${status.queued} synapse${status.queued === 1 ? "" : "s"} the fly just recruited`
    : null;

  return (
    <div style={{ position: "fixed", top: 16, left: 16, zIndex: 50, pointerEvents: "none",
                  padding: "10px 14px", borderRadius: 12, background: "rgba(20,22,27,0.82)",
                  border: "1px solid #2a2e35", color: "#c9d1db", font: "13px system-ui, sans-serif",
                  backdropFilter: "blur(6px)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                       color: tick ? "#7cc4ff" : "#f2f5f9",
                       transition: tick ? "none" : "color 700ms ease-out" }}>
          {status.transactions.toLocaleString()}
        </span>
        <span style={{ color: "#8b949e" }}>
          transactions on Thru{status.network ? ` (${status.network})` : ""}
        </span>
      </div>
      <div style={{ marginTop: 4, color: "#8b949e", fontSize: 12 }}>
        {status.neurons} neuron wallets · {status.synapses} synapses · {left}
      </div>
      {doing && (
        <div style={{ marginTop: 4, fontSize: 12, display: "flex", alignItems: "center", gap: 6,
                      color: status.resting ? "#6e7681" : "#7cc4ff" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "0 0 auto",
                         background: status.resting ? "#3d444d" : "#7cc4ff" }} />
          {doing}
        </div>
      )}
      {trouble && <div style={{ marginTop: 4, color: "#e5a3a3", fontSize: 12 }}>{trouble}</div>}
    </div>
  );
}
