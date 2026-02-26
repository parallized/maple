import { useEffect, useRef, useState } from "react";

type InlineTaskInputProps = {
  initialValue?: string;
  onCommit: (title: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
};

export function InlineTaskInput({
  initialValue,
  onCommit,
  onCancel,
  placeholder = "输入任务标题…",
  className,
  ariaLabel,
  autoFocus = false
}: InlineTaskInputProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(initialValue ?? "");
  const committed = useRef(false);
  const composing = useRef(false);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    const handle = requestAnimationFrame(() => {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => cancelAnimationFrame(handle);
  }, [autoFocus]);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [initialValue]);

  const handleInput = () => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  };

  function commit() {
    if (committed.current) return;
    const liveValue = ref.current?.value ?? value;
    const trimmed = liveValue.trim();
    committed.current = true;
    onCommit(trimmed);
  }

  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
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
          const native = e.nativeEvent;
          const imeComposing = composing.current || native.isComposing || native.keyCode === 229;
          if (imeComposing) return;
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
