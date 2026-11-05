import { beforeEach, expect, it } from "vitest";
import {
  controlArgs,
  routeRosCall,
  setRosTransport,
  setRosToken,
  rosPollInterval,
} from "./rosAccess";
beforeEach(() => {
  localStorage.clear();
  setRosToken("");
});
it("keeps data, maps, archive downloads and export on the original HTTP path", () => {
  setRosTransport("mavlink");
  for (const path of [
    "/api/data/missions",
    "/api/data/mission/m1",
    "/api/map/config",
    "/api/diagnostics/export",
  ])
    expect(
      routeRosCall("ros_get", { baseUrl: "http://jetson:5000", path }),
    ).toBeNull();
  expect(
    routeRosCall("ros_download", { path: "/api/data/mission/m1/archive" }),
  ).toBeNull();
});
it("routes scoped controls explicitly with no cross-transport fallback", () => {
  for (const transport of ["http", "mavlink"] as const) {
    setRosTransport(transport);
    expect(
      routeRosCall("ros_get", {
        baseUrl: "http://jetson:5000",
        path: "/api/diagnostics/link",
      }),
    ).toMatchObject({
      transport,
      request: { method: "GET", path: "/api/diagnostics/link" },
    });
    expect(
      routeRosCall("ros_manual", {
        baseUrl: "http://jetson:5000",
        command: { action: "step", axis: "X", angle_deg: 1800 },
        confirmed: true,
      }),
    ).toMatchObject({
      transport,
      confirmed: true,
      request: {
        path: "/api/manual/pump-step",
        body: { axis: "X", angle_deg: 1800 },
      },
    });
  }
});
it("keeps the optional credential in memory", () => {
  setRosToken("fixture-only-token");
  expect(controlArgs("", "GET", "/api/config").request.authorization).toBe(
    "Bearer fixture-only-token",
  );
  expect(JSON.stringify(localStorage)).not.toContain("fixture-only-token");
});
it("spaces diagnostic reads on radio while preserving HTTP and manual polling", () => {
  setRosTransport("mavlink");
  expect(rosPollInterval("/api/diagnostics/link", 5000)).toBe(30000);
  expect(rosPollInterval("/api/manual/status", 3000)).toBe(3000);
  expect(rosPollInterval("/api/diagnostics/link", 0)).toBe(0);
  setRosTransport("http");
  expect(rosPollInterval("/api/diagnostics/link", 5000)).toBe(5000);
});
