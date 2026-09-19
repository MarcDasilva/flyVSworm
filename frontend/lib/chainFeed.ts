// Where the brain view gets its spikes. Today: the local stand-in (fly-brain/python/chain_server.py),
// which sends the same spike-block bytes the Thru program will emit. Later: a Thru feed (StreamEvents
// via @thru/sdk) implementing the same interface, so the scene does not change.

import { decodeSpikeBlock, type SpikeBlock } from "./chainEvent";

export interface BrainInfo {
  spec: string;
  connectome: Record<string, unknown>;  // the spec's connectome block (source, file(s), sha256)
  n_neurons: number;
  body_id: number[];
  ticks_per_block: number;
}

export type FeedStatus = "connecting" | "live" | "offline";

export interface FeedHandlers {
  onBrain(info: BrainInfo): void;
  onBlock(block: SpikeBlock): void;
  onStatus(status: FeedStatus): void;
  /** a message could not be decoded: the producer and this view disagree on the format */
  onError(message: string): void;
}

export interface ChainFeed {
  close(): void;
}

export const CHAIN_WS = process.env.NEXT_PUBLIC_CHAIN_WS ?? "ws://127.0.0.1:8001/ws/chain";
const RETRY_MS = 1500;

/** The local stand-in: first a JSON "brain" message, then one binary spike block per 100 ticks. */
export function connectLocalFeed(h: FeedHandlers, url: string = CHAIN_WS): ChainFeed {
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const open = () => {
    h.onStatus("connecting");
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      let block: SpikeBlock;
      try {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.type === "brain") h.onBrain(msg as BrainInfo);
          return;
        }
        block = decodeSpikeBlock(ev.data as ArrayBuffer);
      } catch (e) {
        h.onError(`Could not read the fly's event: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      h.onStatus("live");
      h.onBlock(block);
    };
    ws.onclose = () => {
      if (closed) return;
      h.onStatus("offline");
      retry = setTimeout(open, RETRY_MS);
    };
  };
  open();
  return {
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    },
  };
}
