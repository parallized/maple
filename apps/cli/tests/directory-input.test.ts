import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  normalizeTerminalDirectoryInput,
  selectProjectDirectoryInTerminal,
  type TerminalDirectoryIo
} from "../src/project/directory-input";

function scriptedIo(answers: Array<string | null>): {
  io: TerminalDirectoryIo;
  prompts: string[];
  messages: string[];
} {
  const prompts: string[] = [];
  const messages: string[] = [];
  return {
    prompts,
    messages,
    io: {
      question: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? null;
      },
      write: (message) => messages.push(message)
    }
  };
}

describe("terminal project directory input", () => {
  it("validates the path and requires explicit folder confirmation", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-directory-input-"));
    const project = join(root, "project with spaces");
    const regularFile = join(root, "not-a-directory.txt");
    mkdirSync(project);
    writeFileSync(regularFile, "not a project directory", "utf8");
    try {
      const session = scriptedIo([
        join(root, "missing"),
        regularFile,
        `"${project}"`,
        "maybe",
        "n",
        project,
        "y"
      ]);

      const selected = await selectProjectDirectoryInTerminal(undefined, session.io);

      expect(selected).toBe(resolve(project));
      expect(session.messages.some((message) => message.startsWith("路径不可用："))).toBe(true);
      expect(session.messages.some((message) => message.includes("不是文件夹"))).toBe(true);
      expect(session.messages).toContain("请输入 y 或 n。");
      expect(session.messages.filter((message) => message.startsWith("已定位项目目录："))).toHaveLength(2);
      expect(session.prompts.filter((prompt) => prompt.includes("是否是这个文件夹"))).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expands home-relative paths and removes matching paste quotes", () => {
    expect(normalizeTerminalDirectoryInput("~/repo", "/work", "/home/maple")).toBe(resolve("/home/maple/repo"));
    expect(normalizeTerminalDirectoryInput("'/srv/repos/maple'", "/work", "/home/maple"))
      .toBe(resolve("/srv/repos/maple"));
  });

  it("returns cancellation without accepting an unconfirmed path", async () => {
    const session = scriptedIo([null]);
    expect(await selectProjectDirectoryInTerminal(undefined, session.io)).toBeNull();
  });
});
