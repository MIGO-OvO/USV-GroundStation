import { test, expect } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";

for (const width of [1440, 600]) {
  test(`named sampling and task confirmation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((snapshot) => {
      localStorage.setItem(
        "usv.preferences",
        JSON.stringify({
          mapEnabled: false,
          mapSource: "google",
          mapStyle: "gsatellite",
          theme: "light",
        }),
      );
      localStorage.setItem("usv.ros.transport", "mavlink");
      snapshot.link = "connected";
      snapshot.telemetry.system_id = 1;
      snapshot.actions.forEach((action) => {
        action.allowed = true;
      });
      snapshot.navigation.upload = true;
      snapshot.navigation.auto = true;
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      Object.assign(window, {
        isTauri: true,
        recordingCalls: calls,
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
            calls.push({ command, args });
            return command === "ros_control"
              ? { success: true, data: { token: 123456 } }
              : {};
          },
        },
      });
    }, structuredClone(emptySnapshot));
    await page.goto("/");
    await page.getByRole("button", { name: "点采样", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认设备操作" });
    await expect(
      dialog.getByRole("button", { name: "确认执行" }),
    ).toBeDisabled();
    await dialog.getByRole("textbox", { name: "采样名称" }).fill("湖心/样本");
    await dialog.getByRole("button", { name: "确认执行" }).click();
    await expect(dialog.getByRole("alert")).toContainText("路径分隔符");
    await dialog.getByRole("textbox", { name: "采样名称" }).fill("湖心");
    await page.screenshot({
      path: `.impeccable/review/recording-name-${width}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "点采样", exact: true }).click();
    await dialog.getByRole("textbox", { name: "采样名称" }).fill("湖心");
    await dialog.getByRole("button", { name: "确认执行" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "航线", exact: true }).click();
    await page.getByRole("button", { name: "添加航点", exact: true }).click();
    await page.getByRole("button", { name: "上传并校验" }).click();
    await dialog.getByRole("textbox", { name: "任务名称" }).fill("环湖任务");
    await dialog.getByRole("button", { name: "确认执行" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "AUTO 执行 / 继续" }).click();
    await expect(dialog.getByRole("textbox", { name: "任务名称" })).toHaveValue(
      "环湖任务",
    );
    await dialog.getByRole("button", { name: "确认执行" }).click();
    await expect(dialog).not.toBeVisible();
    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            recordingCalls: {
              command: string;
              args: Record<string, unknown>;
            }[];
          }
        ).recordingCalls,
    );
    const relevant = calls.filter((call) =>
      ["ros_control", "station_intent"].includes(call.command),
    );
    expect(relevant).toEqual([
      {
        command: "ros_control",
        args: expect.objectContaining({
          transport: "mavlink",
          request: expect.objectContaining({
            path: "/api/recording/name",
            body: { name: "湖心" },
          }),
        }),
      },
      {
        command: "station_intent",
        args: {
          intent: {
            type: "payload",
            command: 31010,
            param1: 123456,
            param2: 0,
            confirmed: true,
          },
        },
      },
      {
        command: "ros_control",
        args: expect.objectContaining({
          request: expect.objectContaining({
            path: "/api/recording/mission",
            body: { name: "环湖任务" },
          }),
        }),
      },
      {
        command: "station_intent",
        args: {
          intent: expect.objectContaining({
            type: "upload_mission",
            draft: expect.objectContaining({ name: "环湖任务" }),
          }),
        },
      },
      {
        command: "ros_control",
        args: expect.objectContaining({
          request: expect.objectContaining({
            path: "/api/recording/mission",
            body: { name: "环湖任务" },
          }),
        }),
      },
      {
        command: "station_intent",
        args: { intent: { type: "mode", mode: 10, confirmed: true } },
      },
    ]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
