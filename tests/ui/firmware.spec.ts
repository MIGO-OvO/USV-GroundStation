import { expect, test, type Page } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";
import type { SerialDevice } from "../../src/serial";

const pixhawk: SerialDevice = {
  port: "COM7",
  kind: "flight_controller",
  label: "Holybro Pixhawk 6C",
  description: "Pixhawk6C",
  instance_id: "USB-APP",
  usb: { vid: 0x3162, pid: 0x53, serial_number: "USB12345" },
  bootloader_hint: false,
};
const bootloader = {
  ...pixhawk,
  port: "COM12",
  description: "Pixhawk6C-BL",
  instance_id: "USB-BOOT",
  bootloader_hint: true,
};
const stable =
  "https://firmware.ardupilot.org/Rover/stable/Pixhawk6C/ardurover.apj";

async function fixture(page: Page) {
  await page.addInitScript(
    ({ snapshot, bootloader, stable }) => {
      let ports: SerialDevice[] = [];
      let finishFlash: (() => void) | undefined;
      const calls: { command: string; args: unknown }[] = [];
      localStorage.setItem(
        "usv.preferences",
        JSON.stringify({ mapEnabled: false }),
      );
      Object.assign(window, {
        isTauri: true,
        setSerialPorts: (value: SerialDevice[]) => {
          ports = value;
        },
        finishFlash: () => finishFlash?.(),
        firmwareCalls: calls,
        __TAURI_INTERNALS__: {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string, args: Record<string, unknown>) => {
            const channel = (key: string) =>
              args[key] as { onmessage: (value: unknown) => void };
            if (command === "station_subscribe") {
              channel("channel").onmessage(snapshot);
              return 1;
            }
            if (command === "serial_ports") return ports;
            if (command === "firmware_probe") {
              calls.push({ command, args });
              ports = [bootloader];
              return {
                session: 17,
                device: bootloader,
                board: {
                  board_id: 56,
                  board_revision: 0,
                  bootloader_revision: 5,
                  flash_size: 1_966_080,
                },
              };
            }
            if (command === "firmware_rover_releases") {
              return [
                { platform: "Pixhawk6C", version: "V4.7.3", url: stable },
                {
                  platform: "Pixhawk6C-bdshot",
                  version: "V4.7.3",
                  url: stable.replace("Pixhawk6C", "Pixhawk6C-bdshot"),
                },
              ];
            }
            if (command === "firmware_flash") {
              calls.push({
                command,
                args: {
                  id: args.id,
                  source: args.source,
                  confirmed: args.confirmed,
                },
              });
              channel("progress").onmessage({ phase: "writing", percent: 64 });
              await new Promise<void>((resolve) => {
                finishFlash = resolve;
              });
            }
            if (command === "station_intent" || command === "firmware_cancel")
              calls.push({ command, args });
            return null;
          },
        },
      });
    },
    { snapshot: structuredClone(emptySnapshot), bootloader, stable },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "连接与设置" }).click();
}

const ports = (page: Page, devices: SerialDevice[]) =>
  page.evaluate(
    (value) =>
      (
        window as unknown as {
          setSerialPorts: (devices: SerialDevice[]) => void;
        }
      ).setSerialPorts(value),
    devices,
  );
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { firmwareCalls: unknown[] }).firmwareCalls,
  );

test("detects USB hotplug without connecting and keeps manual COM entry", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Windows 串口" }).click();
  const serial = page.getByRole("combobox", { name: "串口设备" });
  await expect(serial).toHaveValue("");
  await ports(page, [pixhawk]);
  await expect(serial).toHaveValue("COM7");
  await expect(serial.locator("option:checked")).toHaveText(
    "COM7 · Holybro Pixhawk 6C",
  );
  await ports(page, [bootloader]);
  await expect(serial.getByRole("option", { name: /引导程序/ })).toBeAttached();
  await expect(page.getByRole("button", { name: "连接设备" })).toBeDisabled();
  expect(await calls(page)).toEqual([]);
  await serial.selectOption("manual");
  await page.getByRole("textbox", { name: "手动串口号" }).fill("COM99");
  await page.getByRole("button", { name: "连接设备" }).click();
  expect(await calls(page)).toEqual([
    {
      command: "station_intent",
      args: {
        intent: {
          type: "connect",
          config: { kind: "serial", port: "COM99", baud: 115200 },
          target_system: null,
        },
      },
    },
  ]);
});

for (const width of [1440, 600]) {
  test(`firmware selection, target confirmation and write progress at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    await fixture(page);
    await ports(page, [pixhawk]);
    await page.getByRole("button", { name: "固件刷写", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "飞控固件刷写" });
    await expect(
      dialog.getByRole("combobox", { name: "飞控串口" }),
    ).toHaveValue("COM7");
    await dialog.getByRole("button", { name: "识别引导程序" }).click();
    await expect(dialog.getByText(/COM12 · Holybro Pixhawk 6C/)).toBeVisible();
    const flash = dialog.getByRole("button", { name: "开始刷写" });
    if (width === 1440) {
      await dialog.getByLabel("固件文件（.apj 或 .px4）").evaluate((input) => {
        const files = new DataTransfer();
        files.items.add(new File(['{"board_id":56}'], "ardurover.apj"));
        (input as HTMLInputElement).files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    } else {
      await dialog.getByRole("button", { name: "官方 ArduRover" }).click();
      const release = dialog.getByRole("combobox", {
        name: "ArduRover 稳定版",
      });
      await expect(release).toHaveValue("");
      await release.selectOption(stable);
    }
    await expect(flash).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: "飞控已上锁，推进电源已断开" })
      .check();
    await dialog.screenshot({
      path: `.impeccable/review/firmware-${width}.png`,
    });
    await flash.click();
    await expect(dialog.getByRole("status")).toContainText(
      "正在写入固件 · 64%",
    );
    await expect(dialog.getByRole("button", { name: "取消" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { finishFlash: () => void }).finishFlash(),
    );
    await expect(dialog.getByRole("status")).toContainText(
      "固件已写入并通过校验",
    );
    await dialog.getByRole("button", { name: "完成" }).click();
    await expect(dialog).toBeHidden();
    expect(await calls(page)).toContainEqual({
      command: "firmware_flash",
      args: {
        id: 17,
        confirmed: true,
        source:
          width === 1440
            ? { kind: "local", text: '{"board_id":56}' }
            : { kind: "rover", url: stable },
      },
    });
  });
}
