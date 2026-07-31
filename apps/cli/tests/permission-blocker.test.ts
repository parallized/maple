import { describe, expect, it } from "bun:test";
import { detectPermissionBlocker } from "../src/execution/permission-blocker";

describe("permission-blocked execution detection", () => {
  it("rejects a successful exit when tools were denied and the Worker says changes were not applied", () => {
    expect(detectPermissionBlocker({
      operationalOutput: "rejected: blocked by policy",
      assistantOutput: "由于本次会话沙箱为只读，所有文件写入与进程执行均被策略拦截，我无法实际落盘改动，只能给出补丁。"
    })).toBe("Worker 被只读沙箱或权限策略拦截，未能把任务改动写入当前项目。");
  });

  it("does not trust the assistant text itself as evidence of a tool denial", () => {
    expect(detectPermissionBlocker({
      operationalOutput: "",
      assistantOutput: "由于本次会话沙箱为只读，我无法实际落盘改动，只能给出补丁。"
    })).toBeNull();
  });

  it("does not reject a task that recovered after an intermediate denial", () => {
    expect(detectPermissionBlocker({
      operationalOutput: "rejected: blocked by policy",
      assistantOutput: "最初无法写入，但随后已写入并修改完成。"
    })).toBeNull();
  });
});
