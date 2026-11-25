import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RosControls from "./RosControls";
import { emptySnapshot } from "./backend";
import { setRosTransport } from "./rosAccess";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("./backend", async (original) => ({
  ...(await original<typeof import("./backend")>()),
  native: true,
  call: api.call,
}));
beforeEach(() => {
  localStorage.clear();
  setRosTransport("mavlink");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  api.call.mockReset();
  api.call.mockImplementation(async (_cmd, { request }) => ({
    success: true,
    data:
      request.path === "/api/manual/status"
        ? { enabled: false, automation_active: false }
        : { Kp: 0.14 },
  }));
});
afterEach(cleanup);
function setup() {
  const s = structuredClone(emptySnapshot);
  s.link = "connected";
  s.payload_online = true;
  const props = {
    s,
    baseUrl: "http://unreachable.invalid:5000",
    notify: vi.fn(),
  };
  const { rerender } = render(<RosControls {...props} />);
  return { s, rerender: () => rerender(<RosControls {...props} />) };
}
it("reads and saves PID over radio while retaining the HTTP option", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "读取PID 参数" }));
  const kp = await screen.findByRole("spinbutton", { name: "比例增益 Kp" });
  expect(kp).toHaveValue(0.14);
  expect(screen.getByLabelText("PID 参数 JSON")).not.toBeVisible();
  fireEvent.change(kp, { target: { value: "0.2" } });
  fireEvent.click(screen.getByRole("button", { name: "保存PID 参数" }));
  await waitFor(() =>
    expect(api.call).toHaveBeenLastCalledWith(
      "ros_control",
      expect.objectContaining({
        transport: "mavlink",
        request: expect.objectContaining({
          path: "/api/pid/config",
          method: "POST",
          body: { Kp: 0.2 },
        }),
      }),
    ),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "配置与控制通信" }), {
    target: { value: "http" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "读取PID 参数" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "读取PID 参数" }));
  expect(api.call).toHaveBeenLastCalledWith(
    "ros_control",
    expect.objectContaining({ transport: "http" }),
  );
});
it("wraps offsets correctly and leaves stop enabled during an outstanding request", async () => {
  setup();
  await screen.findByText("手动模式已关闭");
  fireEvent.change(screen.getByRole("combobox", { name: "配置项目" }), {
    target: { value: "offsets" },
  });
  api.call.mockResolvedValueOnce({
    success: true,
    data: { X: 1, Y: 2, Z: 3, A: 4 },
  });
  fireEvent.click(screen.getByRole("button", { name: "读取相对零点" }));
  const offset = await screen.findByRole("spinbutton", { name: "A 轴（°）" });
  expect(offset).toHaveValue(4);
  fireEvent.change(offset, { target: { value: "4.5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存相对零点" }));
  expect(api.call).toHaveBeenLastCalledWith(
    "ros_control",
    expect.objectContaining({
      request: expect.objectContaining({
        path: "/api/calibration/offsets",
        body: { offsets: { X: 1, Y: 2, Z: 3, A: 4.5 } },
      }),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "刷新手动状态" })).toBeEnabled(),
  );
  api.call.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "刷新手动状态" }));
  expect(screen.getByRole("button", { name: "全泵停止" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "全泵停止" }));
  expect(api.call).toHaveBeenLastCalledWith(
    "ros_control",
    expect.objectContaining({
      request: expect.objectContaining({ path: "/api/manual/stop-all" }),
    }),
  );
});

