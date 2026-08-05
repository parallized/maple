import { describe, expect, it } from "bun:test";
import { sessionSid } from "../src/lib/utils";

describe("sessionSid", () => {
  it("同一会话 ID 派生结果稳定一致", () => {
    const id = "019fbc4f-f220-7263-94d9-211448e8456e";
    expect(sessionSid(id)).toBe(sessionSid(id));
  });

  it("不同会话 ID 即使共享时间戳前缀也能区分", () => {
    const codex = "019fa945-6813-7881-85db-7f1906eb4304";
    const deepseekA = "019fbc4f-f220-7263-94d9-211448e8456e";
    const deepseekB = "019fcee3-81eb-7bf3-925b-8ba41bf484bb";
    // 旧实现取前 3 位，全部是 "019"，无法区分。
    expect(codex.slice(0, 3)).toBe(deepseekA.slice(0, 3));
    expect(deepseekA.slice(0, 3)).toBe(deepseekB.slice(0, 3));
    expect(new Set([sessionSid(codex), sessionSid(deepseekA), sessionSid(deepseekB)]).size).toBe(3);
  });

  it("支持 session_ 前缀的会话 ID", () => {
    const a = "session_ef93b091-37c2-41d1-85d5-aeefec2efb74";
    const b = "session_1985ce45-200f-40f6-8012-06b5c50f8757";
    expect(sessionSid(a)).toBe(sessionSid(a));
    expect(sessionSid(a)).not.toBe(sessionSid(b));
    expect(sessionSid(a)).toMatch(/^[0-9A-F]{6}$/);
  });

  it("输出为 6 位大写十六进制", () => {
    expect(sessionSid("019fbc4f-f220-7263-94d9-211448e8456e")).toMatch(/^[0-9A-F]{6}$/);
  });
});
