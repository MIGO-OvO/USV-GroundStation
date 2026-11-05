import {
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
  api.call.mockReset();
  api.call.mockResolvedValue({ success: true, data: { Kp: 0.14 } });
});
afterEach(cleanup);
function setup() {
  const s = structuredClone(emptySnapshot);
  s.link = "connected";
  render(
    <RosControls
      s={s}
      baseUrl="http://unreachable.invalid:5000"
      notify={vi.fn()}
    />,
  );
}
it("reads and saves PID over radio while retaining the HTTP option", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "读取PID 参数" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "PID 参数 JSON" })).toHaveValue(
      JSON.stringify({ Kp: 0.14 }, null, 2),
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "PID 参数 JSON" }), {
    target: { value: '{"Kp":0.2}' },
  });
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
  fireEvent.change(screen.getByRole("combobox", { name: "配置项目" }), {
    target: { value: "offsets" },
  });
  api.call.mockResolvedValueOnce({
    success: true,
    data: { X: 1, Y: 2, Z: 3, A: 4 },
  });
  fireEvent.click(screen.getByRole("button", { name: "读取相对零点" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "相对零点 JSON" })).toHaveValue(
      JSON.stringify({ offsets: { X: 1, Y: 2, Z: 3, A: 4 } }, null, 2),
    ),
  );
  api.call.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "读取手动状态" }));
  expect(screen.getByRole("button", { name: "全泵停止" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "全泵停止" }));
  expect(api.call).toHaveBeenLastCalledWith(
    "ros_control",
    expect.objectContaining({
      request: expect.objectContaining({ path: "/api/manual/stop-all" }),
    }),
  );
});
