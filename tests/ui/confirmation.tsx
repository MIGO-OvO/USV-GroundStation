import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Confirm } from "../../src/ui";
import "../../src/styles.css";

function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <main>
      <h1>确认框交互测试</h1>
      {open && (
        <Confirm
          text="确认解锁无人船 1？请先确认推进器周围安全。"
          busy={false}
          onClose={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
