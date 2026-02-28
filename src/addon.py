"""
mitmproxy addon: intercepts survey.hypergryph.com HTML responses
and injects the answer-injection script **inline** (no external <script src>).

Inline injection avoids a separate JS request that the game's Chrome/87
webview would cache independently — making the script persist even after
the proxy is stopped.
"""
from __future__ import annotations

import logging
import os
import re

from mitmproxy import http

logger = logging.getLogger(__name__)

_JS_PATH = os.path.join(os.path.dirname(__file__), "inject.js")

# Headers that tell even aggressive webview caches not to store the page.
_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


class SurveyAddon:
    def __init__(self, debug_no_submit: bool = False, ws_port: int = 0, log_callback=None) -> None:
        self.debug_no_submit = debug_no_submit
        self.ws_port = ws_port
        self._log_callback = log_callback

        with open(_JS_PATH, "r", encoding="utf-8") as f:
            self._js_template = f.read()

    def _log(self, msg: str) -> None:
        logger.info(msg)
        if self._log_callback:
            self._log_callback(msg)

    def _build_inline_tag(self) -> bytes:
        """Return a <script>…</script> block with the full JS inlined."""
        js = self._js_template
        js = js.replace("{{DEBUG_NO_SUBMIT}}", "true" if self.debug_no_submit else "false")
        js = js.replace("{{WS_PORT}}", str(self.ws_port))
        # Escape </script> inside JS so it doesn't prematurely close the tag
        js = js.replace("</script>", "<\\/script>")
        return (b"<script>" + js.encode("utf-8") + b"</script>")

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.request.pretty_host != "survey.hypergryph.com":
            return

        if flow.response is None:
            return

        content_type = flow.response.headers.get("content-type", "")
        if "text/html" not in content_type:
            return

        # ── Anti-cache: force the webview to re-fetch every time ──
        flow.response.headers.pop("etag", None)
        flow.response.headers.pop("last-modified", None)
        for k, v in _NO_CACHE_HEADERS.items():
            flow.response.headers[k] = v

        # Strip CSP headers so injected script can run freely.
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

        # Inject the full JS inline before </body>
        tag = self._build_inline_tag()
        needle = b"</body>"
        idx = body.lower().rfind(needle)
        if idx != -1:
            body = body[:idx] + tag + body[idx:]
        else:
            body = body + tag

        flow.response.set_content(body)
        self._log(f"[addon] injected inline script into {flow.request.pretty_url}")
