import { useEffect, useRef, useState } from "react";

type TaskDetailsEditorProps = {
  value: string;
  onCommit: (nextValue: string) => void;
};

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function TaskDetailsEditor({ value, onCommit }: TaskDetailsEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  useEffect(() => {
    if (!editing) return;
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });
  }, [editing]);

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (!editing) return;
    resize();
  }, [draft, editing]);

  function commit(nextValue: string) {
    const normalizedNext = normalizeLineEndings(nextValue);
    const normalizedCurrent = normalizeLineEndings(value);
    if (normalizedNext === normalizedCurrent) return;
    onCommit(normalizedNext);
  }

  if (!editing) {
    const hasContent = value.trim().length > 0;
    return (
      <button
        type="button"
        className="task-details-surface"
        onClick={() => setEditing(true)}
        aria-label="编辑详情"
      >
        {hasContent ? (
          <div className="task-details-text">{value}</div>
        ) : (
          <span className="task-details-placeholder">添加详情…</span>
        )}
      </button>
    );
  }

  return (
    <div className="task-details-surface task-details-surface--editing">
      <textarea
        ref={textareaRef}
        className="task-details-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="添加详情…"
        aria-label="编辑详情"
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            textareaRef.current?.blur();
          }
        }}
        onBlur={() => {
          setEditing(false);
          commit(draft);
        }}
      />
    </div>
  );
}

