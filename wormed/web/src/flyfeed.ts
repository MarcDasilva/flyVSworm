// The fly's own activity, straight from the model that produces it:
// fly-brain/python/server.py streams one JSON frame per simulated frame. A
// frame carries `rates` (per neuron, Hz, averaged over the model's rate
// window) and `spikes` ([tick, neuron] for every spike in the frame). Nothing
// here invents activity — with the server down the brain hangs there dark,
// which is the truth about what the fly is doing.
//
// Start it with:  python3 fly-brain/python/server.py

/** Through the dev server's /fly proxy (vite.config.ts), NOT straight at port
 *  8000: the same origin is what lets /fly/api/network be read as well, and
 *  that server sends no CORS headers. */
// Vercel rewrites HTTP but not WebSockets, so a hosted page names the fly server outright
// (VITE_FLY_WS); the dev server proxies it same-origin.
export const FLY_WS = import.meta.env?.VITE_FLY_WS ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/fly/ws`;
const RETRY_MS = 2000;

export type FlyFrame = {
  /** The model's own tick count at the end of this frame, and when the page
   *  received it — the readout quotes the AGE of what it is showing. */
  tick: number;
  at: number;
  /** Firing rate per neuron, Hz, indexed by the live model's neuron index. */
  rates: Float32Array;
  /** Neuron indices that spiked in this frame, newest frame only. */
  spiked: Uint16Array;
  /** Heading the bump encodes, radians, and how sharp the bump is (0..1). */
  heading: number;
  strength: number;
  /** Bumps the model counts. Exactly ONE is the circuit working; the readout
   *  says so rather than hiding it. */
  bumps: number;
  /** "boot" while the landmark is forming the bump, "live" after. */
  phase: string;
  /** Push-pull drive onto PEN_L / PEN_R, the model's own input units. */
  driveL: number;
  driveR: number;
  /** The momentum signal the fly trades on, -1..1, and the fraction of equity
   *  its readout is holding. Both are the model's, not this page's. */
  signal: number;
  position: number;
  /** The model's own market, which is NOT the room's shared demo market —
   *  the modal shows the shared one, the same as the worm's. */
  equity: number;
};

export type FlyStatus = "connecting" | "live" | "offline";

/**
 * Keeps a socket open to the fly and hands the newest frame to the scene. The
 * socket is reopened on every drop: a demo must not need a page reload to
 * come back when the model is restarted.
 */
export class FlyFeed {
  frame: FlyFrame | null = null;
  status: FlyStatus = "offline";
  /** Frames seen, the HUD's proof that the fly is actually running. */
  frames = 0;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private signal: AbortSignal | null = null;

  constructor(private readonly url = FLY_WS) {}

  connect(signal: AbortSignal): void {
    // A connection includes its retry delay, so another click cannot start a second loop.
    if (this.signal || signal.aborted) return;
    this.signal = signal;
    signal.addEventListener("abort", this.disconnect, { once: true });
    this.open(signal);
  }

  disconnect = (): void => {
    this.signal?.removeEventListener("abort", this.disconnect);
    this.signal = null;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    const socket = this.socket;
    this.socket = null; // A deliberate close must not schedule another connection.
    socket?.close();
    this.frame = null;
    this.status = "offline";
  };

  private open(signal: AbortSignal): void {
    if (signal.aborted || this.signal !== signal || this.socket) return;
    this.status = "connecting";
    const ws = new WebSocket(this.url);
    this.socket = ws;
    ws.onmessage = ev => {
      if (this.socket !== ws) return;
      if (typeof ev.data !== "string") return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;                       // not ours; the server also sends replies
      }
      if (msg.type !== "frame" || !Array.isArray(msg.rates)) return;
      const spikes = Array.isArray(msg.spikes) ? msg.spikes as [number, number][] : [];
      this.frame = {
        tick: Number(msg.t) || 0,
        at: performance.now(),
        rates: Float32Array.from(msg.rates as number[]),
        spiked: Uint16Array.from(spikes.map(s => s[1])),
        heading: Number(msg.heading) || 0,
        strength: Number(msg.strength) || 0,
        bumps: Number(msg.bumps) || 0,
        phase: typeof msg.phase === "string" ? msg.phase : "",
        driveL: Number(msg.drive_l) || 0,
        driveR: Number(msg.drive_r) || 0,
        signal: Number(msg.signal) || 0,
        position: Number(msg.position) || 0,
        equity: Number(msg.equity) || 1,
      };
      this.status = "live";
      this.frames++;
    };
    const reopen = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.status = "offline";
      // Drop the last frame with the socket. Holding it would leave the brain
      // glowing with the firing of a model that is no longer running.
      this.frame = null;
      if (!signal.aborted) this.retry = setTimeout(() => {
        this.retry = null;
        this.open(signal);
      }, RETRY_MS);
    };
    ws.onclose = reopen;
    ws.onerror = () => ws.close();
  }
}
