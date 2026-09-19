// The computer screen: a trading-style chart drawn on a canvas and used as a three.js texture.
// Stand-in data: a random-walk price in 1 s candles. The fly's keystrokes type order commands
// on the bottom line; Enter fills the order, moves the position strip and marks the candle.

import * as THREE from "three";

const W = 1024;
const H = 640;
const CANDLES = 48;           // visible candles
const CANDLE_SECONDS = 0.8;
const SUBSTEPS = 8;           // random-walk steps per candle

const C = {
  bg: "#070b14",
  grid: "#162032",
  text: "#7f93ad",
  bright: "#dbe6f3",
  up: "#34d399",
  down: "#f87171",
  accent: "#5eead4",
};

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  position: number;      // position held during this candle, -1..1
  fill?: "buy" | "sell"; // an order filled during this candle
}

export class TradingScreen {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly font = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

  private candles: Candle[] = [];
  private price = 100;
  private drift = 0;
  private position = 0;
  private sinceCandle = 0;

  private command = "";
  private typed = 0;          // characters of `command` typed so far
  private lastFill = "";
  private cursorOn = true;
  private sinceBlink = 0;
  private dirty = true;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    for (let i = 0; i < CANDLES; i++) this.candles.push(this.nextCandle());
    this.command = this.nextCommand();
  }

  /** Advance the market and the cursor blink; redraws the texture only when something changed. */
  update(dt: number) {
    this.sinceCandle += dt;
    if (this.sinceCandle >= CANDLE_SECONDS) {
      this.sinceCandle -= CANDLE_SECONDS;
      this.candles.push(this.nextCandle());
      this.candles.shift();
      this.dirty = true;
    }
    this.sinceBlink += dt;
    if (this.sinceBlink >= 0.5) {
      this.sinceBlink = 0;
      this.cursorOn = !this.cursorOn;
      this.dirty = true;
    }
    if (this.dirty) this.draw();
  }

  /** One keystroke from the fly: the next character of the command, or Enter once it is complete. */
  keystroke() {
    if (this.typed < this.command.length) {
      this.typed++;
    } else {
      this.fill();
      this.command = this.nextCommand();
      this.typed = 0;
    }
    this.cursorOn = true;
    this.sinceBlink = 0;
    this.dirty = true;
  }

  dispose() {
    this.texture.dispose();
  }

  private nextCandle(): Candle {
    if (Math.random() < 0.06) this.drift = (Math.random() - 0.5) * 0.12; // new regime
    const open = this.price;
    let high = open;
    let low = open;
    for (let i = 0; i < SUBSTEPS; i++) {
      this.price = Math.max(20, this.price + this.drift + (Math.random() - 0.5) * 0.5);
      high = Math.max(high, this.price);
      low = Math.min(low, this.price);
    }
    return { open, high, low, close: this.price, position: this.position };
  }

  /** Momentum trader: buy into a rising market, sell into a falling one. */
  private nextCommand(): string {
    const recent = this.candles.slice(-6);
    const rising = recent.length > 1 && recent[recent.length - 1].close >= recent[0].open;
    const size = (1 + Math.floor(Math.random() * 6)) * 0.05;
    return `${rising ? "buy" : "sell"} ${size.toFixed(2)}`;
  }

  private fill() {
    const [side, sizeText] = this.command.split(" ");
    const size = Number(sizeText);
    this.position = Math.max(-1, Math.min(1, this.position + (side === "buy" ? size : -size)));
    const last = this.candles[this.candles.length - 1];
    last.position = this.position;
    last.fill = side === "buy" ? "buy" : "sell";
    this.lastFill = `filled ${side.toUpperCase()} ${sizeText} @ ${this.price.toFixed(2)}`;
  }

  private draw() {
    this.dirty = false;
    const g = this.ctx;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    // header
    g.font = `500 26px ${this.font}`;
    g.textBaseline = "middle";
    g.fillStyle = C.text;
    g.textAlign = "left";
    g.fillText("MARKET · 1s", 32, 36);
    g.textAlign = "right";
    const pos = this.position;
    g.fillStyle = pos > 0.001 ? C.up : pos < -0.001 ? C.down : C.text;
    const label = pos > 0.001 ? "LONG" : pos < -0.001 ? "SHORT" : "FLAT";
    g.fillText(`${label} ${Math.abs(pos).toFixed(2)}`, W - 32, 36);

    // price chart
    const top = 72;
    const bottom = 420;
    const left = 32;
    const right = W - 120;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of this.candles) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    const pad = (hi - lo) * 0.08 + 0.01;
    lo -= pad;
    hi += pad;
    const y = (p: number) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);

    g.strokeStyle = C.grid;
    g.lineWidth = 2;
    g.font = `20px ${this.font}`;
    g.textAlign = "left";
    g.fillStyle = C.text;
    for (let i = 0; i <= 4; i++) {
      const p = lo + ((hi - lo) * i) / 4;
      const yy = Math.round(y(p));
      g.beginPath();
      g.moveTo(left, yy);
      g.lineTo(right, yy);
      g.stroke();
      g.fillText(p.toFixed(2), right + 12, yy);
    }

    const step = (right - left) / CANDLES;
    const body = step * 0.62;
    this.candles.forEach((c, i) => {
      const x = left + step * (i + 0.5);
      const color = c.close >= c.open ? C.up : C.down;
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y(c.high));
      g.lineTo(x, y(c.low));
      g.stroke();
      const y0 = y(Math.max(c.open, c.close));
      const h = Math.max(2, y(Math.min(c.open, c.close)) - y0);
      g.fillRect(x - body / 2, y0, body, h);
      if (c.fill) {
        const buy = c.fill === "buy";
        const ty = buy ? y(c.low) + 16 : y(c.high) - 16;
        g.fillStyle = C.accent;
        g.beginPath();
        g.moveTo(x, ty + (buy ? -8 : 8));
        g.lineTo(x - 8, ty + (buy ? 6 : -6));
        g.lineTo(x + 8, ty + (buy ? 6 : -6));
        g.closePath();
        g.fill();
      }
    });

    // last price tag
    const lastY = y(this.price);
    g.fillStyle = C.accent;
    g.fillRect(right + 4, lastY - 14, W - right - 12, 28);
    g.fillStyle = C.bg;
    g.fillText(this.price.toFixed(2), right + 12, lastY);

    // position strip: one bar per candle, up = long, down = short
    const mid = 486;
    const half = 44;
    g.fillStyle = C.text;
    g.fillText("POS", right + 12, mid);
    g.strokeStyle = C.grid;
    g.beginPath();
    g.moveTo(left, mid);
    g.lineTo(right, mid);
    g.stroke();
    this.candles.forEach((c, i) => {
      if (Math.abs(c.position) < 0.001) return;
      const x = left + step * i + (step - body) / 2;
      g.fillStyle = c.position > 0 ? C.up : C.down;
      const h = c.position * half;
      g.fillRect(x, h > 0 ? mid - h : mid, body, Math.abs(h));
    });

    // command line
    g.fillStyle = C.text;
    g.font = `22px ${this.font}`;
    g.fillText(this.lastFill, left, 568);
    g.font = `500 28px ${this.font}`;
    g.fillStyle = C.bright;
    const line = `> ${this.command.slice(0, this.typed)}`;
    g.fillText(line, left, 608);
    if (this.cursorOn) {
      const cx = left + g.measureText(line).width + 4;
      g.fillStyle = C.accent;
      g.fillRect(cx, 594, 15, 28);
    }

    this.texture.needsUpdate = true;
  }
}
