import socket
import random

def find_free_port(min_port=1024, max_port=65535, max_tries=20):
    for _ in range(max_tries):
        port = random.randint(min_port, max_port)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free port found in range")
