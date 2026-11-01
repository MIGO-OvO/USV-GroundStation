import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MapView from "./MapView";
import { emptySnapshot } from "./backend";
import type { Preferences } from "./types";

const maps = vi.hoisted(
  () =>
    [] as Array<{
      sources: Record<string, { setData: ReturnType<typeof vi.fn> }>;
    }>,
);
vi.mock("maplibre-gl", () => ({
  default: {
    addProtocol: vi.fn(),
    Map: class {
      sources: Record<string, { setData: ReturnType<typeof vi.fn> }>;
      constructor(options: { style: { sources: Record<string, unknown> } }) {
        this.sources = Object.fromEntries(
          Object.keys(options.style.sources).map((name) => [
            name,
            { setData: vi.fn() },
          ]),
        );
        maps.push(this);
      }
      // MapLibre can report style readiness before its first rendered load event.
      isStyleLoaded() {
        return true;
      }
      getSource(name: string) {
        return this.sources[name];
      }
      addSource(name: string) {
        this.sources[name] = { setData: vi.fn() };
      }
      addControl() {}
      addLayer() {}
      on() {}
      remove() {}
    },
    AttributionControl: class {},
    ScaleControl: class {},
  },
}));
beforeEach(() => {
  maps.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders immediate telemetry before the map load event and after style recreation", () => {
  const preferences: Preferences = {
    rosUrl: "",
    mapSource: "google",
    mapStyle: "gsatellite",
    offline: true,
    theme: "light",
    mapEnabled: false,
  };
  const snapshot = structuredClone(emptySnapshot);
  snapshot.telemetry.track = [
    [121.5, 31.2],
    [121.6, 31.3],
  ];
  const view = render(
    <MapView snapshot={snapshot} preferences={preferences} />,
  );
  expect(maps[0].sources.track.setData).toHaveBeenCalledWith({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: snapshot.telemetry.track },
      },
    ],
  });
  view.rerender(
    <MapView
      snapshot={structuredClone(snapshot)}
      preferences={{ ...preferences, theme: "dark" }}
    />,
  );
  expect(maps).toHaveLength(2);
  expect(maps[1].sources.track.setData).toHaveBeenCalled();
  expect(maps[1].sources.route.setData).toHaveBeenCalledWith({
    type: "FeatureCollection",
    features: [],
  });
});
