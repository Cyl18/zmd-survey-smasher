"""
Clear the game's embedded browser cache.

The game client (终末地/明日方舟) uses an embedded Chromium (Chrome/87)
whose HTTP cache lives under:

    %LOCALAPPDATA%\\PlatformProcess\\

Clearing this directory forces the webview to re-fetch all resources,
which is necessary after the proxy is stopped to avoid serving stale
injected JS from cache.
"""
from __future__ import annotations

import logging
import os
import shutil

logger = logging.getLogger(__name__)

_CACHE_DIR_NAME = "PlatformProcess"


def get_cache_dir() -> str | None:
    """Return the full path to the game cache directory, or None if not found."""
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        return None
    path = os.path.join(local_appdata, _CACHE_DIR_NAME)
    if os.path.isdir(path):
        return path
    return None


def clear_game_cache() -> tuple[bool, str]:
    """
    Delete the contents of the game's browser cache directory.

    Returns (success: bool, message: str).
    """
    cache_dir = get_cache_dir()
    if cache_dir is None:
        return False, f"缓存目录不存在 (%LOCALAPPDATA%\\{_CACHE_DIR_NAME})"

    errors: list[str] = []
    removed = 0
    for entry in os.listdir(cache_dir):
        entry_path = os.path.join(cache_dir, entry)
        try:
            if os.path.isdir(entry_path):
                shutil.rmtree(entry_path)
            else:
                os.remove(entry_path)
            removed += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{entry}: {exc}")

    if errors:
        msg = f"已清理 {removed} 项，{len(errors)} 项失败: {'; '.join(errors[:3])}"
        logger.warning(msg)
        return removed > 0, msg

    if removed == 0:
        return True, "缓存目录已为空，无需清理"

    msg = f"已清理 {removed} 项 ({cache_dir})"
    logger.info(msg)
    return True, msg
