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
  const ref = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue ?? "");
  const committed = useRef(false);
  const composing = useRef(false);

  useEffect(() => {
    queueMicrotask(() => ref.current?.focus());
  }, []);

  function commit() {
    if (committed.current) return;
    committed.current = true;
    onCommit(value);
  }

  return (
    <input
      ref={ref}
      className={["inline-task-input", className].filter(Boolean).join(" ")}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (e.nativeEvent.isComposing || composing.current) return;
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
      onBlur={commit}
    />
  );
}
