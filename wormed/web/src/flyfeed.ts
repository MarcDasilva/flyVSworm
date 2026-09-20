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
export const FLY_WS = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/fly/ws`;
const RETRY_MS = 2000;

export type FlyFrame = {
  /** Firing rate per neuron, Hz, indexed by the live model's neuron index. */
  rates: Float32Array;
  /** Neuron indices that spiked in this frame, newest frame only. */
  spiked: Uint16Array;
  /** Heading the bump encodes, radians, and how sharp the bump is (0..1). */
  heading: number;
  strength: number;
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

  constructor(private readonly url = FLY_WS) {}

  connect(signal: AbortSignal): void {
    if (this.socket || signal.aborted) return;
    this.open(signal);
  }

  private open(signal: AbortSignal): void {
    if (signal.aborted) return;
    this.status = "connecting";
    const ws = new WebSocket(this.url);
    this.socket = ws;
    ws.onmessage = ev => {
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
        rates: Float32Array.from(msg.rates as number[]),
        spiked: Uint16Array.from(spikes.map(s => s[1])),
        heading: Number(msg.heading) || 0,
        strength: Number(msg.strength) || 0,
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
      if (!signal.aborted) setTimeout(() => this.open(signal), RETRY_MS);
    };
    ws.onclose = reopen;
    ws.onerror = () => ws.close();
    signal.addEventListener("abort", () => ws.close(), { once: true });
  }
}
