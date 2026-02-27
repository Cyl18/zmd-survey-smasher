"""
mitmproxy addon: intercepts survey.hypergryph.com HTML responses
and injects the answer-injection script.

Three synthetic paths are handled entirely inside mitmproxy — nothing
reaches the real server for these:

  /__zmd_inject__.js   GET  — serve inject.js with DEBUG_NO_SUBMIT substituted
  /__zmd_query__       POST — receive page payload, return eval JS via AnswerStrategy
  /__zmd_log__         POST — forward page-side log messages to Python logger
"""
from __future__ import annotations

import json
import logging
import os
import re

from mitmproxy import http

from strategy import AnswerStrategy

logger = logging.getLogger(__name__)

_JS_PATH = os.path.join(os.path.dirname(__file__), "inject.js")
_INJECT_PATH = "/__zmd_inject__.js"
_QUERY_PATH  = "/__zmd_query__"
_LOG_PATH    = "/__zmd_log__"
_SCRIPT_TAG  = f'<script src="{_INJECT_PATH}"></script>'.encode("utf-8")


class SurveyAddon:
    def __init__(self, debug_no_submit: bool = False, log_callback=None) -> None:
        self.debug_no_submit = debug_no_submit
        self._strategy = AnswerStrategy(debug_no_submit=debug_no_submit)
        self._log_callback = log_callback

        with open(_JS_PATH, "r", encoding="utf-8") as f:
            self._js_template = f.read()

    def _log(self, msg: str) -> None:
        logger.info(msg)
        if self._log_callback:
            self._log_callback(msg)

    def _build_js(self) -> bytes:
        js = self._js_template
        js = js.replace("{{DEBUG_NO_SUBMIT}}", "true" if self.debug_no_submit else "false")
        return js.encode("utf-8")

    def request(self, flow: http.HTTPFlow) -> None:
        """Handle all synthetic zmd paths before they reach the real server."""
        if flow.request.pretty_host != "survey.hypergryph.com":
            return

        path = flow.request.path

        if path == _INJECT_PATH:
            flow.response = http.Response.make(
                200,
                self._build_js(),
                {"Content-Type": "application/javascript; charset=utf-8"},
            )
            logger.debug("[addon] served inject.js")
            return

        if path == _QUERY_PATH:
            try:
                payload = json.loads(flow.request.get_content() or b"{}")
                result = self._strategy.decide(payload)
                self._log(f"[addon] answered page_type={payload.get('page_type')!r}")
            except Exception as exc:  # noqa: BLE001
                logger.error("[addon] query error: %s", exc)
                result = {"type": "eval", "code": ""}
            flow.response = http.Response.make(
                200,
                json.dumps(result).encode("utf-8"),
                {"Content-Type": "application/json"},
            )
            return

        if path == _LOG_PATH:
            try:
                payload = json.loads(flow.request.get_content() or b"{}")
                self._log(f"[JS] {payload.get('message', '')}")
            except Exception:  # noqa: BLE001
                pass
            flow.response = http.Response.make(204, b"")
            return

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.request.pretty_host != "survey.hypergryph.com":
            return

        if flow.response is None:
            return

        content_type = flow.response.headers.get("content-type", "")
        if "text/html" not in content_type:
            return

        # Strip CSP headers so injected script can use fetch / eval freely.
        # QtWebEngine may enforce CSP connect-src which blocks our fetch calls.
        flow.response.headers.pop("content-security-policy", None)
        flow.response.headers.pop("content-security-policy-report-only", None)

        body = flow.response.get_content()
        if body is None:
            return

        # Remove CSP <meta> tags from HTML as well
        body = re.sub(
            rb'<meta[^>]+http-equiv\s*=\s*["\']?content-security-policy["\']?[^>]*>',
            b'',
            body,
            flags=re.IGNORECASE,
        )

        # Inject a small <script src> tag before </body>
        needle = b"</body>"
        idx = body.lower().rfind(needle)
        if idx != -1:
            body = body[:idx] + _SCRIPT_TAG + body[idx:]
        else:
            body = body + _SCRIPT_TAG

        flow.response.set_content(body)
        self._log(f"[addon] injected script into {flow.request.pretty_url}")
        logger.debug("[addon] injected script tag into %s", flow.request.pretty_url)
