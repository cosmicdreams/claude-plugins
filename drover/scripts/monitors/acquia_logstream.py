#!/usr/bin/env python3
"""
acquia_logstream.py — Direct WSS client for Acquia Cloud logstream.

Replaces `acli app:log:tail` with a direct websocket connection.
No PHP subprocess, no preamble parsing, per-type filtering, structured JSON.

Usage as a module:
    from acquia_logstream import connect
    async for event in connect(app_uuid, env_name):
        print(event)  # {"cmd":"line", "log_type":"...", "text":"...", ...}

Usage as a script (streams to stdout):
    python3 acquia_logstream.py <app_uuid> <env_name> [--types type1,type2]
"""
import asyncio
import json
import os
import signal
import sys
import urllib.parse
from pathlib import Path
from typing import AsyncIterator

sys.path.insert(0, str(Path(__file__).resolve().parent))
from acquia_api import AcquiaClient


async def connect(
    app_uuid: str,
    env_name: str,
    types: list[str] | None = None,
) -> AsyncIterator[dict]:
    """
    Connect to the Acquia logstream WSS and yield log-line events.

    Args:
        app_uuid: Acquia application UUID.
        env_name: Environment name (dev, test, prod).
        types: Log types to subscribe to. None = all available.
               Valid types: apache-request, apache-error, php-error,
               drupal-watchdog, drupal-request, fpm-access, fpm-error,
               bal-request, varnish-request.

    Yields:
        dict with keys: cmd, log_type, text, server, http_status, disp_time.
    """
    try:
        import websockets
    except ImportError:
        raise ImportError(
            "websockets package required: pip install websockets"
        )

    client = AcquiaClient()
    env_id = client.resolve_env_id(app_uuid, env_name)
    ls = client.get_logstream_params(env_id)

    params = ls["params"]
    wss_url = ls["url"]
    qs = urllib.parse.urlencode(params)
    url = f"{wss_url}?{qs}"

    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({
            "cmd": "stream-environment",
            "site": params["site"],
            "env": params["environment"],
            "t": params["t"],
            "d": params["hmac"],
        }))

        available = []
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                d = json.loads(msg)
                if d.get("cmd") == "available":
                    available.append({"type": d["type"], "server": d["server"]})
                elif d.get("cmd") == "error":
                    raise RuntimeError(f"Logstream error: {d.get('description')}")
        except asyncio.TimeoutError:
            pass

        if not available:
            raise RuntimeError("No log sources available from logstream")

        want = set(types) if types else None
        for a in available:
            if want is None or a["type"] in want:
                await ws.send(json.dumps({
                    "cmd": "enable",
                    "type": a["type"],
                    "server": a["server"],
                }))

        async for raw in ws:
            d = json.loads(raw)
            if d.get("cmd") == "line":
                yield d
            elif d.get("cmd") == "error":
                print(
                    f"logstream error: {d.get('description', '?')}",
                    file=sys.stderr,
                )


async def _main(app_uuid: str, env_name: str, types: list[str] | None) -> int:
    stop = asyncio.Event()

    def handle_signal():
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    try:
        async for event in connect(app_uuid, env_name, types):
            if stop.is_set():
                break
            print(json.dumps(event), flush=True)
    except Exception as e:
        print(f"acquia_logstream: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Stream Acquia logs via WSS")
    parser.add_argument("app_uuid", help="Acquia application UUID")
    parser.add_argument("env_name", help="Environment name (dev, test, prod)")
    parser.add_argument(
        "--types",
        help="Comma-separated log types to subscribe to (default: all)",
        default=None,
    )
    args = parser.parse_args()
    type_list = args.types.split(",") if args.types else None
    sys.exit(asyncio.run(_main(args.app_uuid, args.env_name, type_list)))
