import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 600, height: 900 },
]) {
  test(`workspaces and mission editing at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("region", { name: "驾驶舱" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "航行驾驶舱" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "解锁", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `.impeccable/review/cockpit-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "规划航线", exact: true }).click();
    await page.getByRole("button", { name: "添加航点", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "航点 1 采样", exact: true })
      .check();
    await page
      .getByRole("spinbutton", { name: "航点 1 旧固件采样时限" })
      .fill("120");
    await expect(
      page.getByRole("button", { name: "上传并校验" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "添加航点", exact: true }).click();
    await page.getByRole("button", { name: "上移航点 2" }).click();
    await expect(
      page.getByRole("checkbox", { name: "航点 2 采样", exact: true }),
    ).toBeChecked();
    await page.screenshot({
      path: `.impeccable/review/planner-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "采样", exact: true }).click();
    await expect(page.getByRole("region", { name: "采样进度" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "点采样", exact: true }),
    ).toBeDisabled();
    if (viewport.width === 1280) {
      const [plot, scroll] = await Promise.all([
        page.locator(".signal-plot").boundingBox(),
        page.locator(".sampling-scroll").boundingBox(),
      ]);
      expect(plot!.y + plot!.height).toBeLessThanOrEqual(
        scroll!.y + scroll!.height,
      );
    }
    await page.screenshot({
      path: `.impeccable/review/sampling-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "诊断", exact: true }).click();
    await expect(page.getByText("尚无载荷命令")).toBeVisible();
    await page
      .getByRole("textbox", { name: "按 request session 或错误类型筛选" })
      .fill("request-123");
    await page.screenshot({
      path: `.impeccable/review/diagnostics-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "连接与设置" }).click();
    await expect(page.getByRole("button", { name: "连接设备" })).toBeDisabled();
    await page.getByRole("button", { name: "TCP", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "TCP 主机" })).toBeVisible();
    await page.getByRole("combobox", { name: "界面主题" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      path: `.impeccable/review/settings-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "航线", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "航点 2 采样", exact: true }),
    ).toBeChecked();
    expect(errors).toEqual([]);
  });
}

test("settings fill a wide window and stay scrollable without a vertical bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: "连接与设置" }).click();
  await page.getByRole("button", { name: "Windows 串口" }).click();
  await expect(
    page.getByRole("combobox", { name: "串口设备" }),
  ).toBeInViewport();
  const scroll = page.locator(".settings-scroll");
  const flight = page.getByRole("heading", { name: "飞控连接" });
  const ros = page.getByRole("heading", { name: "Jetson ROS 服务" });
  const config = page.getByRole("heading", { name: "ROS 配置与设备" });
  const cache = page.getByRole("heading", { name: "地图与离线缓存" });
  const [flightBox, rosBox, configBox, cacheBox, scrollBox] = await Promise.all(
    [flight, ros, config, cache, scroll].map((item) => item.boundingBox()),
  );
  expect(rosBox!.y).toBeCloseTo(flightBox!.y, 0);
  expect(rosBox!.x - flightBox!.x).toBeGreaterThan(500);
  expect(configBox!.x).toBeCloseTo(rosBox!.x, 0);
  expect(cacheBox!.x).toBeCloseTo(flightBox!.x, 0);
  expect(
    scrollBox!.x + scrollBox!.width - rosBox!.x - rosBox!.width,
  ).toBeLessThan(32);
  await page.screenshot({ path: ".impeccable/review/settings-wide.png" });

  await page.setViewportSize({ width: 960, height: 640 });
  await expect
    .poll(async () => (await ros.boundingBox())!.x)
    .toBeCloseTo((await flight.boundingBox())!.x, 0);
  const sizing = await scroll.evaluate((el) => ({
    verticalBar: el.getBoundingClientRect().width - el.clientWidth,
    horizontalOverflow: el.scrollWidth - el.clientWidth,
    needsScroll: el.scrollHeight > el.clientHeight,
  }));
  expect(sizing).toEqual({
    verticalBar: 0,
    horizontalOverflow: 0,
    needsScroll: true,
  });
  await scroll.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const theme = page.getByRole("combobox", { name: "界面主题" });
  await theme.focus();
  await expect(theme).toBeInViewport();
  await theme.press("ArrowDown");
  await expect(theme).toHaveValue("dark");
});

test("confirmation dialog has a name, description and keyboard cancellation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto("/tests/ui/confirmation.html");
  const dialog = page.getByRole("dialog", { name: "确认设备操作" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    "确认解锁无人船 1？请先确认推进器周围安全。",
  );
  await page.screenshot({ path: ".impeccable/review/confirmation-600.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
]) {
  test(`dark theme across Windows workspaces at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "切换深色主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    for (const [label, file] of [
      ["驾驶舱", "cockpit"],
      ["航线", "planner"],
      ["采样", "sampling"],
      ["诊断", "diagnostics"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.screenshot({
        path: `.impeccable/review/${file}-dark-${viewport.width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "切换浅色主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
}
