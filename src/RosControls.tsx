import { useEffectEvent, useLayoutEffect, useMemo, useState } from "react";
import type { Snapshot, Notify } from "./types";
import { call, object, unpack, native } from "./backend";
import {
  controlArgs,
  useRosTransport,
  setRosTransport,
  setRosToken,
  type RosTransport,
} from "./rosAccess";
import { Confirm } from "./ui";
import "./RosControls.css";

const topics = {
  pid: ["PID 参数", "/api/pid/config"],
  offsets: ["相对零点", "/api/calibration/offsets"],
  presets: ["采样预设", "/api/preset/auto/"],
  waypoints: ["航点采样配置", "/api/waypoint-sampling"],
  hardware: ["硬件设置", "/api/hardware/config"],
} as const;
type Topic = keyof typeof topics;

export default function RosControls({
  s,
  baseUrl,
  notify,
}: {
  s: Snapshot;
  baseUrl: string;
  notify: Notify;
}) {
  const transport = useRosTransport();
  const [topic, setTopic] = useState<Topic>("pid");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [axis, setAxis] = useState("X");
  const [direction, setDirection] = useState("F");
  const [speed, setSpeed] = useState(10);
  const [angle, setAngle] = useState(90);
  const [continuous, setContinuous] = useState(false);
  const [injectionSpeed, setInjectionSpeed] = useState(20);
  const [manual, setManual] = useState<Record<string, unknown> | null>(null);
  const [manualMessage, setManualMessage] = useState("");
  const [manualActivity, setManualActivity] = useState<"read" | "stop" | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    label: string;
    path: string;
    body: unknown;
  } | null>(null);
  const ready = native && (transport === "http" || s.link === "connected");
  const radioSession =
    transport === "mavlink"
      ? `${s.link}:${s.telemetry.generation}:${s.telemetry.system_id}:${s.payload_online}`
      : "";
  const manualSession = useMemo(
    () => ({ active: false, revision: 0 }),
    [baseUrl, transport, s.clock_id, radioSession],
  );
  const protectedOutputs =
    s.safety.emergency_latched || s.safety.outputs_unknown;
  let manualLabel = "手动状态待确认";
  if (!ready) manualLabel = "等待通信连接";
  else if (protectedOutputs) manualLabel = "停止保护生效";
  else if (manual?.automation_active === true) manualLabel = "自动化运行中";
  else if (manual?.enabled === true) manualLabel = "手动模式已开启";
  else if (manual?.enabled === false) manualLabel = "手动模式已关闭";
  const canMove =
    ready &&
    !busy &&
    manualActivity !== "stop" &&
    !protectedOutputs &&
    manual?.enabled === true &&
    manual.automation_active === false;
  const path = topic === "presets" ? topics[topic][1] + name : topics[topic][1];
  function editTopic(value: Topic) {
    setTopic(value);
    setText("");
    setReport(null);
  }
  async function request(
    method: string,
    path: string,
    body: unknown = {},
    confirmed = false,
  ) {
    // Stops remain usable while a long read/write is pending.
    const manualAction = path.startsWith("/api/manual/");
    const readStatus = path === "/api/manual/status";
    const stopAll = path === "/api/manual/stop-all";
    const stop = stopAll || path === "/api/injection-pump/off";
    const revision = manualAction ? ++manualSession.revision : 0;
    const current = () =>
      !manualAction ||
      (manualSession.active && revision === manualSession.revision);
    if (!stop && !readStatus) setBusy(true);
    if (manualAction) {
      setManualActivity(readStatus ? "read" : stopAll ? "stop" : null);
      setManualMessage(
        readStatus
          ? "正在读取手动状态…"
          : stopAll
            ? "正在停止全部泵…"
            : "正在等待设备响应…",
      );
    }
    try {
      const args = controlArgs(baseUrl, method, path, body, confirmed);
      const send = () => call<unknown>("ros_control", args);
      const result = await send().catch((error) => {
        // A ROS restart can invalidate the first request on an otherwise live radio.
        if (readStatus && transport === "mavlink" && current()) return send();
        throw error;
      });
      if (!current()) return result;
      if (manualAction) {
        const data = object(unpack(result));
        if (readStatus || path === "/api/manual/mode") {
          setManual(data);
          setManualMessage("");
        } else if (stopAll) {
          setManualMessage("全泵停止已确认");
        } else {
          const axis = object(body).axis;
          setManualMessage(
            data.controller_reply === "CMD_OK"
              ? `${axis} 轴指令已获控制板确认`
              : `${axis} 轴指令已提交，控制板回执待确认`,
          );
        }
      } else {
        setReport(result);
        if (method !== "GET" && path !== "/api/injection-pump/status")
          notify("操作已提交，请查看设备反馈");
      }
      return result;
    } catch (error) {
      if (current()) {
        if (manualAction) {
          if (readStatus || path === "/api/manual/mode") setManual(null);
          setManualMessage(String(error));
        } else notify(String(error), true);
      }
      throw error;
    } finally {
      if (!stop && !readStatus) setBusy(false);
      if (manualAction && current()) setManualActivity(null);
    }
  }
  const run = (
    method: string,
    path: string,
    body: unknown = {},
    confirmed = false,
  ) => {
    void request(method, path, body, confirmed).catch(() => {});
  };
  const readManualOnConnect = useEffectEvent(() =>
    run("GET", "/api/manual/status"),
  );
  useLayoutEffect(() => {
    manualSession.active = true;
    setManual(null);
    setManualMessage("");
    setManualActivity(null);
    setConfirm((pending) =>
      pending?.path.startsWith("/api/manual/") ? null : pending,
    );
    const revision = ++manualSession.revision;
    if (ready)
      queueMicrotask(() => {
        if (manualSession.active && revision === manualSession.revision)
          readManualOnConnect();
      });
    return () => {
      manualSession.active = false;
    };
  }, [manualSession, ready]);
  function parsed() {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("配置必须是 JSON 对象");
    return body;
  }
  async function load() {
    try {
      const result = await request("GET", path);
      const data = unpack(result);
      setText(
        JSON.stringify(topic === "offsets" ? { offsets: data } : data, null, 2),
      );
    } catch {
      /* The request already reported the error. */
    }
  }
  function save(apply = false) {
    try {
      const body = parsed();
      if (apply)
        setConfirm({
          label: "应用硬件设置并重新连接设备",
          path: "/api/hardware/apply",
          body,
        });
      else run("POST", path, body);
    } catch (error) {
      notify(String(error), true);
    }
  }
  return (
    <section className="ros-controls">
      <h2>ROS 配置与设备</h2>
      <div className="inline-form">
        <label>
          配置与控制通信
          <select
            value={transport}
            disabled={busy || confirm !== null}
            onChange={(e) => {
              setRosTransport(e.target.value as RosTransport);
              setText("");
              setReport(null);
            }}
          >
            <option value="http">HTTP</option>
            <option value="mavlink">数传 MAVLink</option>
          </select>
        </label>
        <label>
          控制令牌
          <input
            type="password"
            autoComplete="off"
            placeholder="船端启用认证时填写"
            onChange={(e) => setRosToken(e.target.value)}
          />
        </label>
      </div>
      <p className="caption">数据中心、地图数据和文件下载继续使用 HTTP。</p>
      <div className="inline-form">
        <label>
          配置项目
          <select
            value={topic}
            disabled={busy || confirm !== null}
            onChange={(e) => editTopic(e.target.value as Topic)}
          >
            {Object.entries(topics).map(([key, value]) => (
              <option key={key} value={key}>
                {value[0]}
              </option>
            ))}
          </select>
        </label>
        {topic === "presets" && (
          <label>
            预设名称
            <input
              value={name}
              disabled={busy || confirm !== null}
              onChange={(e) => {
                setName(e.target.value);
                setText("");
              }}
              maxLength={64}
            />
          </label>
        )}
        <button
          disabled={!ready || busy || (topic === "presets" && !name)}
          onClick={() => void load()}
        >
          读取{topics[topic][0]}
        </button>
        <button
          disabled={!ready || busy || !text || (topic === "presets" && !name)}
          onClick={() => save()}
        >
          保存{topics[topic][0]}
        </button>
        {topic === "presets" && (
          <>
            <button
              disabled={!ready || busy}
              onClick={() => run("GET", "/api/presets/auto")}
            >
              列出预设
            </button>
            <button
              disabled={!ready || busy || !name}
              onClick={() =>
                setConfirm({
                  label: `删除预设 ${name}`,
                  path,
                  body: { method: "DELETE" },
                })
              }
            >
              删除预设
            </button>
          </>
        )}
        {topic === "waypoints" && (
          <button
            disabled={!ready || busy}
            onClick={() => run("POST", "/api/waypoint-sampling/sync")}
          >
            同步飞控航点
          </button>
        )}
        {topic === "hardware" && (
          <>
            <button
              disabled={!ready || busy}
              onClick={() => run("GET", "/api/hardware/serial-ports")}
            >
              列出串口
            </button>
            <button
              disabled={!ready || busy || !text || protectedOutputs}
              onClick={() => save(true)}
            >
              应用硬件设置
            </button>
            <button
              disabled={!ready || busy || !text || protectedOutputs}
              onClick={() => {
                try {
                  const hw = object(parsed());
                  setConfirm({
                    label: "测试泵控串口",
                    path: "/api/hardware/test-pump-port",
                    body: {
                      serial_port: hw.pump_serial_port,
                      baudrate: hw.pump_baudrate,
                      timeout: hw.pump_timeout,
                    },
                  });
                } catch (error) {
                  notify(String(error), true);
                }
              }}
            >
              测试泵控串口
            </button>
          </>
        )}
      </div>
      <textarea
        className="json-editor"
        aria-label={`${topics[topic][0]} JSON`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {topic === "offsets" && (
        <div className="inline-form">
          <label>
            零点轴
            <select value={axis} onChange={(e) => setAxis(e.target.value)}>
              {["X", "Y", "Z", "A"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button
            disabled={!ready || busy}
            onClick={() =>
              setConfirm({
                label: `将 ${axis} 轴当前位置设为零点`,
                path: "/api/calibration/zero",
                body: { axis },
              })
            }
          >
            当前位置设零
          </button>
          <button
            disabled={!ready || busy}
            onClick={() =>
              setConfirm({
                label: `重置 ${axis} 轴零点`,
                path: "/api/calibration/reset",
                body: { axis },
              })
            }
          >
            重置零点
          </button>
          <button
            disabled={!ready || busy || protectedOutputs}
            onClick={() =>
              setConfirm({
                label: `${axis} 轴运动回到保存的零点`,
                path: "/api/calibration/start",
                body: { motors: axis },
              })
            }
          >
            运动回零
          </button>
          <button
            disabled={!ready || busy}
            onClick={() =>
              setConfirm({
                label: "将全部轴当前位置设为零点",
                path: "/api/calibration/zero",
                body: {},
              })
            }
          >
            全部轴设零
          </button>
          <button
            disabled={!ready || busy}
            onClick={() =>
              setConfirm({
                label: "重置全部轴零点",
                path: "/api/calibration/reset",
                body: {},
              })
            }
          >
            重置全部零点
          </button>
          <button
            disabled={!ready || busy || protectedOutputs}
            onClick={() =>
              setConfirm({
                label: "全部轴运动回到保存的零点",
                path: "/api/calibration/start",
                body: { motors: "XYZA" },
              })
            }
          >
            全部轴回零
          </button>
        </div>
      )}
      <h3>四轴手动泵控</h3>
      <p className="caption" role="status">
        {manualLabel}
        {manualMessage && ` · ${manualMessage}`}
      </p>
      <div className="inline-form">
        <button
          disabled={
            !ready ||
            busy ||
            manualActivity === "stop" ||
            protectedOutputs ||
            manual?.enabled === true
          }
          onClick={() =>
            setConfirm({
              label: "开启手动模式",
              path: "/api/manual/mode",
              body: { enabled: true },
            })
          }
        >
          开启手动模式
        </button>
        <button
          disabled={
            !ready ||
            busy ||
            manualActivity === "stop" ||
            manual?.enabled === false
          }
          onClick={() => run("POST", "/api/manual/mode", { enabled: false })}
        >
          退出手动模式
        </button>
        <button
          disabled={!ready || busy || manualActivity !== null}
          onClick={() => run("GET", "/api/manual/status")}
        >
          刷新手动状态
        </button>
      </div>
      <div className="inline-form">
        <label>
          泵轴
          <select value={axis} onChange={(e) => setAxis(e.target.value)}>
            {["X", "Y", "Z", "A"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          泵方向
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="F">正转</option>
            <option value="B">反转</option>
          </select>
        </label>
        <label>
          转速 RPM
          <input
            type="number"
            min={0.01}
            max={100}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <label>
          角度 °
          <input
            type="number"
            min={0.01}
            max={99999}
            value={angle}
            disabled={continuous}
            onChange={(e) => setAngle(Number(e.target.value))}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={continuous}
            onChange={(e) => setContinuous(e.target.checked)}
          />
          连续运行
        </label>
        <button
          disabled={
            !canMove ||
            !Number.isFinite(speed) ||
            speed <= 0 ||
            speed > 100 ||
            !Number.isFinite(angle) ||
            angle < 0 ||
            angle > 99999 ||
            (!continuous && angle === 0)
          }
          onClick={() =>
            setConfirm({
              label: `启动 ${axis} 轴泵`,
              path: "/api/manual/pump-step",
              body: {
                axis,
                direction,
                speed_rpm: speed,
                angle_deg: angle,
                continuous,
              },
            })
          }
        >
          运行泵
        </button>
        <button
          disabled={!ready}
          onClick={() => run("POST", "/api/manual/stop-all")}
        >
          全泵停止
        </button>
      </div>
      <h3>注射泵</h3>
      <div className="inline-form">
        <label>
          注射泵转速
          <input
            type="number"
            min={0}
            max={100}
            value={injectionSpeed}
            onChange={(e) => setInjectionSpeed(Number(e.target.value))}
          />
        </label>
        <button
          disabled={!ready || busy}
          onClick={() => run("POST", "/api/injection-pump/status")}
        >
          读取注射泵状态
        </button>
        <button
          disabled={
            !ready ||
            busy ||
            protectedOutputs ||
            !Number.isInteger(injectionSpeed) ||
            injectionSpeed <= 0 ||
            injectionSpeed > 100
          }
          onClick={() =>
            setConfirm({
              label: "启动注射泵",
              path: "/api/injection-pump/on",
              body: { speed: injectionSpeed },
            })
          }
        >
          启动注射泵
        </button>
        <button
          disabled={
            !ready ||
            busy ||
            protectedOutputs ||
            !Number.isInteger(injectionSpeed) ||
            injectionSpeed < 0 ||
            injectionSpeed > 100
          }
          onClick={() =>
            setConfirm({
              label: "设置注射泵转速",
              path: "/api/injection-pump/set",
              body: { speed: injectionSpeed },
            })
          }
        >
          设置注射泵转速
        </button>
        <button
          disabled={!ready}
          onClick={() => run("POST", "/api/injection-pump/off")}
        >
          停止注射泵
        </button>
      </div>
      <h3>Jetson / bridge / MAVROS</h3>
      <div className="inline-form">
        {[
          ["节点与链路", "link"],
          ["设备与自动化", "system"],
          ["最近事件", "events"],
          ["诊断历史", "history"],
        ].map(([label, route]) => (
          <button
            key={route}
            disabled={!ready || busy}
            onClick={() => run("GET", `/api/diagnostics/${route}`)}
          >
            {label}
          </button>
        ))}
        <button
          disabled={!ready || busy}
          onClick={() => run("POST", "/api/diagnostics/link/reconnect")}
        >
          请求 MAVROS 重连
        </button>
      </div>
      {busy && <p role="status">正在与 ROS 通信…</p>}
      {report !== null && (
        <pre className="ros-control-report" aria-label="ROS 操作结果">
          {JSON.stringify(report, null, 2)}
        </pre>
      )}
      {confirm && (
        <Confirm
          text={confirm.label}
          busy={false}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            if (object(pending.body).method === "DELETE")
              run("DELETE", pending.path);
            else run("POST", pending.path, pending.body, true);
          }}
        />
      )}
    </section>
  );
}
