import { useEffect, useRef, useState } from "react";
import { Cable, Cpu, Wifi, Server, Save, Map, RefreshCw } from "lucide-react";
import { version } from "../package.json";
import type {
  Snapshot,
  Preferences,
  ConnectionConfig,
  SendIntent,
  Notify,
} from "./types";
import { call, useRos, unpack, native, android, object } from "./backend";
import DataCenter from "./DataCenter";
import FirmwareDialog from "./FirmwareDialog";
import RosControls from "./RosControls";
import RosConfigEditor, { isConfig, useConfigDraft } from "./RosConfigEditor";
import { serialLabel, useSerialPorts } from "./serial";
import { Metric } from "./ui";

export default function Settings({
  s,
  preferences,
  setPreferences,
  send,
  notify,
}: {
  s: Snapshot;
  preferences: Preferences;
  setPreferences: (p: Preferences) => void;
  send: SendIntent;
  notify: Notify;
}) {
  const previous = s.saved_connection?.config ?? s.connection;
  const hydrated = useRef(Boolean(previous));
  const [kind, setKind] = useState<"udp" | "tcp" | "serial">(
    previous?.kind ?? "udp",
  );
  const [bind, setBind] = useState(
      previous?.kind === "udp" ? previous.bind : "0.0.0.0:14550",
    ),
    [peer, setPeer] = useState(
      previous?.kind === "udp" ? (previous.peer ?? "") : "",
    );
  const [host, setHost] = useState(
      previous?.kind === "tcp" ? previous.host : "127.0.0.1",
    ),
    [port, setPort] = useState(previous?.kind === "tcp" ? previous.port : 5760),
    [serial, setSerial] = useState(
      previous?.kind === "serial" ? previous.port : "",
    ),
    [baud, setBaud] = useState<number | null>(
      previous?.kind === "serial" ? previous.baud : null,
    );
  const [manualSerial, setManualSerial] = useState(false);
  const [firmwareOpen, setFirmwareOpen] = useState(false);
  const { ports: serialPorts, error: scanError } = useSerialPorts(
    native && !android && (kind === "serial" || firmwareOpen),
  );
  const recognizedLinks = serialPorts.filter(
    (device) =>
      !device.bootloader_hint &&
      (device.kind === "flight_controller" ||
        device.kind === "telemetry_radio"),
  );
  const serialPort =
    serial ||
    (!manualSerial && recognizedLinks.length === 1
      ? recognizedLinks[0].port
      : "");
  const serialDevice = serialPorts.find((device) => device.port === serialPort);
  const serialBaud =
    baud ?? (serialDevice?.kind === "telemetry_radio" ? 57600 : 115200);
  const [target, setTarget] = useState(
    s.saved_connection?.target_system?.toString() ?? "",
  );
  useEffect(() => {
    if (hydrated.current || !previous) return;
    hydrated.current = true;
    setKind(previous.kind);
    if (previous.kind === "udp") {
      setBind(previous.bind);
      setPeer(previous.peer ?? "");
    } else if (previous.kind === "tcp") {
      setHost(previous.host);
      setPort(previous.port);
    } else {
      setSerial(previous.port);
      setBaud(previous.baud);
    }
    setTarget(s.saved_connection?.target_system?.toString() ?? "");
  }, [previous, s.saved_connection?.target_system]);
  const [ros, setRos] = useState(preferences.rosUrl);
  const configDraft = useConfigDraft();
  const [configLoaded, setConfigLoaded] = useState(false);
  const [mapStats, setMapStats] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const config = useRos(preferences.rosUrl, "/api/config", configLoaded, 0);
  const calibration = useRos(
    preferences.rosUrl,
    "/api/calibration/offsets",
    configLoaded,
    0,
  );
  const mapConfig = useRos(
    preferences.rosUrl,
    "/api/map/config",
    configLoaded,
    0,
  );
  async function connect() {
    const connection: ConnectionConfig =
      kind === "udp"
        ? { kind, bind, peer: peer || null }
        : kind === "tcp"
          ? { kind, host, port }
          : { kind, port: serialPort.trim(), baud: serialBaud };
    await send({
      type: "connect",
      config: connection,
      target_system: target ? Number(target) : null,
    });
  }
  async function loadConfig() {
    setBusy(true);
    try {
      const data = await call<unknown>("ros_get", {
        baseUrl: preferences.rosUrl,
        path: "/api/config",
      });
      const config = unpack(data);
      if (!isConfig(config)) throw new Error("ROS 返回的配置应为对象。");
      const { sampling_sequence: _sequence, ...general } = config;
      configDraft.replaceText(JSON.stringify(general, null, 2));
      setConfigLoaded(true);
      notify("已读取 ROS 当前配置");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function saveConfig() {
    const edited = configDraft.validated();
    if (!edited) return;
    const { sampling_sequence: _sequence, ...body } = edited;
    setBusy(true);
    try {
      await call("ros_post", {
        baseUrl: preferences.rosUrl,
        path: "/api/config",
        body,
      });
      config.refresh();
      notify("ROS 配置已保存");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  const styles = object(unpack(mapConfig.data)).styles;
  const offsets = object(unpack(calibration.data));
  const configuredAxes = object(calibration.data).configured_axes;
  return (
    <section className="workspace settings">
      <header className="workspace-heading">
        <div>
          <h1>连接与设置</h1>
          <p>独立 MAVLink 连接 · ROS 数据服务 · 本机离线地图</p>
        </div>
      </header>
      <div className="settings-scroll">
        <section
          className="connection-settings"
          onChangeCapture={() => {
            hydrated.current = true;
          }}
        >
          <h2>
            <Cable size={19} />
            飞控连接
          </h2>
          <div className="segmented transport-switch">
            {(["udp", "tcp", "serial"] as const)
              .filter((k) => k !== "serial" || !android)
              .map((k) => (
                <button
                  key={k}
                  className={kind === k ? "active" : ""}
                  onClick={() => {
                    hydrated.current = true;
                    setKind(k);
                  }}
                >
                  {k === "serial" ? "Windows 串口" : k.toUpperCase()}
                </button>
              ))}
          </div>
          <div className="form-grid">
            {kind === "udp" ? (
              <>
                <label>
                  本机监听地址
                  <input
                    value={bind}
                    onChange={(e) => setBind(e.target.value)}
                    placeholder="0.0.0.0:14550"
                  />
                </label>
                <label>
                  固定对端（可留空）
                  <input
                    value={peer}
                    onChange={(e) => setPeer(e.target.value)}
                    placeholder="由首个匹配飞控心跳确定"
                  />
                </label>
              </>
            ) : kind === "tcp" ? (
              <>
                <label>
                  TCP 主机
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </label>
                <label>
                  端口
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={port}
                    onChange={(e) => setPort(e.target.valueAsNumber)}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  串口设备
                  <select
                    value={manualSerial ? "manual" : serialPort}
                    onChange={(event) => {
                      const value = event.target.value;
                      setManualSerial(value === "manual");
                      setSerial(value === "manual" ? serialPort : value);
                    }}
                  >
                    <option value="">
                      {serialPorts.length ? "选择串口" : "尚未检测到串口"}
                    </option>
                    {serialPorts.map((device) => (
                      <option key={device.port} value={device.port}>
                        {serialLabel(device)}
                      </option>
                    ))}
                    {!manualSerial && serialPort && !serialDevice && (
                      <option value={serialPort}>
                        {serialPort}（未检测到）
                      </option>
                    )}
                    <option value="manual">手动输入…</option>
                  </select>
                  {manualSerial && (
                    <input
                      aria-label="手动串口号"
                      value={serial}
                      placeholder="COM5"
                      onChange={(event) => setSerial(event.target.value)}
                    />
                  )}
                </label>
                <label>
                  波特率
                  <select
                    value={serialBaud}
                    onChange={(e) => setBaud(Number(e.target.value))}
                  >
                    {[57600, 115200, 230400, 460800, 921600].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              目标 sysid
              <input
                type="number"
                min="1"
                max="255"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="自动识别 ArduRover"
              />
            </label>
          </div>
          {kind === "serial" && scanError && (
            <p className="inline-error" role="alert">
              {scanError}
            </p>
          )}
          {kind === "serial" && serialDevice?.bootloader_hint && (
            <p className="caption">此串口处于引导模式，可打开固件刷写。</p>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={
                !native ||
                (kind === "serial" &&
                  (!serialPort.trim() ||
                    Boolean(serialDevice?.bootloader_hint)))
              }
              onClick={() => void connect()}
            >
              <Wifi size={16} />
              连接设备
            </button>
            <button
              disabled={!s.connection}
              onClick={() => void send({ type: "disconnect" })}
            >
              断开
            </button>
            {native && !android && (
              <button
                disabled={Boolean(s.connection)}
                title={s.connection ? "断开飞控连接后可刷写" : undefined}
                onClick={() => setFirmwareOpen(true)}
              >
                <Cpu size={16} />
                固件刷写
              </button>
            )}
            <span className="caption">GCS 254 / 190 · MAVLink 2</span>
          </div>
          {s.error && <p className="inline-error">{s.error}</p>}
          {s.connection_error && (
            <p className="inline-error" role="alert">
              {s.connection_error}
            </p>
          )}
          <p className="caption">
            连接参数保存在本机，下次启动自动连接。手动断开后，本次运行暂停重连。
          </p>
          <p className="caption">
            TCP 默认指向 mavlink-router；UDP
            在匹配飞控心跳后固定对端。重新连接只同步状态。
          </p>
        </section>
        <div className="settings-ros">
          <section>
            <h2>
              <Server size={19} />
              Jetson ROS 服务
            </h2>
            <div className="inline-form">
              <label>
                Web API 地址
                <input
                  type="url"
                  value={ros}
                  onChange={(e) => setRos(e.target.value)}
                  placeholder="http://10.42.0.1:5000"
                />
              </label>
              <button
                onClick={() => {
                  try {
                    const u = new URL(ros);
                    if (
                      !["http:", "https:"].includes(u.protocol) ||
                      u.username ||
                      u.password
                    )
                      throw new Error("请输入不带凭证的 HTTP 地址");
                    setPreferences({ ...preferences, rosUrl: u.origin });
                    notify("ROS 地址已保存");
                  } catch (e) {
                    notify(String(e), true);
                  }
                }}
              >
                <Save size={16} />
                保存地址
              </button>
              <button
                disabled={!native || busy}
                onClick={() => void loadConfig()}
              >
                <RefreshCw size={16} />
                读取配置
              </button>
            </div>
          </section>
          {configLoaded && (
            <section aria-labelledby="ros-general-config">
              <div className="section-heading">
                <h2 id="ros-general-config">ROS 配置</h2>
                <button
                  className="primary"
                  disabled={busy || !configDraft.data}
                  onClick={() => void saveConfig()}
                >
                  <Save size={16} />
                  保存配置
                </button>
              </div>
              {config.error && <p className="inline-error">{config.error}</p>}
              <RosConfigEditor
                draft={configDraft}
                topic="general"
                label="ROS 配置"
                disabled={busy}
              />
              <details className="ros-config-readings">
                <summary>Web 校准零点</summary>
                {calibration.error ? (
                  <p className="inline-error">{calibration.error}</p>
                ) : (
                  <div className="ros-config-fields">
                    {["X", "Y", "Z", "A"].map((axis) => {
                      const angle = offsets[axis];
                      const configured =
                        !Array.isArray(configuredAxes) ||
                        configuredAxes.includes(axis);
                      return (
                        <Metric
                          key={axis}
                          label={`${axis} 轴`}
                          small
                          value={
                            typeof angle === "number"
                              ? configured
                                ? `${angle}°`
                                : "未设零点"
                              : "—"
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </details>
            </section>
          )}
          <RosControls s={s} baseUrl={preferences.rosUrl} notify={notify} />
        </div>
        <section>
          <h2>
            <Map size={19} />
            地图与离线缓存
          </h2>
          <div className="map-settings">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.mapEnabled}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    mapEnabled: e.target.checked,
                  })
                }
              />
              启用底图
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.offline}
                onChange={(e) =>
                  setPreferences({ ...preferences, offline: e.target.checked })
                }
              />
              仅使用本机离线缓存
            </label>
            <label>
              地图来源
              <select
                value={preferences.mapSource}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    mapSource: e.target.value as Preferences["mapSource"],
                    mapStyle:
                      e.target.value === "google" ? "gsatellite" : "satellite",
                  })
                }
              >
                <option value="google">Google（本机直连）</option>
                <option value="ros">ROS 地图服务</option>
              </select>
            </label>
            <label>
              底图样式
              <select
                value={preferences.mapStyle}
                onChange={(e) =>
                  setPreferences({ ...preferences, mapStyle: e.target.value })
                }
              >
                {(preferences.mapSource === "google"
                  ? ["gsatellite", "gstreet", "ghybrid", "gterrain"]
                  : Array.isArray(styles)
                    ? styles.map(String)
                    : ["gsatellite", "satellite", "normal"]
                ).map((style) => (
                  <option key={style} value={style}>
                    {(
                      {
                        gsatellite: "卫星",
                        gstreet: "街道",
                        ghybrid: "卫星与标注",
                        gterrain: "地形",
                      } as Record<string, string>
                    )[style] ?? style}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!native}
              onClick={() =>
                void call("map_stats")
                  .then(setMapStats)
                  .catch((e) => notify(String(e), true))
              }
            >
              检查本机缓存
            </button>
          </div>
          {mapStats !== null && (
            <p className="caption">本机瓦片：{JSON.stringify(mapStats)}</p>
          )}
          <p className="caption">
            默认使用 Windows
            本机定位，后台缓存附近地图；浏览区域自动保存到本机。 Google
            底图每日检查更新，断网使用已有缓存。定位不可用时可拖动地图。地图使用
            WGS 84。
          </p>
        </section>
        <section>
          <h2>应用信息</h2>
          <label className="theme-setting">
            界面主题
            <select
              value={preferences.theme}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  theme: e.target.value as Preferences["theme"],
                })
              }
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <dl className="settings-info">
            <div>
              <dt>版本</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>控制核心</dt>
              <dd>Rust / rust-mavlink</dd>
            </div>
            <div>
              <dt>界面</dt>
              <dd>Tauri 2 / React / MapLibre</dd>
            </div>
            <div>
              <dt>验证范围</dt>
              <dd>见随附验证报告与实机验收清单</dd>
            </div>
          </dl>
        </section>
        <DataCenter preferences={preferences} notify={notify} />
      </div>
      {firmwareOpen && (
        <FirmwareDialog
          ports={serialPorts}
          scanError={scanError}
          onClose={() => setFirmwareOpen(false)}
        />
      )}
    </section>
  );
}
