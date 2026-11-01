export type ConnectionConfig =
  | { kind: "udp"; bind: string; peer: string | null }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "serial"; port: string; baud: number };
export interface Field {
  value: number;
  received_ms: number;
  sequence: number;
  source_component: number;
}
export interface Telemetry {
  system_id: number | null;
  component_id: number | null;
  heartbeat_ms: number | null;
  payload_heartbeat_ms: number | null;
  payload_telemetry_ms: number | null;
  fields: Record<string, Field>;
  track: [number, number][];
  generation: number;
  seen_packets: number;
}
export type RequestState =
  | "created"
  | "sent"
  | "accepted"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";
export interface PayloadEvent {
  v: number;
  session: number;
  request: number;
  seq: number;
  command: number;
  sender_system: number;
  sender_component: number;
  tcp_session: number;
  phase: string;
  outcome: string;
  reason: string;
  attempt_id: string;
  preflight_phase: string;
  cleanup_failed: boolean;
  [key: string]: unknown;
}
export interface Stage {
  at_ms: number;
  clock_id: string;
  name: string;
  detail: string;
}
export interface RequestRecord {
  id: string;
  target_system: number;
  sender_system: number;
  sender_component: number;
  session: number;
  request: number;
  command: number;
  params: [number, number];
  created_unix_ms: number;
  clock_id: string;
  created_ms: number;
  last_send_ms: number | null;
  attempts: number;
  retry_allowed: boolean;
  generation: number;
  state: RequestState;
  receipt: boolean;
  seq: number;
  retired: boolean;
  observed_running: boolean;
  end_status_seq: number | null;
  stop_targets: string[];
  cleanup_failed: boolean;
  event: PayloadEvent | null;
  timeline: Stage[];
}
export interface Diagnostic {
  index: number;
  unix_ms: number;
  mono_ms: number;
  clock_id: string;
  kind: string;
  direction: string;
  system: number | null;
  component: number | null;
  message_id: number | null;
  mav_sequence: number | null;
  command: number | null;
  request: number | null;
  session: number | null;
  detail: unknown;
}
export interface Waypoint {
  lat: number;
  lon: number;
  altitude: number;
  sample: boolean;
  timeout_s: number;
}
export interface MissionDraft {
  version: 1;
  waypoints: Waypoint[];
}
export interface MissionItem {
  seq: number;
  command: number;
  frame: number;
  params: number[];
  x: number;
  y: number;
  z: number;
  autocontinue: number;
}
export interface MissionSnapshot {
  state: string;
  detail: string;
  completed: number;
  total: number;
  verified: boolean;
  items: MissionItem[];
  draft: MissionDraft | null;
}
export interface SafetyState {
  emergency_latched: boolean;
  outputs_unknown: boolean;
  propulsion_confirmed: boolean;
  payload_confirmed: boolean;
  stop_request: string | null;
  issued_ms: number | null;
  clock_id: string;
}
export interface Action {
  command: number;
  label: string;
  allowed: boolean;
  reason: string;
}
export interface FlightRequest {
  id: string;
  command: number;
  name: string;
  state: string;
  created_ms: number;
  sent_ms: number | null;
  ack_result: number | null;
  desired_field: string | null;
  desired_value: number | null;
  baseline_seq: number;
}
export interface NavigationActions {
  arm: boolean;
  disarm: boolean;
  hold: boolean;
  auto: boolean;
  guided: boolean;
  rtl: boolean;
  mission_start: boolean;
  upload: boolean;
  verify_stop: boolean;
}
export interface Snapshot {
  now_ms: number;
  unix_ms: number;
  clock_id: string;
  link: string;
  connection: ConnectionConfig | null;
  error: string | null;
  identity_error: string | null;
  log_error: string | null;
  telemetry: Telemetry;
  payload_online: boolean;
  requests: RequestRecord[];
  flight_requests: FlightRequest[];
  safety: SafetyState;
  actions: Action[];
  navigation: NavigationActions;
  mission: MissionSnapshot;
  diagnostics: Diagnostic[];
  rejected_frames: number;
}
export type Intent =
  | { type: "connect"; config: ConnectionConfig; target_system: number | null }
  | { type: "disconnect" }
  | {
      type: "payload";
      command: number;
      param1: number;
      param2: number;
      confirmed: boolean;
    }
  | { type: "arm"; armed: boolean; confirmed: boolean }
  | { type: "mode"; mode: number; confirmed: boolean }
  | { type: "emergency_stop"; confirmed: boolean }
  | { type: "verify_stop"; onsite_confirmed: boolean }
  | { type: "upload_mission"; draft: MissionDraft; confirmed: boolean }
  | { type: "download_mission" }
  | { type: "stop_mission"; confirmed: boolean };
export interface Preferences {
  rosUrl: string;
  mapStyle: string;
  mapSource: "google" | "ros";
  offline: boolean;
  theme: "light" | "dark";
  mapEnabled: boolean;
}
export type Notify = (text: string, error?: boolean) => void;
export type SendIntent = (
  intent: Intent,
  confirmation?: string,
) => Promise<void>;
