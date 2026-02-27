"""
ProxyManager: runs mitmproxy + WS server in a background asyncio thread.
Also manages the Windows system proxy via winreg.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import winreg

from mitmproxy.options import Options
from mitmproxy.tools.dump import DumpMaster

from addon import SurveyAddon
from ws_server import WsServer

logger = logging.getLogger(__name__)

_PROXY_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"


def set_system_proxy(port: int = 8080) -> None:
    key = winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, _PROXY_REG_KEY, 0, winreg.KEY_SET_VALUE
    )
    winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 1)
    winreg.SetValueEx(key, "ProxyServer", 0, winreg.REG_SZ, f"127.0.0.1:{port}")
    # Bypass the proxy for loopback so the injected WS connection reaches the
    # WS server directly instead of being routed back through mitmproxy.
    winreg.SetValueEx(key, "ProxyOverride", 0, winreg.REG_SZ, "127.0.0.1;localhost;<local>")
    winreg.CloseKey(key)
    logger.info("System proxy set to 127.0.0.1:%d", port)


def clear_system_proxy() -> None:
    key = winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, _PROXY_REG_KEY, 0, winreg.KEY_SET_VALUE
    )
    winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 0)
    winreg.CloseKey(key)
    logger.info("System proxy cleared")


class ProxyManager:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._master: DumpMaster | None = None
        self._ws_server: WsServer | None = None  # set in start()
        self._ready_event = threading.Event()
        self._proxy_port: int = 8080

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(
        self,
        ws_server: WsServer,
        proxy_port: int = 8080,
        debug_no_submit: bool = False,
        log_callback=None,
    ) -> None:
        """
        Start the background asyncio loop:
          1. Start WS server (port assigned by OS)
          2. Start mitmproxy DumpMaster on *proxy_port*

        Blocks until WS server is ready so callers can read ws_server.port.
        """
        self._ws_server = ws_server
        self._proxy_port = proxy_port
        self._ready_event.clear()
        self._debug_no_submit = debug_no_submit
        self._log_callback = log_callback

        self._thread = threading.Thread(
            target=self._thread_main,
            args=(proxy_port, debug_no_submit),
            daemon=True,
            name="proxy-asyncio",
        )
        self._thread.start()
        self._ready_event.wait()  # wait until WS port is known

    def stop(self) -> None:
        if self._loop is None:
            return
        # Use master.shutdown() rather than loop.stop() so that _async_main's
        # finally block (ws_server.stop) runs before the loop closes, avoiding
        # "RuntimeError: Event loop is closed" from abandoned pending tasks.
        if self._master is not None:
            self._loop.call_soon_threadsafe(self._master.shutdown)
        if self._thread:
            self._thread.join(timeout=10)
        self._loop = None
        self._master = None

    # ------------------------------------------------------------------
    # Background thread
    # ------------------------------------------------------------------

    def _thread_main(self, proxy_port: int, debug_no_submit: bool) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            loop.run_until_complete(self._async_main(proxy_port, debug_no_submit))
        except Exception as exc:
            logger.error("ProxyManager background loop error: %s", exc)
        finally:
            # Cancel all still-pending tasks (e.g. IOCP accept_coro from
            # mitmproxy / websockets) so that loop.close() doesn't warn about
            # "Task was destroyed but it is pending!".
            try:
                pending = asyncio.all_tasks(loop)
                if pending:
                    for task in pending:
                        task.cancel()
                    loop.run_until_complete(
                        asyncio.gather(*pending, return_exceptions=True)
                    )
            except Exception:  # noqa: BLE001
                pass
            loop.close()

    async def _async_main(self, proxy_port: int, debug_no_submit: bool) -> None:
        assert self._ws_server is not None
        # 1. Start WS server
        await self._ws_server.start()

        # 2. Build mitmproxy master
        opts = Options(listen_host="127.0.0.1", listen_port=proxy_port)
        master = DumpMaster(opts, with_termlog=False, with_dumper=False)
        master.addons.add(SurveyAddon(self._ws_server.port, debug_no_submit))
        self._master = master

        # 3. Signal readiness (ws_server.port is set)
        self._ready_event.set()

        # 4. Run until stopped
        try:
            await master.run()
        except Exception as exc:  # noqa: BLE001
            logger.warning("mitmproxy master exited: %s", exc)
        finally:
            await self._ws_server.stop()