it("edits preset steps and numbered waypoints in their original shape", async () => {
  setup();
  await screen.findByText("手动模式已关闭");
  const topic = screen.getByRole("combobox", { name: "配置项目" });
  const step = { A: { enable: "E", direction: "F", speed: "8", angle: "360" } };
  fireEvent.change(topic, { target: { value: "presets" } });
  fireEvent.change(screen.getByRole("textbox", { name: "预设名称" }), {
    target: { value: "sample" },
  });
  api.call.mockResolvedValueOnce({
    success: true,
    data: { loop_count: 2, steps: [step] },
  });
  fireEvent.click(screen.getByRole("button", { name: "读取采样预设" }));
  fireEvent.click(await screen.findByText("步骤 1", { selector: "summary" }));
  fireEvent.click(screen.getByText("A 轴", { selector: "summary" }));
  fireEvent.change(screen.getByRole("combobox", { name: "方向" }), {
    target: { value: "B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采样预设" }));
  expect(api.call).toHaveBeenLastCalledWith(
    "ros_control",
    expect.objectContaining({
      request: expect.objectContaining({
        path: "/api/preset/auto/sample",
        body: { loop_count: 2, steps: [{ A: { ...step.A, direction: "B" } }] },
      }),
    }),
  );

  await waitFor(() => expect(topic).toBeEnabled());
  fireEvent.change(topic, { target: { value: "waypoints" } });
  const waypoint = { enabled: true, loop_count: 1, on_fail: "LOITER" };
  api.call.mockResolvedValueOnce({ success: true, data: { "7": waypoint } });
  fireEvent.click(screen.getByRole("button", { name: "读取航点采样配置" }));
  fireEvent.click(await screen.findByText("航点 7", { selector: "summary" }));
  fireEvent.change(screen.getByRole("combobox", { name: "失败策略" }), {
    target: { value: "SKIP" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存航点采样配置" }));
  expect(api.call).toHaveBeenLastCalledWith(
    "ros_control",
    expect.objectContaining({
      request: expect.objectContaining({
        path: "/api/waypoint-sampling",
        body: { "7": { ...waypoint, on_fail: "SKIP" } },
      }),
    }),
  );
  await waitFor(() => expect(topic).toBeEnabled());
});

it("uses the mode reply for successive pump steps even when an older status read finishes later", async () => {
  let completeStatus!: (result: unknown) => void;
  const pendingStatus = new Promise((resolve) => {
    completeStatus = resolve;
  });
  api.call.mockImplementation(async (_cmd, { request }) => {
    if (request.path === "/api/manual/status") return pendingStatus;
    if (request.path === "/api/manual/mode")
      return {
        success: true,
        data: { enabled: true, automation_active: false },
      };
    return { success: true, data: { controller_reply: "CMD_OK" } };
  });

  setup();
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      "ros_control",
      expect.objectContaining({
        request: expect.objectContaining({ path: "/api/manual/status" }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "开启手动模式" }));
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  const runPump = screen.getByRole("button", { name: "运行泵" });
  await waitFor(() => expect(runPump).toBeEnabled());

  await act(async () =>
    completeStatus({
      success: true,
      data: { enabled: false, automation_active: false },
    }),
  );
  for (const axis of ["X", "Y"]) {
    expect(runPump).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "泵轴" }), {
      target: { value: axis },
    });
    fireEvent.click(runPump);
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    expect(
      await screen.findByText(`${axis} 轴指令已获控制板确认`, { exact: false }),
    ).toBeVisible();
  }
  expect(api.call.mock.calls.map(([, { request }]) => request.path)).toEqual([
    "/api/manual/status",
    "/api/manual/mode",
    "/api/manual/pump-step",
    "/api/manual/pump-step",
  ]);
});

it("discards the old status and an open pump confirmation when the radio session changes", async () => {
  api.call.mockResolvedValueOnce({
    success: true,
    data: { enabled: true, automation_active: false },
  });
  const { s, rerender } = setup();
  const runPump = screen.getByRole("button", { name: "运行泵" });
  await waitFor(() => expect(runPump).toBeEnabled());
  fireEvent.click(runPump);
  expect(screen.getByRole("dialog", { name: "确认设备操作" })).toBeVisible();

  s.telemetry.generation += 1;
  rerender();
  expect(screen.queryByRole("dialog", { name: "确认设备操作" })).toBeNull();
  expect(runPump).toBeDisabled();
  await screen.findByText("手动模式已关闭");
  expect(api.call.mock.calls.map(([, { request }]) => request.path)).toEqual([
    "/api/manual/status",
    "/api/manual/status",
  ]);
});

it("reads manual status again after the first read meets a restarted Jetson", async () => {
  api.call.mockRejectedValueOnce("Jetson 数传会话变化或请求已失效");
  setup();
  await screen.findByText("手动模式已关闭");
  expect(api.call.mock.calls.map(([, { request }]) => request.path)).toEqual([
    "/api/manual/status",
    "/api/manual/status",
  ]);
});
