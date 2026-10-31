"""Generate offline wire fixtures with pymavlink and the pinned ROS ledger.

python tools/generate_protocol_fixture.py --ros ../usv_ws/src/usv_ros/scripts/lib/payload_protocol.py
Use a git-show snapshot for --ros when the source checkout is on another branch.
Fixtures are generated protocol examples, not captured hardware evidence.
"""
import argparse
import importlib.util
import json
from pathlib import Path

from pymavlink.dialects.v20 import ardupilotmega as m

parser = argparse.ArgumentParser()
parser.add_argument('--ros', type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('reference_protocol', args.ros)
protocol = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protocol)
ledger = protocol.RequestLedger()
context = protocol.request_context(3, 2, 5, 31010, 254, 190)
ledger.reserve(context, 0, 0)
events = [ledger.event(context, 'request', 'accepted')]
attempt = '12345678123456781234567812345678'
events.append(ledger.event(context, 'progress', attempt_id=attempt, preflight_phase='homing'))
events.append(ledger.event(context, 'terminal', 'succeeded', attempt_id=attempt))

frames = []
def add(name, msg, system=1, component=1):
    encoder = m.MAVLink(None, srcSystem=system, srcComponent=component)
    encoder.seq = 42
    frames.append(dict(name=name, system=system, component=component,
                       hex=msg.pack(encoder).hex(), message_id=msg.get_msgId()))

add('fcu_heartbeat', m.MAVLink_heartbeat_message(m.MAV_TYPE_SURFACE_BOAT, m.MAV_AUTOPILOT_ARDUPILOTMEGA, 1, 4, 4, 3))
add('payload_heartbeat', m.MAVLink_heartbeat_message(m.MAV_TYPE_ONBOARD_CONTROLLER, m.MAV_AUTOPILOT_INVALID, 0, 0, 4, 3), component=191)
for command in range(31010, 31020):
    add(f'command_{command}', m.MAVLink_command_long_message(1, 191, command, 0, 0, 0, 3, 2, 0, 0, 0), 254, 190)
    add(f'ack_{command}', m.MAVLink_command_ack_message(command, 0, 0, 0, 254, 190), component=191)
fields = ['USV_VOLT','USV_ABS','PUMP_X','PUMP_Y','PUMP_Z','PUMP_A','USV_STAT','USV_PKT','USV_STEP','USV_STOT','USV_LOOP','USV_LTOT','USV_SCNT','USV_PERR','USV_PMOD','USV_BSET','USV_REF','USV_BASE','USV_VLD','USV_JTMP','USV_ETMP','USV_JCPU','USV_JMEM','USV_EHEAP','USV_ADS','USV_PROTO']
for i, field in enumerate(fields):
    add(field, m.MAVLink_named_value_float_message(1234, field.encode(), float(i)), component=1)
for i, event in enumerate(events):
    text = protocol.encode_event(event).encode()
    chunks = [text[j:j+50] for j in range(0, len(text), 50)]
    if len(text) % 50 == 0:
        chunks.append(b'')
    for seq, chunk in enumerate(chunks):
        add(f'event_{i}_chunk_{seq}', m.MAVLink_statustext_message(m.MAV_SEVERITY_NOTICE, chunk, 100+i, seq), component=191)

out = dict(generator='pymavlink 2.4.49 + ROS RequestLedger', ros_commit='4c083d331a91553ec1d96343b169638fea9ce908', evidence='generated_offline', frames=frames, events=events)
path = Path(__file__).resolve().parents[1] / 'crates/usv-core/tests/fixtures/protocol-v1.json'
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
print(f'{len(frames)} frames; {len(events)} ROS events; {path}')
