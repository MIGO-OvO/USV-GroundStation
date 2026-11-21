import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot, Intent } from "./types";
import { routeRosCall, rosTransportEvent, rosPollInterval } from "./rosAccess";

export const native = isTauri();
export const android = /Android/i.test(navigator.userAgent);
export const emptySnapshot: Snapshot = {
  now_ms: 0,
  unix_ms: 0,
  clock_id: "",
  link: "disconnected",
  connection: null,
  saved_connection: null,
  connection_error: null,
  error: null,
  identity_error: null,
  log_error: null,
  telemetry: {
    system_id: null,
    component_id: null,
    heartbeat_ms: null,
    payload_heartbeat_ms: null,
    payload_telemetry_ms: null,
    fields: {},
    track: [],
    generation: 0,
    seen_packets: 0,
  },
  payload_online: false,
  requests: [],
  flight_requests: [],
  safety: {
    emergency_latched: false,
    outputs_unknown: false,
    propulsion_confirmed: false,
    payload_confirmed: false,
    stop_request: null,
    issued_ms: null,
    clock_id: "",
  },
  actions: Array.from({ length: 10 }, (_, i) => ({
    command: 31010 + i,
    label: "",
    allowed: false,
    reason: "等待 Rust 后端连接设备",
  })),
  navigation: {
    arm: false,
    disarm: false,
    hold: false,
    loiter: false,
    auto: false,
    auto_reason: null,
    guided: false,
    rtl: false,
    mission_start: false,
    upload: false,
    verify_stop: false,
  },
  mission: {
    state: "idle",
    detail: "",
    completed: 0,
    total: 0,
    verified: false,
    items: [],
    draft: null,
  },
  diagnostics: [],
  rejected_frames: 0,
};

export function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    return Promise.reject(new Error("请在 Tauri 应用中使用设备与 ROS 接口"));
  const control = routeRosCall(command, args);
  return control ? invoke<T>("ros_control", control) : invoke<T>(command, args);
}

export function useStation() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!native) return;
    let active = true;
    let subscription: number | undefined;
    const channel = new Channel<Snapshot>();
    channel.onmessage = (value) => {
      if (active) setSnapshot(value);
    };
    void call<number>("station_subscribe", { channel })
      .then((id) => {
        subscription = id;
        if (!active) void call("station_unsubscribe", { id });
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      if (subscription !== undefined)
        void call("station_unsubscribe", { id: subscription });
    };
  }, []);
  const send = useCallback(
    (intent: Intent) => call<unknown>("station_intent", { intent }),
    [],
  );
  return { snapshot, error, send };
}

export function useRos(
  baseUrl: string,
  path: string,
  enabled = true,
  interval = 3000,
) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision(v => v + 1);
    window.addEventListener(rosTransportEvent, changed);
    return () => window.removeEventListener(rosTransportEvent, changed);
  }, []);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!native || !enabled || !baseUrl || !path) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      setLoading(true);
      try {
        const result = await call<unknown>("ros_get", { baseUrl, path });
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (active) {
          setError(String(e));
          setData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
          if (interval > 0) timer = setTimeout(() => void read(), rosPollInterval(path, interval));
        }
      }
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [baseUrl, path, enabled, interval, revision]);
  return { data, error, loading, refresh: () => setRevision((v) => v + 1) };
}

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const unpack = (value: unknown): unknown => object(value).data ?? value;

export async function saveText(name: string, text: string): Promise<string> {
  if (native) return call<string>("save_text", { name, text });
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return name;
}
