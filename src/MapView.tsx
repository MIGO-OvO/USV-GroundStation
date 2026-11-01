import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import { Crosshair, LocateFixed, MapPin, Plus, Minus } from "lucide-react";
import type { Snapshot, Preferences, Waypoint } from "./types";
import { call, native } from "./backend";
import { field, number } from "./format";

maplibregl.addProtocol("usvtiles", async (request, abort) => {
  const u = new URL(request.url);
  const bytes = await call<number[]>("map_tile", {
    baseUrl: u.searchParams.get("base"),
    source: u.searchParams.get("source"),
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
  const tiles = `usvtiles://tile?source=${p.mapSource}&base=${encodeURIComponent(p.rosUrl)}&style=${p.mapStyle}&z={z}&x={x}&y={y}&offline=${p.offline}`;
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
              attribution:
                p.mapSource === "google" ? "© Google" : "© 高德 · ROS 瓦片服务",
            },
          }
        : {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": p.theme === "dark" ? "#202020" : "#f5f5f5",
        },
      },
      ...(native && p.mapEnabled
        ? [{ id: "imagery", type: "raster" as const, source: "raster" }]
        : []),
    ],
  };
}
interface LocalPosition {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  received_unix_ms: number;
}
function readViewport(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem("usv.map.viewport") ?? "null");
    if (
      Array.isArray(v?.center) &&
      v.center.length === 2 &&
      v.center.every(Number.isFinite) &&
      Math.abs(v.center[0]) <= 180 &&
      Math.abs(v.center[1]) <= 85.1 &&
      Number.isFinite(v.zoom) &&
      v.zoom >= 0 &&
      v.zoom <= 20
    )
      return v;
  } catch {
    /* Use the world view until real local coordinates are available. */
  }
  return { center: [0, 0], zoom: 2 };
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
  const localMarker = useRef<maplibregl.Marker | null>(null);
  const viewport = useRef(readViewport());
  const userMoved = useRef(false);
  const callbacks = useRef({ onAdd, onMove, editing });
  callbacks.current = { onAdd, onMove, editing };
  const [loaded, setLoaded] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [localPosition, setLocalPosition] = useState<LocalPosition | null>(
    null,
  );
  const [locationError, setLocationError] = useState<string | null>(null);
  const [networkEpoch, setNetworkEpoch] = useState(0);
  const [following, setFollowing] = useState(false);
  const position = useRef<[number, number] | null>(null);
  const lat = field(s, "latitude"),
    lon = field(s, "longitude");
  const gps = field(s, "gps_fix");
  useEffect(() => {
    const online = () => setNetworkEpoch((v) => v + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  const localLabel =
    localPosition &&
    Date.now() - localPosition.received_unix_ms > 15 * 60 * 1000
      ? "上次本机位置"
      : "本机位置";
  useEffect(() => {
    if (!native || !preferences.mapEnabled) return;
    let active = true;
    setLocationError(null);
    void call<LocalPosition>("map_location", { offline: preferences.offline })
      .then((p) => {
        if (!active) return;
        setLocalPosition(p);
        if (!preferences.offline && preferences.mapSource === "google")
          void call("map_prefetch", {
            style: preferences.mapStyle,
            latitude: p.latitude,
            longitude: p.longitude,
          }).catch(() => {});
      })
      .catch((e) => {
        if (active) setLocationError(String(e));
      });
    return () => {
      active = false;
    };
  }, [
    preferences.mapEnabled,
    preferences.offline,
    preferences.mapSource,
    preferences.mapStyle,
    networkEpoch,
  ]);
  useEffect(() => {
    if (!container.current) return;
    setMapError(null);
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: style(preferences),
        center: viewport.current.center,
        zoom: viewport.current.zoom,
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
          "line-color": preferences.theme === "dark" ? "#bdbdbd" : "#525252",
          "line-width": 3,
          "line-opacity": 0.8,
        },
      });
      m.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: {
          "line-color": preferences.theme === "dark" ? "#8aafff" : "#2563eb",
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
    m.on("dragstart", () => {
      userMoved.current = true;
      setFollowing(false);
    });
    m.on("zoomstart", (event) => {
      if (event.originalEvent) userMoved.current = true;
    });
    m.on("moveend", () => {
      const center = m.getCenter();
      viewport.current = {
        center: [center.lng, center.lat],
        zoom: m.getZoom(),
      };
      localStorage.setItem(
        "usv.map.viewport",
        JSON.stringify(viewport.current),
      );
    });
    m.on("error", (event) => {
      if (event.error?.message)
        setMapError(
          `${preferences.mapSource === "google" ? "Google" : "ROS"} 底图未载入，已缓存区域仍可查看。`,
        );
    });
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      points.current.forEach((p) => p.remove());
      points.current = [];
      vessel.current?.remove();
      vessel.current = null;
      localMarker.current?.remove();
      localMarker.current = null;
      m.remove();
      map.current = null;
    };
  }, [
    preferences.rosUrl,
    preferences.mapStyle,
    preferences.offline,
    preferences.theme,
    preferences.mapEnabled,
    preferences.mapSource,
    networkEpoch,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!m || !localPosition) return;
    const coords: [number, number] = [
      localPosition.longitude,
      localPosition.latitude,
    ];
    if (!localMarker.current) {
      const el = document.createElement("div");
      el.className = "local-position-marker";
      localMarker.current = new maplibregl.Marker({ element: el })
        .setLngLat(coords)
        .addTo(m);
    }
    localMarker.current.getElement().setAttribute("aria-label", localLabel);
    localMarker.current.getElement().title = `${localLabel} · 精度约 ${Math.round(localPosition.accuracy_m)} m`;
    localMarker.current.setLngLat(coords);
    if (!userMoved.current && !following)
      m.jumpTo({ center: coords, zoom: 16 });
  }, [localPosition, localLabel, loaded, following]);
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
        '<svg width="36" height="42" viewBox="0 0 36 42" aria-hidden="true"><path d="M18 3 30 34 18 29 6 34Z" fill="currentColor" stroke-width="2.5"/></svg>';
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
              ? preferences.mapSource === "google"
                ? "Google · 自动缓存"
                : "ROS 地图"
              : "底图未连接"}
        </span>
      </div>
      {(!preferences.mapEnabled || !native) && (
        <div className="map-empty">
          <LocateFixed size={32} strokeWidth={1.2} />
          <strong>{native ? "底图已关闭" : "地面站界面预览"}</strong>
          <span>
            {native
              ? "在设置中启用 Google 底图，联网浏览自动缓存"
              : "请打开桌面程序连接无人船和地图服务"}
          </span>
        </div>
      )}
      {(mapError || locationError) && preferences.mapEnabled && (
        <div className="map-error" role="status">
          {mapError || locationError}
        </div>
      )}
      <div className="map-controls">
        <button
          aria-label="放大地图"
          className="icon-button"
          onClick={() => {
            userMoved.current = true;
            map.current?.zoomIn();
          }}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="缩小地图"
          className="icon-button"
          onClick={() => {
            userMoved.current = true;
            map.current?.zoomOut();
          }}
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="定位本机"
          title={
            localPosition
              ? `${localLabel} · 精度约 ${Math.round(localPosition.accuracy_m)} m`
              : "等待 Windows 本机定位"
          }
          className="icon-button"
          disabled={!localPosition}
          onClick={() => {
            if (localPosition) {
              userMoved.current = true;
              setFollowing(false);
              map.current?.easeTo({
                center: [localPosition.longitude, localPosition.latitude],
                zoom: 16,
              });
            }
          }}
        >
          <MapPin size={18} />
        </button>
        <button
          aria-label="跟随无人船"
          className={`icon-button ${following ? "selected" : ""}`}
          disabled={lat === null || lon === null || gps === null || gps < 3}
          onClick={() => {
            setFollowing(true);
            userMoved.current = true;
            if (position.current)
              map.current?.easeTo({ center: position.current, zoom: 17 });
          }}
        >
          <LocateFixed size={19} />
        </button>
      </div>
      <div className="map-coordinate">
        {lat !== null && lon !== null && gps !== null && gps >= 3
          ? `${number(lat, 7)}° N / ${number(lon, 7)}° E`
          : "等待新鲜定位"}
        <span>航迹 {s.telemetry.track.length} 点</span>
      </div>
    </div>
  );
}
