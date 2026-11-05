import { test, expect } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";

for (const width of [1440, 600]) {
  test(`ROS radio controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((snapshot) => {
      localStorage.setItem(
        "usv.preferences",
        JSON.stringify({
          rosUrl: "http://unreachable.invalid:5000",
          mapEnabled: false,
          theme: "light",
          mapSource: "google",
          mapStyle: "gsatellite",
        }),
      );
      const calls: unknown[] = [];
      snapshot.link = "connected";
      snapshot.telemetry.system_id = 1;
      Object.assign(window, {
        isTauri: true,
        radioCalls: calls,
        __TAURI_INTERNALS__: {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string, args: Record<string, unknown>) => {
            if (command === "station_subscribe") {
              (args.channel as { onmessage: (s: unknown) => void }).onmessage(
                snapshot,
              );
              return 1;
            }
            if (command === "station_snapshot") return snapshot;
            if (command === "ros_control") {
              calls.push(args);
              const request = args.request as { path: string; method: string };
              if (
                request.path === "/api/pid/config" &&
                request.method === "GET"
              )
                return {
                  success: true,
                  data: {
                    Kp: 0.14,
                    Ki: 0.015,
                    Kd: 0.06,
                    output_min: 1,
                    output_max: 8,
                  },
                };
              if (request.path === "/api/manual/status")
                return {
                  success: true,
                  data: { enabled: true, automation_active: false },
                };
              return { success: true, data: {} };
            }
            return null;
          },
        },
      });
    }, structuredClone(emptySnapshot));
    await page.goto("/");
    await page.getByRole("button", { name: "连接与设置" }).click();
    await page
      .getByRole("combobox", { name: "配置与控制通信" })
      .selectOption("mavlink");
    await page.getByRole("button", { name: "读取PID 参数" }).click();
    await expect(
      page.getByRole("textbox", { name: "PID 参数 JSON" }),
    ).toContainText('"Kp": 0.14');
    await page
      .getByRole("textbox", { name: "PID 参数 JSON" })
      .fill('{"Kp":0.2,"Ki":0.015,"Kd":0.06,"output_min":1,"output_max":8}');
    await page.getByRole("button", { name: "保存PID 参数" }).click();
    await page.getByRole("button", { name: "读取手动状态" }).click();
    await page.getByRole("spinbutton", { name: "角度 °" }).fill("1800");
    await page.getByRole("button", { name: "运行泵", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "确认设备操作" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认执行" }).click();
    await page.getByRole("button", { name: "全泵停止" }).click();
    const control = page.locator(".ros-controls");
    await control.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.impeccable/review/ros-radio-${width}.png`,
      fullPage: true,
    });
    const calls = await page.evaluate(
      () => (window as unknown as { radioCalls: unknown[] }).radioCalls,
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        transport: "mavlink",
        confirmed: true,
        request: expect.objectContaining({
          path: "/api/manual/pump-step",
          body: expect.objectContaining({ angle_deg: 1800 }),
        }),
      }),
    );
    expect(
      calls.every(
        (call) => (call as { transport: string }).transport === "mavlink",
      ),
    ).toBe(true);
    expect(
      await control.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("combobox", { name: "配置与控制通信" })
      .selectOption("http");
    await page.getByRole("button", { name: "读取PID 参数" }).click();
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { radioCalls: { transport: string }[] }
          ).radioCalls.at(-1)?.transport,
      ),
    ).toBe("http");
    expect(errors).toEqual([]);
  });
}
