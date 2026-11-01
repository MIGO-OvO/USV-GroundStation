import { useState } from "react";
import {
  Download,
  Filter,
  RefreshCw,
  Circle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import type {
  Snapshot,
  Preferences,
  RequestRecord,
  Diagnostic,
  Notify,
} from "./types";
import { commands, requestLabel, time } from "./format";
import { call, useRos, unpack, object, native } from "./backend";
import { Empty } from "./ui";

export function Timeline({
  r,
  diagnostics,
}: {
  r: RequestRecord;
  diagnostics: Diagnostic[];
}) {
  const ack = diagnostics.find(
    (d) =>
      d.kind === "ack_unattributed" &&
      Array.isArray(object(d.detail).candidate_requests) &&
      (object(d.detail).candidate_requests as unknown[]).includes(r.id),
  );
  const steps = [
    {
      title: "UI 意图 / Rust 创建",
      stage: r.timeline.find((t) => t.name === "created"),
    },
    { title: "MAVLink 发送", stage: r.timeline.find((t) => t.name === "sent") },
    { title: "标准 ACK", stage: undefined, ack },
    { title: "关联接单", stage: r.timeline.find((t) => t.name === "request") },
    { title: "设备进度", stage: r.timeline.find((t) => t.name === "progress") },
    { title: "终态事件", stage: r.timeline.find((t) => t.name === "terminal") },
  ];
  return (
    <div className="command-timeline">
      <div className="timeline-heading">
        <div>
          <h2>{commands[r.command]}</h2>
          <p>
            {r.sender_system}/{r.sender_component} → {r.target_system}/191 ·
            session {r.session} / request {r.request}
          </p>
        </div>
        <span className={`state ${r.state}`}>{requestLabel(r)}</span>
      </div>
      <ol className="timeline-stages">
        {steps.map((step) => {
          const known = !!step.stage || !!step.ack;
          const at = step.stage?.at_ms ?? step.ack?.mono_ms;
          const clock = step.stage?.clock_id ?? step.ack?.clock_id;
          return (
            <li key={step.title} className={known ? "observed" : ""}>
              {known ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              <div>
                <strong>{step.title}</strong>
                <span>
                  {step.stage?.detail ??
                    (step.ack ? "收到同命令 ACK，无法关联请求身份" : "未确认")}
                </span>
                <small>
                  {at !== undefined
                    ? clock === r.clock_id
                      ? `本机 +${((at - r.created_ms) / 1000).toFixed(3)} s`
                      : "来自另一次应用运行，时钟不同"
                    : "无接收证据"}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
      <details>
        <summary>全部阶段与异常记录（{r.timeline.length}）</summary>
        <table>
          <thead>
            <tr>
              <th>本机单调时间</th>
              <th>阶段</th>
              <th>记录</th>
            </tr>
          </thead>
          <tbody>
            {r.timeline.map((stage, i) => (
              <tr key={i}>
                <td>
                  {stage.clock_id === r.clock_id
                    ? `${stage.at_ms} ms`
                    : "另一次运行"}
                </td>
                <td>{stage.name}</td>
                <td>{stage.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="caption">
        时间线使用相同 clock_id
        的本机接收时钟。Jetson、路由器和飞控阶段缺失时保持未确认。
      </p>
    </div>
  );
}

function identity(d: Diagnostic) {
  const detail = object(d.detail),
    ev = object(detail.event);
  return {
    session: d.session ?? ev.session,
    request: d.request ?? ev.request,
    command: d.command ?? ev.command ?? detail.command,
  };
}
export default function Diagnostics({
  s,
  preferences,
  selected,
  onSelect,
  notify,
}: {
  s: Snapshot;
  preferences: Preferences;
  selected: string;
  onSelect: (id: string) => void;
  notify: Notify;
}) {
  const [tab, setTab] = useState<"local" | "jetson">("local");
  const [filter, setFilter] = useState("");
  const [errors, setErrors] = useState(false);
  const [direction, setDirection] = useState("all");
  const [period, setPeriod] = useState(0);
  const [busy, setBusy] = useState(false);
  const link = useRos(
    preferences.rosUrl,
    "/api/diagnostics/link",
    tab === "jetson",
    3000,
  );
  const system = useRos(
    preferences.rosUrl,
    "/api/diagnostics/system",
    tab === "jetson",
    3000,
  );
  const events = useRos(
    preferences.rosUrl,
    "/api/diagnostics/events",
    tab === "jetson",
    3000,
  );
  const record = s.requests.find((r) => r.id === selected) ?? s.requests.at(-1);
  const rows = s.diagnostics.filter(
    (d) =>
      (!errors ||
        /rejected|invalid|timeout|lost|failed|deferred/.test(d.kind)) &&
      (direction === "all" || d.direction === direction) &&
      (!period || s.unix_ms - d.unix_ms <= period * 1000) &&
      (!filter ||
        JSON.stringify({ ...identity(d), kind: d.kind, detail: d.detail })
          .toLowerCase()
          .includes(filter.toLowerCase())),
  );
  async function exportLogs() {
    setBusy(true);
    try {
      const path = await call<string>("export_diagnostics", {
        baseUrl: preferences.rosUrl || null,
      });
      notify(`诊断包已保存：${path}`);
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace diagnostics">
      <header className="workspace-heading">
        <div>
          <h1>通信诊断</h1>
          <p>MAVLink、请求生命周期与 Jetson 链路证据</p>
        </div>
        <button disabled={!native || busy} onClick={() => void exportLogs()}>
          <Download size={16} />
          {busy ? "导出中" : "导出 JSONL / ZIP"}
        </button>
      </header>
      <div className="workspace-tabs">
        <button
          className={tab === "local" ? "active" : ""}
          onClick={() => setTab("local")}
        >
          地面站通信
        </button>
        <button
          className={tab === "jetson" ? "active" : ""}
          onClick={() => setTab("jetson")}
        >
          Jetson / ROS
        </button>
      </div>
      <div className="diagnostics-scroll">
        {tab === "local" ? (
          <>
            <div className="request-picker">
              <label>
                命令时间线
                <select
                  value={record?.id ?? ""}
                  onChange={(e) => onSelect(e.target.value)}
                >
                  <option value="">选择请求</option>
                  {[...s.requests].reverse().map((r) => (
                    <option key={r.id} value={r.id}>
                      {time(r.created_unix_ms)} · {commands[r.command]} ·{" "}
                      {r.session}/{r.request} · {requestLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {record ? (
              <Timeline r={record} diagnostics={s.diagnostics} />
            ) : (
              <Empty title="尚无载荷命令">
                发送命令后可查看发送、接单和执行记录。
              </Empty>
            )}
            <section className="packet-section">
              <div className="section-heading">
                <h2>结构化通信记录</h2>
                <span className="caption">
                  最近 {s.diagnostics.length} 条 · 无效帧 {s.rejected_frames}
                </span>
              </div>
              <div className="diagnostic-filters">
                <label className="search">
                  <Filter size={15} />
                  <input
                    aria-label="按 request session 或错误类型筛选"
                    placeholder="request / session / 错误类型"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                <select
                  aria-label="通信方向"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="all">全部方向</option>
                  <option value="rx">接收 RX</option>
                  <option value="tx">发送 TX</option>
                  <option value="local">本机事件</option>
                </select>
                <select
                  aria-label="时间范围"
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                >
                  <option value={0}>全部保留记录</option>
                  <option value={30}>最近 30 秒</option>
                  <option value={300}>最近 5 分钟</option>
                </select>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={errors}
                    onChange={(e) => setErrors(e.target.checked)}
                  />
                  仅异常
                </label>
              </div>
              <div className="table-scroll packets">
                <table>
                  <thead>
                    <tr>
                      <th>本机接收时间</th>
                      <th>方向</th>
                      <th>sys / comp</th>
                      <th>消息 / 序号</th>
                      <th>命令 · session/request</th>
                      <th>类型与详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const id = identity(d);
                      return (
                        <tr key={d.index}>
                          <td className="numeric">
                            {time(d.unix_ms)}
                            <small>{d.mono_ms} ms</small>
                          </td>
                          <td>
                            <span className={`direction ${d.direction}`}>
                              {d.direction.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            {d.system ?? "本机"} / {d.component ?? ""}
                          </td>
                          <td>
                            {d.message_id ?? ""}{" "}
                            {d.mav_sequence != null && (
                              <small>seq {d.mav_sequence}</small>
                            )}
                          </td>
                          <td className="numeric">
                            {String(id.command ?? "")}
                            <small>
                              {id.session != null
                                ? `${id.session}/${id.request}`
                                : ""}
                            </small>
                          </td>
                          <td>
                            <details>
                              <summary>{d.kind}</summary>
                              <pre>{JSON.stringify(d.detail, null, 2)}</pre>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!rows.length && (
                  <p className="muted compact">当前筛选下没有记录</p>
                )}
              </div>
            </section>
          </>
        ) : (
          <div className="jetson-diagnostics">
            <div className="section-heading">
              <h2>{preferences.rosUrl}</h2>
              <button
                onClick={() => {
                  link.refresh();
                  system.refresh();
                  events.refresh();
                }}
              >
                <RefreshCw size={15} />
                刷新链路
              </button>
            </div>
            {link.error && <p className="inline-error">{link.error}</p>}
            {!native && <Empty title="在桌面应用中连接 ROS" />}
            <section>
              <h3>
                <Clock size={16} />
                路由器、MAVROS 与 bridge
              </h3>
              <pre>
                {JSON.stringify(unpack(link.data), null, 2) ?? "等待 ROS 诊断"}
              </pre>
            </section>
            <section>
              <h3>设备健康与自动化</h3>
              {system.error ? (
                <p className="inline-error">{system.error}</p>
              ) : (
                <pre>
                  {JSON.stringify(unpack(system.data), null, 2) ??
                    "等待设备健康"}
                </pre>
              )}
            </section>
            <section>
              <h3>Jetson 事件</h3>
              {events.error ? (
                <p className="inline-error">{events.error}</p>
              ) : (
                <pre>
                  {JSON.stringify(unpack(events.data), null, 2) ?? "等待事件"}
                </pre>
              )}
            </section>
          </div>
        )}
        <section className="freshness">
          <h2>遥测字段新鲜度</h2>
          <p className="caption">
            载荷心跳：
            {s.telemetry.payload_heartbeat_ms == null
              ? "未收到"
              : `${((s.now_ms - s.telemetry.payload_heartbeat_ms) / 1000).toFixed(1)} s 前`}
            {" · "}载荷遥测：
            {s.telemetry.payload_telemetry_ms == null
              ? "未收到"
              : `${((s.now_ms - s.telemetry.payload_telemetry_ms) / 1000).toFixed(1)} s 前`}
            {" · "}
            {s.payload_online ? "载荷链路在线" : "载荷链路无新鲜证据"}
          </p>
          <div className="freshness-grid">
            {Object.entries(s.telemetry.fields).map(([name, f]) => (
              <div key={name}>
                <span>{name}</span>
                <strong
                  className={s.now_ms - f.received_ms > 3000 ? "stale" : ""}
                >
                  {((s.now_ms - f.received_ms) / 1000).toFixed(1)} s
                </strong>
                <small>
                  序号 {f.sequence} · comp {f.source_component}
                </small>
              </div>
            ))}
          </div>
          {!Object.keys(s.telemetry.fields).length && (
            <p className="muted">等待设备遥测</p>
          )}
        </section>
      </div>
    </section>
  );
}
