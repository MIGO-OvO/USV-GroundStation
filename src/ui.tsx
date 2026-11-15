import { useEffect, useId, useRef, useState } from "react";
import { recordingName } from "./recording";
import { AlertTriangle, X, Check, Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { Snapshot, RequestRecord } from "./types";
import { commands, field, number, requestLabel, time } from "./format";

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Circle size={25} strokeWidth={1.2} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Metric({
  label,
  value,
  unit,
  small,
}: {
  label: string;
  value: string;
  unit?: string;
  small?: boolean;
}) {
  return (
    <div className={`metric ${small ? "small" : ""}`}>
      <span>{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
    </div>
  );
}
export function Reading({
  s,
  name,
  digits = 1,
  unit = "",
}: {
  s: Snapshot;
  name: string;
  digits?: number;
  unit?: string;
}) {
  const value = field(s, name);
  const stale = !!s.telemetry.fields[name] && value === null;
  if (
    value !== null &&
    ["USV_VOLT", "USV_ABS"].includes(name) &&
    field(s, "USV_VLD") !== 1
  )
    return <span className="muted">无有效帧</span>;
  if (value !== null && name === "USV_ABS" && field(s, "USV_BSET") !== 1)
    return <span className="muted">未设基线</span>;
  if (
    value === -1 &&
    ["USV_JTMP", "USV_ETMP", "USV_JCPU", "USV_JMEM", "USV_EHEAP"].includes(name)
  )
    return <span className="muted">未知</span>;
  return (
    <span className={value === null ? "muted" : "reading"}>
      {stale ? "已过期" : number(value, digits, unit)}
    </span>
  );
}
export function Confirm({
  text,
  onConfirm,
  onClose,
  busy,
  nameLabel,
  initialName = "",
}: {
  text: string;
  onConfirm: (name?: string) => void;
  onClose: () => void;
  busy: boolean;
  nameLabel?: string;
  initialName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-operation-title"
      aria-describedby="confirm-operation-target"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="confirm-dialog"
    >
      <div className="dialog-title">
        <AlertTriangle size={23} />
        <h2 id="confirm-operation-title">确认设备操作</h2>
        <button aria-label="关闭确认" onClick={onClose} className="icon-button">
          <X size={20} />
        </button>
      </div>
      <p id="confirm-operation-target">{text}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          try {
            onConfirm(nameLabel ? recordingName(name) : undefined);
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        {nameLabel && (
          <label className="recording-name" htmlFor={id}>
            {nameLabel}
            <input
              id={id}
              autoFocus
              value={name}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
            />
          </label>
        )}
        {error && (
          <p id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
        <div className="button-row end">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || Boolean(nameLabel && !name.trim())}
          >
            {busy ? "提交中" : "确认执行"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function RequestSummary({
  record,
  onOpen,
}: {
  record?: RequestRecord;
  onOpen: (id: string) => void;
}) {
  if (!record) return <p className="muted compact">尚无载荷请求</p>;
  return (
    <button className="request-summary" onClick={() => onOpen(record.id)}>
      <span>
        {commands[record.command]}
        <small>
          {time(record.created_unix_ms)} · {record.session}/{record.request}
        </small>
      </span>
      <span className={`state ${record.state}`}>{requestLabel(record)}</span>
    </button>
  );
}
export function Evidence({
  confirmed,
  children,
}: {
  confirmed: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`evidence ${confirmed ? "confirmed" : ""}`}>
      {confirmed ? <Check size={16} /> : <Circle size={15} />}
      <span>{children}</span>
      <small>{confirmed ? "已确认" : "未确认"}</small>
    </div>
  );
}
