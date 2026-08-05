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

export function saveRunnerRemark(runnerId: string, remark: string): void {
  try {
    const remarks = loadRunnerRemarks();
    const trimmed = remark.trim();
    if (trimmed) remarks[runnerId] = trimmed;
    else delete remarks[runnerId];
    localStorage.setItem(RUNNER_REMARKS_KEY, JSON.stringify(remarks));
  } catch {
    // 忽略存储失败。
  }
}
