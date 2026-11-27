import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square, RefreshCw, Activity } from "lucide-react";
import type { Snapshot, Preferences, SendIntent } from "./types";
import { field, number, commands, time } from "./format";
import { useRos } from "./backend";
import SamplingConfiguration, {
  type useSamplingConfig,
} from "./SamplingConfiguration";
import { Empty, Reading, RequestSummary } from "./ui";
import { SamplingProgress, PumpDetails, pidMode } from "./SamplingStatus";
import "./SamplingStatus.css";

export interface SignalPoint {
  t: number;
  value: number;
}
export function SignalChart({
  data,
  unit,
  label,
}: {
  data: SignalPoint[];
  unit: string;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 700, height: 260 });
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(240, entry.contentRect.width),
        height: entry.contentRect.height,
      }),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="signal-plot" ref={container}>
      {data.length ? (
        <SignalPlot
          data={data}
          unit={unit}
          label={label}
          width={size.width}
          height={size.height}
        />
      ) : (
        <Empty title={`等待有效${label}数据`}>收到有效测量后显示曲线</Empty>
      )}
    </div>
  );
}

function SignalPlot({
  data,
  unit,
  label,
  width,
  height,
}: {
  data: SignalPoint[];
  unit: string;
  label: string;
  width: number;
  height: number;
}) {
  const end = data[data.length - 1].t,
    start = end - 120000;
  const visible = data.filter((p) => p.t >= start);
  const min = Math.min(...visible.map((p) => p.value)),
    max = Math.max(...visible.map((p) => p.value));
  const padding = Math.max((max - min) * 0.15, 0.005),
    low = min - padding,
    high = max + padding;
  let previous = -Infinity;
  const path = visible
    .map((p) => {
      const x = 54 + ((p.t - start) / 120000) * (width - 70);
      const y = height - 40 - ((p.value - low) / (high - low)) * (height - 70);
      const command = p.t - previous > 3000 ? "M" : "L";
      previous = p.t;
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className="signal-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}实时曲线，最近 120 秒，共 ${visible.length} 个观测点`}
    >
      <title>
        {label} / {unit}，地面站接收时间
      </title>
      {[0, 0.5, 1].map((y) => (
        <g key={y}>
          <line
            x1="54"
            x2={width - 16}
            y1={30 + y * (height - 70)}
            y2={30 + y * (height - 70)}
            className="chart-grid"
          />
          <text x="46" y={34 + y * (height - 70)} textAnchor="end">
            {(high - y * (high - low)).toFixed(3)}
          </text>
        </g>
      ))}
      <path d={path} className="chart-line" />
      <text x="54" y={height - 12}>
        −120 s
      </text>
      <text x={(54 + width - 16) / 2} y={height - 12} textAnchor="middle">
        −60 s
      </text>
      <text x={width - 16} y={height - 12} textAnchor="end">
        最新接收
      </text>
    </svg>
  );
}

export function PayloadControls({
  s,
  send,
  compact = false,
}: {
  s: Snapshot;
  send: SendIntent;
  compact?: boolean;
}) {
  const groups = compact
    ? [
        [31018, 31017, 31010],
        [31011, 31019],
      ]
    : [
        [31018, 31017, 31019],
        [31010, 31012, 31013, 31011],
        [31015, 31016, 31014],
      ];
  return (
    <div className="payload-controls">
      {groups.map((group, i) => (
        <div className="control-group" key={i}>
          {!compact && <h3>{["分光采集", "点采样", "走航与校准"][i]}</h3>}
          <div className="button-row wrap">
            {group.map((c) => {
              const action = s.actions.find((a) => a.command === c);
              const stop = [31011, 31016, 31019].includes(c);
              return (
                <button
                  key={c}
                  disabled={!action?.allowed}
                  title={action?.reason || commands[c]}
                  className={
                    stop ? "danger-outline" : c === 31010 ? "primary" : ""
                  }
                  onClick={() =>
                    void send(
                      {
                        type: "payload",
                        command: c,
                        param1: 0,
                        param2: 0,
                        confirmed: true,
                      },
                      [31010, 31014, 31015].includes(c)
                        ? `对无人船 ${s.telemetry.system_id} 执行${commands[c]}。`
                        : undefined,
                    )
                  }
                >
                  {stop ? (
                    <Square size={14} />
                  ) : c === 31012 ? (
                    <Pause size={14} />
                  ) : (
                    <Play size={14} />
                  )}
                  <span>{commands[c]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PayloadWorkspace({
  s,
  preferences,
  send,
  samplingConfig,
  series,
  onRequest,
}: {
  s: Snapshot;
  preferences: Preferences;
  send: SendIntent;
  samplingConfig: ReturnType<typeof useSamplingConfig>;
  series: { voltage: SignalPoint[]; absorbance: SignalPoint[] };
  onRequest: (id: string) => void;
}) {
  const [signal, setSignal] = useState<"voltage" | "absorbance">("voltage");
  const health = useRos(
    preferences.rosUrl,
    "/api/diagnostics/system",
    true,
    3000,
  );
  const pumps = useRos(preferences.rosUrl, "/api/manual/status", true, 1500);
  return (
    <section className="workspace sampling">
      <header className="workspace-heading sampling-heading">
        <SamplingProgress s={s} />
        <button
          type="button"
          className={`connection-indicator ${s.payload_online ? "online" : ""}`}
          disabled={s.link !== "connected"}
          onClick={() => void send({ type: "refresh_payload" })}
          title="通过飞控重新读取 Jetson 载荷状态"
        >
          <span />
          {s.payload_online ? "载荷在线" : "载荷离线"}
          <RefreshCw size={14} />
          重读状态
        </button>
      </header>
      <div className="sampling-scroll">
        <div className="sampling-top">
          <section className="sampling-instruments">
            <div className="instrument-row">
              <div>
                <span>分光电压</span>
                <strong>
                  <Reading s={s} name="USV_VOLT" digits={4} unit=" V" />
                </strong>
              </div>
              <div>
                <span>吸光度</span>
                <strong>
                  <Reading s={s} name="USV_ABS" digits={4} unit=" AU" />
                </strong>
              </div>
              <div>
                <span>采样启动次数</span>
                <strong>
                  <Reading s={s} name="USV_SCNT" digits={0} />
                </strong>
              </div>
            </div>
            <div className="section-heading">
              <h2>
                <Activity size={17} />
                实时信号
              </h2>
              <div className="segmented">
                <button
                  className={signal === "voltage" ? "active" : ""}
                  onClick={() => setSignal("voltage")}
                >
                  电压
                </button>
                <button
                  className={signal === "absorbance" ? "active" : ""}
                  onClick={() => setSignal("absorbance")}
                >
                  吸光度
                </button>
              </div>
            </div>
            <SignalChart
              data={series[signal]}
              unit={signal === "voltage" ? "V" : "AU"}
              label={signal === "voltage" ? "电压" : "吸光度"}
            />
          </section>
          <aside className="sampling-actions">
            <h2>载荷操作</h2>
            <PayloadControls s={s} send={send} />
            <div className="latest-command">
              <h3>最近请求</h3>
              <RequestSummary record={s.requests.at(-1)} onOpen={onRequest} />
            </div>
          </aside>
        </div>
        <section className="pump-section">
          <div className="section-heading">
            <h2>泵组反馈</h2>
            <span className="caption">相对 Web 保存的校准零点</span>
          </div>
          <div className="pump-readings">
            {["X", "Y", "Z", "A"].map((axis) => {
              const value = field(s, `PUMP_${axis}`);
              return (
                <div key={axis}>
                  <span>泵 {axis}</span>
                  <strong>
                    {value !== null && value < 0
                      ? "未校准"
                      : number(value, 1, "°")}
                  </strong>
                </div>
              );
            })}
            <div>
              <span>PID 模式 / 误差</span>
              <strong>
                {pidMode(s)} / {number(field(s, "USV_PERR"), 2, "°")}
              </strong>
            </div>
          </div>
          <PumpDetails
            s={s}
            health={health.data}
            manual={pumps.data}
            healthError={health.error}
            manualError={pumps.error}
          />
        </section>
        <SamplingConfiguration config={samplingConfig} />
        <div className="health-strip">
          <span>
            Jetson <Reading s={s} name="USV_JTMP" unit=" °C" />
          </span>
          <span>
            ESP32 <Reading s={s} name="USV_ETMP" unit=" °C" />
          </span>
          <span>
            CPU <Reading s={s} name="USV_JCPU" digits={0} unit=" %" />
          </span>
          <span>
            内存 <Reading s={s} name="USV_JMEM" digits={0} unit=" %" />
          </span>
          <span>
            最后请求{" "}
            {s.requests.at(-1)
              ? time(s.requests.at(-1)!.created_unix_ms)
              : "尚无"}
          </span>
        </div>
      </div>
    </section>
  );
}
