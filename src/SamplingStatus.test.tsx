import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { emptySnapshot } from "./backend";
import { PumpDetails, SamplingProgress } from "./SamplingStatus";
import { SignalChart } from "./PayloadWorkspace";

afterEach(() => {
  cleanup();
});
const snapshot = () => {
  const s = structuredClone(emptySnapshot);
  s.payload_online = true;
  for (const [key, value] of Object.entries({
    USV_STAT: 1,
    USV_STEP: 3,
    USV_STOT: 8,
    USV_LOOP: 2,
    USV_LTOT: 0,
    PUMP_X: 359.4,
    PUMP_Y: -1,
    USV_PERR: -0.2,
  })) {
    s.telemetry.fields[key] = {
      value,
      received_ms: 0,
      sequence: 1,
      source_component: 191,
    };
  }
  return s;
};
it("highlights only the reported stage and handles unlimited, paused and stale progress", () => {
  const s = snapshot();
  const view = render(<SamplingProgress s={s} />);
  expect(
    view.container.querySelector('[aria-current="step"]'),
  ).toHaveTextContent("采样");
  expect(screen.getByRole("progressbar", { name: "当前步骤" })).toHaveAttribute(
    "value",
    "3",
  );
  expect(
    screen.queryByRole("progressbar", { name: "当前循环" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("2 / 不限")).toBeInTheDocument();
  s.telemetry.fields.USV_STAT.value = 11;
  view.rerender(<SamplingProgress s={s} />);
  expect(screen.getByText("采样已暂停")).toBeInTheDocument();
  expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
  s.now_ms = 4000;
  view.rerender(<SamplingProgress s={s} />);
  expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  expect(screen.getByText("等待载荷状态")).toBeInTheDocument();
});
it("visualizes actual angles and labels automation as a snapshot without inventing axis PID results", () => {
  const props = {
    s: snapshot(),
    health: {
      data: {
        automation: { source_monotonic: 10, pending_motors: ["X"] },
        latest: { jetson: { cpu_percent: 27 }, detector: {} },
      },
    },
    manual: null,
    healthError: null,
    manualError: null,
  };
  const view = render(<PumpDetails {...props} />);
  view.container.querySelector("details")!.open = true;
  expect(screen.getByRole("img", { name: "泵 X：359.4°" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "泵 Y：未校准" })).toBeInTheDocument();
  expect(
    screen
      .getByRole("img", { name: "泵 Z：未更新" })
      .querySelector(".angle-pointer"),
  ).toBeNull();
  expect(screen.getByText("报告内待到位")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "Jetson CPU" })).toHaveAttribute(
    "value",
    "27",
  );
  expect(view.container.querySelector("pre")).toBeNull();
  expect(screen.getByText("自动化与控制快照")).toBeInTheDocument();
  view.rerender(
    <PumpDetails
      {...props}
      health={null}
      manual={null}
      healthError="读取设备状态失败"
    />,
  );
  expect(screen.getByText("读取设备状态失败")).toBeInTheDocument();
  expect(screen.queryByText("报告内待到位")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("meter")).toHaveLength(0);
});
it("retains signal gaps and the 120 second window", () => {
  const view = render(
    <SignalChart
      data={[
        { t: 0, value: 9 },
        { t: 10000, value: 1 },
        { t: 11000, value: 2 },
        { t: 130000, value: 3 },
      ]}
      label="电压"
      unit="V"
    />,
  );
  const path = view.container.querySelector(".chart-line")!.getAttribute("d")!;
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path.match(/L/g)).toHaveLength(1);
  expect(screen.getByRole("img")).toHaveAccessibleName(/共 3 个观测点/);
});
