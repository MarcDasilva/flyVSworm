"""Live web server: one simulated fly per browser tab, streamed over a WebSocket.

    cd fly-brain/python
    ../.venv/Scripts/python server.py            # then open http://127.0.0.1:8000

The brain runs here in Python (live.LiveSession). Each connection gets its own
session; ~30 frames per second are pushed to the page, each carrying the spikes
of the ticks simulated since the last frame. 1x speed = 1000 ticks per second,
i.e. brain real time (1 tick = 1 ms).

Client -> server messages (JSON):
    {"type": "market", "trend": float, "volatility": float}   either key optional
    {"type": "shock", "direction": 1 | -1}                     pump / dump
    {"type": "pause", "paused": bool}
    {"type": "speed", "speed": one of SPEEDS}
    {"type": "reset", "seed": int}                             fresh fly and market, same market settings
    {"type": "export"}                                         reply {"type": "export", "run": ...} for live.LiveSession.replay
Malformed messages are ignored.
"""
import argparse
import asyncio
import json
import os
import time

import uvicorn
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import chain_state
import connectome
import live
from market import MarketParams
from model_float import load_spec

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "web"))
FPS = 30
TICKS_PER_SECOND = 1000  # at speed 1x
SPEEDS = (0.25, 0.5, 1.0, 2.0, 4.0)

@asynccontextmanager
async def lifespan(_app):
    """While the backend runs, each synapse the manifest holds becomes one transaction on Thru."""
    chain_state.start()
    yield
    chain_state.stop()


app = FastAPI(title="fly-brain live", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.middleware("http")
async def revalidate(request, call_next):
    """Make the browser re-check the page and its scripts on every load, so edits are never hidden by cache."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
def index():
    return FileResponse(os.path.join(WEB, "index.html"))


@app.get("/api/network")
def network():
    p, spec = load_spec(live.SPEC_PATH)
    return live.network(connectome.build(p, spec.get("connectome")))


@app.get("/api/chain")
def chain():
    """What the fly brain has stored on Thru: transactions, and how far the wiring has got."""
    return chain_state.status()





class Controller:
    """Holds one connection's session and applies client messages to it."""

    def __init__(self):
        self.market = MarketParams()
        self.seed = 0
        self.session = live.LiveSession(seed=self.seed, market_params=self.market)
        self.speed = 1.0
        self.paused = False
        self.dirty = True   # a frame should be sent even while paused
        self.outbox = []    # replies to send (sent by the stream loop, never concurrently)

    def apply(self, msg):
        kind = msg.get("type")
        if kind in ("market", "shock"):
            self.session.apply(msg)  # logged by the session for exact replay
        elif kind == "export":
            self.outbox.append({"type": "export", "run": self.session.export()})
        elif kind == "pause":
            self.paused = bool(msg.get("paused"))
        elif kind == "speed" and float(msg.get("speed", 0)) in SPEEDS:
            self.speed = float(msg["speed"])
        elif kind == "reset":
            self.seed = int(msg.get("seed", self.seed + 1)) % (2 ** 31)
            self.session = live.LiveSession(seed=self.seed, market_params=self.market)
        self.dirty = True


@app.websocket("/ws")
async def stream(websocket: WebSocket):
    await websocket.accept()
    ctl = Controller()

    async def receive():
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    msg = json.loads(text)
                    if isinstance(msg, dict):
                        ctl.apply(msg)
                except (ValueError, TypeError, ArithmeticError):  # malformed message or field (e.g. Infinity): ignore it
                    continue
        except WebSocketDisconnect:
            pass

    receiver = asyncio.create_task(receive())
    budget, next_frame = 0.0, time.perf_counter()
    try:
        while not receiver.done():
            if not ctl.paused:
                budget += TICKS_PER_SECOND * ctl.speed / FPS
                n, budget = int(budget), budget - int(budget)
                frame = ctl.session.step(n)
            elif ctl.dirty:
                frame = ctl.session.frame()
            else:
                frame = None
            outgoing, ctl.outbox = ctl.outbox, []
            if frame is not None:
                # sim_speed, not speed: the frame's "speed" is the fly's turning speed
                frame.update(type="frame", seed=ctl.seed, sim_speed=ctl.speed, paused=ctl.paused)
                ctl.dirty = False
                outgoing.append(frame)
            try:
                for msg in outgoing:
                    await websocket.send_json(msg)
            except (WebSocketDisconnect, RuntimeError):
                break
            next_frame += 1.0 / FPS
            delay = next_frame - time.perf_counter()
            if delay < -0.5:  # fell far behind (e.g. laptop asleep): don't try to catch up
                next_frame, delay = time.perf_counter(), 0.0
            await asyncio.sleep(max(0.0, delay))
    finally:
        receiver.cancel()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="fly-brain live server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--spec", default=None,
                    help="spec file (default spec/params_hemibrain_avg.json; spec/params.json = the legacy 56-neuron fly)")
    ap.add_argument("--chain", action="store_true",
                    help="push synapses to Thru while running (needs data/chain_deploy.json)")
    ap.add_argument("--chain-rate", type=float, default=None, metavar="PER_SECOND",
                    help=f"ceiling on how fast to push (default {chain_state.RATE:g}/s)")
    ap.add_argument("--chain-order", choices=("activity", "manifest"), default="activity",
                    help="activity: a fly runs here and the synapses it recruits are the ones "
                         "recorded, so the count moves when the fly does. manifest: walk the "
                         "manifest in order at --chain-rate (default: activity)")
    args = ap.parse_args()
    if args.spec:
        live.SPEC_PATH = os.path.abspath(args.spec)
    chain_state.ENABLED = args.chain
    chain_state.ACTIVITY = args.chain_order == "activity"
    if args.chain_rate:
        chain_state.RATE = args.chain_rate
    uvicorn.run(app, host=args.host, port=args.port)
