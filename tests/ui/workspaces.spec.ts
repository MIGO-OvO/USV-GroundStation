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
