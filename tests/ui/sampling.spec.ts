import { test, expect } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";

for (const width of [1556, 1280, 960, 600]) {
  test(`sampling progress, aligned controls and PID visuals at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const snapshot = structuredClone(emptySnapshot);
    snapshot.link = "connected";
    snapshot.payload_online = true;
    snapshot.telemetry.system_id = 1;
    snapshot.actions = snapshot.actions.map((a) => ({ ...a, allowed: true }));
    await page.addInitScript(
      ({ snapshot, width }) => {
        localStorage.setItem(
          "usv.preferences",
          JSON.stringify({
            rosUrl: "http://fixture.invalid",
            mapEnabled: false,
            theme: width === 600 ? "dark" : "light",
          }),
        );
        localStorage.setItem("usv.ros.transport", "http");
        const health = {
          success: true,
          data: {
            latest: {
              ts: "2026-11-27T08:00:00Z",
              jetson: {
                cpu_percent: 27.5,
                memory_percent: 42.1,
                temperature_c: 48.2,
              },
              detector: {
                online: true,
                age_s: 0.2,
                temperature_c: 36.7,
                heap_percent_free: 71,
              },
              health: { level: "ok", summary: "ok" },
              ros_nodes: [{ name: "/pump_control", alive: true }],
            },
            automation: {
              source_monotonic: 125,
              status: "running",
              preflight_phase: "complete",
              pending_motors: ["A"],
              serial_connected: true,
            },
          },
        };
        let emit: (s: unknown) => void;
        const update = (values: Record<string, number>, now: number) => {
          snapshot.now_ms = now;
          for (const [name, value] of Object.entries(values))
            snapshot.telemetry.fields[name] = {
              value,
              received_ms: now,
              sequence: now,
              source_component: 191,
            };
          emit(structuredClone(snapshot));
        };
        Object.assign(window, {
          isTauri: true,
          samplingUpdate: update,
          __TAURI_INTERNALS__: {
            transformCallback: () => 1,
            unregisterCallback: () => {},
            invoke: async (command: string, args: Record<string, unknown>) => {
              if (command === "station_subscribe") {
                emit = (args.channel as { onmessage: (s: unknown) => void })
                  .onmessage;
                emit(snapshot);
                return 1;
              }
              const path =
                command === "ros_control"
                  ? (args.request as { path: string }).path
                  : args?.path;
              if (path === "/api/diagnostics/system") return health;
              if (path === "/api/manual/status")
                return {
                  data: {
                    enabled: false,
                    automation_active: true,
                    spectrometer_active: true,
                  },
                };
              if (path === "/api/data/missions") return { data: [] };
              return null;
            },
          },
        });
      },
      { snapshot, width },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "采样", exact: true }).click();
    await page.evaluate(async () => {
      const update = (
        window as unknown as {
          samplingUpdate: (values: Record<string, number>, now: number) => void;
        }
      ).samplingUpdate;
      for (let i = 0; i <= 60; i++) {
        update(
          {
            USV_STAT: 1,
            USV_STEP: 3,
            USV_STOT: 8,
            USV_LOOP: 1,
            USV_LTOT: 3,
            USV_PMOD: 1,
            USV_PERR: -0.24,
            PUMP_X: 359.4,
            PUMP_Y: 235.6,
            PUMP_Z: 352,
            PUMP_A: 356.8,
            USV_SCNT: 2,
            USV_VLD: 1,
            USV_BSET: 1,
            USV_VOLT: 0.4 + Math.sin(i * 1.7) * 0.003 - i * 0.0002,
            USV_ABS: 0.03 + Math.sin(i * 1.7) * 0.001,
          },
          i * 2000,
        );
        await new Promise((r) => setTimeout(r, 12));
      }
    });
    await expect(page.getByRole("img", { name: /电压实时曲线/ })).toBeVisible();
    await expect(
      page.locator('.sampling-stages [aria-current="step"]'),
    ).toHaveText("采样");
    const progress = await page
      .getByRole("region", { name: "采样进度" })
      .boundingBox();
    const chart = await page.locator(".signal-chart").boundingBox();
    expect(progress!.y + progress!.height).toBeLessThan(chart!.y);
    if (width === 1280) expect(chart!.y + chart!.height).toBeLessThan(692);
    const widths = await page
      .locator(".sampling-actions .control-group button")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getBoundingClientRect().width),
      );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    const plotWidth = await page
      .locator(".signal-chart")
      .evaluate((svg) => Number(svg.getAttribute("viewBox")!.split(" ")[2]));
    expect(Math.abs(plotWidth - chart!.width)).toBeLessThan(1);
    await page.screenshot({
      path: `.impeccable/review/sampling-layout-${width}.png`,
      fullPage: true,
    });
    await page.getByText("四轴反馈、PID 与设备状态", { exact: true }).click();
    await expect(page.getByRole("img", { name: "泵 A：356.8°" })).toBeVisible();
    await expect(
      page.getByRole("meter", { name: "Jetson CPU" }),
    ).toHaveAttribute("value", "27.5");
    await expect(page.locator(".pump-details pre")).toHaveCount(0);
    await page.locator(".pump-details").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.impeccable/review/sampling-pid-${width}.png`,
      fullPage: true,
    });
    const overflow = await page
      .locator(".sampling-scroll")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "吸光度", exact: true }).click();
    await expect(
      page.getByRole("img", { name: /吸光度实时曲线/ }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
