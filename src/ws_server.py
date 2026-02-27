"""
WebSocket answer server.
Runs in the same asyncio event loop as mitmproxy.
"""
from __future__ import annotations

import asyncio
import json
import logging

import websockets
import websockets.asyncio.server

from strategy import AnswerStrategy

logger = logging.getLogger(__name__)


class WsServer:
    def __init__(self, strategy: AnswerStrategy, log_callback=None) -> None:
        self.strategy = strategy
        self.log_callback = log_callback  # optional callable(str) for GUI log
        self._server: websockets.asyncio.server.Server | None = None
        self.port: int = 0

    def _log(self, msg: str) -> None:
        logger.info(msg)
        if self.log_callback:
            self.log_callback(msg)

    async def _handler(self, websocket) -> None:
        self._log(f"[WS] client connected: {websocket.remote_address}")
        try:
            async for raw in websocket:
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError as exc:
                    self._log(f"[WS] JSON decode error: {exc}")
                    continue

                msg_type = payload.get("type")

                if msg_type == "query":
                    response = self.strategy.decide(payload)
                    await websocket.send(json.dumps(response))
                    self._log(
                        f"[WS] answered page_type={payload.get('page_type')!r}"
                    )
                elif msg_type == "log":
                    self._log(f"[JS] {payload.get('message', '')}")
                else:
                    self._log(f"[WS] unknown message type: {msg_type!r}")
        except websockets.exceptions.ConnectionClosedError:
            pass
        except Exception as exc:  # noqa: BLE001
            self._log(f"[WS] handler error: {exc}")
        finally:
            self._log("[WS] client disconnected")

    async def start(self) -> None:
        """Bind to a random OS-assigned port and start serving."""
        self._server = await websockets.serve(self._handler, "127.0.0.1", 0)
        assert self._server is not None
        self.port = self._server.sockets[0].getsockname()[1]
        self._log(f"[WS] server started on port {self.port}")

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._log("[WS] server stopped")
            self._server = None
