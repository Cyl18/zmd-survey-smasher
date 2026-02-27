---

## Plan: zmd-survey-smasher Auto-Fill Tool

**TL;DR:** A uv-managed Python project with a PyQt6 GUI that starts mitmproxy in a background asyncio thread, sets the Windows system proxy, intercepts `survey.hypergryph.com` HTML responses, and injects JS that communicates with a local WebSocket server on a random port. The WS server decides answers and **sends back raw JS code for the browser to `eval()`** (currently rule-based; LLM-ready — an LLM can directly emit JS). Packaged as a single-folder exe via PyInstaller.

---

### Architecture Overview

```
Game Client (QtWebEngine)
    │  HTTP/S via system proxy
    ▼
mitmproxy (127.0.0.1:8080)
    │  intercepts survey.hypergryph.com HTML
    │  injects <script> with WS_PORT baked in
    ▼
Injected JS (runs inside page)
    │  detects page type, extracts option texts + outer HTML
    │  sends JSON query to WS server
    │  receives JS code string → eval()s it
    │  JS code performs DOM clicks + clicks 下一页 / 提交
    │  fallback: if 您尚未答完此题 appears, random-click + retry
    ▲
    │  WebSocket  ws://127.0.0.1:<random_port>
    ▼
WS Answer Server (asyncio, random OS-assigned port)
    │  receives page payload
    │  runs AnswerStrategy (rule-based now, LLM later)
    │  returns {type:"eval", code:"<JS string>"}
    ▼
PyQt6 GUI (main thread)
    │  Start / Stop proxy + WS server
    │  Install CA cert
    │  Log window
    └─ clears system proxy on exit
```

---

### Page Types

| # | Name | Detection heuristic | Click target |
|---|------|--------------------|----|
| 1 | **Agreement** | Page has `label input[type="checkbox"]` whose label text contains `我已阅读` | The `<input>` inside that label; then `下一页` |
| 2 | **Button groups** | Collecting all `<button>` elements grouped by `parentElement` yields ≥1 group with ≥2 buttons | Per group: `buttons[len-2]` (倒数第二); if only 1 button, click it; then `下一页` / `提交` |
| 3 | **Div options** | No multi-button groups; a container div has 3–7 direct child `div`s each matching the icon+text sub-structure | Second-to-last child div; then `下一页` / `提交` |

**Button-group detail** (applies to any number of 题组 on the page; each group may have a different number of buttons):

```
页面
├── 题组1
│   └── … > 选项容器A (parentElement)
│       ├── button  (选项1)
│       ├── button  (选项2)   ← buttons.length-2 (不定长，永远选倒数第二)
│       ├── div     (separator — not a button, skipped)
│       └── button  (最后一个 — skip)
├── 题组2
│   └── … > 选项容器B (parentElement)
│       ├── button  (选项1)
│       ├── …
│       └── button  (最后一个 — skip)
├── … (可能有更多题组)
└── 提交/下一页 button  (单独 parent，只有1个 button → 被过滤掉)
```

- Collect all `<button>` elements; group by `button.parentElement`
- Discard groups with `< 2` buttons (提交/下一页 各自 parent 内只有1个 button)
- For **each remaining group**: click `buttons[buttons.length - 2]`（倒数第二，不受每组长度影响）

**Div-option detail** (standalone 5-option page and 5-item rating):

```
container div
├── clickable div  (option 1)
│   ├── div  (icon)
│   └── div  (text area)
│       ├── div  (main text)
│       └── div  (sub text)
├── clickable div  (option 2)
├── clickable div  (option 3)
├── clickable div  (option 4)  ← second-to-last (index len-2)
└── clickable div  (option 5)
```

Detection: container's direct children are all `div`s and each child has exactly 2 child `div`s, second of which has exactly 2 child `div`s.

---

### WebSocket Protocol

**JS → Python (`query`):**
```json
{
  "type": "query",
  "page_type": "agreement | button_groups | div_options",
  "groups": [
    { "index": 0, "option_texts": ["非常不满意", "不满意", "一般", "满意", "非常满意"] }
  ],
  "outer_html": "<div>…full page HTML snapshot…</div>"
}
```

- `groups` is empty for `agreement`; one entry for `div_options`; one per question group for `button_groups`
- `outer_html` is included for LLM context (rule-based strategy ignores it)

**Python → JS (`eval`):**
```json
{
  "type": "eval",
  "code": "/* arbitrary JS string executed via eval() in the page context */"
}
```

- The JS side receives this and calls `eval(msg.code)` — no JS-side interpretation logic needed
- `AnswerStrategy.decide()` generates the JS code string directly
- Rule-based example for `button_groups`: the generated code calls `.click()` on the appropriate button elements and then `下一页`/`提交` after 10 ms
- LLM strategy: just ask the model to emit a JS snippet given the `outer_html` — no protocol change required
- `agreement`: generated code clicks the checkbox input then the advance button

---

### File Structure

