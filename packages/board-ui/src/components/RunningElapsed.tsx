import { useEffect, useState } from "react";

/** 运行时长格式化：<60s → "45s"；<60m → "3m05s"；其余 → "1h05m"。 */
export function formatElapsed(since: string, now: number = Date.now()): string {
  const start = Date.parse(since);
  const total = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** 进行中任务的实时运行时长：每秒刷新一次，以状态变更时间（updatedAt）为起点。 */
export function RunningElapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatElapsed(since, now)}</>;
}
