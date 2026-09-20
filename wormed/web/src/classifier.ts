import { BEHAVIOR } from "./body.js";
import type { Behavior } from "./chain.js";

// Healthy chain playback can have ~11 s gaps. Re-reading an unchanged account
// must not keep an old directional signal alive indefinitely.
export const BEHAVIOR_STALE_MS = 15_000;

const STATES = [
  { label: "Pause", meaning: "Low locomotor output. The model is holding its position." },
  { label: "Forward run", meaning: "Head-led movement, continuing a run through the environment." },
  { label: "Reversal", meaning: "Backward movement. Reversals can reposition the worm before a new heading." },
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
