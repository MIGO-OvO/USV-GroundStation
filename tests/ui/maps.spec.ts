import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    Object.assign(window, {
      isTauri: true,
      mapTestCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === "map_location") {
            if (
              (window as unknown as { mapTestLocationDenied?: boolean })
                .mapTestLocationDenied
            )
              throw new Error("Windows 定位不可用，可拖动地图自动缓存");
            return {
              latitude: 31.2,
              longitude: 121.5,
              accuracy_m: 30,
              received_unix_ms: Date.now(),
            };
          }
          if (command === "map_prefetch") return 54;
          if (command === "map_tile")
            return Array.from(
              atob(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              ),
              (c) => c.charCodeAt(0),
            );
          throw new Error(`Unexpected test command ${command}`);
        },
      },
    });
  });
});

test("Google map uses local coordinates without ROS or vessel GPS and preserves offline view", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/ui/map.html");
  await expect(page.getByRole("button", { name: "定位本机" })).toBeEnabled();
  await expect(page.getByLabel("本机位置", { exact: true })).toBeVisible();
  await expect(page.getByText("等待新鲜定位")).toBeVisible();
  await expect(page.getByText("Google · 自动缓存")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("usv.map.viewport")))
    .not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("usv.map.viewport")!).center,
      ),
    )
    .toEqual([121.5, 31.2]);
  await page.getByRole("button", { name: "放大地图" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("usv.map.viewport")!).zoom,
      ),
    )
    .toBeGreaterThan(16);
  await page.getByRole("button", { name: "切换离线缓存" }).click();
  await expect(page.getByText("离线缓存", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("usv.map.viewport")!).zoom,
      ),
    )
    .toBeGreaterThan(16);
  const readCalls = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            mapTestCalls: { command: string; args: Record<string, unknown> }[];
          }
        ).mapTestCalls,
    );
  await expect
    .poll(async () =>
      (await readCalls()).some(
        (c) => c.command === "map_tile" && c.args.offline,
      ),
    )
    .toBe(true);
  const calls = await readCalls();
  expect(
    calls.some((c) => c.command === "map_prefetch" && c.args.latitude === 31.2),
  ).toBe(true);
  expect(
    calls
      .filter((c) => c.command === "map_tile")
      .every((c) => c.args.source === "google" && c.args.baseUrl === ""),
  ).toBe(true);
  await page.screenshot({ path: ".impeccable/review/local-map.png" });
  expect(errors).toEqual([]);
});

test("denied local positioning still allows browsing and caching without invented coordinates", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.assign(window, { mapTestLocationDenied: true }),
  );
  await page.goto("/tests/ui/map.html");
  await expect(page.getByRole("status")).toHaveText(
    "Error: Windows 定位不可用，可拖动地图自动缓存",
  );
  await expect(page.getByRole("button", { name: "定位本机" })).toBeDisabled();
  await expect(page.getByLabel("本机位置", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "放大地图" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("usv.map.viewport")!).zoom,
      ),
    )
    .toBeGreaterThan(2);
  const commands = await page.evaluate(() =>
    (
      window as unknown as { mapTestCalls: { command: string }[] }
    ).mapTestCalls.map((c) => c.command),
  );
  expect(commands).toContain("map_tile");
  expect(commands).not.toContain("map_prefetch");
});
