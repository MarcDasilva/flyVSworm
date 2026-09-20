/**
 * Looping ambient beds that swell in and out on random intervals. Started ONLY
 * from the ENTER click — autoplay policy mutes any audio created before a user
 * gesture, and a muted element throws on play() rather than waiting.
 */
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const MUTED_KEY = "worm.muted";
type MuteStorage = Pick<Storage, "getItem" | "setItem">;
/** Every bed ever started, so a mute click reaches beds created before AND after it. */
const beds: HTMLAudioElement[] = [];
let muted = false;

/** The stored preference. ABSENT reads as sound ON — a first visit must not open silent. */
export function readMuted(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try { return storage.getItem(MUTED_KEY) === "1"; } catch { return false; }
}

/** Mutes the element, not the swell: the loop keeps running so unmuting lands
 *  mid-swell instead of restarting the silence. A storage failure (Safari
 *  private mode throws on setItem) still mutes THIS session. */
export function setMuted(on: boolean, storage: MuteStorage = localStorage): void {
  muted = on;
  for (const a of beds) a.muted = on;
  try { storage.setItem(MUTED_KEY, on ? "1" : "0"); } catch { /* remembered next time, or not */ }
}

/** Fade the bed up to `peak`, hold, fade out, sleep a random gap — forever. */
export function ambience(url: string, peak: number): void {
  const a = new Audio(url);
  a.loop = true;
  a.volume = 0;
  a.muted = muted;
  beds.push(a);
  void (async () => {
    // A 404 or a blocked play() rejects once here; the loop never starts, the scene keeps going.
    try { await a.play(); } catch { return; }
    for (;;) {
      await wait(rand(6_000, 25_000));
      await ramp(a, peak, rand(5_000, 9_000));
      await wait(rand(1_500, 5_000));
      await ramp(a, 0, rand(2_000, 5_000));
    }
  })();
}

/** Linear volume ramp; ponytail: setTimeout steps, swap for GainNode if it clicks. */
async function ramp(a: HTMLAudioElement, to: number, ms: number): Promise<void> {
  const from = a.volume, t0 = performance.now();
  for (let t = 0; t < 1; t = (performance.now() - t0) / ms) {
    a.volume = from + (to - from) * Math.min(t, 1);
    await wait(50);
  }
  a.volume = to;
}
