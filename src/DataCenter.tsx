import { useState } from "react";
import { Database, Download, RefreshCw } from "lucide-react";
import { array, call, native, object, unpack, useRos } from "./backend";
import type { Notify, Preferences } from "./types";

export default function DataCenter({
  preferences,
  notify,
}: {
  preferences: Preferences;
  notify: Notify;
}) {
  const [mission, setMission] = useState("");
  const [busy, setBusy] = useState(false);
  const missions = useRos(preferences.rosUrl, "/api/data/missions", true, 5000);
  const detail = useRos(
    preferences.rosUrl,
    mission
      ? `/api/data/mission/${encodeURIComponent(mission)}?view=data-center`
      : "",
    !!mission,
    3000,
  );
  const samples = useRos(
    preferences.rosUrl,
    mission ? `/api/data/mission/${encodeURIComponent(mission)}/samples` : "",
    !!mission,
    3000,
  );
  const missionData = unpack(missions.data);
  const list = array(object(missionData).missions ?? missionData);
  const sampleData = unpack(samples.data),
    sampleList = array(object(sampleData).samples ?? sampleData);
  async function download(suffix: string) {
    if (!mission) return;
    setBusy(true);
    try {
      const path = await call<string>("ros_download", {
        baseUrl: preferences.rosUrl,
        path: `/api/data/mission/${encodeURIComponent(mission)}/${suffix}`,
      });
      notify(`数据已保存：${path}`);
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="data-center">
      <div className="section-heading">
        <h2>
          <Database size={18} />
          采样数据中心
        </h2>
        <button
          className="text-button"
          onClick={missions.refresh}
          disabled={missions.loading}
        >
          <RefreshCw size={15} />
          刷新
        </button>
      </div>
      <div className="data-toolbar">
        <label>
          任务记录
          <select value={mission} onChange={(e) => setMission(e.target.value)}>
            <option value="">选择 ROS 已归档任务</option>
            {list.map((m, i) => {
              const item = object(m),
                id = String(item.mission_id ?? item.id ?? "");
              return (
                id && (
                  <option key={id || i} value={id}>
                    {String(item.name ?? item.title ?? id)}
                  </option>
                )
              );
            })}
          </select>
        </label>
        <button
          disabled={!mission || busy}
          onClick={() => void download("archive")}
        >
          <Download size={15} />
          ZIP 原始归档
        </button>
        <button
          disabled={!mission || busy}
          onClick={() => void download("raw.csv")}
        >
          <Download size={15} />
          原始 CSV
        </button>
        <button
          disabled={!mission || busy}
          onClick={() => void download("csv")}
        >
          结果 CSV
        </button>
      </div>
      {missions.error && <p className="inline-error">{missions.error}</p>}
      {!native && <p className="muted">在桌面应用中连接 ROS 后可查看归档。</p>}
      {native && !missions.error && !list.length && (
        <p className="muted">
          {missions.loading ? "正在读取任务记录" : "ROS 尚无已归档任务"}
        </p>
      )}
      {!!mission && (
        <>
          {(samples.error || detail.error) && (
            <p className="inline-error">{samples.error || detail.error}</p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>采样记录</th>
                  <th>来源</th>
                  <th>结果</th>
                  <th>开始时间</th>
                </tr>
              </thead>
              <tbody>
                {sampleList.map((raw, index) => {
                  const item = object(raw);
                  return (
                    <tr key={String(item.sample_id ?? index)}>
                      <td className="identity-cell">
                        {String(item.sample_id ?? item.id ?? index + 1)}
                      </td>
                      <td>{String(item.source ?? "未记录")}</td>
                      <td>{String(item.outcome ?? item.status ?? "未记录")}</td>
                      <td>
                        {String(
                          item.start_time ??
                            item.timestamp ??
                            item.started_at ??
                            "未记录",
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details>
            <summary>任务与记录详情</summary>
            <pre>{JSON.stringify(unpack(detail.data), null, 2)}</pre>
          </details>
        </>
      )}
      <p className="caption">
        来源：{preferences.rosUrl}。QGC、飞控和本地启动的采样均读取 ROS
        的原始归档。
      </p>
    </section>
  );
}
