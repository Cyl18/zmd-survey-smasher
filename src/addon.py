"""
mitmproxy addon: intercepts survey.hypergryph.com HTML responses
and injects the answer-injection script.
"""
from __future__ import annotations

import logging
import os

from mitmproxy import http

logger = logging.getLogger(__name__)

_JS_PATH = os.path.join(os.path.dirname(__file__), "inject.js")


class SurveyAddon:
    def __init__(self, ws_port: int, debug_no_submit: bool = False) -> None:
        self.ws_port = ws_port
        self.debug_no_submit = debug_no_submit

        with open(_JS_PATH, "r", encoding="utf-8") as f:
            self._js_template = f.read()

    def _build_script_tag(self) -> bytes:
        js = self._js_template
        js = js.replace("{{WS_PORT}}", str(self.ws_port))
        js = js.replace("{{DEBUG_NO_SUBMIT}}", "true" if self.debug_no_submit else "false")
        tag = f"<script>\n{js}\n</script>"
        return tag.encode("utf-8")

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

        tag = self._build_script_tag()

        # Inject before </body>
        needle = b"</body>"
        idx = body.lower().rfind(needle)
        if idx != -1:
            body = body[:idx] + tag + body[idx:]
        else:
            body = body + tag

        flow.response.set_content(body)
        logger.debug("[addon] injected script into %s", flow.request.pretty_url)
