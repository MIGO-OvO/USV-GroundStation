import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import { Crosshair, LocateFixed, Plus, Minus } from "lucide-react";
import type { Snapshot, Preferences, Waypoint } from "./types";
import { call, native } from "./backend";
import { field, number } from "./format";

maplibregl.addProtocol("usvtiles", async (request, abort) => {
  const u = new URL(request.url);
  const bytes = await call<number[]>("map_tile", {
    baseUrl: u.searchParams.get("base"),
    style: u.searchParams.get("style"),
    z: Number(u.searchParams.get("z")),
    x: Number(u.searchParams.get("x")),
    y: Number(u.searchParams.get("y")),
    offline: u.searchParams.get("offline") === "true",
  });
  if (abort.signal.aborted) throw new DOMException("瓦片已取消", "AbortError");
  return { data: new Uint8Array(bytes).buffer };
});

const collection = (
  features: GeoJSON.Feature[],
): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
function style(p: Preferences): StyleSpecification {
  const tiles = `usvtiles://tile?base=${encodeURIComponent(p.rosUrl)}&style=${p.mapStyle}&z={z}&x={x}&y={y}&offline=${p.offline}`;
  return {
    version: 8,
    sources:
      native && p.mapEnabled
        ? {
            raster: {
              type: "raster",
              tiles: [tiles],
              tileSize: 256,
              maxzoom: 20,
              attribution: p.mapStyle.startsWith("g")
                ? "© Google · ROS 瓦片服务"
                : "© 高德 · ROS 瓦片服务",
            },
          }
        : {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": p.theme === "dark" ? "#203a3b" : "#e5ece7",
        },
      },
      ...(native && p.mapEnabled
        ? [{ id: "imagery", type: "raster" as const, source: "raster" }]
        : []),
    ],
  };
}
export default function MapView({
  snapshot: s,
  preferences,
  waypoints = [],
  editing = false,
  onAdd,
  onMove,
}: {
  snapshot: Snapshot;
  preferences: Preferences;
  waypoints?: Waypoint[];
  editing?: boolean;
  onAdd?: (lat: number, lon: number) => void;
  onMove?: (index: number, lat: number, lon: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const vessel = useRef<maplibregl.Marker | null>(null);
  const points = useRef<maplibregl.Marker[]>([]);
  const callbacks = useRef({ onAdd, onMove, editing });
  callbacks.current = { onAdd, onMove, editing };
  const [loaded, setLoaded] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const position = useRef<[number, number] | null>(null);
  const lat = field(s, "latitude"),
    lon = field(s, "longitude");
  const gps = field(s, "gps_fix");
  useEffect(() => {
    if (!container.current) return;
    setMapError(null);
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: style(preferences),
        center: [110.412778, 25.314167],
        zoom: 14,
        attributionControl: false,
        renderWorldCopies: false,
      });
    } catch (e) {
      setMapError(`地图初始化失败：${String(e)}`);
      return;
    }
    map.current = m;
    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    m.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );
    m.on("load", () => {
      m.addSource("track", { type: "geojson", data: collection([]) });
      m.addSource("route", { type: "geojson", data: collection([]) });
      m.addLayer({
        id: "track",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#1a8c65",
          "line-width": 3,
          "line-opacity": 0.8,
        },
      });
      m.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#bb6a23",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });
      setLoaded((v) => v + 1);
    });
    m.on("click", (event) => {
      if (callbacks.current.editing)
        callbacks.current.onAdd?.(event.lngLat.lat, event.lngLat.lng);
    });
    m.on("dragstart", () => setFollowing(false));
    m.on("error", (event) => {
      if (event.error?.message)
        setMapError("底图未载入。检查 ROS 地图服务或切换到已缓存区域。");
    });
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      points.current.forEach((p) => p.remove());
      points.current = [];
      vessel.current?.remove();
      vessel.current = null;
      m.remove();
      map.current = null;
    };
  }, [
    preferences.rosUrl,
    preferences.mapStyle,
    preferences.offline,
    preferences.theme,
    preferences.mapEnabled,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!m?.isStyleLoaded()) return;
    (m.getSource("track") as GeoJSONSource).setData(
      collection(
        s.telemetry.track.length >= 2
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: s.telemetry.track,
                },
              },
            ]
          : [],
      ),
    );
    (m.getSource("route") as GeoJSONSource).setData(
      collection(
        waypoints.length >= 2
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: waypoints.map((w) => [w.lon, w.lat]),
                },
              },
            ]
          : [],
      ),
    );
  }, [s.telemetry.track, waypoints, loaded]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    points.current.forEach((p) => p.remove());
    points.current = waypoints.map((w, i) => {
      const el = document.createElement("button");
      el.className = `waypoint-marker ${w.sample ? "sampling" : ""}`;
      el.textContent = String(i + 1);
      el.setAttribute("aria-label", `航点 ${i + 1}${w.sample ? "，采样" : ""}`);
      const marker = new maplibregl.Marker({ element: el, draggable: editing })
        .setLngLat([w.lon, w.lat])
        .addTo(m);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        callbacks.current.onMove?.(i, p.lat, p.lng);
      });
      return marker;
    });
  }, [waypoints, editing, loaded]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lat === null || lon === null || gps === null || gps < 3) {
      vessel.current?.remove();
      vessel.current = null;
      position.current = null;
      return;
    }
    position.current = [lon, lat];
    if (!vessel.current) {
      const el = document.createElement("div");
      el.className = "vessel-marker";
      el.setAttribute("aria-label", "无人船实时位置");
      el.innerHTML =
        '<svg width="36" height="42" viewBox="0 0 36 42" aria-hidden="true"><path d="M18 3 30 34 18 29 6 34Z" fill="#146b52" stroke="#f1f6ed" stroke-width="2.5"/></svg>';
      vessel.current = new maplibregl.Marker({
        element: el,
        rotationAlignment: "map",
      })
        .setLngLat([lon, lat])
        .addTo(m);
    }
    vessel.current.setLngLat([lon, lat]).setRotation(field(s, "heading") ?? 0);
    if (following) m.easeTo({ center: [lon, lat], duration: 250 });
  }, [lat, lon, gps, s, following, loaded]);
  return (
    <div className={`map-shell ${editing ? "editing" : ""}`}>
      <div
        ref={container}
        className="map-canvas"
        aria-label={editing ? "航线规划地图，点击添加航点" : "无人船航行地图"}
      />
      <div className="map-tag">
        <Crosshair size={14} />
        {editing ? "点击地图添加航点 · 拖动调整位置" : "WGS 84"}
        <span>
          {preferences.offline
            ? "离线缓存"
            : preferences.mapEnabled
              ? "ROS 地图"
              : "底图未连接"}
        </span>
      </div>
      {(!preferences.mapEnabled || !native) && (
        <div className="map-empty">
          <LocateFixed size={32} strokeWidth={1.2} />
          <strong>{native ? "连接地图服务" : "地面站界面预览"}</strong>
          <span>
            {native
              ? "在设置中填写 ROS 地址并启用地图"
              : "设备连接与通信由 Tauri 中的 Rust 后端提供"}
          </span>
        </div>
      )}
      {mapError && preferences.mapEnabled && (
        <div className="map-error" role="status">
          {mapError}
        </div>
      )}
      <div className="map-controls">
        <button
          aria-label="放大地图"
          className="icon-button"
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="缩小地图"
          className="icon-button"
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="跟随无人船"
          className={`icon-button ${following ? "selected" : ""}`}
          disabled={lat === null || lon === null || gps === null || gps < 3}
          onClick={() => {
            setFollowing(true);
            if (position.current)
              map.current?.easeTo({ center: position.current, zoom: 17 });
          }}
        >
          <LocateFixed size={19} />
        </button>
      </div>
      <div className="map-coordinate">
        {lat !== null && lon !== null
          ? `${number(lat, 7)}° N / ${number(lon, 7)}° E`
          : "等待新鲜定位"}
        <span>航迹 {s.telemetry.track.length} 点</span>
      </div>
    </div>
  );
}
