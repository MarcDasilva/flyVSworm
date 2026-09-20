"""Long-lived chain worker behind web/relay.mjs. One JSON command per stdin
line, one JSON reply per stdout line, strictly in order.

It exists as a PROCESS rather than a function call because every chain
operation costs ~2.3 s of consensus latency and ~1.3 s of `thru` subprocess
derivation on top — and the derivation is the same six answers every time.
A process that starts once amortises it; `python3 -c` per touch pays it
again on every click.

Two invariants the relay depends on:

- Commands are executed ONE at a time in arrival order. Transactions from a
  single fee payer are nonce-ordered, so two in flight at once is a race
  the chain resolves by rejecting one.
- NOTHING but a reply may reach stdout. deploy.py prints a progress line per
  transaction; that line goes to stderr here, or it would be parsed as a
  reply and desynchronise the relay's queue for the rest of the session.

Run with cwd = repo root (the package is imported as wormed.pipeline.deploy).
"""
import contextlib
import base64
import json
import struct
import sys

from . import deploy


def _reply(**kw) -> None:
    sys.stdout.write(json.dumps(kw) + "\n")
    sys.stdout.flush()


def _balance() -> dict:
    """The floor and the faucet command travel WITH the balance so the relay
    never hardcodes a second copy of R19's numbers."""
    return {"balance": deploy.fee_payer_balance(),
            "floor": deploy.BALANCE_FLOOR,
            "faucet": deploy.FAUCET_REFILL}


def _handle(cmd: dict) -> dict:
    op = cmd.get("op")
    if op == "warm":
        # Forces the cached derivations and the account ordering, so the
        # first touch of the demo is not the slowest one.
        deploy._step_accounts()
        deploy._slots()
        account = deploy._run_json(["account", "info", deploy._reservoir_account()])["account_info"]
        data = base64.b64decode(account["data"])
        pending = len(data) >= 16 and struct.unpack_from("<I", data)[0] == 0x53594e50 \
            and struct.unpack_from("<I", data, 8)[0] > 0
        return {**_balance(), "pending": pending}
    if op == "balance":
        return _balance()
    if op == "refill":
        if deploy._rpc_base_url().rstrip("/") != "https://rpc.alphanet.thru.org":
            raise ValueError("Automatic faucet refill is restricted to Thru alphanet")
        out = deploy._run_json(["faucet", "withdraw", deploy.FEE_PAYER, "10000"])["faucet_withdraw"]
        return {**_balance(), "sig": out["signature"]}
    if op == "reset":
        out = deploy.reset_sim()
        return {"sig": out["signature"]}
    if op == "stimulate":
        out = deploy.stimulate(str(cmd["neuron"]), float(cmd["mV"]))
        return {"sig": out["signature"], "cu": out["compute_units_consumed"]}
    if op == "step":
        out = deploy.run_steps(int(cmd["n"]), settle_every=int(cmd["settleEvery"]),
                               emit=True, individual=True)
        return {"sig": out["signature"], "cu": out["compute_units_consumed"], "pending": True}
    if op == "classify":
        out = deploy.classify()
        return {"sig": out["signature"], "cu": out["compute_units_consumed"]}
    raise ValueError(f"unknown op {op!r}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        cmd = json.loads(line)
        try:
            # deploy.py's per-transaction progress lines are stdout writes;
            # this is the redirect that keeps them out of the reply stream.
            with contextlib.redirect_stdout(sys.stderr):
                result = _handle(cmd)
            _reply(id=cmd.get("id"), ok=True, **result)
        except Exception as exc:                       # noqa: BLE001
            _reply(id=cmd.get("id"), ok=False, error=f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
