import { Activity, Check, FlaskConical, Settings2 } from "lucide-react";
import { array, object, unpack } from "./backend";
import { field, number, statuses } from "./format";
import type { Snapshot } from "./types";

const phaseNames: Record<string, string> = {
  checking: "检查设备",
  homing: "泵组归零",
  compensating: "管路补偿",
  separating: "油相分离",
  injection: "进样准备",
  verifying: "检查分光信号",
  complete: "准备完成",
  idle: "待机",
  cancelled: "已取消",
};
const pidModes = ["空闲", "运行 / 暂停", "完成", "异常"];
const automationNames: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  paused: "已暂停",
  finished: "已完成",
  stopped: "已停止",
  failed: "失败",
  error: "异常",
  preparing: "准备中",
};
export function pidMode(s: Snapshot) {
  const mode = field(s, "USV_PMOD");
  const status = field(s, "USV_STAT");
  if (mode === 1 && status === 11) return "已暂停";
  if (mode === 1 && status !== null && [1, 2, 8, 14].includes(status))
    return "运行中";
  return mode === null ? "未更新" : (pidModes[mode] ?? `模式 ${mode}`);
}
const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown) =>
  typeof value === "string" && value ? value : "未更新";
const flag = (value: unknown, yes: string, no: string) =>
  value === true ? yes : value === false ? no : "未更新";

function Position({
  label,
  value,
  total,
}: {
  label: string;
  value: number | null;
  total: number | null;
}) {
  const known = value !== null && value >= 0 && total !== null && total > 0;
  return (
    <div className="sampling-position">
      <div>
        <span>{label}</span>
        <strong>
          {number(value, 0)} /{" "}
          {total === 0
            ? label === "当前循环"
              ? "不限"
              : "待定"
            : number(total, 0)}
        </strong>
      </div>
      {known ? (
        <progress
          aria-label={label}
          max={total}
          value={Math.min(value, total)}
        />
      ) : (
        <div className="progress-track" />
      )}
    </div>
  );
}

export function SamplingProgress({ s }: { s: Snapshot }) {
  const status = s.payload_online ? field(s, "USV_STAT") : null;
  const current =
    status === 8 || status === 4
      ? 0
      : status === 1
        ? 1
        : status === 2 || status === 14
          ? 2
          : status === 9
            ? 3
            : -1;
  const request = [...s.requests]
    .reverse()
    .find(
      (r) =>
        !r.retired &&
        r.generation === s.telemetry.generation &&
        r.clock_id === s.clock_id &&
        ["accepted", "executing"].includes(r.state) &&
        r.timeline.at(-1)?.clock_id === s.clock_id &&
        s.now_ms - r.timeline.at(-1)!.at_ms <= 6000 &&
        [31010, 31014, 31015].includes(r.command),
    );
  const phase = status === 8 ? request?.event?.preflight_phase : undefined;
  const stages = [
    { label: "准备", icon: Settings2 },
    { label: "采样", icon: FlaskConical },
    { label: "检测", icon: Activity },
    { label: "完成", icon: Check },
  ];
  return (
    <section className="sampling-progress" aria-label="采样进度">
      <div className="section-heading">
        <h2>采样进度</h2>
        <span className={`sampling-state ${status === 3 ? "error" : ""}`}>
          {!s.payload_online
            ? "载荷离线"
            : status === null
              ? "等待载荷状态"
              : (statuses[status] ?? `状态 ${status}`)}
          {phase && ` · ${phaseNames[phase] ?? phase}`}
        </span>
      </div>
      <ol className="sampling-stages">
        {stages.map(({ label, icon: Icon }, index) => (
          <li key={label} aria-current={current === index ? "step" : undefined}>
            <span className="stage-marker">
              <Icon size={16} />
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="sampling-positions">
        <Position
          label="当前步骤"
          value={s.payload_online ? field(s, "USV_STEP") : null}
          total={s.payload_online ? field(s, "USV_STOT") : null}
        />
        <Position
          label="当前循环"
          value={s.payload_online ? field(s, "USV_LOOP") : null}
          total={s.payload_online ? field(s, "USV_LTOT") : null}
        />
      </div>
    </section>
  );
}

function Gauge({ axis, angle }: { axis: string; angle: number | null }) {
  const valid = angle !== null && angle >= 0 && angle <= 360;
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`泵 ${axis}：${angle !== null && angle < 0 ? "未校准" : number(angle, 1, "°")}`}
    >
      <circle className="angle-track" cx="50" cy="50" r="36" />
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          className="angle-tick"
          x1="50"
          y1="10"
          x2="50"
          y2="17"
          transform={`rotate(${deg} 50 50)`}
        />
      ))}
      {valid && (
        <g transform={`rotate(${angle} 50 50)`}>
          <line className="angle-pointer" x1="50" y1="50" x2="50" y2="21" />
          <circle className="angle-dot" cx="50" cy="50" r="3" />
        </g>
      )}
      <text x="50" y="94" textAnchor="middle">
        0–360°
      </text>
    </svg>
  );
}

function LoadMeter({ label, value }: { label: string; value: unknown }) {
  const n = numeric(value);
  return (
    <div className="sampling-position">
      <div>
        <span>{label}</span>
        <strong>{number(n, 1, "%")}</strong>
      </div>
      {n !== null && n >= 0 && n <= 100 ? (
        <meter aria-label={label} min={0} max={100} value={n} />
      ) : (
        <div className="progress-track" />
      )}
    </div>
  );
}

