import { describe, expect, it } from "vitest";
import { field, parseMission } from "./format";
import { emptySnapshot } from "./backend";

describe("device data boundaries", () => {
  it("expires received values without replacing them with zero", () => {
    const s = structuredClone(emptySnapshot);
    s.now_ms = 4001;
    s.telemetry.fields.USV_VOLT = {
      value: 1.23,
      received_ms: 1000,
      sequence: 1,
      source_component: 191,
    };
    expect(field(s, "USV_VOLT")).toBeNull();
    expect(field(s, "missing")).toBeNull();
    s.now_ms = 4000;
    expect(field(s, "USV_VOLT")).toBe(1.23);
  });
  it("roundtrips a sampling waypoint and rejects invalid import", () => {
    const draft = {
      version: 1,
      waypoints: [
        { lat: 25.3, lon: 110.4, altitude: 0, sample: true, timeout_s: 120 },
      ],
    };
    expect(parseMission(JSON.stringify(draft))).toEqual(draft);
    draft.waypoints[0].timeout_s = 1800;
    expect(parseMission(JSON.stringify(draft))).toEqual(draft);
    for (const patch of [
      { lat: 91 },
      { lon: "110" },
      { timeout_s: 2049 },
      { timeout_s: 1.5 },
      { sample: 1 },
    ]) {
      expect(() =>
        parseMission(
          JSON.stringify({
            ...draft,
            waypoints: [{ ...draft.waypoints[0], ...patch }],
          }),
        ),
      ).toThrow();
    }
  });
});
