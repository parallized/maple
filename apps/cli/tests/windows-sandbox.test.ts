import { describe, expect, it } from "bun:test";
import { getCodingAgentAdapter } from "../src/execution/adapters/registry";
import {
  CODEX_SANDBOX_GROUP,
  describeWindowsSandboxFailure,
  hasExplicitInheritableModifyAce,
  prepareCodexWindowsSandbox,
  type IcaclsResult,
  type WindowsSandboxTools
} from "../src/execution/windows-sandbox";

const EXPLICIT_MODIFY_ACL = [
  "E:\\repo S-1-5-21-1-2-3:(OI)(CI)(M)",
  "                 holybread\\CodexSandboxUsers:(OI)(CI)(M)",
  "                 BUILTIN\\Administrators:(I)(F)"
].join("\r\n");

function fakeTools(overrides: {
  isWindows?: boolean;
  rootAcl?: string;
  grantResult?: IcaclsResult;
  subdirectories?: string[];
  currentUser?: string;
}): { tools: WindowsSandboxTools; grants: Array<[string, string]> } {
  const grants: Array<[string, string]> = [];
  const tools: WindowsSandboxTools = {
    isWindows: overrides.isWindows ?? true,
    listImmediateSubdirectories: () => overrides.subdirectories ?? [],
    readAcl: async () => ({ ok: true, stdout: overrides.rootAcl ?? "", stderr: "" }),
    grantModify: async (dir, principal) => {
      grants.push([dir, principal]);
      return overrides.grantResult ?? { ok: true, stdout: "processed file: ok", stderr: "" };
    },
    currentUserPrincipal: () => overrides.currentUser ?? "DOMAIN\\user"
  };
  return { tools, grants };
}

describe("Windows sandbox ACL detection", () => {
  it("accepts an explicit inheritable Modify ACE for the sandbox group", () => {
    expect(hasExplicitInheritableModifyAce(EXPLICIT_MODIFY_ACL, "holybread\\CodexSandboxUsers")).toBe(true);
  });

  it("rejects an inherited-only ACE", () => {
    const inherited = "E:\\repo holybread\\CodexSandboxUsers:(I)(OI)(CI)(M)";
    expect(hasExplicitInheritableModifyAce(inherited, CODEX_SANDBOX_GROUP)).toBe(false);
  });

  it("rejects read-only or unrelated ACEs", () => {
    expect(hasExplicitInheritableModifyAce("E:\\repo holybread\\CodexSandboxUsers:(I)(RX)", CODEX_SANDBOX_GROUP)).toBe(false);
    expect(hasExplicitInheritableModifyAce("E:\\repo NT AUTHORITY\\SYSTEM:(I)(F)", CODEX_SANDBOX_GROUP)).toBe(false);
  });
});

describe("Windows sandbox failure diagnosis", () => {
  it.each([
    "helper_unknown_error: setup refresh had errors",
    "windows sandbox: setup refresh failed with status exit code: 1",
    "windows sandbox: setup failed, refresh had errors"
  ])("translates a known setup refresh failure into actionable guidance: %s", (output) => {
    const message = describeWindowsSandboxFailure(output);
    expect(message).not.toBeNull();
    expect(message).toContain("Codex Windows 沙箱");
    expect(message).toContain("icacls");
  });

  it("translates an elevation (OS error 740) failure", () => {
    const message = describeWindowsSandboxFailure(
      "codex-windows-sandbox-setup.exe failed to spawn with OS error 740 (requires elevation)"
    );
    expect(message).not.toBeNull();
    expect(message).toContain("管理员");
  });

  it("ignores normal or unrelated output", () => {
    expect(describeWindowsSandboxFailure(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } })))
      .toBeNull();
    expect(describeWindowsSandboxFailure("bun test passed")).toBeNull();
    expect(describeWindowsSandboxFailure("exec: codex: executable file not found")).toBeNull();
  });
});

describe("Codex Windows sandbox pre-flight", () => {
  it("is a no-op off Windows", async () => {
    const { tools } = fakeTools({ isWindows: false });
    expect(await prepareCodexWindowsSandbox("E:\\repo", {}, tools)).toEqual({});
  });

  it("is a no-op for read-only sandbox runs", async () => {
    const { tools } = fakeTools({ rootAcl: "" });
    expect(await prepareCodexWindowsSandbox("E:\\repo", { readOnly: true }, tools)).toEqual({});
  });

  it("skips grants when the workspace root already has an explicit Modify ACE", async () => {
    const { tools, grants } = fakeTools({ rootAcl: EXPLICIT_MODIFY_ACL });
    expect(await prepareCodexWindowsSandbox("E:\\repo", {}, tools)).toEqual({});
    expect(grants).toEqual([]);
  });

  it("repairs the workspace root, writable dirs and immediate subdirectories", async () => {
    const { tools, grants } = fakeTools({
      subdirectories: ["E:\\repo\\apps", "E:\\repo\\docs"]
    });
    const result = await prepareCodexWindowsSandbox(
      "E:\\repo",
      { additionalWritableDirectories: ["E:\\tmp\\artifacts"] },
      tools
    );
    expect(result.warning).toBeUndefined();
    expect(result.note).toContain("已为 Codex Windows 沙箱补齐");
    expect(grants).toEqual([
      ["E:\\repo", CODEX_SANDBOX_GROUP],
      ["E:\\tmp\\artifacts", CODEX_SANDBOX_GROUP],
      ["E:\\repo\\apps", CODEX_SANDBOX_GROUP],
      ["E:\\repo\\docs", CODEX_SANDBOX_GROUP]
    ]);
  });

  it("falls back to the current user when the sandbox group does not exist", async () => {
    const grants: Array<[string, string]> = [];
    const tools: WindowsSandboxTools = {
      isWindows: true,
      listImmediateSubdirectories: () => [],
      readAcl: async () => ({ ok: true, stdout: "", stderr: "" }),
      grantModify: async (dir, principal) => {
        grants.push([dir, principal]);
        const ok = principal === "DOMAIN\\dev";
        return {
          ok,
          stdout: "",
          stderr: ok ? "" : "no mapping between account names and security IDs was done."
        };
      },
      currentUserPrincipal: () => "DOMAIN\\dev"
    };
    const result = await prepareCodexWindowsSandbox("E:\\repo", {}, tools);
    expect(result.note).toContain("已为 Codex Windows 沙箱补齐");
    const groupGrants = grants.filter(([, principal]) => principal === CODEX_SANDBOX_GROUP);
    const userGrants = grants.filter(([, principal]) => principal === "DOMAIN\\dev");
    expect(groupGrants.length).toBe(1);
    expect(userGrants.length).toBe(1);
  });

  it("warns with admin guidance when the grant is denied", async () => {
    const { tools } = fakeTools({
      grantResult: { ok: false, stdout: "", stderr: "Access is denied." }
    });
    const result = await prepareCodexWindowsSandbox("E:\\repo", {}, tools);
    expect(result.warning).toBe(true);
    expect(result.note).toContain("管理员");
    expect(result.note).toContain("icacls");
  });
});

describe("Codex adapter Windows sandbox wiring", () => {
  it.each(["codex", "deepseek"] as const)("exposes a prepareRun pre-flight on %s", (kind) => {
    expect(typeof getCodingAgentAdapter(kind).prepareRun).toBe("function");
  });

  it("keeps unrelated adapters free of Windows sandbox pre-flight", () => {
    expect(getCodingAgentAdapter("claude").prepareRun).toBeUndefined();
    expect(getCodingAgentAdapter("kimi").prepareRun).toBeUndefined();
  });
});
