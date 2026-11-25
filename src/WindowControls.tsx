import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import type { Notify } from "./types";

export default function WindowControls({ notify }: { notify: Notify }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const refresh = async () => {
      setMaximized(await getCurrentWindow().isMaximized());
    };
    const onResize = () => void refresh().catch(() => {});
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  async function act(action: "minimize" | "toggleMaximize" | "close") {
    try {
      const appWindow = getCurrentWindow();
      await appWindow[action]();
      if (action === "toggleMaximize")
        setMaximized(await appWindow.isMaximized());
    } catch (error) {
      notify(String(error), true);
    }
  }

  const maximizeLabel = maximized ? "还原窗口" : "最大化窗口";
  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button
        type="button"
        aria-label="最小化窗口"
        title="最小化窗口"
        onClick={() => void act("minimize")}
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onClick={() => void act("toggleMaximize")}
      >
        {maximized ? <Copy size={14} /> : <Square size={14} />}
      </button>
      <button
        type="button"
        className="window-close"
        aria-label="关闭窗口"
        title="关闭窗口"
        onClick={() => void act("close")}
      >
        <X size={17} />
      </button>
    </div>
  );
}