```
zmd-survey-smasher/
├── pyproject.toml
├── .python-version          # 3.12
├── uv.lock
├── build.spec
└── src/
    ├── main.py              # PyQt6 GUI entry point
    ├── proxy_manager.py     # mitmproxy DumpMaster in background thread
    ├── ws_server.py         # asyncio WebSocket answer server
    ├── strategy.py          # AnswerStrategy (rule-based; swap for LLM later, dont write LLM impl now)
    ├── addon.py             # mitmproxy addon: HTML interception + JS injection
    ├── cert_installer.py    # certutil CA cert installation
    └── inject.js            # injected into survey pages (embedded in addon.py at startup)
```

---

### Steps

1. **Init uv project**
   - `uv init --name zmd-survey-smasher`
   - `uv add mitmproxy PyQt6 websockets`
   - `uv add --dev pyinstaller`
   - Add `.python-version` → `3.12`

2. **`src/strategy.py` — AnswerStrategy**
   - `class AnswerStrategy`: `__init__(self, debug_no_submit: bool = False)`; single method `decide(payload: dict) -> dict` returning `{"type": "eval", "code": "<js string>"}`
   - **Advance button helper** used by all three branches: `Array.from(document.querySelectorAll('button')).find(b => ADVANCE_TEXTS.includes(b.textContent.trim()))` where `ADVANCE_TEXTS` is `['下一页']` when `debug_no_submit=True`, `['下一页','提交']` otherwise — call `.click()` on it after a `setTimeout(..., 10)` so the answer selection registers first
   - Rule-based JS generation:
     - `agreement` → JS that clicks `label input[type="checkbox"]` then the advance button
     - `button_groups` → collect all `<button>` elements, group by `parentElement`, discard groups with `< 2` buttons; for **each remaining group** (one per 题组, number varies per page) click `buttons[buttons.length - 2]` (倒数第二，不受组内按钮数影响); after all groups are clicked, `setTimeout` 10 ms then click the advance button
     - `div_options` → JS that clicks the second-to-last matching child div, then after 10 ms clicks the advance button
   - LLM subclass: override `decide()`, receive `outer_html` from payload, prompt model to output a JS snippet, return it as `code` — zero other changes needed

3. **`src/ws_server.py` — WS Answer Server**
   - On start: `await websockets.serve(handler, "127.0.0.1", 0)` → OS picks a free port
   - Read actual port: `server.sockets[0].getsockname()[1]`; expose as `ws_server.port`
   - Handler: receive `query` JSON → `strategy.decide(payload)` → send `{"type":"eval","code":"…"}` JSON
   - `start()` / `stop()` coroutines; runs in the same asyncio loop as mitmproxy

