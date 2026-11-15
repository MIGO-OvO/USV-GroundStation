import type { Intent } from "./types";
import { call, object } from "./backend";
import { controlArgs } from "./rosAccess";

export function recordingName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("请输入名称");
  if ([...name].length > 80 || new TextEncoder().encode(name).length > 180)
    throw new Error("名称过长，请缩短后重试");
  if (/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/.test(name) || name.endsWith("."))
    throw new Error(
      '名称不能包含路径分隔符、控制字符或 <>:"|?*，也不能以句点结尾',
    );
  return name;
}

export function recordingKind(intent: Intent) {
  if (intent.type === "payload" && intent.command === 31010) return "sample";
  if (
    intent.type === "upload_mission" ||
    (intent.type === "mode" && intent.mode === 10)
  )
    return "mission";
  return null;
}

export async function prepareRecording(
  intent: Intent,
  name: string,
  baseUrl: string,
): Promise<Intent> {
  const kind = recordingKind(intent);
  if (!kind) return intent;
  name = recordingName(name);
  const result = object(
    await call(
      "ros_control",
      controlArgs(
        baseUrl,
        "POST",
        kind === "sample" ? "/api/recording/name" : "/api/recording/mission",
        { name },
      ),
    ),
  );
  if (result.success !== true)
    throw new Error(String(result.message || "名称保存失败"));
  if (intent.type === "payload") {
    const token = object(result.data).token;
    if (
      typeof token !== "number" ||
      !Number.isInteger(token) ||
      token <= 0 ||
      token >= 2 ** 24
    )
      throw new Error("ROS 返回的采样名称标识无效");
    return { ...intent, param1: token };
  }
  return intent.type === "upload_mission"
    ? { ...intent, draft: { ...intent.draft, name } }
    : intent;
}
