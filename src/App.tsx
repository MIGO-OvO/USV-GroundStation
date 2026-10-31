import { useEffect, useRef, useState } from "react";
import {
  Compass,
  Navigation,
  Route,
  FlaskConical,
  Radio,
  Settings2,
  Moon,
  Sun,
  Unplug,
  OctagonAlert,
  ArrowRight,
  Battery,
  Satellite,
  X,
  ShieldCheck,
  Waves,
} from "lucide-react";
import type {
  Snapshot,
  Preferences,
  MissionDraft,
  Intent,
  SendIntent,
} from "./types";
import { useStation, native, object } from "./backend";
import {
  field,
  modes,
  statuses,
  number,
  stateText,
  parseMission,
} from "./format";
import { Confirm, Evidence, Metric, Reading, RequestSummary } from "./ui";
import MapView from "./MapView";
import Planner from "./Planner";
import PayloadWorkspace, {
  PayloadControls,
  type SignalPoint,
} from "./PayloadWorkspace";
import Diagnostics from "./Diagnostics";
import Settings from "./Settings";

type Workspace =
  | "cockpit"
  | "planner"
  | "sampling"
  | "diagnostics"
  | "settings";
const defaults: Preferences = {
  rosUrl: "http://127.0.0.1:5000",
  mapStyle: "gsatellite",
  offline: false,
  theme: "light",
  mapEnabled: false,
};
function loadPreferences(): Preferences {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem("usv.preferences") ?? "{}"),
    };
  } catch {
    return defaults;
  }
}
function loadDraft(): MissionDraft {
  try {
    return parseMission(
      localStorage.getItem("usv.mission") ?? '{"version":1,"waypoints":[]}',
    );
  } catch {
    return { version: 1, waypoints: [] };
  }
}

function useSignals(s: Snapshot) {
  const [series, setSeries] = useState<{
    voltage: SignalPoint[];
    absorbance: SignalPoint[];
  }>({ voltage: [], absorbance: [] });
  const seen = useRef({ voltage: "", absorbance: "" });
  useEffect(() => {
    setSeries({ voltage: [], absorbance: [] });
    seen.current = { voltage: "", absorbance: "" };
  }, [s.clock_id, s.telemetry.generation, s.telemetry.system_id]);
  useEffect(() => {
    if (!s.payload_online || field(s, "USV_VLD") !== 1) return;
    for (const [key, name] of [
      ["voltage", "USV_VOLT"],
      ["absorbance", "USV_ABS"],
    ] as const) {
      if (key === "absorbance" && field(s, "USV_BSET") !== 1) continue;
      const value = field(s, name),
        f = s.telemetry.fields[name];
      const identity = `${s.clock_id}/${s.telemetry.generation}/${field(s, "USV_PKT") ?? f?.sequence}`;
      if (f && value !== null && seen.current[key] !== identity) {
        seen.current[key] = identity;
        setSeries((old) => ({
          ...old,
          [key]: [
            ...old[key].filter((p) => p.t >= f.received_ms - 120000),
            { t: f.received_ms, value },
          ].slice(-1200),
        }));
      }
    }
  }, [s]);
  return series;
}

