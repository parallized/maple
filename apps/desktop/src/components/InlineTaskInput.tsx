import { useEffect, useRef, useState } from "react";

type InlineTaskInputProps = {
  initialValue?: string;
  onCommit: (title: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

export function InlineTaskInput({
  initialValue,
  onCommit,
  onCancel,
  placeholder = "输入任务标题…",
  className,
  ariaLabel
}: InlineTaskInputProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(initialValue ?? "");
  const committed = useRef(false);
  const composing = useRef(false);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
      ref.current.focus();
    }
  }, []);

  const handleInput = () => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  };

  function commit() {
    if (committed.current) return;
    const trimmed = value.trim();
    committed.current = true;
    onCommit(trimmed);
  }

  return (
    <textarea
      ref={ref}
      className={["inline-task-input", className].filter(Boolean).join(" ")}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        handleInput();
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const native = e.nativeEvent;
          const imeComposing = composing.current || native.isComposing || native.keyCode === 229;
          if (imeComposing) return;
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committed.current = true;
          if (onCancel) onCancel();
          else onCommit("");
        }
      }}
      onBlur={() => {
        if (composing.current) return;
        commit();
      }}
      style={{ overflow: 'hidden', resize: 'none', display: 'block' }}
    />
  );
}
