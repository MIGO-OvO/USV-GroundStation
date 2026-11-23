import { useEffect, useState } from "react";
import { call } from "./backend";

export type SerialDevice = {
  port: string;
  kind:
    | "flight_controller"
    | "telemetry_radio"
    | "rtk_gps"
    | "open_pilot"
    | "usb_serial"
    | "bluetooth"
    | "other";
  label: string;
  description: string | null;
  instance_id: string | null;
  usb: { vid: number; pid: number; serial_number: string | null } | null;
  bootloader_hint: boolean;
};

export const serialLabel = (device: SerialDevice) =>
  `${device.port} · ${device.label}${device.bootloader_hint ? "（引导程序）" : ""}`;

export function useSerialPorts(enabled: boolean) {
  const [ports, setPorts] = useState<SerialDevice[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const devices = await call<SerialDevice[]>("serial_ports");
        if (live) {
          setPorts(devices ?? []);
          setError("");
        }
      } catch (e) {
        if (live) {
          setPorts([]);
          setError(String(e));
        }
      } finally {
        if (live) timer = setTimeout(() => void refresh(), 700);
      }
    }
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  return { ports, error };
}
