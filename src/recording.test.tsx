import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptySnapshot } from "./backend";
import type { Intent, Snapshot } from "./types";
import { prepareRecording, recordingName } from "./recording";
import { parseMission } from "./format";
import { setRosTransport } from "./rosAccess";
import App from "./App";

const mock = vi.hoisted(() => ({
  snapshot: null as unknown as Snapshot,
  send: vi.fn(),
  call: vi.fn(),
}));
vi.mock("./MapView", () => ({ default: () => <div aria-label="test map" /> }));
vi.mock("./backend", async (original) => ({
  ...(await original<typeof import("./backend")>()),
  call: mock.call,
  useStation: () => ({ snapshot: mock.snapshot, error: null, send: mock.send }),
}));
beforeEach(() => {
  localStorage.clear();
  mock.snapshot = structuredClone(emptySnapshot);
  mock.snapshot.link = "connected";
  mock.snapshot.telemetry.system_id = 1;
  mock.snapshot.actions.forEach((action) => {
    action.allowed = true;
  });
  mock.snapshot.navigation.auto = true;
  mock.snapshot.navigation.upload = true;
  mock.send.mockReset().mockResolvedValue({});
  mock.call
    .mockReset()
    .mockResolvedValue({ success: true, data: { token: 123456 } });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

const start: Intent = {
  type: "payload",
  command: 31010,
  param1: 0,
  param2: 0,
  confirmed: true,
};
function enterSampleName() {
  fireEvent.click(screen.getByRole("button", { name: "点采样" }));
  fireEvent.change(screen.getByRole("textbox", { name: "采样名称" }), {
    target: { value: "湖心" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
}

it("asks for a name, allows cancellation, and sends nothing for a blank name", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "点采样" }));
  expect(screen.getByRole("button", { name: "确认执行" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(mock.call).not.toHaveBeenCalled();
  expect(mock.send).not.toHaveBeenCalled();
});

it("prepares the name over the selected radio link before sending the original physical command", async () => {
  setRosTransport("mavlink");
  render(<App />);
  enterSampleName();
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledExactlyOnceWith({
      ...start,
      param1: 123456,
    }),
  );
  expect(mock.call).toHaveBeenCalledExactlyOnceWith(
    "ros_control",
    expect.objectContaining({
      baseUrl: "http://10.42.0.1:5000",
      transport: "mavlink",
      request: expect.objectContaining({
        path: "/api/recording/name",
        body: { name: "湖心" },
      }),
    }),
  );
});

it("keeps START unsent after name preparation fails", async () => {
  mock.call.mockRejectedValue(new Error("名称保存失败"));
  render(<App />);
  enterSampleName();
  await screen.findByText("Error: 名称保存失败");
  expect(mock.send).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});

it.each(["cancel", "disconnect", "stop"])(
  "cancels pending START on %s without replaying it when the name response arrives",
  async (reason) => {
    let complete!: (value: unknown) => void;
    mock.call.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<App />);
    enterSampleName();
    expect(mock.call).toHaveBeenCalledTimes(1);
    if (reason === "disconnect") {
      mock.snapshot = { ...mock.snapshot, link: "disconnected" };
      view.rerender(<App />);
    } else if (reason === "cancel") {
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "急停" }));
      fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
      await waitFor(() =>
        expect(mock.send).toHaveBeenCalledWith({
          type: "emergency_stop",
          confirmed: true,
        }),
      );
    }
    await act(async () => {
      complete({ success: true, data: { token: 123456 } });
    });
    expect(
      mock.send.mock.calls.some(
        ([intent]) => intent.type === "payload" && intent.command === 31010,
      ),
    ).toBe(false);
  },
);

it("saves the task name for both upload and AUTO without changing their physical intent", async () => {
  const draft = { version: 1 as const, waypoints: [], name: "环湖任务" };
  const upload: Intent = { type: "upload_mission", draft, confirmed: true };
  expect(
    await prepareRecording(upload, "环湖任务", "http://boat:5000"),
  ).toEqual(upload);
  const auto: Intent = { type: "mode", mode: 10, confirmed: true };
  expect(await prepareRecording(auto, "环湖任务", "http://boat:5000")).toEqual(
    auto,
  );
  expect(
    mock.call.mock.calls.every(
      ([, args]) => args.request.path === "/api/recording/mission",
    ),
  ).toBe(true);
  expect(parseMission(JSON.stringify(draft))).toEqual(draft);
});

it("checks filename portability and rejects unusable name tokens", async () => {
  expect(recordingName(" 湖心 ")).toBe("湖心");
  for (const name of [
    "../x",
    "x/y",
    "x\\y",
    "x\nY",
    "x?",
    "x.",
    "x".repeat(81),
    "湖".repeat(61),
    "😀".repeat(46),
  ])
    expect(() => recordingName(name)).toThrow();
  for (const token of [0, -1, 0.5, 2 ** 24, "123", null]) {
    mock.call.mockResolvedValueOnce({ success: true, data: { token } });
    await expect(
      prepareRecording(start, "湖心", "http://boat:5000"),
    ).rejects.toThrow("标识无效");
  }
});
