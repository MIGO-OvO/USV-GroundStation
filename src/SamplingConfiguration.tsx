import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { call, native, object, unpack } from "./backend";
import { isConfig } from "./RosConfigEditor";
import { controlArgs } from "./rosAccess";
import type { Snapshot } from "./types";
import "./SamplingConfiguration.css";

const path = "/api/config";
const axes = ["X", "Y", "Z", "A"] as const;
type Step = Record<string, unknown>;
type Sequence = { steps: Step[]; loop_count: number };
type Draft = { steps: Step[]; loops: string; infinite: boolean };

function readSequence(result: unknown): Sequence {
  const { steps, loop_count } = object(
    object(unpack(result)).sampling_sequence,
  );
  if (
    !Array.isArray(steps) ||
    !steps.every(isConfig) ||
    typeof loop_count !== "number" ||
    !Number.isInteger(loop_count) ||
    loop_count < 0
  ) {
    throw new Error("船端返回的采样配置无效");
  }
  return { steps, loop_count };
}

function toDraft(sequence: Sequence): Draft {
  return {
    steps: sequence.steps,
    loops: String(sequence.loop_count || 1),
    infinite: sequence.loop_count === 0,
  };
}

function configJSON(value: Sequence) {
  return JSON.stringify(value, (_, entry: unknown) =>
    isConfig(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );
}

function inputValue(value: unknown, fallback = "") {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : fallback;
}

function nonnegative(value: unknown, integer = false) {
  const text = inputValue(value).trim();
  const number = Number(text);
  return (
    text !== "" &&
    Number.isFinite(number) &&
    number >= 0 &&
    (!integer || Number.isSafeInteger(number))
  );
}

function toSequence(draft: Draft): Sequence {
  const loop_count = draft.infinite ? 0 : Number(draft.loops);
  if (!draft.infinite && (!Number.isSafeInteger(loop_count) || loop_count < 1))
    throw new Error("循环次数须为正整数");
  if (!draft.steps.length) throw new Error("至少添加一个采样步骤");
  const steps = draft.steps.map((step, index) => {
    if (!nonnegative(step.interval ?? 0, true))
      throw new Error(`步骤 ${index + 1} 的等待时间须为非负整数`);
    for (const axis of axes) {
      const pump = object(step[axis]);
      if (pump.enable !== "E") continue;
      if (
        !nonnegative(pump.speed ?? 0) ||
        (pump.continuous !== true && !nonnegative(pump.angle ?? 0))
      )
        throw new Error(`检查步骤 ${index + 1} 的 ${axis} 轴转速和角度`);
    }
    return { ...step, interval: Number(step.interval ?? 0) };
  });
  return { steps, loop_count };
}

export function useSamplingConfig(s: Snapshot) {
  const system = s.link === "connected" ? s.telemetry.system_id : null;
  const vessel =
    system === null ? null : JSON.stringify([system, s.connection]);
  const [loaded, setLoaded] = useState<{
    vessel: string;
    sequence: Sequence;
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Sequence | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [notice, setNotice] = useState({ vessel, text: "", error: false });
  const ready = native && vessel !== null;
  const sameVessel = vessel !== null && loaded?.vessel === vessel;
  const visibleDraft = vessel === null || sameVessel ? draft : null;
  const dirty =
    draft !== null &&
    loaded !== null &&
    JSON.stringify(draft) !== JSON.stringify(toDraft(loaded.sequence));

  function report(text = "", error = false) {
    setNotice({ vessel, text, error });
  }

  function request(method: "GET" | "POST", body?: unknown) {
    return call<unknown>("ros_control", {
      ...controlArgs("", method, path, body),
      transport: "mavlink",
      expectedSystem: system,
    });
  }

  function acceptRead(
    target: string,
    sequence: Sequence,
    sent: Sequence | null,
    retain = false,
  ) {
    setLoaded({ vessel: target, sequence });
    setPending(null);
    const verified = sent !== null && configJSON(sequence) === configJSON(sent);
    if (!retain || verified) setDraft(toDraft(sequence));
    if (!sent) report("已读取船端配置");
    else if (verified) report("采样配置已保存并核对");
    else report("船端配置与草稿不同，草稿已保留", true);
  }

  async function read() {
    if (vessel === null || busy) return;
    setBusy("read");
    report();
    try {
      const sequence = readSequence(await request("GET"));
      acceptRead(
        vessel,
        sequence,
        sameVessel ? pending : null,
        sameVessel && dirty,
      );
    } catch (error) {
      report(String(error), true);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (vessel === null || !sameVessel || !draft || busy || pending) return;
    let sequence: Sequence;
    try {
      sequence = toSequence(draft);
    } catch (error) {
      report((error as Error).message, true);
      return;
    }
    setPending(sequence);
    setBusy("save");
    report();
    try {
      await request("POST", { sampling_sequence: sequence });
      acceptRead(vessel, readSequence(await request("GET")), sequence, true);
    } catch (error) {
      report(`保存结果待核对。请读取船端配置。 ${String(error)}`, true);
    } finally {
      setBusy(null);
    }
  }

  return {
    draft: visibleDraft,
    ready,
    busy,
    notice:
      vessel === null || vessel === notice.vessel
        ? notice
        : { text: "", error: false },
    dirty,
    pending: Boolean(pending && (sameVessel || vessel === null)),
    read,
    save,
    edit(value: Draft) {
      setDraft(value);
      report();
    },
    discard() {
      if (!loaded) return;
      setDraft(toDraft(loaded.sequence));
      report();
    },
  };
}

function PumpFields({
  axis,
  pump,
  edit,
}: {
  axis: (typeof axes)[number];
  pump: Record<string, unknown>;
  edit: (changes: Record<string, unknown>) => void;
}) {
  const enabled = pump.enable === "E";
  const continuous = pump.continuous === true;
  return (
    <fieldset className="sampling-pump">
      <legend>{axis} 轴</legend>
      <label className="checkbox">
        <input
          aria-label={`启用 ${axis} 轴`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => edit({ enable: e.target.checked ? "E" : "D" })}
        />
        启用
      </label>
      {enabled && (
        <>
          <label className="ros-config-field">
            方向
            <select
              value={pump.direction === "B" ? "B" : "F"}
              onChange={(e) => edit({ direction: e.target.value })}
            >
              <option value="F">正转</option>
              <option value="B">反转</option>
            </select>
          </label>
          <label className="ros-config-field">
            转速（RPM）
            <input
              type="number"
              min="0"
              step="any"
              value={inputValue(pump.speed, "5")}
              onChange={(e) => edit({ speed: e.target.value })}
            />
          </label>
          {continuous ? (
            <span className="caption">连续转动</span>
          ) : (
            <label className="ros-config-field">
              角度（°）
              <input
                type="number"
                min="0"
                step="any"
                value={inputValue(pump.angle, "0")}
                onChange={(e) => edit({ angle: e.target.value })}
              />
            </label>
          )}
        </>
      )}
    </fieldset>
  );
}

export default function SamplingConfiguration({
  config,
}: {
  config: ReturnType<typeof useSamplingConfig>;
}) {
  const [selected, setSelected] = useState(0);
  const {
    draft,
    ready,
    busy,
    notice,
    dirty,
    pending,
    read,
    save,
    edit,
    discard,
  } = config;
  const steps = draft?.steps ?? [];
  const index = Math.min(selected, steps.length - 1);
  const step = steps[index];
  const editable = ready && !busy && !pending;

  function setSteps(steps: Step[]) {
    if (draft) edit({ ...draft, steps });
  }
  function editStep(changes: Step) {
    setSteps(
      steps.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  }
  function moveStep(offset: number) {
    const next = index + offset;
    const ordered = [...steps];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    setSteps(ordered);
    setSelected(next);
  }

  return (
    <section
      className="sampling-config"
      aria-labelledby="sampling-config-title"
    >
      <div className="section-heading">
        <h2 id="sampling-config-title">
          <Settings2 size={18} />
          采样配置
        </h2>
        <div className="sampling-config-actions">
          {dirty && draft && !pending && (
            <button
              type="button"
              className="text-button"
              disabled={!!busy}
              onClick={discard}
            >
              放弃修改
            </button>
          )}
          <button
            type="button"
            disabled={!ready || !!busy}
            onClick={() => void read()}
          >
            <RefreshCw size={15} />
            {busy === "read" ? "读取中" : "读取船端配置"}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!editable || !draft || !dirty}
            onClick={() => void save()}
          >
            <Save size={15} />
            {busy === "save" ? "保存并核对中" : "保存采样配置"}
          </button>
        </div>
      </div>
      <p className="caption">
        通过 MAVLink 数传读写。保存的设置在下一次采样开始时生效。
      </p>
      {!ready && (
        <p className="caption">连接数传并收到飞控心跳后可读取和保存。</p>
      )}
      {ready && !draft && !busy && !notice.text && (
        <p className="caption">读取船端配置后即可编辑。</p>
      )}
      {dirty && draft && !pending && !busy && (
        <p className="caption">有未保存的修改。</p>
      )}
      {pending && !busy && !notice.text && (
        <p className="caption">请读取船端配置，核对上次保存结果。</p>
      )}
      {notice.text && (
        <p
          className={notice.error ? "inline-error" : "caption"}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {draft && (
        <fieldset className="sampling-config-form" disabled={!editable}>
          <div className="sampling-loop">
            <label className="ros-config-field">
              循环次数
              <input
                type="number"
                min="1"
                step="1"
                value={draft.infinite ? "" : draft.loops}
                disabled={draft.infinite}
                onChange={(e) => edit({ ...draft, loops: e.target.value })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.infinite}
                onChange={(e) => edit({ ...draft, infinite: e.target.checked })}
              />
              无限循环
            </label>
          </div>
          <div className="sampling-steps">
            <div className="sampling-step-list">
              <h3>采样步骤</h3>
              {steps.length > 0 && (
                <ol>
                  {steps.map((item, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        aria-pressed={i === index}
                        onClick={() => setSelected(i)}
                      >
                        <span>{i + 1}</span>
                        {inputValue(item.name).trim() || "未命名步骤"}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                onClick={() => {
                  setSteps([...steps, { name: "新步骤", interval: 0 }]);
                  setSelected(steps.length);
                }}
              >
                <Plus size={15} />
                添加步骤
              </button>
            </div>
            {step && (
              <div className="sampling-step-detail">
                <div className="sampling-step-fields">
                  <label className="ros-config-field">
                    步骤名称
                    <input
                      value={inputValue(step.name)}
                      onChange={(e) => editStep({ name: e.target.value })}
                    />
                  </label>
                  <label className="ros-config-field">
                    完成后等待（毫秒）
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={inputValue(step.interval, "0")}
                      onChange={(e) => editStep({ interval: e.target.value })}
                    />
                  </label>
                  <div className="sampling-config-actions">
                    <button
                      type="button"
                      aria-label="上移步骤"
                      title="上移步骤"
                      disabled={index === 0}
                      onClick={() => moveStep(-1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      aria-label="下移步骤"
                      title="下移步骤"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      aria-label="删除步骤"
                      title="删除步骤"
                      onClick={() => {
                        setSteps(steps.filter((_, i) => i !== index));
                        setSelected(Math.max(0, index - 1));
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="sampling-pump-grid">
                  {axes.map((axis) => (
                    <PumpFields
                      key={axis}
                      axis={axis}
                      pump={object(step[axis])}
                      edit={(changes) => {
                        editStep({
                          [axis]: {
                            direction: "F",
                            speed: "5",
                            angle: "0",
                            ...object(step[axis]),
                            ...changes,
                          },
                        });
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}
