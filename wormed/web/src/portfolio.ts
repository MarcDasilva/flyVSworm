/** Local paper trading against the room's demo market. No brokerage orders.
 * Positive tilt sets the fraction invested; negative tilt returns to cash. */
export class WormPortfolio {
  readonly startingBalance = 10_000;
  cash = this.startingBalance;
  shares = 0;
  trades = 0;

  equity(price: number): number { return this.cash + this.shares * price; }

  rebalance(price: number, tilt: number): void {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(tilt)) return;
    const target = this.equity(price) * Math.max(0, Math.min(1, tilt)) / price;
    const change = target - this.shares;
    if (Math.abs(change * price) < 1) return;
    this.cash = Math.max(0, this.cash - change * price);
    this.shares = target;
    this.trades++;
  }
}
