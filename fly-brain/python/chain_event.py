"""The spike-block event the fly program on Thru is meant to emit (tsys_emit_event), and its decoder.

Until the fixed-point Thru program exists, chain_server.py produces these same bytes from the
Python model, so the 3D view reads exactly the format it will later read from the chain.
Integers only: the Thru VM has no floating point.

Layout, version 1, little-endian:
    offset  size  field
    0       u8    version (1)
    1       u8    kind (1 = spike block)
    2       u16   n_neurons
    4       u32   first_tick
    8       u16   n_ticks
    10      u16   flags: bit 0 boot (the bump is still forming), bit 1 landmark shown during the block
    12      n_ticks * ceil(n_neurons / 8) bytes of spike bits: row k is tick first_tick + k;
                  neuron i is bit (i % 8) (least significant first) of byte i // 8 of its row;
                  the padding bits past n_neurons in each row's last byte are 0
    ...     5 x i32 Q16.16 readouts, as the session holds them after the block's last tick:
                  heading     metrics.heading of the per-wedge EPG rates over the last live.RATE_WINDOW
                              ticks (wedges, 0..n_wedges)
                  strength    the bump strength from the same call (0..1)
                  speed       trading.Readout.speed: turning over its window_ticks (wedges/s, + = CCW)
                  position    trading.Readout.position (-1..1; 0 during boot)
                  level       trading.DriveMapper.level(): signed drive, x threshold current
                  Q16.16 = round(x * 65536), Python round() (halves to even), saturated to i32.

Comparing two producers (this model vs the Thru program): spike bits must match exactly; readouts
only within a tolerance, since the chain computes them natively in fixed point.
"""
import struct

VERSION = 1
KIND_SPIKES = 1
FLAG_BOOT = 1
FLAG_LANDMARK = 2
HEADER = struct.Struct("<BBHIHH")
READOUTS = ("heading", "strength", "speed", "position", "level")
TAIL = struct.Struct("<" + "i" * len(READOUTS))
Q = 1 << 16


def row_bytes(n_neurons):
    return (n_neurons + 7) // 8


def to_q16(x):
    return max(-(1 << 31), min((1 << 31) - 1, int(round(x * Q))))


def encode(first_tick, n_ticks, n_neurons, spikes, readouts, flags=0):
    """spikes: iterable of (tick, neuron) with first_tick <= tick < first_tick + n_ticks.
    readouts: dict with the READOUTS keys, floats."""
    rb = row_bytes(n_neurons)
    bits = bytearray(n_ticks * rb)
    for t, i in spikes:
        k = t - first_tick
        if not (0 <= k < n_ticks and 0 <= i < n_neurons):
            raise ValueError(f"spike ({t}, {i}) outside the block")
        bits[k * rb + i // 8] |= 1 << (i % 8)
    head = HEADER.pack(VERSION, KIND_SPIKES, n_neurons, first_tick, n_ticks, flags)
    return head + bytes(bits) + TAIL.pack(*(to_q16(readouts[k]) for k in READOUTS))


def decode(buf):
    version, kind, n, first, n_ticks, flags = HEADER.unpack_from(buf, 0)
    if version != VERSION or kind != KIND_SPIKES:
        raise ValueError(f"unsupported event: version {version}, kind {kind}")
    rb = row_bytes(n)
    end = HEADER.size + n_ticks * rb
    if len(buf) != end + TAIL.size:
        raise ValueError(f"event is {len(buf)} bytes, expected {end + TAIL.size}")
    pad = (0xFF << (n % 8)) & 0xFF if n % 8 else 0
    if pad and any(buf[HEADER.size + k * rb + rb - 1] & pad for k in range(n_ticks)):
        raise ValueError("padding bits past n_neurons are set")
    spikes = [(first + k, b * 8 + j)
              for k in range(n_ticks) for b in range(rb)
              for j in range(8) if buf[HEADER.size + k * rb + b] >> j & 1]
    values = TAIL.unpack_from(buf, end)
    return {"n_neurons": n, "first_tick": first, "n_ticks": n_ticks, "flags": flags, "spikes": spikes,
            **{k: v / Q for k, v in zip(READOUTS, values)}}
