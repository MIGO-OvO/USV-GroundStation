import { test, expect } from "@playwright/test";
import { emptySnapshot } from "../../src/backend";

for (const width of [1280, 600]) {
  test(`cockpit map controls, footer and notification at ${width}px`, async ({
    page,
  }) => {
    const height = width === 1280 ? 720 : 900;
    await page.setViewportSize({ width, height });
    const snapshot = structuredClone(emptySnapshot);
    snapshot.link = "connected";
    snapshot.telemetry.system_id = 1;
    snapshot.navigation.manual = true;
    snapshot.telemetry.fields.mode = {
      value: 4,
      received_ms: 0,
      sequence: 1,
      source_component: 1,
    };
    await page.addInitScript(
      ({ snapshot, width }) => {
        const tile = document.createElement("canvas");
        tile.width = tile.height = 256;
        const context = tile.getContext("2d")!;
        context.fillStyle = "#435b62";
        context.fillRect(0, 0, 256, 256);
        context.fillStyle = "#758678";
        context.fillRect(128, 0, 128, 256);
        const tileBytes = Array.from(
          atob(tile.toDataURL().split(",")[1]),
          (c) => c.charCodeAt(0),
        );
        localStorage.setItem(
          "usv.preferences",
          JSON.stringify({
            mapSource: "google",
            mapStyle: "gsatellite",
            mapEnabled: true,
            theme: width === 600 ? "dark" : "light",
          }),
        );
        Object.assign(window, {
          isTauri: true,
          __TAURI_INTERNALS__: {
            transformCallback: () => 1,
            unregisterCallback: () => {},
            invoke: async (command: string, args: Record<string, unknown>) => {
              if (command === "station_subscribe") {
                (
                  args.channel as { onmessage: (snapshot: unknown) => void }
                ).onmessage(snapshot);
                return 1;
              }
              if (command === "map_location")
                throw new Error("Windows 定位不可用 (0x80070005)");
              if (command === "map_tile") return tileBytes;
              return null;
            },
          },
        });
      },
      { snapshot, width },
    );
    await page.goto("/");
    const cockpit = page.getByRole("region", { name: "驾驶舱" });
    const map = cockpit.getByLabel("无人船航行地图");
    await expect(map).toBeVisible();
    await expect(
      cockpit.getByRole("heading", { name: "航行驾驶舱" }),
    ).toHaveCount(0);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText("无法获取本机位置")).toBeVisible();
    await expect(footer.getByText("无法获取本机位置")).toHaveAttribute(
      "title",
      /0x80070005/,
    );
    await expect(
      cockpit.getByText(/Windows 定位不可用|无法获取本机位置/),
    ).toHaveCount(0);
    await expect(cockpit.getByText("Google · 自动缓存")).toHaveCount(0);
    const [mapBox, headerBox, footerBox] = await Promise.all([
      map.boundingBox(),
      page.locator(".app-header").boundingBox(),
      footer.boundingBox(),
    ]);
    expect(mapBox!.y - (headerBox!.y + headerBox!.height)).toBeLessThan(24);
    expect(footerBox!.y).toBeGreaterThan(height - 100);
    const alpha = await cockpit.locator(".map-controls").evaluate((el) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(el).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBeGreaterThan(150);
    expect(alpha).toBeLessThan(255);
    await page.screenshot({
      path: `.impeccable/review/cockpit-location-${width}.png`,
      animations: "disabled",
    });
    await cockpit.getByRole("button", { name: "MANUAL 手动" }).click();
    await expect(page.getByRole("dialog")).toContainText("遥控器接管");
    await page.getByRole("button", { name: "确认执行" }).click();
    const toast = page.locator(".toast");
    await expect(toast.getByRole("status")).toHaveText(
      "操作已提交，等待设备回执",
    );
    const toastBox = await toast.boundingBox();
    expect(
      Math.abs(toastBox!.x + toastBox!.width / 2 - width / 2),
    ).toBeLessThan(2);
    expect(toastBox!.y + toastBox!.height).toBeLessThan(footerBox!.y);
    if (width <= 700) {
      const main = await page.getByRole("main").boundingBox();
      expect(toastBox!.y).toBeGreaterThan(main!.y + main!.height);
    }
    await page.screenshot({
      path: `.impeccable/review/cockpit-toast-${width}.png`,
      animations: "disabled",
    });
    await toast.getByRole("button", { name: "关闭反馈" }).click();
    await expect(toast).toHaveCount(0);
    await page.getByRole("button", { name: "连接与设置" }).click();
    await expect(footer.getByText("无法获取本机位置")).toHaveCount(0);
    await page.getByRole("button", { name: "连接设备" }).click();
    await expect(toast.getByRole("status")).toHaveText(
      "正在连接，等待飞控心跳",
    );
  });
}
