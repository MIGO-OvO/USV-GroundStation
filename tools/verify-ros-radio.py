"""Exercise Rust Station -> MAVLink 2 -> ROS RPC -> actual Flask API on loopback.

Requires the ROS Python dependencies and a built ros_radio_probe example.
All device routes run in standalone mode; no serial port or vessel is opened.
"""
import argparse
import collections
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--ros-root', required=True)
    args.add_argument('--probe', required=True)
    options = args.parse_args()
    sys.path.insert(0, str(Path(options.ros_root).resolve()))
    from scripts import web_config_server as web
    from scripts.lib.ros_radio import RosRadioServer, LocalWebAPI, MESSAGE_TYPE, unpack, ACK, RESPONSE
    from pymavlink.dialects.v20 import ardupilotmega as mav
    from werkzeug.serving import make_server
    assert not web.ROS_AVAILABLE, 'Run this standalone fixture outside a ROS runtime'
    with tempfile.TemporaryDirectory() as temp:
        original_config, original_calibration, original_presets = web.ConfigManager, web.CalibrationManager, web.PresetManager
        class Config(original_config):
            def __init__(self): super().__init__(os.path.join(temp, 'config.json'))
        class Calibration(original_calibration):
            def __init__(self): super().__init__(os.path.join(temp, 'calibration.json'))
        class Presets(original_presets):
            def __init__(self): super().__init__(os.path.join(temp, 'presets.json'))
        web.ConfigManager, web.CalibrationManager, web.PresetManager = Config, Calibration, Presets
        os.environ['USV_MISSION_DATA_DIR'] = os.path.join(temp, 'missions')
        os.environ['USV_WEB_REQUIRE_AUTH'] = ''
        server = web.WebConfigServer(standalone=True)
        calls = collections.Counter()
        @server.app.before_request
        def observe(): calls[(web.request.method, web.request.path)] += 1
        http = make_server('127.0.0.1', 0, server.app, threaded=True)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        radio = RosRadioServer(LocalWebAPI(http.server_port))
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        child = subprocess.Popen([options.probe, str(listener.getsockname()[1]), os.path.join(temp, 'station')], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        connection = None
        try:
            listener.settimeout(10)
            connection, _ = listener.accept()
            class Writer:
                def write(self, data): connection.sendall(data)
            codec = mav.MAVLink(Writer(), srcSystem=1, srcComponent=191)
            codec.robust_parsing = True
            last_heartbeat = 0
            dropped_ack = dropped_result = False
            until = time.monotonic() + 110
            while child.poll() is None:
                if time.monotonic() > until: raise TimeoutError('loopback probe deadline')
                if time.monotonic() - last_heartbeat >= .5:
                    codec.srcComponent = 1
                    codec.heartbeat_send(mav.MAV_TYPE_SURFACE_BOAT, mav.MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 4, mav.MAV_STATE_ACTIVE)
                    codec.srcComponent = 191
                    codec.heartbeat_send(mav.MAV_TYPE_ONBOARD_CONTROLLER, mav.MAV_AUTOPILOT_INVALID, 0, 0, mav.MAV_STATE_ACTIVE)
                    last_heartbeat = time.monotonic()
                if select.select([connection], [], [], .01)[0]:
                    try:
                        data = connection.recv(16384)
                    except ConnectionResetError:
                        break
                    if not data: break
                    message = codec.parse_char(data)
                    while message:
                        if message.get_type() == 'V2_EXTENSION' and message.message_type == MESSAGE_TYPE:
                            radio.receive((message.get_srcSystem(), message.get_srcComponent()), message.payload)
                            # Duplicate requests exercise admission deduplication.
                            radio.receive((message.get_srcSystem(), message.get_srcComponent()), message.payload)
                        message = codec.parse_char(b'')
                item = radio.peek()
                if item:
                    target, payload = item
                    kind = unpack(payload)[0]
                    drop = kind == ACK and not dropped_ack or kind == RESPONSE and not dropped_result
                    if kind == ACK: dropped_ack = True
                    if kind == RESPONSE: dropped_result = True
                    if not drop:
                        codec.v2_extension_send(0, target[0], target[1], MESSAGE_TYPE, list(payload.ljust(249, b'\0')))
                    radio.sent(item)
            stdout, stderr = child.communicate(timeout=5)
            print(stdout)
            if child.returncode: raise RuntimeError(stderr)
            assert dropped_ack and dropped_result
            assert calls['POST', '/api/config'] == 2, calls
            assert calls['POST', '/api/manual/pump-step'] == 1, calls
            assert calls['POST', '/api/injection-pump/on'] == 1, calls
            # Existing HTTP data and configuration routes still work.
            client = server.app.test_client()
            assert client.get('/api/data/missions').status_code == 200
            saved = client.get('/api/config').get_json()
            assert saved['pump_settings']['pid_precision'] == .2
            assert saved['sampling_sequence']['loop_count'] == 3
            assert [step['interval'] for step in saved['sampling_sequence']['steps']] == [1000, 500]
            assert client.get('/api/map/config').status_code == 200
            print('Dropped ACK/result and duplicate frames passed; HTTP data/map/config preserved; operations:', sum(calls.values()))
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()
            if connection: connection.close()
            listener.close()
            radio.close()
            http.shutdown()


if __name__ == '__main__': main()