export function PumpDetails({
  s,
  health,
  manual,
  healthError,
  manualError,
}: {
  s: Snapshot;
  health: unknown;
  manual: unknown;
  healthError: string | null;
  manualError: string | null;
}) {
  const report = object(unpack(health)),
    latest = object(report.latest),
    automation = object(report.automation);
  const jetson = object(latest.jetson),
    detector = object(latest.detector),
    healthState = object(latest.health);
  const manualState = object(unpack(manual));
  const hasReport = Object.keys(automation).length > 0;
  const pending = array(automation.pending_motors);
  return (
    <details className="pump-details">
      <summary>四轴反馈、PID 与设备状态</summary>
      <div className="pid-summary">
        <div>
          <span>PID 状态</span>
          <strong>{pidMode(s)}</strong>
        </div>
        <div>
          <span>最近 PID 误差</span>
          <strong>{number(field(s, "USV_PERR"), 2, "°")}</strong>
        </div>
        <p className="caption">
          误差为最近一帧 PID 反馈；四轴角度相对校准零点。
        </p>
      </div>
      <div className="pump-visuals">
        {["X", "Y", "Z", "A"].map((axis) => {
          const angle = field(s, `PUMP_${axis}`);
          return (
            <div className="pump-axis" key={axis}>
              <Gauge axis={axis} angle={angle} />
              <div>
                <h3>泵 {axis}</h3>
                <strong>
                  {angle !== null && angle < 0
                    ? "未校准"
                    : number(angle, 1, "°")}
                </strong>
                <span className="caption">
                  {pending.includes(axis)
                    ? "报告内待到位"
                    : Array.isArray(automation.pending_motors)
                      ? "报告内未等待"
                      : "等待状态更新"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sampling-detail-columns">
        <section>
          <h3>自动化与控制快照</h3>
          {healthError && <p className="inline-error">{healthError}</p>}
          <p className="caption">
            {hasReport ? "最近收到的自动化报告" : "等待自动化报告"}
          </p>
          <dl className="sampling-facts">
            <div>
              <dt>自动化状态</dt>
              <dd>
                {hasReport
                  ? (automationNames[String(automation.status)] ??
                    text(automation.status))
                  : "未更新"}
              </dd>
            </div>
            <div>
              <dt>准备阶段</dt>
              <dd>
                {hasReport
                  ? (phaseNames[String(automation.preflight_phase)] ??
                    text(automation.preflight_phase))
                  : "未更新"}
              </dd>
            </div>
            <div>
              <dt>控制器串口</dt>
              <dd>
                {hasReport
                  ? flag(automation.serial_connected, "已连接", "未连接")
                  : "未更新"}
              </dd>
            </div>
            <div>
              <dt>手动模式</dt>
              <dd>{flag(manualState.enabled, "已开启", "已关闭")}</dd>
            </div>
            <div>
              <dt>自动化占用</dt>
              <dd>
                {flag(manualState.automation_active, "正在运行", "未占用")}
              </dd>
            </div>
            <div>
              <dt>分光采集</dt>
              <dd>
                {flag(manualState.spectrometer_active, "正在采集", "未采集")}
              </dd>
            </div>
          </dl>
          {manualError && <p className="inline-error">{manualError}</p>}
          {typeof automation.last_error === "string" &&
            automation.last_error && (
              <p className="inline-error">最近异常：{automation.last_error}</p>
            )}
          {automation.cleanup_failed === true && (
            <p className="inline-error">输出清理失败</p>
          )}
        </section>
        <section>
          <h3>设备健康快照</h3>
          <p className="caption">报告时间：{text(latest.ts)}</p>
          <div className="device-loads">
            <LoadMeter label="Jetson CPU" value={jetson.cpu_percent} />
            <LoadMeter label="Jetson 内存" value={jetson.memory_percent} />
            <LoadMeter
              label="ESP32 可用内存"
              value={detector.heap_percent_free}
            />
          </div>
          <dl className="sampling-facts">
            <div>
              <dt>Jetson 温度</dt>
              <dd>{number(numeric(jetson.temperature_c), 1, " °C")}</dd>
            </div>
            <div>
              <dt>ESP32 温度</dt>
              <dd>{number(numeric(detector.temperature_c), 1, " °C")}</dd>
            </div>
            <div>
              <dt>检测板</dt>
              <dd>
                {flag(detector.online, "在线", "离线")} ·{" "}
                {number(numeric(detector.age_s), 1, " s")}
              </dd>
            </div>
            <div>
              <dt>健康状态</dt>
              <dd>
                {(
                  { ok: "正常", warn: "警告", error: "异常" } as Record<
                    string,
                    string
                  >
                )[String(healthState.level)] ?? "未更新"}
              </dd>
            </div>
            {array(latest.ros_nodes).map((raw) => {
              const node = object(raw);
              return (
                <div key={String(node.name)}>
                  <dt>{text(node.name)}</dt>
                  <dd>{flag(node.alive, "在线", "离线")}</dd>
                </div>
              );
            })}
          </dl>
          {typeof healthState.summary === "string" &&
            healthState.summary !== "ok" && (
              <p className="caption">{healthState.summary}</p>
            )}
        </section>
      </div>
    </details>
  );
}
