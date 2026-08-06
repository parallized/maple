/** Runner 备注名（本地存储）：用户自定义的简短显示名，避免展示过长的机器名。 */
const RUNNER_REMARKS_KEY = "maple.runnerRemarks";

export function loadRunnerRemarks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RUNNER_REMARKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) result[id] = value.trim();
    }
    return result;
  } catch {
    return {};
  }
}

/** 备注名变更事件：同页内通知侧栏等订阅方即时刷新（跨标签页走 storage 事件）。 */
export const RUNNER_REMARKS_CHANGED_EVENT = "maple:runner-remarks-changed";

export function saveRunnerRemark(runnerId: string, remark: string): void {
  try {
    const remarks = loadRunnerRemarks();
    const trimmed = remark.trim();
    if (trimmed) remarks[runnerId] = trimmed;
    else delete remarks[runnerId];
    localStorage.setItem(RUNNER_REMARKS_KEY, JSON.stringify(remarks));
    window.dispatchEvent(new Event(RUNNER_REMARKS_CHANGED_EVENT));
  } catch {
    // 忽略存储失败。
  }
}

/** 订阅备注名变更：同页事件 + 跨标签页 storage 事件，返回取消函数。 */
export function subscribeRunnerRemarks(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === RUNNER_REMARKS_KEY) listener();
  };
  window.addEventListener(RUNNER_REMARKS_CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RUNNER_REMARKS_CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
