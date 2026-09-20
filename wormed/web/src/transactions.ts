import type { Synapse } from "./chain.js";

/** Smooth confirmed receipt bursts over eight seconds of display playback.
 * This changes presentation only; every signature remains a separate transaction. */
export class TransactionPlayback {
  private queue: { receipt: Synapse; at: number }[] = [];
  private seen = new Set<string>();
  private credit = 0;
  private lastTick: number | undefined;
  private receivedAt = -Infinity;

  push(receipt: Synapse, now: number): boolean {
    if (!receipt.signature || this.seen.has(receipt.signature)) return false;
    this.seen.add(receipt.signature);
    if (this.seen.size > 65_536) this.seen.delete(this.seen.values().next().value!);
    this.receivedAt = now;
    this.queue.push({ receipt, at: now });
    // ponytail: bounded display backlog; the chain retains the complete history.
    if (this.queue.length > 32_768) this.queue.splice(0, this.queue.length - 32_768);
    return true;
  }

  get pending(): number { return this.queue.length; }
  age(now: number): number { return now - this.receivedAt; }
  active(now: number): boolean { return this.age(now) < 15_000; }

  tick(now: number): Synapse[] {
    const dt = this.lastTick === undefined ? 1 / 60 : Math.max(0, Math.min(.05, (now - this.lastTick) / 1000));
    this.lastTick = now;
    // Hidden tabs and a stopped relay must not replay minutes of stale activity.
    const firstFresh = this.queue.findIndex(entry => now - entry.at < 15_000);
    if (firstFresh < 0) this.queue.length = 0;
    else if (firstFresh > 0) this.queue.splice(0, firstFresh);
    if (!this.queue.length) { this.credit = 0; return []; }
    this.credit += dt * Math.max(20, this.queue.length / 8);
    const count = Math.min(this.queue.length, Math.floor(this.credit));
    this.credit -= count;
    return this.queue.splice(0, count).map(entry => entry.receipt);
  }
}

/** Incremental, newest-first DOM updates. Scrolling back freezes the visible
 * history; returning to the top resumes without moving the reader's place. */
export class TransactionList {
  private pending: Synapse[] = [];
  private list = document.createElement("ol");

  constructor(private viewport: HTMLElement, latest: HTMLButtonElement,
              private names: string[], private explorer: string) {
    this.list.className = "transactions";
    viewport.replaceChildren(this.list);
    viewport.addEventListener("scroll", () => { latest.hidden = viewport.scrollTop < 4; });
    viewport.addEventListener("keydown", event => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        event.stopPropagation(); // Native list scrolling must not also pan the 3D camera.
    });
    latest.onclick = () => { viewport.scrollTop = 0; latest.hidden = true; };
  }

  add(receipt: Synapse): void {
    this.pending.push(receipt);
    if (this.pending.length > 500) this.pending.splice(0, this.pending.length - 500);
  }

  render(paused: boolean): void {
    this.viewport.classList.toggle("held", paused || this.viewport.scrollTop >= 4);
    if (paused || this.viewport.scrollTop >= 4 || !this.pending.length) return;
    const rows = document.createDocumentFragment();
    for (const receipt of this.pending.reverse()) {
      const row = document.createElement("li");
      row.className = "row";
      row.dataset.signature = receipt.signature;
      const kind = document.createElement("span");
      kind.className = "tx-kind";
      kind.textContent = receipt.chemical ? "chemical" : "electrical";
      const link = document.createElement("a");
      link.href = this.explorer + receipt.signature;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${receipt.signature.slice(0, 12)}…${receipt.signature.slice(-4)}`;
      link.title = receipt.signature;
      const edge = document.createElement("span");
      edge.className = "dim tx-edge";
      edge.textContent = `${this.names[receipt.pre]} → ${this.names[receipt.post]}`;
      edge.title = `${receipt.amount > 0 ? "+" : ""}${receipt.amount} units · simulation step ${receipt.step}`;
      row.append(kind, link, edge);
      rows.append(row);
    }
    this.pending.length = 0;
    this.list.prepend(rows);
    while (this.list.children.length > 500) this.list.lastElementChild!.remove();
  }
}
