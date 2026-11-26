import { useMemo, useRef, useState, type ReactNode } from "react";
import "./RosControls.css";

export const configTopics = {
  pid: ["PID 参数", "/api/pid/config"],
  offsets: ["相对零点", "/api/calibration/offsets"],
  presets: ["采样预设", "/api/preset/auto/"],
  waypoints: ["航点采样配置", "/api/waypoint-sampling"],
  hardware: ["硬件设置", "/api/hardware/config"],
} as const;

export type ConfigTopic = keyof typeof configTopics;
type EditorTopic = ConfigTopic | "general";
type ConfigEntry = [string, unknown];
type EditField = (path: string[], value: number | boolean | string) => void;

export function isConfig(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseConfig(text: string) {
  if (!text.trim()) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isConfig(value) ? value : null;
  } catch {
    return null;
  }
}

export function useConfigDraft() {
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const data = useMemo(() => parseConfig(text), [text]);
  const form = useRef<HTMLFormElement>(null);

  function replaceText(value: string) {
    setText(value);
    setRevision((revision) => revision + 1);
  }

  function editField(keys: string[], value: string | number | boolean) {
    setText((previous) => {
      const draft = parseConfig(previous);
      if (!draft) return previous;
      let parent = draft;
      for (const key of keys.slice(0, -1))
        parent = parent[key] as Record<string, unknown>;
      parent[keys[keys.length - 1]] = value;
      return JSON.stringify(draft, null, 2);
    });
  }

  const validated = () => (form.current?.reportValidity() ? data : null);
  return { text, data, revision, form, replaceText, editField, validated };
}

const groups: Partial<Record<EditorTopic, [string, string[]][]>> = {
  pid: [
    ["控制增益", ["Kp", "Ki", "Kd"]],
    ["输出范围", ["output_min", "output_max"]],
  ],
  hardware: [
    ["泵控串口", ["pump_serial_port", "pump_baudrate", "pump_timeout"]],
    [
      "分光采集",
      [
        "ads_address",
        "spectro_channel",
        "mux",
        "gain",
        "vref_mode",
        "adc_rate",
        "publish_rate",
        "spectro_output_hz",
        "reference_voltage",
        "baseline_voltage",
        "continuous_mode",
        "auto_start",
      ],
    ],
  ],
};

const labels: Record<string, string> = {
  version: "配置版本",
  updated_at: "更新时间",
  mission: "采样任务",
  recording: "记录命名",
  name: "名称",
  description: "说明",
  pump_settings: "泵控参数",
  sampling_sequence: "采样流程",
  waypoint_sampling: "航点采样配置",
  sampling: "采样参数",
  sample_timeout_s: "旧固件采样时限（秒）",
  automation_policy: "自动化策略",
  mapping_profile: "地图采样设置",
  detection_settings: "检测设置",
  pollution_metric: "污染物指标",
  hardware: "硬件设置",
  lab_mode: "实验模式",
  Kp: "比例增益 Kp",
  Ki: "积分增益 Ki",
  Kd: "微分增益 Kd",
  output_min: "输出下限",
  output_max: "输出上限",
  pump_serial_port: "串口设备",
  pump_baudrate: "波特率",
  pump_timeout: "串口超时（秒）",
  ads_address: "ADC 地址",
  spectro_channel: "分光通道",
  mux: "ADC 输入",
  gain: "ADC 增益",
  vref_mode: "参考电压源",
  adc_rate: "ADC 采样率（SPS）",
  publish_rate: "ROS 发布率（Hz）",
  spectro_output_hz: "分光上报频率（Hz）",
  reference_voltage: "参考电压（V）",
  baseline_voltage: "基线电压（V）",
  continuous_mode: "连续采集",
  auto_start: "启动时采集",
  i2c_mapping: "编码器通道",
  offsets: "零点角度",
  X: "X 轴",
  Y: "Y 轴",
  Z: "Z 轴",
  A: "A 轴",
  steps: "采样步骤",
  interval: "步骤间隔（毫秒）",
  loop_count: "循环次数",
  retry_count: "旧流程重试次数",
  hold_before_sampling_s: "旧流程稳定等待（秒）",
  on_fail: "失败策略",
  enabled: "启用",
  enable: "泵轴状态",
  speed: "转速（RPM）",
  angle: "角度（°）",
  direction: "方向",
  continuous: "连续运行",
};

const choices: Record<string, Record<string, string>> = {
  on_fail: {
    LOITER: "定点驻留（LOITER）",
    HOLD: "停止推进（HOLD）",
    SKIP: "跳过（SKIP）",
    ABORT: "中止（ABORT）",
  },
  direction: { F: "正转", B: "反转" },
  enable: { E: "启用", D: "停用" },
  vref_mode: { AVDD: "电源参考（AVDD）", INT: "内部参考（INT）" },
};

