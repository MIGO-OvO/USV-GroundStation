import { useSyncExternalStore } from "react";

export type RosTransport = "mavlink" | "http";
export const rosTransportEvent = "usv-ros-transport";
let authorization = "";
export function rosTransport(): RosTransport {
  return localStorage.getItem("usv.ros.transport") === "mavlink"
    ? "mavlink"
    : "http";
}
export function setRosTransport(value: RosTransport) {
  localStorage.setItem("usv.ros.transport", value);
  window.dispatchEvent(new Event(rosTransportEvent));
}
function subscribe(changed: () => void) {
  window.addEventListener(rosTransportEvent, changed);
  return () => window.removeEventListener(rosTransportEvent, changed);
}
export function useRosTransport() {
  return useSyncExternalStore(subscribe, rosTransport);
}
export function rosPollInterval(path: string, interval: number) {
  return interval > 0 &&
    rosTransport() === "mavlink" &&
    path.startsWith("/api/diagnostics/")
    ? Math.max(30000, interval)
    : interval;
}
export function setRosToken(value: string) {
  authorization = value ? `Bearer ${value}` : "";
}
export function controlArgs(
  baseUrl: string,
  method: string,
  path: string,
  body: unknown = {},
  confirmed = false,
) {
  return {
    baseUrl,
    transport: rosTransport(),
    request: { method, path, body, authorization },
    confirmed,
  };
}
export function controlPath(path: string) {
  return /^\/api\/(config$|pid\/config$|calibration\/(offsets|zero|reset|start)$|presets\/auto$|preset\/auto\/|waypoint-sampling($|\/)|manual\/|injection-pump\/|hardware\/|diagnostics\/(link($|\/reconnect$)|system$|events$|history$))/.test(
    path,
  );
}
export function routeRosCall(command: string, args?: Record<string, unknown>) {
  if (!args) return null;
  if (
    (command === "ros_get" || command === "ros_post") &&
    typeof args.path === "string" &&
    controlPath(args.path)
  ) {
    return controlArgs(
      String(args.baseUrl ?? ""),
      command === "ros_get" ? "GET" : "POST",
      args.path,
      args.body ?? {},
    );
  }
  if (command === "ros_manual") {
    const cmd = args.command as Record<string, unknown>;
    if (!cmd || typeof cmd !== "object") return null;
    const { action, ...body } = cmd;
    const path =
      action === "mode"
        ? "/api/manual/mode"
        : action === "step"
          ? "/api/manual/pump-step"
          : action === "stop_all"
            ? "/api/manual/stop-all"
            : "";
    if (path)
      return controlArgs(
        String(args.baseUrl ?? ""),
        "POST",
        path,
        body,
        args.confirmed === true,
      );
  }
  return null;
}
