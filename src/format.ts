import type { Snapshot, RequestRecord, MissionDraft } from "./types";
import { recordingName } from "./recording";

export function field(s: Snapshot, name: string): number | null {
  const f = s.telemetry.fields[name];
  return f && s.now_ms - f.received_ms <= 3000 ? f.value : null;
}
export const number = (
  value: number | null | undefined,
  digits = 1,
  suffix = "",
) =>
  value == null || !Number.isFinite(value)
    ? "未更新"
    : `${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
export const modes: Record<number, string> = {
  0: "MANUAL",
  1: "ACRO",
  3: "STEERING",
  4: "HOLD",
  5: "LOITER",
  6: "FOLLOW",
  7: "SIMPLE",
  10: "AUTO",
  11: "RTL",
  12: "SMART RTL",
  15: "GUIDED",
  16: "初始化",
};
export const statuses: Record<number, string> = {
  0: "空闲",
  1: "采样中",
  2: "检测中",
  3: "设备异常",
  4: "归零校准",
  5: "航行中",
  6: "已到航点",
  7: "保持位置",
  8: "自动化准备",
  9: "采样完成",
  10: "恢复航线",
  11: "采样已暂停",
  12: "已停止",
  13: "已取消",
  14: "走航检测",
};
export const commands: Record<number, string> = {
  31010: "点采样",
  31011: "停止采样及输出",
  31012: "暂停采样",
  31013: "恢复采样",
  31014: "归零校准",
  31015: "启动走航",
  31016: "停止走航",
  31017: "设置分光基线",
  31018: "启动分光采集",
  31019: "停止分光采集",
};
export const stateText: Record<string, string> = {
  created: "已创建",
  sent: "已发送",
  accepted: "已接单",
  executing: "执行中",
  succeeded: "已成功",
  failed: "失败",
  cancelled: "已取消",
  unknown: "状态未知",
  confirmed: "状态已确认",
  idle: "未传输",
  uploading: "正在上传",
  awaiting_count: "等待任务数量",
  reading: "逐项回读",
  verified: "回读一致",
  downloaded: "下载完成",
};
export function requestLabel(r: RequestRecord) {
  return r.command === 31015 && r.event?.outcome === "succeeded" && !r.retired
    ? "本轮完成，走航继续"
    : stateText[r.state];
}
export function time(unix: number) {
  return unix
    ? new Date(unix).toLocaleTimeString("zh-CN", { hour12: false })
    : "等待更新";
}
export function parseMission(text: string): MissionDraft {
  const value: unknown = JSON.parse(text);
  if (
    value === null ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("waypoints" in value) ||
    !Array.isArray(value.waypoints)
  )
    throw new Error("任务格式需为 version=1 和 waypoints 数组");
  if (value.waypoints.length > 500) throw new Error("航点不能超过 500 个");
  const waypoints = value.waypoints.map((raw: unknown) => {
    if (raw === null || typeof raw !== "object")
      throw new Error("航点格式无效");
    const p = raw as Record<string, unknown>;
    if (
      typeof p.lat !== "number" ||
      typeof p.lon !== "number" ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180
    )
      throw new Error("航点坐标无效");
    if (
      typeof p.sample !== "boolean" ||
      typeof p.timeout_s !== "number" ||
      !Number.isInteger(p.timeout_s) ||
      p.timeout_s < 1 ||
      p.timeout_s > 2048 ||
      typeof p.altitude !== "number" ||
      !Number.isFinite(p.altitude)
    )
      throw new Error("航点采样参数无效");
    return {
      lat: p.lat,
      lon: p.lon,
      sample: p.sample,
      timeout_s: p.timeout_s,
      altitude: p.altitude,
    };
  });
  if ("name" in value && typeof value.name !== "string")
    throw new Error("任务名称应为文本");
  const name =
    "name" in value && typeof value.name === "string" && value.name.trim()
      ? recordingName(value.name)
      : undefined;
  return { version: 1, waypoints, ...(name ? { name } : {}) };
}
