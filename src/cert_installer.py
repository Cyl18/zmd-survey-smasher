"""
CA certificate installer: generates the mitmproxy CA cert if absent,
then installs it into the Windows user trust store via certutil.
"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path


def _generate_ca_cert() -> tuple[bool, str]:
    """
    Use mitmproxy's CertStore to generate the CA cert into ~/.mitmproxy/
    without needing to start the full proxy.
    """
    try:
        from mitmproxy.certs import CertStore

        ca_dir = Path.home() / ".mitmproxy"
        ca_dir.mkdir(parents=True, exist_ok=True)
        CertStore.create_store(ca_dir, "mitmproxy", 2048)
        return True, "CA cert generated via mitmproxy CertStore"
    except Exception as exc:  # noqa: BLE001
        return False, f"CertStore generation failed: {exc}"


def install_ca_cert(timeout: float = 3.0, poll_interval: float = 0.01) -> tuple[bool, str]:
    """
    Ensure ~/.mitmproxy/mitmproxy-ca-cert.pem exists (generating it if needed),
    then install it into the Windows user Root store via certutil.

    Returns (success, message).
    """
    cert_path = Path.home() / ".mitmproxy" / "mitmproxy-ca-cert.pem"

    # If the cert doesn't exist yet, generate it directly via mitmproxy API
    if not cert_path.exists():
        ok, msg = _generate_ca_cert()
        if not ok:
            return False, msg

    # Poll briefly in case generation is async / still writing
    deadline = time.monotonic() + timeout
    while not cert_path.exists():
        if time.monotonic() >= deadline:
            return (
                False,
                f"CA cert still not found at {cert_path} after generation attempt.",
            )
        time.sleep(poll_interval)

    result = subprocess.run(
        ["certutil", "-addstore", "-user", "Root", str(cert_path)],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0:
        return True, f"CA cert installed successfully from {cert_path}"
    else:
        output = (result.stdout + result.stderr).strip()
        return False, f"certutil failed (rc={result.returncode}): {output}"

        return False, f"certutil failed (rc={result.returncode}): {output}"
