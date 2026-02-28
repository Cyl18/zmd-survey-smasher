# AGENTS.md — Repository Knowledge

## Project Overview
Auto-fill tool for Arknights (终末地/明日方舟) survey pages on `survey.hypergryph.com`.
Uses mitmproxy to intercept HTML, injects JS that auto-detects and fills survey questions.

## Architecture
- **PyQt6 GUI** (main.py) → starts proxy + shows logs
- **mitmproxy** (proxy_manager.py, addon.py) → intercepts survey HTML, injects JS **inline**
- **inject.js** → runs inside the game's webview, detects page types, clicks options
- **strategy.py** → rule-based answer generation (LLM-ready interface)
- **ws_server.py** → WebSocket server (currently unused by inject.js, which acts locally)

## Key Constraints
- **Game webview is Chrome/87** (old Chromium embedded in game client)
- **No async/await** in inject.js — some QtWebEngine builds break silently
- **All CSS must use `!important`** via `_imp()` helper — game CSS overrides injected elements
- **No `vh` units** — embedded webviews may not support viewport units correctly
- **Use `<div>` not `<pre>`** for log panel — game CSS may target `<pre>` elements
- **Font shorthand (`font:`) should be expanded** to individual properties for compatibility
- **JS is inlined** into HTML (not `<script src>`) — avoids separate cacheable JS request
- **No-cache headers** on HTML responses — game webview caches aggressively
- **Log panel at TOP** (top:40px, below badge) — game UI covers the bottom of the webview
- Badge is clickable to toggle log panel visibility

## Caching Gotcha
Game's Chrome/87 webview caches both HTML and external JS aggressively.
If using `<script src="...">`, the JS persists in cache even after proxy stops.
Solution: inline JS + no-cache headers + strip ETag/Last-Modified.
Game browser cache lives at `%LOCALAPPDATA%\PlatformProcess\` — can be cleared
via the "清除游戏缓存" button (cache_cleaner.py).

## Page Types Detected
1. **Agreement** — checkbox with "我已阅读，并同意以上内容"
2. **Button groups** — buttons grouped by parentElement, ≥2 per group
3. **Div option containers (strict)** — container div with 3–10 child divs each having ≥2 children
4. **Div option containers (relaxed)** — container div with 3+ child divs that have text but no buttons/inputs (≥50% of children); handles deeply nested single-child chains
5. **Checkbox groups** — non-agreement checkboxes grouped by nearest shared ancestor with ≥2 checkboxes

## Critical inject.js Design Notes
- **pageKey() must exclude own UI**: `#zmd-log` and `#zmd-badge` are excluded from the page fingerprint. Otherwise logging changes innerText length → changes pageKey → triggers MutationObserver → infinite loop.
- **onMutation() must filter own UI**: The `isOwnUI()` helper walks up the DOM to check if a mutation target is inside `#zmd-log` or `#zmd-badge`. Without this, every log append triggers re-processing.
- **Unknown page → fallback**: When page type is unrecognized but interactive elements exist, the script enters the fallback path (random clicking) instead of looping forever.
- **No scheduleRecheck()**: Removed the periodic recheck timer. Page changes are detected solely via MutationObserver to avoid CPU spinning.
- **hasUnansweredError() clones body**: Excludes `#zmd-log` from the text check to avoid false positives from logged error messages.

## Windows-only
- System proxy set via `winreg` (HKCU Internet Settings)
- CA cert installed via `certutil`
- Game cache at `%LOCALAPPDATA%\PlatformProcess\`