function Cockpit({
  s,
  preferences,
  draft,
  send,
  onRequest,
  onPlan,
}: {
  s: Snapshot;
  preferences: Preferences;
  draft: MissionDraft;
  send: SendIntent;
  onRequest: (id: string) => void;
  onPlan: () => void;
}) {
  const armed = field(s, "armed"),
    mode = field(s, "mode"),
    status = field(s, "USV_STAT"),
    fix = field(s, "gps_fix");
  const latest = s.flight_requests.at(-1);
  return (
    <section className="workspace cockpit">
      <header className="workspace-heading">
        <div>
          <h1>航行驾驶舱</h1>
          <p>
            {s.telemetry.system_id
              ? `无人船 ${String(s.telemetry.system_id).padStart(2, "0")}`
              : "等待无人船"}{" "}
            ·{" "}
            {s.link === "connected"
              ? "ArduPilot ArduRover"
              : "尚未建立飞控连接"}
          </p>
        </div>
        <button className="text-button" onClick={onPlan}>
          规划航线
          <ArrowRight size={15} />
        </button>
      </header>
      <div className="cockpit-body">
        <div className="cockpit-map">
          <MapView
            snapshot={s}
            preferences={preferences}
            waypoints={draft.waypoints}
          />
          <div className="navigation-metrics">
            <Metric
              label="地速"
              value={number(field(s, "speed"), 2)}
              unit="m/s"
            />
            <Metric
              label="航向"
              value={number(field(s, "heading"), 1)}
              unit="°"
            />
            <Metric
              label="横滚 / 俯仰"
              value={`${number(field(s, "roll"), 1)} / ${number(field(s, "pitch"), 1)}`}
              unit="°"
            />
            <Metric
              label="任务项"
              value={number(field(s, "mission_current"), 0)}
            />
          </div>
        </div>
        <aside className="operations-panel">
          <section>
            <div className="section-heading">
              <h2>航行控制</h2>
              <span className="mode-label">
                {mode === null ? "模式待更新" : (modes[mode] ?? String(mode))}
              </span>
            </div>
            <div className="arm-row">
              <span className={armed === 1 ? "warning-text" : "muted"}>
                {armed === null
                  ? "解锁状态待更新"
                  : armed
                    ? "推进已解锁"
                    : "推进已上锁"}
              </span>
              <button
                className={armed === 1 ? "" : "primary"}
                disabled={
                  armed === 1 ? !s.navigation.disarm : !s.navigation.arm
                }
                onClick={() =>
                  void send(
                    { type: "arm", armed: armed !== 1, confirmed: true },
                    `对无人船 ${s.telemetry.system_id} 执行${armed === 1 ? "上锁" : "解锁"}。`,
                  )
                }
              >
                {armed === 1 ? "上锁" : "解锁"}
              </button>
            </div>
            <div className="mode-buttons">
              <button
                disabled={!s.navigation.hold}
                onClick={() =>
                  void send({ type: "mode", mode: 4, confirmed: true })
                }
              >
                HOLD 保持
              </button>
              <button
                disabled={!s.navigation.auto}
                onClick={() =>
                  void send(
                    { type: "mode", mode: 10, confirmed: true },
                    `无人船 ${s.telemetry.system_id} 切换 AUTO 并执行当前任务。`,
                  )
                }
              >
                AUTO 任务
              </button>
              <button
                disabled={!s.navigation.guided}
                onClick={() =>
                  void send(
                    { type: "mode", mode: 15, confirmed: true },
                    `无人船 ${s.telemetry.system_id} 切换 GUIDED 模式。`,
                  )
                }
              >
                GUIDED
              </button>
              <button
                disabled={!s.navigation.rtl}
                onClick={() =>
                  void send(
                    { type: "mode", mode: 11, confirmed: true },
                    `无人船 ${s.telemetry.system_id} 执行 RTL 返航。`,
                  )
                }
              >
                RTL 返航
              </button>
            </div>
            {latest && (
              <p
                className={`flight-feedback ${latest.state === "unknown" ? "warning-text" : ""}`}
              >
                {latest.name}：{stateText[latest.state] ?? latest.state}
                {latest.ack_result != null && (
                  <small>标准 ACK {latest.ack_result}；状态单独确认</small>
                )}
              </p>
            )}
          </section>
          <section>
            <h2>定位与电源</h2>
            <dl className="telemetry-list">
              <div>
                <dt>
                  <Satellite size={15} />
                  GPS
                </dt>
                <dd>
                  {fix === null
                    ? "未更新"
                    : fix >= 6
                      ? "RTK 固定"
                      : fix === 5
                        ? "RTK 浮点"
                        : fix >= 3
                          ? "已定位"
                          : "未定位"}
                  <small>{number(field(s, "satellites"), 0)} 颗卫星</small>
                </dd>
              </div>
              <div>
                <dt>HDOP</dt>
                <dd>
                  <Reading s={s} name="hdop" digits={2} />
                </dd>
              </div>
              <div>
                <dt>
                  <Battery size={15} />
                  电池
                </dt>
                <dd>
                  <Reading s={s} name="battery_percent" digits={0} unit=" %" />
                  <small>
                    <Reading
                      s={s}
                      name="battery_voltage"
                      digits={2}
                      unit=" V"
                    />
                  </small>
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <div className="section-heading">
              <h2>采样载荷</h2>
              <span
                className={`status-dot ${s.payload_online ? "online" : ""}`}
              />
            </div>
            <div className="payload-overview">
              <strong>
                {s.payload_online
                  ? status === null
                    ? "状态待更新"
                    : (statuses[status] ?? `状态 ${status}`)
                  : "载荷离线"}
              </strong>
              <span>
                步骤 <Reading s={s} name="USV_STEP" digits={0} /> /{" "}
                <Reading s={s} name="USV_STOT" digits={0} />
              </span>
            </div>
            <dl className="telemetry-list compact-list">
              <div>
                <dt>电压</dt>
                <dd>
                  <Reading s={s} name="USV_VOLT" digits={4} unit=" V" />
                </dd>
              </div>
              <div>
                <dt>吸光度</dt>
                <dd>
                  <Reading s={s} name="USV_ABS" digits={4} unit=" AU" />
                </dd>
              </div>
            </dl>
            <PayloadControls s={s} send={send} compact />
          </section>
          <section className="panel-request">
            <h2>命令反馈</h2>
            <RequestSummary record={s.requests.at(-1)} onOpen={onRequest} />
          </section>
        </aside>
      </div>
    </section>
  );
}

