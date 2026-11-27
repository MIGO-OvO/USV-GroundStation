import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Snapshot, RequestRecord } from "./types";
import { emptySnapshot } from "./backend";
import { PayloadControls } from "./PayloadWorkspace";
import { Timeline } from "./Diagnostics";
import { Reading } from "./ui";
import App from "./App";
import Settings from "./Settings";

const mock = vi.hoisted(() => ({
  snapshot: null as unknown as Snapshot,
  send: vi.fn().mockResolvedValue({}),
}));
vi.mock("./MapView", () => ({ default: () => <div aria-label="test map" /> }));
vi.mock("./backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend")>()),
  useStation: () => ({ snapshot: mock.snapshot, error: null, send: mock.send }),
}));
beforeEach(() => {
  mock.snapshot = structuredClone(emptySnapshot);
  mock.send.mockClear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("confirms MANUAL and dismisses ordinary feedback after five seconds", async () => {
  vi.useFakeTimers();
  mock.snapshot.link = "connected";
  mock.snapshot.telemetry.system_id = 1;
  mock.snapshot.navigation.manual = true;
  mock.snapshot.telemetry.fields.mode = {
    value: 4,
    received_ms: 0,
    sequence: 1,
    source_component: 1,
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  const { rerender } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "MANUAL 手动" }));
  expect(mock.send).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent("遥控器接管");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "确认执行" })),
  );
  expect(mock.send).toHaveBeenCalledExactlyOnceWith({
    type: "mode",
    mode: 0,
    confirmed: true,
  });
  const toast = screen.getByRole("status").closest(".toast") as HTMLElement;
  expect(within(toast).getByText("5 s")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2000));
  expect(within(toast).getByText("3 s")).toBeInTheDocument();
  mock.snapshot.telemetry.fields.mode.value = 0;
  rerender(<App />);
  expect(screen.getByRole("button", { name: "MANUAL 手动" })).toBeDisabled();
  act(() => vi.advanceTimersByTime(2999));
  expect(toast).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(toast).not.toBeInTheDocument();
});

it("restores saved serial settings after disconnect and navigation", () => {
  mock.snapshot.saved_connection = {
    config: { kind: "serial", port: "COM14", baud: 230400 },
    target_system: 7,
  };
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "连接与设置" }));
  expect(screen.getByRole("combobox", { name: "串口设备" })).toHaveValue(
    "COM14",
  );
  expect(screen.getByRole("combobox", { name: "波特率" })).toHaveValue(
    "230400",
  );
  expect(screen.getByRole("spinbutton", { name: "目标 sysid" })).toHaveValue(7);
  fireEvent.click(screen.getByRole("button", { name: "诊断" }));
  fireEvent.click(screen.getByRole("button", { name: "连接与设置" }));
  expect(screen.getByRole("combobox", { name: "串口设备" })).toHaveValue(
    "COM14",
  );
  expect(mock.send).not.toHaveBeenCalled();
});

it("hydrates a delayed backend profile and preserves subsequent form edits", () => {
  const props = {
    s: mock.snapshot,
    preferences: {
      rosUrl: "http://10.42.0.1:5000",
      mapStyle: "gsatellite",
      mapSource: "google" as const,
      offline: true,
      theme: "light" as const,
      mapEnabled: false,
    },
    setPreferences: vi.fn(),
    send: mock.send,
    notify: vi.fn(),
  };
  const view = render(<Settings {...props} />);
  const saved = {
    config: { kind: "tcp" as const, host: "10.42.0.1", port: 5762 },
    target_system: 1,
  };
  view.rerender(
    <Settings {...props} s={{ ...mock.snapshot, saved_connection: saved }} />,
  );
  expect(screen.getByRole("textbox", { name: "TCP 主机" })).toHaveValue(
    "10.42.0.1",
  );
  expect(screen.getByRole("spinbutton", { name: "端口" })).toHaveValue(5762);
  fireEvent.change(screen.getByRole("textbox", { name: "TCP 主机" }), {
    target: { value: "10.42.0.2" },
  });
  view.rerender(
    <Settings
      {...props}
      s={{ ...mock.snapshot, saved_connection: structuredClone(saved) }}
    />,
  );
  expect(screen.getByRole("textbox", { name: "TCP 主机" })).toHaveValue(
    "10.42.0.2",
  );
  expect(mock.send).not.toHaveBeenCalled();
});

