import { createRoot } from "react-dom/client";
import { useState } from "react";
import MapView from "../../src/MapView";
import { emptySnapshot } from "../../src/backend";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../src/styles.css";

function Fixture() {
  const [offline, setOffline] = useState(false);
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <button onClick={() => setOffline(!offline)}>切换离线缓存</button>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MapView
          snapshot={emptySnapshot}
          preferences={{
            rosUrl: "",
            mapSource: "google",
            mapStyle: "gsatellite",
            mapEnabled: true,
            offline,
            theme: "light",
          }}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
