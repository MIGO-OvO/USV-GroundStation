import { Channel } from "@tauri-apps/api/core";
import { Cpu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { call } from "./backend";
import { serialLabel, type SerialDevice } from "./serial";

type FirmwareTarget = {
  session: number;
  device: SerialDevice;
  board: {
    board_id: number;
    board_revision: number;
    bootloader_revision: number;
    flash_size: number;
  };
};
type Release = { platform: string; version: string; url: string };

const phases = {
  downloading: "正在下载固件",
  checking: "正在检查固件和板卡",
  erasing: "正在擦除 Flash",
  writing: "正在写入固件",
  verifying: "正在校验 Flash",
  rebooting: "正在重启飞控",
};
type Progress = { phase: keyof typeof phases; percent: number | null };

export default function FirmwareDialog({
  ports,
  scanError,
  onClose,
}: {
  ports: SerialDevice[];
  scanError: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [port, setPort] = useState("");
  const [target, setTarget] = useState<FirmwareTarget | null>(null);
  const [work, setWork] = useState<"probe" | "catalog" | "flash" | null>(null);
  const [catalog, setCatalog] = useState<Release[] | null>(null);
  const [source, setSource] = useState<"local" | "rover">("local");
  const [release, setRelease] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const boards = ports.filter(
    (device) => device.kind === "flight_controller" && device.usb,
  );
  const selected = port
    ? boards.find((device) => device.port === port)
    : boards.length === 1
      ? boards[0]
      : undefined;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function close() {
    if (work === "flash") return;
    try {
      await call("firmware_cancel");
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }

  async function probe() {
    setError("");
    setWork("probe");
    try {
      setTarget(
        await call<FirmwareTarget>("firmware_probe", {
          target: selected ?? null,
        }),
      );
      setCatalog(null);
      setRelease("");
      setConfirmed(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setWork(null);
    }
  }

  async function loadCatalog() {
    if (!target) return;
    setSource("rover");
    setFile(null);
    setError("");
    if (catalog) return;
    setWork("catalog");
    try {
      const choices = await call<Release[]>("firmware_rover_releases", {
        id: target.session,
      });
      setCatalog(choices);
      setRelease(choices.length === 1 ? choices[0].url : "");
    } catch (e) {
      setError(String(e));
    } finally {
      setWork(null);
    }
  }

  async function flash() {
    const selectedFile = source === "local" ? file : null;
    const selectedRelease = source === "rover" ? release : "";
    if (!target || !confirmed || (!selectedFile && !selectedRelease)) return;
    const channel = new Channel<Progress>();
    channel.onmessage = setProgress;
    setError("");
    setWork("flash");
    setProgress({ phase: "checking", percent: null });
    try {
      const input = selectedFile
        ? { kind: "local", text: await selectedFile.text() }
        : { kind: "rover", url: selectedRelease };
      await call("firmware_flash", {
        id: target.session,
        source: input,
        confirmed,
        progress: channel,
      });
      setDone(true);
    } catch (e) {
      setError(String(e));
      await call("firmware_cancel").catch(() => {});
    } finally {
      setWork(null);
      setProgress(null);
      setTarget(null);
      setFile(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog firmware-dialog"
      aria-labelledby="firmware-title"
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <div className="dialog-title">
        <Cpu size={22} />
        <h2 id="firmware-title">飞控固件刷写</h2>
        <button
          className="icon-button"
          aria-label="关闭固件刷写"
          disabled={work === "flash"}
          onClick={() => void close()}
        >
          <X size={20} />
        </button>
      </div>
      {done ? (
        <p role="status">固件已写入并通过校验，已发送重启命令。</p>
      ) : target ? (
        <>
          <div className="firmware-target">
            <strong>{serialLabel(target.device)}</strong>
            <span>
              板卡 ID {target.board.board_id} · 引导程序 v
              {target.board.bootloader_revision} · 可写 Flash{" "}
              {Math.round(target.board.flash_size / 1024)} KiB
            </span>
            {target.device.usb?.serial_number && (
              <span>USB 序列号 {target.device.usb.serial_number}</span>
            )}
          </div>
          {work === "flash" && progress ? (
            <div className="firmware-progress" role="status">
              <span>
                {phases[progress.phase]}
                {progress.percent === null ? "" : ` · ${progress.percent}%`}
              </span>
              <progress
                aria-label="固件写入进度"
                max={100}
                value={progress.percent ?? undefined}
              />
              <span className="caption">请保持 USB 连接。</span>
            </div>
          ) : (
            <>
              <div className="segmented firmware-sources" aria-label="固件来源">
                <button
                  aria-pressed={source === "local"}
                  className={source === "local" ? "active" : ""}
                  disabled={Boolean(work)}
                  onClick={() => {
                    setSource("local");
                    setError("");
                  }}
                >
                  本地固件
                </button>
                <button
                  aria-pressed={source === "rover"}
                  className={source === "rover" ? "active" : ""}
                  disabled={Boolean(work)}
                  onClick={() => void loadCatalog()}
                >
                  官方 ArduRover
                </button>
              </div>
              {source === "local" ? (
                <label className="firmware-field">
                  固件文件（.apj 或 .px4）
                  <input
                    type="file"
                    accept=".apj,.px4"
                    onChange={(event) => {
                      const selectedFile = event.target.files?.[0] ?? null;
                      if (
                        selectedFile &&
                        selectedFile.size > 24 * 1024 * 1024
                      ) {
                        setError("固件文件超过 24 MiB。");
                        setFile(null);
                        event.target.value = "";
                      } else {
                        setError("");
                        setFile(selectedFile);
                      }
                    }}
                  />
                </label>
              ) : work === "catalog" ? (
                <p role="status">正在查询 ArduRover 稳定版…</p>
              ) : catalog?.length ? (
                <label className="firmware-field">
                  ArduRover 稳定版
                  <select
                    value={release}
                    onChange={(event) => setRelease(event.target.value)}
                  >
                    <option value="" disabled>
                      选择板卡固件
                    </option>
                    {catalog.map(({ platform, version, url }) => (
                      <option key={url} value={url}>
                        {platform} · {version}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                catalog && <p>官方目录中没有匹配的稳定版，可选择本地固件。</p>
              )}
              <label className="checkbox firmware-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                飞控已上锁，推进电源已断开
              </label>
            </>
          )}
        </>
      ) : (
        <>
          <p>
            断开电池和其他供电，只用 USB 连接飞控。开始识别后，在 20
            秒内插入或重新插入 USB。
          </p>
          <label className="firmware-field">
            飞控串口
            <select
              value={selected?.port ?? ""}
              disabled={work === "probe" || boards.length === 0}
              onChange={(event) => setPort(event.target.value)}
            >
              <option value="" disabled>
                {boards.length ? "选择飞控串口" : "等待飞控接入"}
              </option>
              {boards.map((device) => (
                <option key={device.port} value={device.port}>
                  {serialLabel(device)}
                </option>
              ))}
            </select>
          </label>
          {work === "probe" && <p role="status">正在等待引导程序…</p>}
        </>
      )}
      {(error || (!target && !done && scanError)) && (
        <p className="firmware-error" role="alert">
          {error || scanError}
        </p>
      )}
      <div className="button-row end">
        <button disabled={work === "flash"} onClick={() => void close()}>
          {done ? "完成" : "取消"}
        </button>
        {!target && !done && (
          <button
            className="primary"
            disabled={Boolean(
              work || scanError || (boards.length > 0 && !selected),
            )}
            onClick={() => void probe()}
          >
            识别引导程序
          </button>
        )}
        {target && work !== "flash" && (
          <button
            className="primary"
            disabled={
              Boolean(work) ||
              !confirmed ||
              (source === "local" ? !file : !release)
            }
            onClick={() => void flash()}
          >
            开始刷写
          </button>
        )}
      </div>
    </dialog>
  );
}
