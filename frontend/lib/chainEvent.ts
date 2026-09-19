// Decoder for the fly's spike-block event (fly-brain/python/chain_event.py is the spec).
// The same bytes come from the local stand-in today and from the Thru program's events later.

export const FLAG_BOOT = 1;
export const FLAG_LANDMARK = 2;
const HEADER_BYTES = 12;
const READOUTS = ["heading", "strength", "speed", "position", "level"] as const;
const Q = 65536;

export type Readouts = Record<(typeof READOUTS)[number], number>;

export interface SpikeBlock extends Readouts {
  nNeurons: number;
  firstTick: number;
  nTicks: number;
  flags: number;
  /** spike ticks and neurons, in tick order: spikeTick[k] fired neuron spikeNeuron[k] */
  spikeTick: Uint32Array;
  spikeNeuron: Uint16Array;
}

export function decodeSpikeBlock(buf: ArrayBuffer): SpikeBlock {
  const dv = new DataView(buf);
  const version = dv.getUint8(0), kind = dv.getUint8(1);
  if (version !== 1 || kind !== 1) throw new Error(`unsupported event: version ${version}, kind ${kind}`);
  const nNeurons = dv.getUint16(2, true), firstTick = dv.getUint32(4, true);
  const nTicks = dv.getUint16(8, true), flags = dv.getUint16(10, true);
  const rowBytes = (nNeurons + 7) >> 3, end = HEADER_BYTES + nTicks * rowBytes;
  if (buf.byteLength !== end + 4 * READOUTS.length) {
    throw new Error(`event is ${buf.byteLength} bytes, expected ${end + 4 * READOUTS.length}`);
  }
  const bits = new Uint8Array(buf, HEADER_BYTES, nTicks * rowBytes);
  const ticks: number[] = [], neurons: number[] = [];
  for (let k = 0; k < nTicks; k++) {
    for (let b = 0; b < rowBytes; b++) {
      let byte = bits[k * rowBytes + b];
      while (byte) {
        const j = 31 - Math.clz32(byte & -byte);  // lowest set bit
        byte &= byte - 1;
        const i = b * 8 + j;
        if (i >= nNeurons) throw new Error("padding bits past nNeurons are set");
        ticks.push(firstTick + k);
        neurons.push(i);
      }
    }
  }
  const out = { nNeurons, firstTick, nTicks, flags,
                spikeTick: Uint32Array.from(ticks), spikeNeuron: Uint16Array.from(neurons) } as SpikeBlock;
  READOUTS.forEach((key, r) => { out[key] = dv.getInt32(end + 4 * r, true) / Q; });
  return out;
}
