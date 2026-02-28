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
# PyQt6: only collect the three modules actually used; PyInstaller hooks handle Qt DLL collection
websockets_datas, websockets_binaries, websockets_hiddenimports = collect_all("websockets")

all_datas = (
    mitmproxy_datas
    + mitmproxy_rs_datas
    + websockets_datas
    + copy_metadata("mitmproxy")
    # Include inject.js relative to src/
    + [("src/inject.js", ".")]
)

all_binaries = (
    mitmproxy_binaries
    + mitmproxy_rs_binaries
    + websockets_binaries
)

all_hiddenimports = (
    mitmproxy_hiddenimports
    + mitmproxy_rs_hiddenimports
    + websockets_hiddenimports
    + [
        "PyQt6.QtCore",
        "PyQt6.QtGui",
        "PyQt6.QtWidgets",
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

# Unused PyQt6 modules — listed here so PyInstaller doesn't pull them in
# even if something indirectly references them
_pyqt6_excludes = [
    "PyQt6.QtWebEngine",
    "PyQt6.QtWebEngineWidgets",
    "PyQt6.QtWebEngineCore",
    "PyQt6.QtMultimedia",
    "PyQt6.QtMultimediaWidgets",
    "PyQt6.Qt3DCore",
    "PyQt6.Qt3DRender",
    "PyQt6.Qt3DLogic",
    "PyQt6.Qt3DInput",
    "PyQt6.Qt3DAnimation",
    "PyQt6.Qt3DExtras",
    "PyQt6.QtQuick",
    "PyQt6.QtQuickWidgets",
    "PyQt6.QtQml",
    "PyQt6.QtSql",
    "PyQt6.QtTest",
    "PyQt6.QtBluetooth",
    "PyQt6.QtNfc",
    "PyQt6.QtPositioning",
    "PyQt6.QtLocation",
    "PyQt6.QtSensors",
    "PyQt6.QtSerialPort",
    "PyQt6.QtXml",
    "PyQt6.QtSvg",
    "PyQt6.QtSvgWidgets",
    "PyQt6.QtOpenGL",
    "PyQt6.QtOpenGLWidgets",
    "PyQt6.QtCharts",
    "PyQt6.QtDataVisualization",
    "PyQt6.QtRemoteObjects",
    "PyQt6.QtStateMachine",
    "PyQt6.QtHelp",
    "PyQt6.QtPdf",
    "PyQt6.QtPdfWidgets",
    "PyQt6.QtDesigner",
    "PyQt6.QtPrintSupport",
]

a = Analysis(
    ["src/main.py"],
    pathex=["src"],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=_pyqt6_excludes,
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
