/** Brief voltage dips, separated by 5–16 seconds of steady light. Time is in ms. */
export function createFlicker(): (now: number) => number {
  let start = 0, end = 0, depth = 0;
  return now => {
    // A paused tab skips missed dips instead of playing them back in a burst.
    if (now >= end) {
      start = now + 5000 + Math.random() * 11000;
      end = start + 90 + Math.random() * 150;
      depth = 0.3 + Math.random() * 0.45;
    }
    if (now < start) return 1;
    const phase = (now - start) / (end - start);
    return 1 - depth * Math.sin(Math.PI * phase) ** 0.4;
  };
}
