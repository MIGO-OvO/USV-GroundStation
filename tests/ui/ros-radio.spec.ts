import { test, expect } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";

const hardwareConfig = {
  pump_serial_port: "/dev/ttyUSB0",
  pump_baudrate: 115200,
  pump_timeout: 1,
  ads_address: "0x40",
  spectro_channel: 2,
  mux: "AIN0_AVSS",
  gain: 1,
  vref_mode: "AVDD",
  adc_rate: 90,
  publish_rate: 90,
  spectro_output_hz: 10,
  reference_voltage: 0,
  baseline_voltage: 0,
  continuous_mode: true,
  auto_start: false,
  i2c_mapping: { X: 0, Y: 3, Z: 4, A: 7 },
  board_revision: { capabilities: ["angle", "spectro"], reserved: null },
};

for (const width of [1440, 600]) {
  test(`ROS radio controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = {
      snapshot: structuredClone(emptySnapshot),
      hardware: hardwareConfig,
      theme: width === 600 ? "dark" : "light",
    };
    await page.addInitScript(({ snapshot, hardware, theme }) => {
      localStorage.setItem("usv.ros.transport", "mavlink");
      localStorage.setItem(
        "usv.preferences",
        JSON.stringify({
          rosUrl: "http://unreachable.invalid:5000",
          mapEnabled: false,
          theme,
          mapSource: "google",
          mapStyle: "gsatellite",
        }),
      );
      const calls: unknown[] = [];
      let manualEnabled = false;
      let cancelPump: ((error: Error) => void) | undefined;
      snapshot.link = "connected";
      snapshot.payload_online = true;
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
              const request = args.request as {
                path: string;
                method: string;
                body: { enabled?: boolean; axis?: string };
              };
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
              if (
                request.path === "/api/hardware/config" &&
                request.method === "GET"
              )
                return { success: true, data: hardware };
              if (request.path === "/api/config" && request.method === "GET")
                return {
                  mission: { name: "岸边采样" },
                  sampling: { sample_timeout_s: 30 },
                  hardware,
                };
              if (
                request.path === "/api/calibration/offsets" &&
                request.method === "GET"
              )
                return {
                  success: true,
                  data: { X: 0, Y: 0, Z: 0, A: 3.25 },
                  configured_axes: ["A"],
                };
              if (request.path === "/api/manual/status")
                return {
                  success: true,
                  data: { enabled: manualEnabled, automation_active: false },
                };
              if (request.path === "/api/manual/mode") {
                manualEnabled = request.body.enabled === true;
                return {
                  success: true,
                  data: { enabled: manualEnabled, automation_active: false },
                };
              }
              if (request.path === "/api/manual/pump-step") {
                if (request.body.axis === "Z")
                  return new Promise((_resolve, reject) => {
                    cancelPump = reject;
                  });
                return {
                  success: true,
                  data: { controller_reply: "CMD_OK" },
                };
              }
              if (request.path === "/api/manual/stop-all")
                cancelPump?.(new Error("已由停止操作取消"));
              return { success: true, data: {} };
            }
            return null;
          },
        },
      });
    }, fixture);
    await page.goto("/");
    await page.getByRole("button", { name: "连接与设置" }).click();
    await expect(
      page.getByText("手动模式已关闭", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "读取PID 参数" }).click();
    const kp = page.getByRole("spinbutton", { name: "比例增益 Kp" });
    const savePid = page.getByRole("button", { name: "保存PID 参数" });
    await expect(kp).toHaveValue("0.14");
    await expect(page.getByLabel("PID 参数 JSON")).toBeHidden();
    await kp.fill("");
    await savePid.click();
    await expect(kp).toBeFocused();
    await kp.fill("0.2");
    await savePid.click();

    const topic = page.getByRole("combobox", { name: "配置项目" });
    await topic.selectOption("hardware");
    await page.getByRole("button", { name: "读取硬件设置" }).click();
    await expect(page.getByRole("textbox", { name: "串口设备" })).toHaveValue(
      "/dev/ttyUSB0",
    );
    await expect(
      page.getByRole("spinbutton", { name: "ADC 采样率（SPS）" }),
    ).toHaveValue("90");
    const autoStart = page.getByRole("checkbox", { name: "启动时采集" });
    await expect(autoStart).not.toBeChecked();
    await autoStart.check();
    const channel = page.getByRole("spinbutton", { name: "A 轴", exact: true });
    await expect(channel).toHaveValue("7");
    await channel.fill("5");
    await page.locator(".ros-config-editor").screenshot({
      path: `.impeccable/review/ros-hardware-${width}.png`,
    });
    await page.getByText("高级 JSON", { exact: true }).click();
    const json = page.getByRole("textbox", { name: "硬件设置 JSON" });
    await expect(json).toBeVisible();
    const draft = {
      ...hardwareConfig,
      auto_start: true,
      i2c_mapping: { ...hardwareConfig.i2c_mapping, A: 5 },
    };
    expect(JSON.parse(await json.inputValue())).toEqual(draft);
    await json.fill(JSON.stringify({ ...draft, pump_baudrate: 460800 }));
    await page.getByText("高级 JSON", { exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "波特率" })).toHaveValue(
      "460800",
    );
    await page.getByRole("button", { name: "保存硬件设置" }).click();
    await topic.selectOption("pid");
    await page.getByRole("button", { name: "开启手动模式" }).click();
    await page.getByRole("button", { name: "确认执行" }).click();
    const angleInput = page.getByRole("spinbutton", { name: "角度 °" });
    const speedInput = page.getByRole("spinbutton", { name: "转速 RPM" });
    await expect(angleInput).toHaveValue("360");
    await expect(speedInput).toHaveValue("8");
    await angleInput.fill("10");
    await expect(angleInput).toHaveJSProperty("validationMessage", "");
    await expect(speedInput).toHaveJSProperty("validationMessage", "");
    await angleInput.fill("1800");
    const runPump = page.getByRole("button", { name: "运行泵", exact: true });
    for (const axis of ["X", "Y", "Z"]) {
      await page.getByRole("combobox", { name: "泵轴" }).selectOption(axis);
      await runPump.click();
      await page.getByRole("button", { name: "确认执行" }).click();
      if (axis !== "Z")
        await expect(
          page.getByText(`${axis} 轴指令已获控制板确认`),
        ).toBeVisible();
    }
    await expect(runPump).toBeDisabled();
    await page.getByRole("button", { name: "全泵停止" }).click();
    await expect(page.getByText("全泵停止已确认")).toBeVisible();
    await expect(runPump).toBeEnabled();
    await page.getByRole("button", { name: "退出手动模式" }).click();
    await expect(
      page.getByText("手动模式已关闭", { exact: true }),
    ).toBeVisible();
    await expect(runPump).toBeDisabled();
    const control = page.locator(".ros-controls");
    await control.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.impeccable/review/ros-radio-${width}.png`,
      fullPage: true,
    });
    const readCalls = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              radioCalls: {
                transport: string;
                request: { method: string; path: string; body: unknown };
              }[];
            }
          ).radioCalls,
      );
    const calls = await readCalls();
    const manualPaths = calls
      .map(({ request }) => request.path)
      .filter((path) => path.startsWith("/api/manual/"));
    expect(manualPaths).toEqual([
      "/api/manual/status",
      "/api/manual/mode",
      "/api/manual/pump-step",
      "/api/manual/pump-step",
      "/api/manual/pump-step",
      "/api/manual/stop-all",
      "/api/manual/mode",
    ]);
    expect(
      calls
        .filter(
          ({ request }) =>
            request.method === "POST" && request.path === "/api/pid/config",
        )
        .map(({ request }) => request.body),
    ).toEqual([{ Kp: 0.2, Ki: 0.015, Kd: 0.06, output_min: 1, output_max: 8 }]);
    expect(
      calls.find(
        ({ request }) =>
          request.method === "POST" && request.path === "/api/hardware/config",
      )?.request.body,
    ).toEqual({ ...draft, pump_baudrate: 460800 });
    expect(calls).toContainEqual(
      expect.objectContaining({
        transport: "mavlink",
        confirmed: true,
        request: expect.objectContaining({
          path: "/api/manual/pump-step",
          body: expect.objectContaining({ speed_rpm: 8, angle_deg: 1800 }),
        }),
      }),
    );
    expect(calls.every((call) => call.transport === "mavlink")).toBe(true);
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
    await page.getByRole("button", { name: "读取配置", exact: true }).click();
    const general = page.getByRole("region", { name: "ROS 配置", exact: true });
    await general.getByText("采样任务", { exact: true }).click();
    const missionName = general.getByRole("textbox", {
      name: "名称",
      exact: true,
    });
    await expect(missionName).toHaveValue("岸边采样");
    await expect(general.getByLabel("ROS 配置 JSON")).toBeHidden();
    await missionName.fill("岸边复测");
    await general.getByRole("button", { name: "保存配置" }).click();
    expect(
      (await readCalls()).find(
        ({ request }) =>
          request.method === "POST" && request.path === "/api/config",
      )?.request.body,
    ).toEqual({
      mission: { name: "岸边复测" },
      sampling: { sample_timeout_s: 30 },
      hardware: hardwareConfig,
    });
    await general.getByText("Web 校准零点").click();
    await expect(general.getByText("3.25°")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
