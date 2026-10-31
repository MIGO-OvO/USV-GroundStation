import {
  ArrowDown,
  ArrowUp,
  Download,
  Upload,
  Plus,
  Trash2,
  FileUp,
  FileDown,
} from "lucide-react";
import { useRef, useState } from "react";
import type {
  Snapshot,
  Preferences,
  MissionDraft,
  SendIntent,
  Notify,
} from "./types";
import MapView from "./MapView";
import { parseMission, stateText, field } from "./format";
import { saveText } from "./backend";

export default function Planner({
  s,
  preferences,
  draft,
  setDraft,
  send,
  notify,
}: {
  s: Snapshot;
  preferences: Preferences;
  draft: MissionDraft;
  setDraft: (d: MissionDraft) => void;
  send: SendIntent;
  notify: Notify;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(true);
  function move(index: number, to: number) {
    if (to < 0 || to >= draft.waypoints.length) return;
    const waypoints = [...draft.waypoints];
    const [item] = waypoints.splice(index, 1);
    waypoints.splice(to, 0, item);
    setDraft({ ...draft, waypoints });
  }
  function update(
    index: number,
    patch: Partial<MissionDraft["waypoints"][number]>,
  ) {
    setDraft({
      ...draft,
      waypoints: draft.waypoints.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    });
  }
  const add = (lat: number, lon: number) => {
    if (draft.waypoints.length >= 500) {
      notify("航点不能超过 500 个", true);
      return;
    }
    setDraft({
      ...draft,
      waypoints: [
        ...draft.waypoints,
        { lat, lon, altitude: 0, sample: false, timeout_s: 255 },
      ],
    });
  };
  async function importFile(selected?: File) {
    if (!selected) return;
    try {
      setDraft(parseMission(await selected.text()));
      notify("任务草稿已导入");
    } catch (e) {
      notify(String(e), true);
    }
  }
  const total =
    draft.waypoints.length +
    draft.waypoints.filter((w) => w.sample).length +
    (draft.waypoints.length ? 1 : 0);
  return (
    <section className="workspace planner">
      <header className="workspace-heading">
        <div>
          <h1>航线规划</h1>
          <p>
            {draft.waypoints.length} 个航点 ·{" "}
            {draft.waypoints.filter((w) => w.sample).length} 个采样点 · {total}{" "}
            个 MAVLink 任务项
          </p>
        </div>
        <div className="button-row">
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            aria-label="导入任务文件"
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button onClick={() => file.current?.click()}>
            <FileUp size={16} />
            导入
          </button>
          <button
            disabled={!draft.waypoints.length}
            onClick={() =>
              void saveText("usv-mission.json", JSON.stringify(draft, null, 2))
                .then((p) => notify(`任务已导出：${p}`))
                .catch((e) => notify(String(e), true))
            }
          >
            <FileDown size={16} />
            导出
          </button>
        </div>
      </header>
      <div className="planner-content">
        <div className="planning-map">
          <MapView
            snapshot={s}
            preferences={preferences}
            waypoints={draft.waypoints}
            editing={editing}
            onAdd={add}
            onMove={(i, lat, lon) => update(i, { lat, lon })}
          />
          <div className="planning-toggle">
            <label>
              <input
                type="checkbox"
                checked={editing}
                onChange={(e) => setEditing(e.target.checked)}
              />
              地图编辑
            </label>
          </div>
        </div>
        <div className="plan-editor">
          <div className="section-heading">
            <h2>航点与采样</h2>
            <button
              className="text-button"
              onClick={() =>
                add(
                  field(s, "latitude") ?? 25.314167,
                  field(s, "longitude") ?? 110.412778,
                )
              }
            >
              <Plus size={16} />
              添加航点
            </button>
          </div>
          <div className="table-scroll">
            <table className="waypoint-table">
              <thead>
                <tr>
                  <th>航点</th>
                  <th>纬度 / 经度</th>
                  <th>采样 / 超时 s</th>
                  <th>排序</th>
                </tr>
              </thead>
              <tbody>
                {draft.waypoints.map((w, i) => (
                  <tr
                    key={i}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", String(i))
                    }
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      if (Number.isInteger(from)) move(from, i);
                    }}
                  >
                    <td>
                      <span
                        className={`waypoint-number ${w.sample ? "sampling" : ""}`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td>
                      <input
                        aria-label={`航点 ${i + 1} 纬度`}
                        type="number"
                        step="0.0000001"
                        min="-90"
                        max="90"
                        value={w.lat}
                        onChange={(e) => {
                          if (Number.isFinite(e.target.valueAsNumber))
                            update(i, { lat: e.target.valueAsNumber });
                        }}
                      />
                      <input
                        aria-label={`航点 ${i + 1} 经度`}
                        type="number"
                        step="0.0000001"
                        min="-180"
                        max="180"
                        value={w.lon}
                        onChange={(e) => {
                          if (Number.isFinite(e.target.valueAsNumber))
                            update(i, { lon: e.target.valueAsNumber });
                        }}
                      />
                    </td>
                    <td>
                      <label className="checkbox">
                        <input
                          aria-label={`航点 ${i + 1} 采样`}
                          type="checkbox"
                          checked={w.sample}
                          onChange={(e) =>
                            update(i, { sample: e.target.checked })
                          }
                        />
                        定点采样
                      </label>
                      <input
                        aria-label={`航点 ${i + 1} 采样超时`}
                        disabled={!w.sample}
                        type="number"
                        min="1"
                        max="255"
                        step="1"
                        value={w.timeout_s}
                        onChange={(e) =>
                          update(i, { timeout_s: e.target.valueAsNumber })
                        }
                      />
                    </td>
                    <td>
                      <div className="reorder">
                        <button
                          className="icon-button"
                          aria-label={`上移航点 ${i + 1}`}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`下移航点 ${i + 1}`}
                          disabled={i === draft.waypoints.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          className="icon-button danger-text"
                          aria-label={`删除航点 ${i + 1}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              waypoints: draft.waypoints.filter(
                                (_, index) => index !== i,
                              ),
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!draft.waypoints.length && (
              <p className="empty-plan">
                点击地图或添加航点，然后打开对应航点的定点采样开关。
              </p>
            )}
          </div>
          <div className="transfer-status">
            <div>
              <strong>{stateText[s.mission.state] ?? s.mission.state}</strong>
              <span>{s.mission.detail || "飞控上锁后可上传任务"}</span>
            </div>
            {s.mission.total > 0 && (
              <progress max={s.mission.total} value={s.mission.completed} />
            )}
          </div>
          <div className="plan-actions">
            <button
              className="primary"
              disabled={!s.navigation.upload || !draft.waypoints.length}
              onClick={() =>
                void send(
                  { type: "upload_mission", draft, confirmed: true },
                  `将 ${draft.waypoints.length} 个航点上传至无人船 ${s.telemetry.system_id}，替换当前飞控任务。完成后会逐项回读校验。`,
                )
              }
            >
              <Upload size={16} />
              上传并校验
            </button>
            <button
              disabled={s.link !== "connected"}
              onClick={() => void send({ type: "download_mission" })}
            >
              <Download size={16} />
              下载任务
            </button>
            {s.mission.draft && (
              <button
                onClick={() => {
                  setDraft(s.mission.draft!);
                  notify("已将完整回读任务载入草稿");
                }}
              >
                载入回读
              </button>
            )}
          </div>
          <div className="button-row navigation-row">
            <button
              disabled={!s.navigation.auto}
              onClick={() =>
                void send(
                  { type: "mode", mode: 10, confirmed: true },
                  `将无人船 ${s.telemetry.system_id} 切换至 AUTO，执行或继续当前任务。`,
                )
              }
            >
              AUTO 执行 / 继续
            </button>
            <button
              disabled={!s.navigation.hold}
              onClick={() =>
                void send({ type: "mode", mode: 4, confirmed: true })
              }
            >
              HOLD 暂停航行
            </button>
            <button
              className="danger-outline"
              disabled={!s.navigation.hold}
              onClick={() =>
                void send(
                  { type: "stop_mission", confirmed: true },
                  "切换 HOLD 并停止采样及载荷输出。航行和载荷分别确认，飞控保留当前任务进度。",
                )
              }
            >
              停止任务与采样
            </button>
          </div>
          <p className="caption">
            定点采样使用 42702 / param1=1；任务项进度与采样结果分别确认。
          </p>
        </div>
      </div>
    </section>
  );
}
