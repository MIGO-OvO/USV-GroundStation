import { expect, test } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";

for (const width of [1280, 600]) {
  test(`edits and verifies sampling over radio at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    const snapshot = structuredClone(emptySnapshot);
    snapshot.link = "connected";
    snapshot.telemetry.system_id = 1;

    await page.addInitScript((snapshot) => {
      localStorage.setItem(
        "usv.preferences",
        JSON.stringify({ mapEnabled: false }),
      );
      localStorage.setItem("usv.ros.transport", "http");
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      let sequence = {
        loop_count: 1,
        steps: [
          {
            name: "进样",
            interval: 2000,
            A: { enable: "E", direction: "F", speed: "3", angle: "360" },
          },
          { name: "冲洗", interval: 500 },
        ],
      };
      let loseReceipt = false;
      let emit: (snapshot: unknown) => void;
      Object.assign(window, {
        isTauri: true,
        configCalls: calls,
        loseSamplingReceipt: () => {
          loseReceipt = true;
        },
        changeSamplingLink: (system: number | null) => {
          snapshot.link = system === null ? "disconnected" : "connected";
          snapshot.telemetry.system_id = system;
          emit(structuredClone(snapshot));
        },
        __TAURI_INTERNALS__: {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string, args: Record<string, unknown>) => {
            calls.push({ command, args });
            if (command === "station_subscribe") {
              emit = (
                args.channel as { onmessage: (snapshot: unknown) => void }
              ).onmessage;
              emit(structuredClone(snapshot));
              return 1;
            }
            if (command === "ros_get" && args.path === "/api/data/missions")
              return { data: [{ mission_id: "one", name: "实验归档" }] };
            if (command === "ros_download") return "D:/test.csv";
            if (command === "map_location") return null;
            if (command !== "ros_control") return { data: [] };
            const request = args.request as {
              path: string;
              method: string;
              body: { sampling_sequence: typeof sequence };
            };
            if (request.path !== "/api/config") return { data: {} };
            if (request.method === "GET")
              return {
                sampling_sequence: structuredClone(sequence),
                hardware: { enabled: true },
              };
            sequence = structuredClone(request.body.sampling_sequence);
            if (loseReceipt) {
              loseReceipt = false;
              throw new Error("数传连接已断开");
            }
            return { success: true };
          },
        },
      });
    }, snapshot);

    const read = page.getByRole("button", { name: "读取船端配置" });
    const save = page.getByRole("button", { name: "保存采样配置" });
    const config = page.getByRole("region", { name: "采样配置" });
    const nav = (name: string) =>
      page.getByRole("button", { name, exact: true }).click();
    const changeLink = (system: number | null) =>
      page.evaluate(
        (system) =>
          (
            window as unknown as {
              changeSamplingLink: (system: number | null) => void;
            }
          ).changeSamplingLink(system),
        system,
      );
    const configCalls = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            configCalls: {
              command: string;
              args: {
                request?: { method: string; path: string; body: unknown };
                transport?: string;
                expectedSystem?: number;
                path?: string;
              };
            }[];
          }
        ).configCalls.filter(
          (call) =>
            call.args?.request?.path === "/api/config" ||
            call.command === "ros_download",
        ),
      );

    await page.goto("/");
    await nav("采样");
    await expect(
      page.getByRole("heading", { name: "采样数据中心" }),
    ).toHaveCount(0);
    await expect(save).toBeDisabled();
    await read.click();
    await expect(config.getByLabel("循环次数")).toHaveValue("1");
    await config.getByLabel("循环次数").fill("2.5");
    await save.click();
    await expect(config.getByRole("alert")).toHaveText("循环次数须为正整数");
    expect(
      (await configCalls()).map(({ args }) => args.request?.method),
    ).toEqual(["GET"]);
    await config.getByLabel("循环次数").fill("3");
    const pump = config.getByRole("group", { name: "A 轴" });
    await pump.getByLabel("方向").selectOption("B");
    await pump.getByLabel("转速（RPM）").fill("8");
    await pump.getByLabel("角度（°）").fill("720");
    await config.getByLabel("完成后等待（毫秒）").fill("1000");
    await config.getByRole("button", { name: "添加步骤" }).click();
    await config.getByLabel("步骤名称").fill("临时");
    await config.getByRole("button", { name: "删除步骤" }).click();
    await config.getByRole("button", { name: /冲洗/ }).click();
    await config.getByRole("button", { name: "上移步骤" }).click();
    expect(
      await config.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await save.click();
    await expect(config.getByRole("status")).toHaveText("采样配置已保存并核对");
    const calls = await configCalls();
    expect(calls.map(({ args }) => args.request?.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
    expect(
      calls.every(
        ({ command, args }) =>
          command === "ros_control" &&
          args.transport === "mavlink" &&
          args.expectedSystem === 1,
      ),
    ).toBe(true);
    expect(calls[1].args.request?.body).toEqual({
      sampling_sequence: {
        loop_count: 3,
        steps: [
          { name: "冲洗", interval: 500 },
          {
            name: "进样",
            interval: 1000,
            A: { enable: "E", direction: "B", speed: "8", angle: "720" },
          },
        ],
      },
    });

    await page.evaluate(() =>
      (
        window as unknown as { loseSamplingReceipt: () => void }
      ).loseSamplingReceipt(),
    );
    await config.getByLabel("无限循环").check();
    await save.click();
    await expect(config.getByRole("alert")).toContainText("保存结果待核对");
    await changeLink(null);
    await expect(read).toBeDisabled();
    await nav("连接与设置");
    await expect(
      page.getByRole("heading", { name: "采样数据中心" }),
    ).toBeVisible();
    await page.getByLabel("任务记录").selectOption("one");
    await page.getByRole("button", { name: "结果 CSV" }).click();
    expect((await configCalls()).at(-1)?.args.path).toBe(
      "/api/data/mission/one/csv",
    );

    await changeLink(1);
    await nav("采样");
    await expect(config.getByLabel("无限循环")).toBeChecked();
    await expect(save).toBeDisabled();
    await read.click();
    await expect(config.getByRole("status")).toHaveText("采样配置已保存并核对");
    const writes = (await configCalls()).filter(
      ({ args }) => args.request?.method === "POST",
    );
    expect(writes).toHaveLength(2);
    expect(writes[1].args.request?.body).toMatchObject({
      sampling_sequence: { loop_count: 0 },
    });

    await changeLink(2);
    await expect(save).toBeDisabled();
    await expect(config.getByLabel("无限循环")).toHaveCount(0);
    await read.click();
    await expect(config.getByRole("status")).toHaveText("已读取船端配置");
    expect((await configCalls()).at(-1)?.args.expectedSystem).toBe(2);
    await config.getByRole("button", { name: /进样/ }).click();
    await config.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: `.impeccable/review/sampling-configuration-${width}.png`,
      fullPage: true,
    });
  });
}
