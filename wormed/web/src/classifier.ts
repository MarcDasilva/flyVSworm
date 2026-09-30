import { BEHAVIOR } from "./body.js";
import type { Behavior, Synapse } from "./chain.js";

// Healthy chain playback can have ~11 s gaps. Re-reading an unchanged account
// must not keep an old directional signal alive indefinitely.
export const BEHAVIOR_STALE_MS = 15_000;

/** A fast current-based contribution to the existing motor-state heuristic.
 * Uses the same five command cells and weights as the on-chain classifier.
 * Chemical inhibition subtracts; gap current also subtracts from its donor.
 * Decay smooths real receipts; no random or clock-generated buy/sell values. */
export class SynapticHeuristic {
  private weights: number[];
  private signed = 0;
  private total = 0;
  private at = 0;

  constructor(names: string[]) {
    const weights: Record<string, number> = { AVBL: .6, PVCL: .4, AVAL: -.5, AVDL: -.3, AVEL: -.2 };
    this.weights = names.map(name => weights[name] ?? 0);
  }

  private decay(now: number): void {
    const factor = Math.exp(-Math.max(0, now - this.at) / 450);
    this.signed *= factor;
    this.total *= factor;
    this.at = now;
  }

  observe(receipt: Synapse, now: number): void {
    this.decay(now);
    const weight = this.weights[receipt.post] - (receipt.chemical ? 0 : this.weights[receipt.pre]);
    const current = receipt.amount * weight;
    this.signed += current;
    this.total += Math.abs(current);
  }

  value(now: number, baseline: number, active: boolean): number {
    this.decay(now);
    if (!active) return 0;
    // 2 native units regularize tiny currents instead of amplifying noise.
    const activity = this.signed / (this.total + 2);
    return Math.max(-1, Math.min(1, .3 * baseline + .7 * activity));
  }
}

const STATES = [
  { label: "Pause", meaning: "" },
  { label: "Forward run", meaning: "" },
  { label: "Reversal", meaning: "" },
  { label: "Omega turn", meaning: "A deep bend that changes heading, often following a reversal." },
] as const;

export function classifyBehavior(sample: Behavior | undefined, ageMs: number, playing: boolean) {
  const unavailable = (status: string, label: string, meaning: string) => ({
    state: null, label, meaning, status, forward: 0, reverse: 0, signal: 0,
  });
  if (!sample) return unavailable("waiting", "Awaiting activity", "The readout starts when a motor-state sample arrives.");
  if (!Number.isInteger(sample.state) || sample.state < 0 || sample.state > 3
      || !Number.isSafeInteger(sample.step) || sample.step < 0
      || !Number.isFinite(ageMs) || ageMs < 0
      || ![sample.driveFwd, sample.driveRev].every(d => Number.isFinite(d) && d >= 0 && d <= 1)) {
    return unavailable("invalid", "Signal unavailable", "The latest sample cannot support a behavior reading.");
  }
  if (ageMs > BEHAVIOR_STALE_MS) {
    return unavailable("stale", "Awaiting updates", "Worm activity has stopped updating. The signal rests at neutral.");
  }
  const forward = sample.driveFwd, reverse = sample.driveRev;
  // A behavior heuristic, not an estimated probability or a market model.
  // Respect the on-chain state (including its hysteresis); opposing drives
  // cannot turn a held forward state into a Sell signal, or vice versa.
  const signal = !playing ? 0
    : sample.state === BEHAVIOR.FORWARD ? Math.max(0, forward - reverse)
    : sample.state === BEHAVIOR.REVERSE ? Math.min(0, forward - reverse) : 0;
  return {
    ...STATES[sample.state], state: sample.state,
    status: playing ? "live" : "buffering", forward, reverse, signal,
  };
}
