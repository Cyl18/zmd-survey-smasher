# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for zmd-survey-smasher.
Build with: uv run pyinstaller build.spec
"""
from PyInstaller.utils.hooks import collect_all, copy_metadata

block_cipher = None

# Collect entire packages (datas + binaries + hiddenimports)
mitmproxy_datas, mitmproxy_binaries, mitmproxy_hiddenimports = collect_all("mitmproxy")
mitmproxy_rs_datas, mitmproxy_rs_binaries, mitmproxy_rs_hiddenimports = collect_all("mitmproxy_rs")
pyqt6_datas, pyqt6_binaries, pyqt6_hiddenimports = collect_all("PyQt6")
websockets_datas, websockets_binaries, websockets_hiddenimports = collect_all("websockets")

all_datas = (
    mitmproxy_datas
    + mitmproxy_rs_datas
    + pyqt6_datas
    + websockets_datas
    + copy_metadata("mitmproxy")
    # Include inject.js relative to src/
    + [("src/inject.js", ".")]
)

all_binaries = (
    mitmproxy_binaries
    + mitmproxy_rs_binaries
    + pyqt6_binaries
    + websockets_binaries
)

all_hiddenimports = (
    mitmproxy_hiddenimports
    + mitmproxy_rs_hiddenimports
    + pyqt6_hiddenimports
    + websockets_hiddenimports
    + [
        "mitmproxy.proxy.layers",
        "mitmproxy.contentviews",
        "mitmproxy_rs",
        "cryptography",
        "OpenSSL",
        "h2",
        "hpack",
        "websockets",
        "winreg",
    ]
)

a = Analysis(
    ["src/main.py"],
    pathex=["src"],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="zmd-survey-smasher",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # no console window
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="zmd-survey-smasher",
)
