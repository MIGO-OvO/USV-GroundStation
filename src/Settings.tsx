import { useState } from "react";
import { Cable, Wifi, Server, Save, Map, RefreshCw } from "lucide-react";
import type {
  Snapshot,
  Preferences,
  ConnectionConfig,
  SendIntent,
  Notify,
} from "./types";
import { call, useRos, unpack, native, android, object } from "./backend";

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
  const [kind, setKind] = useState<"udp" | "tcp" | "serial">(
    s.connection?.kind ?? "udp",
  );
  const [bind, setBind] = useState("0.0.0.0:14550"),
    [peer, setPeer] = useState("");
  const [host, setHost] = useState("127.0.0.1"),
    [port, setPort] = useState(5760),
    [serial, setSerial] = useState("COM5"),
    [baud, setBaud] = useState(115200);
  const [target, setTarget] = useState("");
  const [ros, setRos] = useState(preferences.rosUrl);
  const [configText, setConfigText] = useState("");
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
          : { kind, port: serial, baud };
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
      setConfigText(JSON.stringify(unpack(data), null, 2));
      setConfigLoaded(true);
      notify("已读取 ROS 当前配置");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function saveConfig() {
    setBusy(true);
    try {
      const body: unknown = JSON.parse(configText);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("配置必须是 JSON 对象");
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
  return (
    <section className="workspace settings">
      <header className="workspace-heading">
        <div>
          <h1>连接与设置</h1>
          <p>独立 MAVLink 连接 · ROS 数据服务 · 本机离线地图</p>
        </div>
      </header>
      <div className="settings-scroll">
        <section className="connection-settings">
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
                  onClick={() => setKind(k)}
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
                  串口
                  <input
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                  />
                </label>
                <label>
                  波特率
                  <select
                    value={baud}
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
          <div className="button-row">
            <button
              className="primary"
              disabled={!native}
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
            <span className="caption">GCS 254 / 190 · MAVLink 2</span>
          </div>
          {s.error && <p className="inline-error">{s.error}</p>}
          <p className="caption">
            TCP 默认指向 mavlink-router；UDP
            在匹配飞控心跳后固定对端。重新连接只同步状态。
          </p>
        </section>
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
                placeholder="http://192.168.1.100:5000"
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
              启用 ROS 底图
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
              底图样式
              <select
                value={preferences.mapStyle}
                onChange={(e) =>
                  setPreferences({ ...preferences, mapStyle: e.target.value })
                }
              >
                {(Array.isArray(styles)
                  ? styles.map(String)
                  : ["gsatellite", "satellite", "normal"]
                ).map((style) => (
                  <option key={style} value={style}>
                    {style}
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
            在线浏览过的 ROS PNG 瓦片自动保存到应用数据目录；ROS
            服务同时保留其现有离线瓦片缓存。地图使用 WGS 84。
          </p>
        </section>
        {configLoaded && (
          <section>
            <div className="section-heading">
              <h2>ROS 采样配置</h2>
              <button
                className="primary"
                disabled={busy || !configText}
                onClick={() => void saveConfig()}
              >
                <Save size={16} />
                保存配置
              </button>
            </div>
            {config.error && <p className="inline-error">{config.error}</p>}
            <textarea
              className="json-editor"
              aria-label="ROS 配置 JSON"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              spellCheck={false}
            />
            <details>
              <summary>Web 校准零点</summary>
              <pre>{JSON.stringify(calibration.data, null, 2)}</pre>
            </details>
          </section>
        )}
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
              <dd>0.1.0</dd>
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
      </div>
    </section>
  );
}