function Fields({
  entries,
  path,
  topic,
  onEdit,
}: {
  entries: ConfigEntry[];
  path: string[];
  topic: EditorTopic;
  onEdit: EditField;
}) {
  return (
    <div className="ros-config-fields">
      {entries.map(([key, value]) => {
        const fieldPath = [...path, key];
        let label = Object.hasOwn(labels, key) ? labels[key] : key;
        if (path[0] === "offsets" && /^[XYZA]$/.test(key)) label += "（°）";
        if (path.at(-1) === "steps" && /^\d+$/.test(key))
          label = `步骤 ${Number(key) + 1}`;
        if (
          ((topic === "waypoints" && !path.length) ||
            path.at(-1) === "waypoint_sampling") &&
          /^\d+$/.test(key)
        )
          label = `航点 ${key}`;

        if (value !== null && typeof value === "object") {
          const children = Object.entries(value);
          return (
            <details
              key={key}
              className="ros-config-nested"
              open={
                ["offsets", "i2c_mapping", "steps"].includes(key) || undefined
              }
            >
              <summary>{label}</summary>
              {children.length ? (
                <Fields
                  entries={children}
                  path={fieldPath}
                  topic={topic}
                  onEdit={onEdit}
                />
              ) : (
                <p className="caption">无条目</p>
              )}
            </details>
          );
        }

        let input: ReactNode = <span className="muted">未设置</span>;
        const options = Object.hasOwn(choices, key) ? choices[key] : undefined;
        if (typeof value === "boolean") {
          input = (
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => onEdit(fieldPath, e.currentTarget.checked)}
            />
          );
        } else if (typeof value === "number") {
          input = (
            <input
              type="number"
              step="any"
              required
              defaultValue={value}
              onChange={(e) => {
                const number = e.currentTarget.valueAsNumber;
                if (Number.isFinite(number)) onEdit(fieldPath, number);
              }}
            />
          );
        } else if (typeof value === "string") {
          input =
            options && Object.hasOwn(options, value) ? (
              <select
                value={value}
                onChange={(e) => onEdit(fieldPath, e.currentTarget.value)}
              >
                {Object.entries(options).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={value}
                onChange={(e) => onEdit(fieldPath, e.currentTarget.value)}
              />
            );
        }
        return (
          <label
            key={key}
            className={`ros-config-field${typeof value === "boolean" ? " ros-config-switch" : ""}`}
          >
            <span>{label}</span>
            {input}
          </label>
        );
      })}
    </div>
  );
}

function ConfigFields({
  topic,
  data,
  onEdit,
}: {
  topic: EditorTopic;
  data: Record<string, unknown>;
  onEdit: EditField;
}) {
  const sections = groups[topic] ?? [];
  const grouped = new Set(sections.flatMap(([, keys]) => keys));
  const otherFields = Object.entries(data).filter(([key]) => !grouped.has(key));

  if (!Object.keys(data).length)
    return (
      <p className="caption">
        {topic === "waypoints"
          ? "没有已配置的采样航点。"
          : "没有可编辑的参数。"}
      </p>
    );

  return (
    <>
      {sections.map(([title, keys]) => {
        const entries = keys
          .filter((key) => Object.hasOwn(data, key))
          .map((key): ConfigEntry => [key, data[key]]);
        return entries.length ? (
          <section className="ros-config-section" key={title}>
            <h4>{title}</h4>
            <Fields entries={entries} path={[]} topic={topic} onEdit={onEdit} />
          </section>
        ) : null;
      })}
      {otherFields.length > 0 && (
        <Fields entries={otherFields} path={[]} topic={topic} onEdit={onEdit} />
      )}
    </>
  );
}

export default function RosConfigEditor({
  draft,
  topic,
  label,
  disabled,
}: {
  draft: ReturnType<typeof useConfigDraft>;
  topic: EditorTopic;
  label: string;
  disabled: boolean;
}) {
  return (
    <div className="ros-config-editor">
      {draft.data ? (
        <form
          key={draft.revision}
          ref={draft.form}
          onSubmit={(e) => e.preventDefault()}
          onInvalidCapture={(e) => {
            let parent = (e.target as HTMLElement).parentElement;
            while (parent && parent !== e.currentTarget) {
              if (parent instanceof HTMLDetailsElement) parent.open = true;
              parent = parent.parentElement;
            }
          }}
        >
          <fieldset disabled={disabled}>
            <ConfigFields
              topic={topic}
              data={draft.data}
              onEdit={draft.editField}
            />
          </fieldset>
        </form>
      ) : (
        <p className={draft.text.trim() ? "warning-text" : "caption"}>
          {draft.text.trim()
            ? "请输入有效的 JSON 对象。"
            : "读取配置后可在此编辑。"}
        </p>
      )}
      <details className="ros-config-json" key={topic}>
        <summary>高级 JSON</summary>
        <textarea
          className="json-editor"
          aria-label={`${label} JSON`}
          value={draft.text}
          disabled={disabled}
          onChange={(e) => draft.replaceText(e.target.value)}
          spellCheck={false}
        />
      </details>
    </div>
  );
}