it.each([
  [undefined, "http://10.42.0.1:5000"],
  ["http://127.0.0.1:5000", "http://10.42.0.1:5000"],
  ["http://192.168.2.10:5000", "http://192.168.2.10:5000"],
])("loads ROS Web preference %s as %s", (rosUrl, expected) => {
  localStorage.setItem("usv.preferences", JSON.stringify({ rosUrl }));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "连接与设置" }));
  expect(screen.getByPlaceholderText("http://10.42.0.1:5000")).toHaveValue(
    expected,
  );
});

it("migrates the old ROS-only map setting to automatic local Google maps", () => {
  localStorage.setItem(
    "usv.preferences",
    JSON.stringify({ mapEnabled: false, theme: "dark" }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "连接与设置" }));
  expect(screen.getByRole("checkbox", { name: "启用底图" })).toBeChecked();
  expect(screen.getByRole("combobox", { name: "地图来源" })).toHaveValue(
    "google",
  );
  expect(screen.getByRole("combobox", { name: "界面主题" })).toHaveValue(
    "dark",
  );
});

it("keeps physical controls disabled with no backend evidence", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: "解锁" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "急停" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "采样" }));
  expect(screen.getByRole("button", { name: "点采样" })).toBeDisabled();
  expect(mock.send).not.toHaveBeenCalled();
});
it("submits one point-sample intent without requiring GPS in the UI", () => {
  const s = structuredClone(emptySnapshot);
  s.telemetry.system_id = 1;
  s.actions.find((a) => a.command === 31010)!.allowed = true;
  const send = vi.fn();
  render(<PayloadControls s={s} send={send} />);
  fireEvent.click(screen.getByRole("button", { name: "点采样" }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toEqual({
    type: "payload",
    command: 31010,
    param1: 0,
    param2: 0,
    confirmed: true,
  });
});
it("requires confirmation before arm reaches Rust", () => {
  mock.snapshot.navigation.arm = true;
  mock.snapshot.telemetry.system_id = 1;
  mock.snapshot.telemetry.fields.armed = {
    value: 0,
    received_ms: 0,
    sequence: 1,
    source_component: 1,
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "解锁" }));
  expect(mock.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  expect(mock.send).toHaveBeenCalledExactlyOnceWith({
    type: "arm",
    armed: true,
    confirmed: true,
  });
});
it("shows unknown hardware sentinel separately from stale telemetry", () => {
  const s = structuredClone(emptySnapshot);
  s.telemetry.fields.USV_ETMP = {
    value: -1,
    received_ms: 0,
    sequence: 1,
    source_component: 191,
  };
  const view = render(<Reading s={s} name="USV_ETMP" />);
  expect(screen.getByText("未知")).toBeInTheDocument();
  s.now_ms = 4000;
  view.rerender(<Reading s={s} name="USV_ETMP" />);
  expect(screen.getByText("已过期")).toBeInTheDocument();
});
it("does not present standard ACK as correlated acceptance or execution", () => {
  const r: RequestRecord = {
    id: "r1",
    target_system: 1,
    sender_system: 254,
    sender_component: 190,
    session: 1,
    request: 1,
    command: 31010,
    params: [0, 0],
    created_unix_ms: 1000,
    clock_id: "clock-a",
    created_ms: 0,
    last_send_ms: 10,
    attempts: 1,
    retry_allowed: true,
    generation: 1,
    state: "sent",
    receipt: false,
    seq: 0,
    retired: false,
    observed_running: false,
    end_status_seq: null,
    stop_targets: [],
    cleanup_failed: false,
    event: null,
    timeline: [
      { at_ms: 0, clock_id: "clock-a", name: "created", detail: "created" },
      { at_ms: 10, clock_id: "clock-a", name: "sent", detail: "sent" },
    ],
  };
  render(
    <Timeline
      r={r}
      diagnostics={[
        {
          index: 1,
          unix_ms: 1100,
          mono_ms: 100,
          clock_id: "clock-a",
          kind: "ack_unattributed",
          direction: "rx",
          system: 1,
          component: 191,
          message_id: 77,
          mav_sequence: 3,
          command: null,
          request: null,
          session: null,
          detail: { candidate_requests: ["r1"] },
        },
      ]}
    />,
  );
  expect(
    screen.getByText("收到同命令 ACK，无法关联请求身份"),
  ).toBeInTheDocument();
  expect(screen.getAllByText("未确认")).toHaveLength(3);
});
