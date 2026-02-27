# AGENTS.md — Repository Knowledge

## Project Overview
Auto-fill tool for Arknights (终末地/明日方舟) survey pages on `survey.hypergryph.com`.
Uses mitmproxy to intercept HTML, injects JS that auto-detects and fills survey questions.

## Architecture
- **PyQt6 GUI** (main.py) → starts proxy + shows logs
- **mitmproxy** (proxy_manager.py, addon.py) → intercepts survey HTML, injects `<script>` tag
- **inject.js** → runs inside the game's webview, detects page types, clicks options
- **strategy.py** → rule-based answer generation (LLM-ready interface)
- **ws_server.py** → WebSocket server (currently unused by inject.js, which acts locally)

## Key Constraints
- **Game webview is Chrome/87** (old Chromium embedded in game client)
- **No async/await** in inject.js — some QtWebEngine builds break silently
- **All CSS must use `!important`** — game CSS can override injected elements
- **No `vh` units** — embedded webviews may not support viewport units correctly
- **Use `<div>` not `<pre>`** for log panel — game CSS may target `<pre>` elements
- **Font shorthand (`font:`) should be expanded** to individual properties for compatibility
- Badge is clickable to toggle log panel visibility

## Page Types Detected
1. **Agreement** — checkbox with "我已阅读，并同意以上内容"
2. **Button groups** — buttons grouped by parentElement, ≥2 per group
3. **Div option containers** — container div with 3-10 child divs each having ≥2 children

## Windows-only
- System proxy set via `winreg` (HKCU Internet Settings)
- CA cert installed via `certutil`
