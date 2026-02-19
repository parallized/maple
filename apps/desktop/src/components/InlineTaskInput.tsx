import { useEffect, useRef, useState } from "react";

export function InlineTaskInput({ initialValue, onCommit }: { initialValue?: string; onCommit: (title: string) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue ?? "");
  const committed = useRef(false);

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
      className="inline-task-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="输入任务标题…"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committed.current = true;
          onCommit("");
        }
      }}
      onBlur={commit}
    />
  );
}
