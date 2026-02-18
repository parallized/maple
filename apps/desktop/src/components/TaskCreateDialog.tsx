import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";

type TaskCreateDialogProps = {
  open: boolean;
  nextVersionLabel: string;
  onCreate: (title: string) => void;
  onCancel: () => void;
};

export function TaskCreateDialog({ open, nextVersionLabel, onCreate, onCancel }: TaskCreateDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle("");
      return;
    }
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="modal">
        <h3>新建任务</h3>
        <p className="hint">将加入待办列表，并默认标记为 {nextVersionLabel}。</p>

        <div className="stack-input">
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="输入任务标题"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onCancel();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const trimmed = title.trim();
                if (!trimmed) {
                  return;
                }
                onCreate(trimmed);
              }
            }}
          />
        </div>

        <div className="row-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = title.trim();
              if (!trimmed) {
                return;
              }
              onCreate(trimmed);
            }}
          >
            <Icon icon="mingcute:add-line" />
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