export default function App() {
  const { snapshot: s, error, send: backendSend } = useStation();
  const [workspace, setWorkspace] = useState<Workspace>("cockpit");
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [draft, setDraft] = useState<MissionDraft>(loadDraft);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<{
    text: string;
    intent: Intent;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const series = useSignals(s);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    localStorage.setItem("usv.preferences", JSON.stringify(preferences));
  }, [preferences]);
  useEffect(() => {
    localStorage.setItem("usv.mission", JSON.stringify(draft));
  }, [draft]);
  function notify(text: string, isError = false) {
    setNotice({ text, error: isError });
  }
  async function execute(intent: Intent) {
    setBusy(true);
    try {
      const result = object(await backendSend(intent));
      const failures = Object.entries(result)
        .filter(([, value]) => "Err" in object(value))
        .map(([key, value]) => `${key}：${String(object(value).Err)}`);
      notify(
        failures.length
          ? failures.join("；")
          : intent.type === "connect"
            ? "正在连接，等待飞控心跳"
            : "操作已提交，等待设备回执",
        failures.length > 0,
      );
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  }
  const send: SendIntent = async (intent, text) => {
    if (text) {
      setConfirmation({ intent, text });
      return;
    }
    await execute(intent);
  };
  const openRequest = (id: string) => {
    setSelectedRequest(id);
    setWorkspace("diagnostics");
  };
  const nav = [
    { key: "cockpit", label: "驾驶舱", icon: Navigation },
    { key: "planner", label: "航线", icon: Route },
    { key: "sampling", label: "采样", icon: FlaskConical },
    { key: "diagnostics", label: "诊断", icon: Radio },
  ] as const;
  const locked = s.safety.emergency_latched || s.safety.outputs_unknown;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <Compass size={28} strokeWidth={1.6} />
          <strong>
            USV<span>GroundStation</span>
          </strong>
        </div>
        <div className="header-status">
          <button
            className={`connection-indicator ${s.link === "connected" ? "online" : ""}`}
            onClick={() => setWorkspace("settings")}
          >
            <span />
            {s.link === "connected"
              ? `无人船 ${s.telemetry.system_id} 已连接`
              : s.link === "connecting"
                ? "等待飞控心跳"
                : native
                  ? "连接无人船"
                  : "浏览器预览"}
          </button>
          <span
            className={`payload-link ${s.payload_online ? "online-text" : ""}`}
          >
            <Waves size={15} />
            载荷 {s.payload_online ? "在线" : "离线"}
          </span>
        </div>
        <button
          className="emergency-button"
          disabled={s.link !== "connected"}
          onClick={() =>
            void send(
              { type: "emergency_stop", confirmed: true },
              `对无人船 ${s.telemetry.system_id} 执行推进强制上锁和载荷全输出停止，两部分将分别等待真实状态与回执。`,
            )
          }
        >
          <OctagonAlert size={19} />
          急停
        </button>
      </header>
      <nav className="app-nav" aria-label="主工作区">
        {nav.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            aria-current={workspace === key ? "page" : undefined}
            className={workspace === key ? "active" : ""}
            onClick={() => setWorkspace(key)}
          >
            <Icon size={22} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
        <div className="nav-bottom">
          <button
            aria-label={
              preferences.theme === "light" ? "切换深色主题" : "切换浅色主题"
            }
            onClick={() =>
              setPreferences({
                ...preferences,
                theme: preferences.theme === "light" ? "dark" : "light",
              })
            }
          >
            {preferences.theme === "light" ? (
              <Moon size={20} />
            ) : (
              <Sun size={20} />
            )}
          </button>
          <button
            className={workspace === "settings" ? "active" : ""}
            aria-label="连接与设置"
            onClick={() => setWorkspace("settings")}
          >
            <Settings2 size={21} />
            <span>设置</span>
          </button>
        </div>
      </nav>
      <main className="app-main">
        {(notice || error) && (
          <div
            className={`notice ${notice?.error || error ? "error" : ""}`}
            role={notice?.error || error ? "alert" : "status"}
          >
            <span>{notice?.text ?? error}</span>
            <button
              aria-label="关闭反馈"
              className="icon-button"
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {(s.identity_error || s.log_error) && (
          <div className="notice error" role="alert">
            {s.identity_error
              ? `身份存储：${s.identity_error}`
              : `诊断日志：${s.log_error}`}
          </div>
        )}
        {locked && (
          <div className="safety-banner">
            <div className="safety-title">
              <ShieldCheck size={20} />
              <strong>
                {s.safety.emergency_latched
                  ? "急停保护保持中"
                  : "设备输出状态待同步"}
              </strong>
              <span>停止结果和后续状态到齐后恢复操作</span>
            </div>
            {s.safety.emergency_latched && (
              <div className="safety-evidence">
                <Evidence confirmed={s.safety.propulsion_confirmed}>
                  推进上锁
                </Evidence>
                <Evidence confirmed={s.safety.payload_confirmed}>
                  载荷全输出停止
                </Evidence>
              </div>
            )}
            <button
              disabled={!s.navigation.verify_stop}
              onClick={() =>
                void send(
                  { type: "verify_stop", onsite_confirmed: true },
                  "已在现场确认推进和载荷均已停止，解除本次急停保护。",
                )
              }
            >
              确认现场停止
            </button>
          </div>
        )}
        {workspace === "cockpit" && (
          <Cockpit
            s={s}
            preferences={preferences}
            draft={draft}
            send={send}
            onRequest={openRequest}
            onPlan={() => setWorkspace("planner")}
          />
        )}
        {workspace === "planner" && (
          <Planner
            s={s}
            preferences={preferences}
            draft={draft}
            setDraft={setDraft}
            send={send}
            notify={notify}
          />
        )}
        {workspace === "sampling" && (
          <PayloadWorkspace
            s={s}
            preferences={preferences}
            send={send}
            notify={notify}
            series={series}
            onRequest={openRequest}
          />
        )}
        {workspace === "diagnostics" && (
          <Diagnostics
            s={s}
            preferences={preferences}
            selected={selectedRequest}
            onSelect={setSelectedRequest}
            notify={notify}
          />
        )}
        {workspace === "settings" && (
          <Settings
            s={s}
            preferences={preferences}
            setPreferences={setPreferences}
            send={send}
            notify={notify}
          />
        )}
      </main>
      <footer className="app-footer">
        <span>
          <span
            className={`status-dot ${s.link === "connected" ? "online" : ""}`}
          />
          {s.link === "connected" ? (
            "MAVLink 2"
          ) : (
            <>
              <Unplug size={12} />
              未连接
            </>
          )}
          <span className="footer-divider" />
          {native ? "Rust 控制核心" : "界面预览，无设备控制"}
        </span>
        <span>
          WGS 84
          <span className="footer-divider" />
          v0.1.0
        </span>
      </footer>
      {confirmation && (
        <Confirm
          text={confirmation.text}
          busy={busy}
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
          onConfirm={() => void execute(confirmation.intent)}
        />
      )}
    </div>
  );
}
