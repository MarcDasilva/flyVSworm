"""Stand-in for the fly on Thru: runs the live trading fly and streams chain_event spike blocks.

    cd fly-brain/python
    ../.venv/Scripts/python chain_server.py          # ws://127.0.0.1:8001/ws/chain (server.py keeps 8000)

Each WebSocket connection gets its own fly (live.LiveSession, the default synthetic market). It
first receives one JSON text message describing the brain (the stand-in for reading the Thru
program's account), then one binary chain_event per TICKS_PER_BAR ticks, paced at brain real time
(1 tick = 1 ms). The binary bytes are the ones the Thru program will emit, so the 3D view only
swaps its transport later.

    {"type": "brain", "spec", "connectome": {...the spec's block}, "n_neurons", "body_id": [...], "ticks_per_block"}

It needs a hemibrain spec: the 3D view maps neuron index -> hemibrain body ID.
"""
import argparse
import asyncio
import os
import time

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

import chain_event
import live

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SPEC = os.path.join(ROOT, "spec", "params_hemibrain_avg.json")
BLOCK_TICKS = live.TICKS_PER_BAR  # one event per bar; the boot phase splits into BOOT_TICKS / BLOCK_TICKS blocks

app = FastAPI(title="fly-brain chain stand-in")


def brain_info(spec_path):
    """Neuron index -> hemibrain body ID, read from the file whose row order the model uses
    (building the session first verifies that file's pinned content hash)."""
    s = live.LiveSession(seed=0, spec_path=spec_path)
    source = s.spec.get("connectome") or {}
    kind = source.get("source", "procedural")
    if kind in ("hemibrain", "hemibrain_averaged"):
        rows = source["file"]
    elif kind == "hemibrain_blend":  # connectome.load_blend uses the averaged ring's row order
        rows = source["averaged"]["file"]
    else:
        raise SystemExit(f"{spec_path}: the 3D view needs a hemibrain connectome (it maps neurons to "
                         f"hemibrain body IDs), not {kind!r}")
    with np.load(os.path.join(ROOT, rows), allow_pickle=False) as f:
        body_id = [int(b) for b in f["body_id"]]
    if len(body_id) != s.cx.N:
        raise SystemExit(f"{rows}: {len(body_id)} body IDs for {s.cx.N} neurons")
    return {"type": "brain", "spec": os.path.relpath(spec_path, ROOT).replace(os.sep, "/"),
            "connectome": source, "n_neurons": s.cx.N, "body_id": body_id, "ticks_per_block": BLOCK_TICKS}


def block(session):
    """Advance one block and return its chain_event bytes."""
    first = session.t
    frame = session.step(BLOCK_TICKS)
    flags = (chain_event.FLAG_BOOT if first < live.BOOT_TICKS else 0) | \
            (chain_event.FLAG_LANDMARK if first < live.BOOT_LANDMARK_TICKS else 0)
    readouts = {"heading": session.heading, "strength": session.strength, "speed": session.readout.speed,
                "position": session.position, "level": session.mapper.level()}
    return chain_event.encode(first, BLOCK_TICKS, session.cx.N, frame["spikes"], readouts, flags)


@app.websocket("/ws/chain")
async def stream(websocket: WebSocket):
    await websocket.accept()  # accept first: closing before accept() is an HTTP 403 and the reason is lost
    try:
        seed = int(websocket.query_params.get("seed", 0))
        if not 0 <= seed < 2 ** 31:
            raise ValueError
    except ValueError:
        await websocket.close(code=1008, reason="seed must be an integer in [0, 2**31)")
        return
    session = live.LiveSession(seed=seed, spec_path=app.state.spec)
    await websocket.send_json(app.state.info)

    async def drain():  # the view sends nothing; this only notices a disconnect
        try:
            while True:
                await websocket.receive_bytes()
        except (WebSocketDisconnect, RuntimeError):
            pass

    receiver = asyncio.create_task(drain())
    next_block = time.perf_counter()
    try:
        while not receiver.done():
            event = await asyncio.to_thread(block, session)
            try:
                await websocket.send_bytes(event)
            except (WebSocketDisconnect, RuntimeError):
                break
            next_block += BLOCK_TICKS / 1000.0
            delay = next_block - time.perf_counter()
            if delay < -0.5:  # fell far behind (e.g. laptop asleep): don't try to catch up
                next_block, delay = time.perf_counter(), 0.0
            await asyncio.sleep(max(0.0, delay))
    finally:
        receiver.cancel()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="fly-brain chain stand-in server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8001)
    ap.add_argument("--spec", default=SPEC, help="a hemibrain spec (default spec/params_hemibrain_avg.json)")
    args = ap.parse_args()
    app.state.spec = os.path.abspath(args.spec)
    app.state.info = brain_info(app.state.spec)
    uvicorn.run(app, host=args.host, port=args.port)