4. **`src/inject.js` — Injected JS**
   - `const WS_PORT = {{WS_PORT}};` (substituted by addon at intercept time)
   - `const DEBUG_NO_SUBMIT = {{DEBUG_NO_SUBMIT}};` (substituted by addon; `true` skips `提交`)
   - Connect `ws://127.0.0.1:${WS_PORT}`; retry with 10 ms backoff up to 5 times
   - **Page detection** (checked in order on each SPA navigation):
     1. `agreement`: `document.querySelector('label input[type="checkbox"]')` + label text check
     2. `button_groups`: group buttons by parent; any group with ≥2 buttons
     3. `div_options` fallback: container matching the icon+text sub-structure
   - Extract `option_texts` from text-area child's `textContent` (best-effort); capture `document.body.outerHTML` snapshot
   - Send `query` JSON (including `outer_html`); await `{type:"eval", code}` response
   - **Execute**: call `eval(msg.code)` — all click logic and timing lives inside the generated code
   - **Advance helper** (used both by eval'd code and by fallback): `Array.from(document.querySelectorAll('button')).find(b => (DEBUG_NO_SUBMIT ? ['下一页'] : ['下一页','提交']).includes(b.textContent.trim()))`
   - **Fallback — `您尚未答完此题`**:
     - After each advance attempt, a `MutationObserver` watches for any element whose `textContent` contains `您尚未答完此题`
     - If detected within 200 ms of clicking advance: randomly pick and click 1–3 options from each detected option group (buttons / divs), wait 10 ms, then re-query and click the 下一页/提交 button using the advance helper
     - Retry up to 3 times before giving up and logging a warning via WS `{type:"log", message:"…"}`
   - **Navigation guard**: `MutationObserver` on `document.body`; debounce 10 ms; track processed page key (URL + stable DOM fingerprint) to avoid re-firing same page

5. **`src/addon.py` — mitmproxy Addon**
   - `__init__(self, ws_port: int, debug_no_submit: bool = False)` stores both
   - `response(flow)`: filter `pretty_host == "survey.hypergryph.com"` and `"text/html" in content-type`
   - Load `inject.js` (read from file at startup; path relative to `addon.py`), replace `{{WS_PORT}}` and `{{DEBUG_NO_SUBMIT}}` (`"true"`/`"false"`)
   - Inject `<script>…</script>` immediately before `</body>`

6. **`src/proxy_manager.py` — Proxy Manager**
   - `ProxyManager` owns a `threading.Thread` with `asyncio.new_event_loop()` (keeps Qt main loop separate)
   - Thread startup sequence (inside the background asyncio loop):
     1. `await ws_server.start()` → `ws_server.port` is now set (OS-assigned)
     2. Create `DumpMaster` with `Addon(ws_port=ws_server.port, debug_no_submit=debug_no_submit)` registered
     3. Signal port back to main thread via `threading.Event` + shared attribute, then `await master.run()`
   - `start(ws_server, debug_no_submit: bool = False)`: create thread, start it, wait on the event so that `ws_server.port` is readable on return
   - `stop()`: `master.shutdown()` + `ws_server.stop()`, join thread
   - `set_system_proxy(port)` / `clear_system_proxy()`: `winreg` on `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` (`ProxyEnable`, `ProxyServer = "127.0.0.1:8080"`)

7. **`src/cert_installer.py` — CA Cert Installer**
   - Poll `~/.mitmproxy/mitmproxy-ca-cert.pem` up to 3 s (file created on first proxy start; poll interval 10 ms)
   - `subprocess.run(["certutil", "-addstore", "-user", "Root", cert_path])`
   - Return `(success: bool, message: str)` for GUI display

8. **`src/main.py` — PyQt6 GUI**
   - `MainWindow(QMainWindow)`: status label, Start/Stop `QPushButton`, "安装 CA 证书" `QPushButton`, read-only `QTextEdit` log, proxy port `QSpinBox` (default 8080)
   - **调试选项**: `QCheckBox("调试：仅下一页（不提交）")` — when checked, `debug_no_submit=True` is passed to both `AnswerStrategy` and `Addon`; the checkbox is disabled while the proxy is running
   - WS port is random — shown in log as "WS server on :<port>"
   - **Start**: read `debug_no_submit` from checkbox → `proxy_manager.start(ws_server, debug_no_submit)` (starts background loop, binds WS port internally) → read `ws_server.port` (now available) → `set_system_proxy(8080)` → log both ports
   - **Stop**: `clear_system_proxy()` → `proxy_manager.stop()`
   - `closeEvent`: always call Stop, wait for thread join
   - Cross-thread log: `pyqtSignal(str)` connected to `log.append()` — emitted from asyncio thread

9. **`build.spec` — PyInstaller**
   - `collect_all('mitmproxy')`, `collect_all('mitmproxy_rs')`, `collect_all('PyQt6')`, `collect_all('websockets')`
   - `copy_metadata('mitmproxy')` (for `importlib.metadata`)
   - `hiddenimports`: `mitmproxy.proxy.layers`, `mitmproxy.contentviews`, `mitmproxy_rs`, `cryptography`, `OpenSSL`, `h2`, `hpack`, `websockets`
   - `--onedir` (not `--onefile`): `mitmproxy_rs` Rust `.pyd` cannot reliably self-extract from a zip bundle
   - Build: `uv run pyinstaller build.spec`

---

### Verification

- `uv run python src/main.py` → GUI opens; log shows "WS server on :<random>" and "Proxy on :8080"
- "安装 CA 证书" → `certutil` returns 0; cert visible in Windows cert store (certmgr.msc)
- "Start" → `HKCU\...\Internet Settings\ProxyServer` = `127.0.0.1:8080` in registry
- Browser via system proxy → `http://mitm.it` confirms mitmproxy active
- Game client → `survey.hypergryph.com` → agreement checkbox auto-clicked → each page type detected, filled, advanced → `提交` clicked at end
- Close GUI → `ProxyEnable = 0` in registry
- `uv run pyinstaller build.spec` → `dist/zmd-survey-smasher/` runs standalone on clean machine

---

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| **WebSocket** | Answer logic stays server-side in Python; easy to add LLM subclass of `AnswerStrategy` later |
| **Random WS port** | Avoids hardcoded conflicts; mitmproxy injects the actual port into JS at intercept time |
| **`AnswerStrategy` class** | Decouples logic from transport; swap rule-based for LLM without touching WS plumbing |
| **`debug_no_submit` flag** | Lets you step through pages manually without the tool accidentally submitting the survey; passed from GUI checkbox → `AnswerStrategy` (affects generated JS `ADVANCE_TEXTS`) + `Addon` (affects `inject.js` fallback advance helper) |
| **Python → JS `eval` protocol** | Python (or LLM) emits arbitrary JS; JS side is a dumb executor — no mapping layer needed, LLM can output JS directly |
| **`您尚未答完此题` fallback** | Some pages require ≥N selections; random retry satisfies validation without special-casing each question type |
| **Shared asyncio loop** | mitmproxy and `websockets` are both asyncio-native; one loop in one thread, no sync overhead |
| **Separate thread for asyncio** | Qt occupies main thread event loop; asyncio runs in background thread |
| **`--onedir` packaging** | `mitmproxy_rs` Rust extension fails to extract reliably from `--onefile` zip on Windows |
| **`winreg` for system proxy** | What QtWebEngine reads; more reliable than `netsh` on Windows |
| **`uv` + lockfile** | Reproducible builds for distribution; `uv sync` gives exact environment; dev tools isolated via `--dev` |