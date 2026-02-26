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
  const composing = useRef(false);
  const pendingSubmit = useRef(false);
  const pendingCancel = useRef(false);

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

  const submit = (raw?: string) => {
    const value = raw ?? inputRef.current?.value ?? title;
    const trimmed = value.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  const requestSubmit = () => {
    if (composing.current) {
      pendingSubmit.current = true;
      pendingCancel.current = false;
      queueMicrotask(() => inputRef.current?.blur());
      return;
    }
    submit();
  };

  const requestCancel = () => {
    if (composing.current) {
      pendingCancel.current = true;
      pendingSubmit.current = false;
      queueMicrotask(() => inputRef.current?.blur());
      return;
    }
    onCancel();
  };

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="新建任务">
      <div
        className="ui-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            requestCancel();
          }
        }}
      />
      <div className="ui-modal-panel">
        <div className="ui-modal-body">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-lg font-semibold">新建任务</h3>
              <p className="text-muted text-sm mt-1">将加入待办列表，并默认标记为 {nextVersionLabel}。</p>
            </div>
            <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn" onClick={requestCancel} aria-label="关闭">
              <Icon icon="mingcute:close-line" />
            </button>
          </div>

          <div className="mt-4">
            <input
              ref={inputRef}
              className="ui-input w-full"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={(event) => {
                composing.current = false;
                if (pendingCancel.current) {
                  pendingCancel.current = false;
                  pendingSubmit.current = false;
                  queueMicrotask(() => onCancel());
                  return;
                }
                if (!pendingSubmit.current) return;
                pendingSubmit.current = false;
                queueMicrotask(() => submit(event.currentTarget.value));
              }}
              placeholder="输入任务标题"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  const native = event.nativeEvent;
                  const imeComposing = composing.current || native.isComposing || native.keyCode === 229;
                  if (!imeComposing) {
                    event.preventDefault();
                  }
                  requestCancel();
                }
                if (event.key === "Enter") {
                  const native = event.nativeEvent;
                  const imeComposing = composing.current || native.isComposing || native.keyCode === 229;
                  if (imeComposing) return;
                  event.preventDefault();
                  requestSubmit();
                }
              }}
            />
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost" onClick={requestCancel}>
              取消
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--outline gap-1"
              onClick={requestSubmit}
            >
              <Icon icon="mingcute:add-line" />
              创建
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
