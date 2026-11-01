#!/usr/bin/env python3
"""Exercise a real mavlink-routerd using isolated pseudo UARTs and loopback TCP."""

import os
import pty
import select
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Test-only MAVLink 2 frames generated with pymavlink 2.4.49 (1/191).
HEARTBEAT = bytes.fromhex("fd0900000001bf000000000000000b03000303846a")
PAYLOAD = bytes.fromhex("fd1100000001bffb00007b0000000000803f5553565f50524f544fbbde")
UNKNOWN = bytes.fromhex("fd0100000901bfffff7f000000")
# Captured by a passive Jetson TCP observer on 2026-11-01. Its unknown
# message ID has no verifiable CRC; the untrusted header claims source 1/191.
FIELD_UNKNOWN = bytes.fromhex("fd1000002201bf27b292f51c00002301011e0000cec040011b3b203c")


def read_for(peer, seconds):
    output = bytearray()
    deadline = time.monotonic() + seconds
    while (remaining := deadline - time.monotonic()) > 0:
        if not select.select([peer], [], [], remaining)[0]:
            break
        data = os.read(peer, 4096) if isinstance(peer, int) else peer.recv(4096)
        if not data:
            break
        output.extend(data)
    return bytes(output)


def expect(peer, frame, label):
    actual = read_for(peer, 0.25)
    assert actual == frame, f"{label}: expected {frame.hex()}, got {actual.hex()}"
    print(f"PASS: {label}", flush=True)


def connect(port, process):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        assert process.poll() is None, "router exited before accepting test traffic"
        try:
            return socket.create_connection(("127.0.0.1", port), timeout=0.25)
        except ConnectionRefusedError:
            time.sleep(0.02)
    raise TimeoutError("loopback test router did not start")


def main(binary):
    # Both UARTs are created here. No real serial port or remote host is opened.
    primary, primary_slave = pty.openpty()
    redundant, redundant_slave = pty.openpty()
    with tempfile.TemporaryDirectory(prefix="usv-router-test-") as temporary:
        root = Path(temporary)
        (root / "config.d").mkdir()
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        config = f"[General]\nTcpServerPort={port}\n"
        for name, slave in [("primary", primary_slave), ("redundant", redundant_slave)]:
            config += (f"[UartEndpoint {name}]\nDevice={os.ttyname(slave)}\n"
                       "Baud=921600\nGroup=usv-link\n")
        (root / "main.conf").write_text(config)
        with (root / "router.log").open("w+") as log:
            process = subprocess.Popen(
                [str(Path(binary).resolve()), "-c", str(root / "main.conf"),
                 "-d", str(root / "config.d")], stdout=log, stderr=log,
            )
            bridge = None
            try:
                bridge = connect(port, process)
                corrupt = bytearray(HEARTBEAT)
                corrupt[-1] ^= 1
                os.write(primary, corrupt)
                expect(bridge, b"", "CRC-invalid known frame is dropped")
                bridge.sendall(PAYLOAD)
                expect(primary, PAYLOAD, "invalid CRC cannot block real payload")
                expect(redundant, PAYLOAD, "redundant UART receives real payload")

                for label, unknown in [("field-captured", FIELD_UNKNOWN), ("synthetic", UNKNOWN)]:
                    bridge.close()
                    bridge = connect(port, process)
                    os.write(primary, unknown)
                    expect(bridge, unknown, f"{label}: unknown dialect frame still passes through")
                    expect(primary, b"", f"{label}: unknown frame is not echoed to its source")
                    expect(redundant, b"", f"{label}: unknown frame is not echoed to its source group")
                    bridge.sendall(PAYLOAD)
                    expect(primary, PAYLOAD, f"{label}: unknown source cannot poison the UART route")
                    expect(redundant, PAYLOAD, f"{label}: unknown source cannot poison the UART group")

                bridge.close()
                bridge = connect(port, process)
                bridge.sendall(PAYLOAD)
                expect(primary, PAYLOAD, "TCP reconnect preserves the UART return route")
                expect(redundant, PAYLOAD, "TCP reconnect preserves the UART group")

                bridge.close()
                bridge = connect(port, process)
                os.write(primary, HEARTBEAT)
                expect(bridge, HEARTBEAT, "CRC-valid payload source is still learned")
                expect(redundant, b"", "valid source group still prevents loops")
                bridge.sendall(PAYLOAD)
                expect(primary, b"", "valid source still prevents loopback")
                expect(redundant, b"", "valid source still protects the redundant group")
            except BaseException:
                log.flush()
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
            finally:
                if bridge is not None:
                    bridge.close()
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
                for fd in [primary, primary_slave, redundant, redundant_slave]:
                    os.close(fd)


if __name__ == "__main__":
    main(sys.argv[1])
