"""
zmd-survey-smasher — PyQt6 GUI entry point.
"""
from __future__ import annotations

import sys
import os
import atexit
import signal

# Ensure src/ is on the path when run directly
sys.path.insert(0, os.path.dirname(__file__))

from PyQt6.QtCore import pyqtSignal, Qt, QThread
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QSpinBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from cache_cleaner import clear_game_cache, get_cache_dir
from cert_installer import install_ca_cert
from proxy_manager import ProxyManager, clear_system_proxy, set_system_proxy


class CertInstallThread(QThread):
    finished = pyqtSignal(bool, str)

    def run(self) -> None:
        success, msg = install_ca_cert()
        self.finished.emit(success, msg)


class MainWindow(QMainWindow):
    # Cross-thread log signal
    log_signal = pyqtSignal(str)

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("zmd-survey-smasher")
        self.resize(640, 480)

        self._proxy_manager: ProxyManager | None = None
        self._running = False

        self._build_ui()
        self.log_signal.connect(self._append_log)

    # ──────────────────────────────────────────────────────────────────
    # UI setup
    # ──────────────────────────────────────────────────────────────────


    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        # Usage tutorial
        tutorial = QLabel(
            “<b>使用教程：</b><br>”
            “1. <b>（首次使用）点击”安装 CA 证书”</b><br>”
            “2. <b>关闭游戏，点击”启动”</b>（自动清理游戏缓存；若清理失败日志会提示）<br>”
            “3. <b>打开终末地客户端，正常填写问卷</b><br>”
            “<span style='color:#b45309'>⚠ 若问卷已在游戏中打开，请刷新/重新进入页面（代理启动前的连接不经过拦截）</span>”
        )
        tutorial.setWordWrap(True)
        tutorial.setStyleSheet("color:#444; background:#f6f6f6; border-radius:6px; padding:8px; margin-bottom:6px;")
        layout.addWidget(tutorial)

        # Status row
        status_row = QHBoxLayout()
        self._status_label = QLabel("● 已停止")
        self._status_label.setStyleSheet("color: gray; font-weight: bold;")
        status_row.addWidget(self._status_label)
        status_row.addStretch()
        layout.addLayout(status_row)

        # Config group
        cfg_group = QGroupBox("配置")
        cfg_layout = QHBoxLayout(cfg_group)
        cfg_layout.addWidget(QLabel("代理端口:"))
        self._proxy_port_spin = QSpinBox()
        self._proxy_port_spin.setRange(0, 65535)
        self._proxy_port_spin.setValue(0)
        self._proxy_port_spin.setToolTip("0=自动分配可用端口")
        cfg_layout.addWidget(self._proxy_port_spin)
        cfg_layout.addStretch()

        self._debug_checkbox = QCheckBox("调试：仅下一页（不提交）")
        self._debug_checkbox.setChecked(True)
        cfg_layout.addWidget(self._debug_checkbox)
        layout.addWidget(cfg_group)

        # Button row
        btn_row = QHBoxLayout()
        self._start_btn = QPushButton("▶ 启动")
        self._start_btn.clicked.connect(self._on_start)
        self._stop_btn = QPushButton("■ 停止")
        self._stop_btn.clicked.connect(self._on_stop)
        self._stop_btn.setEnabled(False)
        self._cert_btn = QPushButton("安装 CA 证书")
        self._cert_btn.clicked.connect(self._on_install_cert)
        self._cache_btn = QPushButton("清除游戏缓存")
        self._cache_btn.setToolTip("清除 %LOCALAPPDATA%\\PlatformProcess 下的浏览器缓存")
        self._cache_btn.clicked.connect(self._on_clear_cache)
        btn_row.addWidget(self._start_btn)
        btn_row.addWidget(self._stop_btn)
        btn_row.addWidget(self._cert_btn)
        btn_row.addWidget(self._cache_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        # Log area
        self._log_edit = QTextEdit()
        self._log_edit.setReadOnly(True)
        self._log_edit.setFontFamily("Consolas")
        layout.addWidget(self._log_edit)

    # ──────────────────────────────────────────────────────────────────
    # Slots
    # ──────────────────────────────────────────────────────────────────

    def _on_start(self) -> None:
        if self._running:
            return

        from port_utils import find_free_port

        port_val = self._proxy_port_spin.value()
        debug_no_submit = self._debug_checkbox.isChecked()

        self._start_btn.setEnabled(False)
        self._debug_checkbox.setEnabled(False)
        self._proxy_port_spin.setEnabled(False)

        # ── Auto-clear game cache ──────────────────────────────────────────
        if get_cache_dir() is not None:
            self._append_log("正在清理游戏缓存…")
            cache_ok, cache_msg = clear_game_cache()
            if cache_ok:
                self._append_log(f"✓ {cache_msg}")
            else:
                self._append_log(f"⚠ 缓存清理失败：{cache_msg}")
                self._append_log("⚠ 请先关闭游戏再点击启动，否则游戏可能加载旧版注入脚本缓存")

        self._append_log("正在启动…")

        try:
            # 自动分配端口
            if port_val == 0:
                proxy_port = find_free_port(20000, 60000)
                self._append_log(f"自动分配端口: {proxy_port}")
            else:
                proxy_port = port_val
                # 检查端口占用
                import socket
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    try:
                        s.bind(("127.0.0.1", proxy_port))
                    except OSError:
                        raise RuntimeError(f"端口 {proxy_port} 已被占用，请换一个端口或设为0自动分配")

            proxy_manager = ProxyManager()
            proxy_manager.start(
                proxy_port=proxy_port,
                debug_no_submit=debug_no_submit,
                log_callback=self.log_signal.emit,
            )
            set_system_proxy(proxy_port)

            self._proxy_manager = proxy_manager
            self._running = True

            self._status_label.setText("● 运行中")
            self._status_label.setStyleSheet("color: green; font-weight: bold;")
            self._stop_btn.setEnabled(True)

            self._append_log(f"Proxy on :{proxy_port}" + (" [调试：不提交]" if debug_no_submit else ""))
            self._append_log("⚠ 提示：若问卷已在游戏中打开，请在游戏内刷新/重新进入问卷页面，使流量经由代理拦截。")
        except Exception as exc:  # noqa: BLE001
            self._append_log(f"启动失败: {exc}")
            self._start_btn.setEnabled(True)
            self._debug_checkbox.setEnabled(True)
            self._proxy_port_spin.setEnabled(True)

    def _on_stop(self) -> None:
        if not self._running:
            return
        self._do_stop()

    def _do_stop(self) -> None:
        self._append_log("正在停止…")
        try:
            clear_system_proxy()
        except Exception as exc:  # noqa: BLE001
            self._append_log(f"清除系统代理失败: {exc}")

        if self._proxy_manager:
            try:
                self._proxy_manager.stop()
            except Exception as exc:  # noqa: BLE001
                self._append_log(f"停止代理失败: {exc}")
            self._proxy_manager = None

        self._running = False
        self._status_label.setText("● 已停止")
        self._status_label.setStyleSheet("color: gray; font-weight: bold;")
        self._start_btn.setEnabled(True)
        self._stop_btn.setEnabled(False)
        self._debug_checkbox.setEnabled(True)
        self._proxy_port_spin.setEnabled(True)
        self._append_log("已停止")

    def _on_install_cert(self) -> None:
        self._cert_btn.setEnabled(False)
        self._append_log("正在安装 CA 证书…")
        self._cert_thread = CertInstallThread()
        self._cert_thread.finished.connect(self._on_cert_done)
        self._cert_thread.start()

    def _on_cert_done(self, success: bool, message: str) -> None:
        self._cert_btn.setEnabled(True)
        self._append_log(("✓ " if success else "✗ ") + message)

    def _on_clear_cache(self) -> None:
        self._append_log("正在清除游戏缓存…")
        success, message = clear_game_cache()
        self._append_log(("✓ " if success else "✗ ") + message)

    def _append_log(self, text: str) -> None:
        self._log_edit.append(text)

    # ──────────────────────────────────────────────────────────────────
    # Close event
    # ──────────────────────────────────────────────────────────────────

    def closeEvent(self, a0) -> None:  # noqa: N802
        if self._running:
            self._do_stop()
        super().closeEvent(a0)


def main() -> None:
    # Ensure system proxy is cleared on any normal exit
    atexit.register(clear_system_proxy)

    # Also respond to common termination signals
    def _signal_handler(signum, frame):
        try:
            clear_system_proxy()
        finally:
            sys.exit(0)

    try:
        signal.signal(signal.SIGINT, _signal_handler)
        signal.signal(signal.SIGTERM, _signal_handler)
    except Exception:
        # Some platforms may not support signal setting from GUI threads; ignore safely
        pass

    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    try:
        sys.exit(app.exec())
    finally:
        # Fallback cleanup
        try:
            clear_system_proxy()
        except Exception:
            pass


if __name__ == "__main__":
    main()
