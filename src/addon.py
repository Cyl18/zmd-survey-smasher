"""
mitmproxy addon: intercepts survey.hypergryph.com HTML responses
and injects the answer-injection script.

Strategy: inject a tiny <script src="/__zmd_inject__.js"> tag into HTML
responses, then serve the actual JS (with WS_PORT / DEBUG_NO_SUBMIT
substituted) when the browser requests that synthetic path.
"""
from __future__ import annotations

import logging
import os

from mitmproxy import http

logger = logging.getLogger(__name__)

_JS_PATH = os.path.join(os.path.dirname(__file__), "inject.js")
_INJECT_PATH = "/__zmd_inject__.js"
_SCRIPT_TAG = f'<script src="{_INJECT_PATH}"></script>'.encode("utf-8")


class SurveyAddon:
    def __init__(self, ws_port: int, debug_no_submit: bool = False) -> None:
        self.ws_port = ws_port
        self.debug_no_submit = debug_no_submit

        with open(_JS_PATH, "r", encoding="utf-8") as f:
            self._js_template = f.read()

    def _build_js(self) -> bytes:
        js = self._js_template
        js = js.replace("{{WS_PORT}}", str(self.ws_port))
        js = js.replace("{{DEBUG_NO_SUBMIT}}", "true" if self.debug_no_submit else "false")
        return js.encode("utf-8")

    def request(self, flow: http.HTTPFlow) -> None:
        """Serve inject.js for the synthetic path without hitting the real server."""
        if flow.request.pretty_host != "survey.hypergryph.com":
            return
        if flow.request.path != _INJECT_PATH:
            return

        flow.response = http.Response.make(
            200,
            self._build_js(),
            {"Content-Type": "application/javascript; charset=utf-8"},
        )
        logger.debug("[addon] served inject.js for %s", flow.request.pretty_url)

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.request.pretty_host != "survey.hypergryph.com":
            return

        if flow.response is None:
            return

        content_type = flow.response.headers.get("content-type", "")
        if "text/html" not in content_type:
            return

        body = flow.response.get_content()
        if body is None:
            return

        # Inject a small <script src> tag before </body>
        needle = b"</body>"
        idx = body.lower().rfind(needle)
        if idx != -1:
            body = body[:idx] + _SCRIPT_TAG + body[idx:]
        else:
            body = body + _SCRIPT_TAG

        flow.response.set_content(body)
        logger.debug("[addon] injected script tag into %s", flow.request.pretty_url)
