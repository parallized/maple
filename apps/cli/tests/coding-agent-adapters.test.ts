import { describe, expect, it } from "bun:test";
import type { RunLogEntry, WorkerKind } from "@maple/protocol";
import { getCodingAgentAdapter } from "../src/execution/adapters/registry";
import { executeWorker } from "../src/execution/process-executor";
import { formatRunLogEntry } from "../src/execution/run-log";
import { createSecretRedactor } from "../src/execution/secret-redaction";
import { detectCodingAgentTools } from "../src/execution/tool-availability";
import { buildResolvedWorkerCommand, buildWorkerCommand } from "../src/execution/worker-command";

const PROMPT = "修复 \"quoted\" 行为\n并运行测试";

describe("Coding Agent commands", () => {
  it.each([
    ["codex", "codex", ["--ask-for-approval", "never", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--json", "-"], "stdin"],
    ["claude", "claude", ["--print", "--permission-mode", "auto", "--verbose", "--output-format", "stream-json", PROMPT], "argument"],
    ["kimi", "kimi", ["--prompt", PROMPT, "--output-format", "stream-json"], "argument"],
    ["gemini", "gemini", ["-p", PROMPT, "--output-format", "stream-json", "--approval-mode=yolo"], "argument"],
    ["opencode", "opencode", ["run", "--auto", "--format", "json", PROMPT], "argument"],
    ["glm", "opencode", ["run", "--auto", "--format", "json", "--model", "zai-coding-plan/glm-5.2", PROMPT], "argument"],
    ["iflow", "iflow", ["-p", PROMPT, "--yolo", "--stream", "--debug"], "argument"]
  ] as const)("builds an isolated %s adapter command", (kind, executable, args, promptInput) => {
    const command = buildWorkerCommand(kind, PROMPT, "direct", {});
    expect(command).toEqual({
      executable,
      args: [...args],
      ...(promptInput === "stdin" ? { stdin: PROMPT } : {})
    });
    expect([...command.args, command.stdin].filter((value) => value === PROMPT)).toHaveLength(1);
  });

  it("supports Kimi executable and model overrides in prompt mode", () => {
    const command = buildWorkerCommand("kimi", PROMPT, "direct", {
      MAPLE_KIMI_BIN: "kimi-code-custom",
      MAPLE_KIMI_MODEL: "kimi-for-coding"
    });
    expect(command).toEqual({
      executable: "kimi-code-custom",
      args: ["--model", "kimi-for-coding", "--prompt", PROMPT, "--output-format", "stream-json"]
    });
    expect(command.args).not.toContain("--auto");
    expect(command.args).not.toContain("--plan");
  });

  it("gives GLM its own model and executable override chain", () => {
    expect(buildWorkerCommand("glm", PROMPT, "direct", { MAPLE_OPENCODE_BIN: "shared-opencode" }).executable)
      .toBe("shared-opencode");

    const command = buildWorkerCommand("glm", PROMPT, "direct", {
      MAPLE_OPENCODE_BIN: "shared-opencode",
      MAPLE_GLM_BIN: "glm-host",
      MAPLE_GLM_MODEL: "zhipuai-coding-plan/glm-5.2"
    });
    expect(command.executable).toBe("glm-host");
    expect(command.args).toEqual([
      "run",
      "--auto",
      "--format",
      "json",
      "--model",
      "zhipuai-coding-plan/glm-5.2",
      PROMPT
    ]);
  });

  it("runs DeepSeek Flash through a dedicated Codex Provider without exposing the key in arguments", () => {
    const apiKey = "sk-deepseek-test-secret";
    const command = buildWorkerCommand("deepseek", PROMPT, "direct", {
      DEEPSEEK_API_KEY: apiKey,
      MAPLE_DEEPSEEK_MODEL_CATALOG: "C:/maple/providers/deepseek/models.json"
    });

    expect(command.executable).toBe("codex");
    expect(command.stdin).toBe(PROMPT);
    expect(command.env).toEqual({ DEEPSEEK_API_KEY: apiKey });
    expect(command.args).toContain("deepseek-v4-flash");
    expect(command.args).toContain('model_provider="maple_deepseek"');
    expect(command.args).toContain('model_providers.maple_deepseek.base_url="https://api.deepseek.com/"');
    expect(command.args).toContain('model_providers.maple_deepseek.env_key="DEEPSEEK_API_KEY"');
    expect(command.args).toContain('model_providers.maple_deepseek.wire_api="responses"');
    expect(command.args).toContain('model_catalog_json="C:/maple/providers/deepseek/models.json"');
    expect(command.args.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);
    expect(command.args).not.toContain("--ignore-user-config");
    expect(command.args.join(" ")).not.toContain(apiKey);
  });

  it("allows Maple to lower reasoning for lightweight manager turns", () => {
    const codex = buildWorkerCommand("codex", PROMPT, "direct", {}, { reasoningEffort: "low" });
    expect(codex.args).toContain('model_reasoning_effort="low"');

    const deepseek = buildWorkerCommand("deepseek", PROMPT, "direct", {}, { reasoningEffort: "low" });
    expect(deepseek.args).toContain('model_reasoning_effort="low"');
  });

  it("isolates a DeepSeek Leader from user-global and Maple MCP configuration", () => {
    const isolatedHome = "C:\\maple\\managers\\project-1\\deepseek-codex-home";
    const command = buildWorkerCommand("deepseek", PROMPT, "direct", {
      DEEPSEEK_API_KEY: "sk-deepseek-test-secret",
      MAPLE_MCP_COMMAND: "maple-mcp",
      MAPLE_MCP_ARGS: '["serve"]'
    }, {
      readOnly: true,
      disableMcp: true,
      isolatedHome
    });

    expect(command.env).toEqual({
      DEEPSEEK_API_KEY: "sk-deepseek-test-secret",
      CODEX_HOME: isolatedHome
    });
    expect(command.args.join(" ")).not.toContain("mcp_servers.maple");
    expect(command.args).toContain("read-only");

    const codex = buildWorkerCommand("codex", PROMPT, "direct", {
      MAPLE_MCP_COMMAND: "maple-mcp"
    }, { disableMcp: true });
    const claude = buildWorkerCommand("claude", PROMPT, "direct", {
      MAPLE_MCP_CONFIG: "C:\\maple\\mcp.json"
    }, { disableMcp: true });
    expect(codex.args.join(" ")).not.toContain("mcp_servers.maple");
    expect(claude.args).not.toContain("--mcp-config");
  });

  it.each([
    ["codex", "--add-dir"],
    ["deepseek", "--add-dir"],
    ["claude", "--add-dir"],
    ["kimi", "--add-dir"],
    ["gemini", "--include-directories"],
    ["iflow", "--include-directories"]
  ] as const)("allows %s to write only the Maple-managed artifact directory", (kind, flag) => {
    const artifactDirectory = "C:\\Users\\maple\\.maple\\artifacts\\attempt-1";
    const command = buildWorkerCommand(kind, PROMPT, "direct", {}, {
      additionalWritableDirectories: [artifactDirectory]
    });
    const flagIndex = command.args.indexOf(flag);
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(command.args[flagIndex + 1]).toBe(artifactDirectory);
  });

  it.each([
    ["codex", ["--ask-for-approval", "never", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--json", "resume", "session-1", "-"]],
    ["claude", ["--print", "--resume", "session-1", "--permission-mode", "auto", "--verbose", "--output-format", "stream-json", PROMPT]],
    ["kimi", ["--session", "session-1", "--prompt", PROMPT, "--output-format", "stream-json"]],
    ["gemini", ["--resume", "session-1", "-p", PROMPT, "--output-format", "stream-json", "--approval-mode=yolo"]],
    ["opencode", ["run", "--auto", "--format", "json", "--session", "session-1", PROMPT]],
    ["glm", ["run", "--auto", "--format", "json", "--model", "zai-coding-plan/glm-5.2", "--session", "session-1", PROMPT]],
    ["iflow", ["--resume", "session-1", "-p", PROMPT, "--yolo", "--stream", "--debug"]]
  ] as const)("resumes the exact persisted %s session", (kind, expectedArgs) => {
    const command = buildWorkerCommand(kind, PROMPT, "direct", {}, { resumeSessionId: "session-1" });
    expect(command.args).toEqual([...expectedArgs]);
    if (kind === "codex") expect(command.stdin).toBe(PROMPT);
  });

  it("resumes the exact DeepSeek Codex thread", () => {
    const command = buildWorkerCommand("deepseek", PROMPT, "direct", {}, { resumeSessionId: "deepseek-session" });
    expect(command.args.slice(-3)).toEqual(["resume", "deepseek-session", "-"]);
    expect(command.stdin).toBe(PROMPT);
  });

  it("detects installed tools from every adapter's actual executable", () => {
    const available = new Set(["codex-custom", "opencode"]);
    const tools = detectCodingAgentTools(
      { MAPLE_CODEX_BIN: "codex-custom" },
      (executable) => available.has(executable) ? executable : null
    );

    expect(tools.map(({ kind, label, executable, available: installed }) => ({
      kind,
      label,
      executable,
      installed
    }))).toEqual([
      { kind: "codex", label: "Codex", executable: "codex-custom", installed: true },
      { kind: "deepseek", label: "DeepSeek-Flash", executable: "codex-custom", installed: false },
      { kind: "claude", label: "Claude", executable: "claude", installed: false },
      { kind: "kimi", label: "Kimi", executable: "kimi", installed: false },
      { kind: "glm", label: "GLM", executable: "opencode", installed: true },
      { kind: "iflow", label: "iFlow", executable: "iflow", installed: false },
      { kind: "gemini", label: "Gemini", executable: "gemini", installed: false },
      { kind: "opencode", label: "OpenCode", executable: "opencode", installed: true }
    ]);
  });

  it("reports DeepSeek only when Codex and a DeepSeek credential are both available", () => {
    const resolver = (executable: string) => executable === "codex" ? "C:/tools/codex.cmd" : null;
    const disconnected = detectCodingAgentTools({}, resolver).find((tool) => tool.kind === "deepseek");
    const connected = detectCodingAgentTools({ DEEPSEEK_API_KEY: "sk-configured" }, resolver)
      .find((tool) => tool.kind === "deepseek");

    expect(disconnected).toMatchObject({ executable: "codex", available: false });
    expect(connected).toMatchObject({
      executable: "codex",
      available: true,
      modelId: "deepseek-v4-flash",
      modelName: "DeepSeek V4 Flash",
      reasoningEffort: "high"
    });
  });

  it.each([
    ["codex", "codex"],
    ["deepseek", "codex"],
    ["claude", "claude"],
    ["kimi", "kimi"],
    ["glm", "opencode"],
    ["iflow", "iflow"],
    ["gemini", "gemini"],
    ["opencode", "opencode"]
  ] as const)("resolves the %s adapter executable before launch", (kind, executable) => {
    const resolved = `C:\\tools\\${executable}.cmd`;
    const command = buildResolvedWorkerCommand(
      kind,
      PROMPT,
      "direct",
      {},
      (candidate) => candidate === executable ? resolved : null
    );

    expect(command.executable).toBe(resolved);
  });

  it("resolves both the agent and selected shell executable", () => {
    const executables = new Map([
      ["codex", "C:\\tools\\codex.cmd"],
      ["cmd", "C:\\Windows\\System32\\cmd.exe"]
    ]);
    const command = buildResolvedWorkerCommand(
      "codex",
      PROMPT,
      "cmd",
      {},
      (candidate) => executables.get(candidate) ?? null
    );

    expect(command.executable).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(command.args.at(-1)).toContain("C:\\tools\\codex.cmd");
  });
});

function parse(kind: WorkerKind, lines: string[]) {
  const parser = getCodingAgentAdapter(kind).createOutputParser();
  return lines.flatMap((line) => parser.push("stdout", `${line}\n`));
}

describe("Coding Agent structured output", () => {
  it.each([
    ["codex", { type: "thread.started", thread_id: "codex-session" }, "codex-session"],
    ["deepseek", { type: "thread.started", thread_id: "deepseek-session" }, "deepseek-session"],
    ["claude", { type: "system", subtype: "init", session_id: "claude-session" }, "claude-session"],
    ["kimi", { role: "meta", type: "session.resume_hint", session_id: "kimi-session" }, "kimi-session"],
    ["gemini", { type: "init", session_id: "gemini-session", model: "gemini" }, "gemini-session"],
    ["opencode", { type: "step_start", sessionID: "opencode-session", part: { id: "step-1" } }, "opencode-session"],
    ["glm", { type: "step_start", sessionID: "glm-session", part: { id: "step-1" } }, "glm-session"],
    ["iflow", { type: "assistant", sessionId: "iflow-session", content: "ok" }, "iflow-session"]
  ] as const)("captures the %s Provider session ID", (kind, payload, expectedSessionId) => {
    const parser = getCodingAgentAdapter(kind).createOutputParser();
    parser.push("stdout", `${JSON.stringify(payload)}\n`);
    expect(parser.sessionId()).toBe(expectedSessionId);
  });

  it("maps Codex lifecycle, assistant, command and file changes", () => {
    const events = parse("codex", [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({
        type: "item.started",
        item: { id: "command-1", type: "command_execution", command: "bun test", status: "in_progress" }
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "file-1", type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }] }
      }),
      JSON.stringify({ type: "item.completed", item: { id: "message-1", type: "agent_message", text: "完成" } })
    ]);
    expect(events.map((entry) => entry.kind)).toEqual(["lifecycle", "command", "file_change", "assistant"]);
    expect(events[1]).toMatchObject({ groupId: "command-1", status: "progress", title: "bun test" });
    expect(events[3]?.content).toBe("完成");
  });

  it("maps Claude text, thinking, tool calls, results and final status", () => {
    const events = parse("claude", [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "检查代码" },
            { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } },
            { type: "text", text: "测试完成" }
          ]
        }
      }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "41 pass" }] }
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "done" })
    ]);
    expect(events.map((entry) => entry.kind)).toEqual([
      "reasoning",
      "command",
      "assistant",
      "tool_result",
      "lifecycle"
    ]);
    expect(events[1]).toMatchObject({ groupId: "tool-1", status: "started" });
    expect(events[3]).toMatchObject({ groupId: "tool-1", status: "completed" });
  });

  it("maps Kimi assistant, tool and retry meta records", () => {
    const events = parse("kimi", [
      JSON.stringify({
        role: "assistant",
        content: "准备修改",
        tool_calls: [{ id: "call-1", function: { name: "write_file", arguments: { path: "a.ts" } } }]
      }),
      JSON.stringify({ role: "tool", tool_call_id: "call-1", content: "ok" }),
      JSON.stringify({ role: "meta", type: "turn.step.retrying", error_message: "rate limited" })
    ]);
    expect(events.map((entry) => entry.kind)).toEqual(["assistant", "file_change", "tool_result", "warning"]);
    expect(events[1]).toMatchObject({ groupId: "call-1", status: "started" });
    expect(events[2]).toMatchObject({ groupId: "call-1", status: "completed" });
    expect(events[3]).toMatchObject({ level: "warning", status: "progress" });
  });

  it("preserves provider tool failures as failed result events", () => {
    const kimi = parse("kimi", [
      JSON.stringify({ role: "tool", tool_call_id: "call-2", is_error: true, content: "permission denied" })
    ]);
    const opencode = parse("opencode", [
      JSON.stringify({ type: "tool_use", part: { id: "call-3", tool: "bash", state: { error: "exit 1" } } })
    ]);
    expect(kimi[0]).toMatchObject({ kind: "tool_result", level: "error", status: "failed" });
    expect(opencode[0]).toMatchObject({ kind: "command", level: "error", status: "failed" });
  });

  it("maps Gemini streaming messages, tools and completion", () => {
    const events = parse("gemini", [
      JSON.stringify({ type: "init", model: "gemini-2.5-pro" }),
      JSON.stringify({ type: "message", role: "assistant", content: "正在处理" }),
      JSON.stringify({ type: "tool_use", id: "tool-1", name: "run_command", parameters: { command: "bun test" } }),
      JSON.stringify({ type: "tool_result", id: "tool-1", status: "success", output: "ok" }),
      JSON.stringify({ type: "result", response: "完成" })
    ]);
    expect(events.map((entry) => entry.kind)).toEqual([
      "lifecycle",
      "assistant",
      "command",
      "tool_result",
      "assistant",
      "lifecycle"
    ]);
    expect(events[2]?.groupId).toBe("tool-1");
    expect(events[3]).toMatchObject({ groupId: "tool-1", status: "completed" });
  });

  it("captures token usage from Claude result and maps cache fields", () => {
    const parser = getCodingAgentAdapter("claude").createOutputParser();
    expect(parser.usage()).toBeNull();
    parser.push("stdout", `${JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      usage: {
        input_tokens: 1200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 800,
        output_tokens: 45
      }
    })}\n`);
    expect(parser.usage()).toMatchObject({
      inputTokens: 1500, // input(1200) + cache_creation(300)
      cachedInputTokens: 800,
      outputTokens: 45,
      reasoningOutputTokens: 0
    });
  });

  it("ignores Claude result without usage", () => {
    const parser = getCodingAgentAdapter("claude").createOutputParser();
    parser.push("stdout", `${JSON.stringify({ type: "result", subtype: "success", result: "done" })}\n`);
    expect(parser.usage()).toBeNull();
  });

  it("captures token usage from Gemini result usage_metadata", () => {
    const parser = getCodingAgentAdapter("gemini").createOutputParser();
    expect(parser.usage()).toBeNull();
    parser.push("stdout", `${JSON.stringify({
      type: "result",
      response: "完成",
      usage_metadata: {
        prompt_token_count: 2100,
        candidates_token_count: 88,
        cached_content_token_count: 1500,
        thoughts_token_count: 200
      }
    })}\n`);
    expect(parser.usage()).toMatchObject({
      inputTokens: 2100,
      cachedInputTokens: 1500,
      outputTokens: 88,
      reasoningOutputTokens: 200
    });
  });

  it("ignores Gemini result without usage_metadata", () => {
    const parser = getCodingAgentAdapter("gemini").createOutputParser();
    parser.push("stdout", `${JSON.stringify({ type: "result", response: "完成" })}\n`);
    expect(parser.usage()).toBeNull();
  });

  it.each(["opencode", "glm"] as const)("maps %s host text, reasoning, tool, steps and errors", (kind) => {
    const events = parse(kind, [
      JSON.stringify({ type: "step_start", part: { id: "step-1" } }),
      JSON.stringify({ type: "reasoning", part: { id: "reason-1", text: "分析" } }),
      JSON.stringify({ type: "tool_use", part: { id: "tool-1", tool: "bash", state: { status: "completed", output: "ok" } } }),
      JSON.stringify({ type: "text", part: { id: "text-1", text: "完成" } }),
      JSON.stringify({ type: "step_finish", part: { id: "step-1" } }),
      JSON.stringify({ type: "error", error: { message: "provider failed" } })
    ]);
    expect(events.map((entry) => entry.kind)).toEqual([
      "lifecycle",
      "reasoning",
      "command",
      "assistant",
      "lifecycle",
      "error"
    ]);
    expect(events[2]).toMatchObject({ groupId: "tool-1", status: "completed" });
  });

  it("keeps iFlow generic JSON and future unknown output instead of dropping it", () => {
    const parser = getCodingAgentAdapter("iflow").createOutputParser();
    const known = parser.push("stdout", `${JSON.stringify({ type: "assistant", content: "流式回复" })}\n`);
    const unknown = parser.push("stdout", `${JSON.stringify({ type: "future_event", payload: { value: 1 } })}\n`);
    const raw = parser.push("stderr", "unstructured diagnostic\n");
    expect(known[0]).toMatchObject({ kind: "assistant", content: "流式回复" });
    expect(unknown[0]).toMatchObject({ kind: "raw" });
    expect(unknown[0]?.content).toContain("future_event");
    expect(raw[0]).toMatchObject({ kind: "raw", level: "debug" });
  });

  it("decodes JSONL split across chunks and flushes the final line", () => {
    const parser = getCodingAgentAdapter("codex").createOutputParser();
    expect(parser.push("stdout", '{"type":"item.completed","item":{"id":"m1","type":"agent_')).toEqual([]);
    const completed = parser.push("stdout", 'message","text":"跨块完成"}}\n');
    expect(completed[0]).toMatchObject({ kind: "assistant", content: "跨块完成", groupId: "m1" });

    parser.push("stdout", '{"type":"turn.completed","usage":{"input_tokens":12}}');
    const flushed = parser.flush("stdout");
    expect(flushed[0]).toMatchObject({ kind: "lifecycle", status: "completed" });
  });

  it("captures token usage from Codex turn.completed and keeps the last one", () => {
    const parser = getCodingAgentAdapter("codex").createOutputParser();
    expect(parser.usage()).toBeNull();

    parser.push(
      "stdout",
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":3}}\n'
    );
    expect(parser.usage()).toMatchObject({
      inputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 5,
      reasoningOutputTokens: 3
    });

    // 多次 turn.completed 取最后一次
    parser.push(
      "stdout",
      '{"type":"turn.completed","usage":{"input_tokens":72148,"cached_input_tokens":47360,"output_tokens":2765,"reasoning_output_tokens":1542}}\n'
    );
    expect(parser.usage()).toMatchObject({ inputTokens: 24788, outputTokens: 2765 });

    // 无 usage 字段的完成事件不清空已记录的用量
    parser.push("stdout", '{"type":"turn.completed"}\n');
    expect(parser.usage()?.inputTokens).toBe(24788);
  });

  it("reports an all-cache-hit Codex turn through cachedInputTokens", () => {
    const parser = getCodingAgentAdapter("codex").createOutputParser();
    parser.push(
      "stdout",
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":100,"output_tokens":0,"reasoning_output_tokens":0}}\n'
    );
    expect(parser.usage()).toEqual({
      inputTokens: 0,
      cachedInputTokens: 100,
      outputTokens: 0,
      reasoningOutputTokens: 0
    });
  });
});

describe("run log text fallback", () => {
  const base: RunLogEntry = {
    sequence: 1,
    occurredAt: "2026-07-27T00:00:00.000Z",
    stream: "stdout",
    kind: "assistant",
    level: "info",
    content: "已完成"
  };

  it("keeps assistant content clean and labels operational records", () => {
    expect(formatRunLogEntry(base)).toBe("已完成");
    expect(formatRunLogEntry({ ...base, kind: "command", title: "bun test", content: "41 pass" }))
      .toBe("[命令 · bun test] 41 pass");
  });
});

describe("process execution lifecycle", () => {
  it("redacts full DeepSeek keys and Provider-masked key suffixes before persistence", () => {
    const redact = createSecretRedactor(["sk-maple-secret-heck"]);
    expect(redact("Bearer sk-maple-secret-heck")).toBe("Bearer [REDACTED]");
    expect(redact("Your api key: ****heck is invalid")).toBe("Your api key: [REDACTED] is invalid");
    expect(redact("unexpected sk-another-secret-value")).toBe("unexpected [REDACTED]");
  });

  it("does not launch an agent after cancellation and still emits ordered records", async () => {
    const controller = new AbortController();
    controller.abort();
    const entries: RunLogEntry[] = [];
    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: "do not run",
      signal: controller.signal,
      onLog: async (entry) => {
        entries.push(entry);
      }
    });
    expect(result).toMatchObject({ success: false, exitCode: null, error: "Maple CLI 已停止，Worker 未启动。" });
    expect(entries.map((entry) => entry.sequence)).toEqual([0, 1]);
    expect(entries.map((entry) => entry.kind)).toEqual(["lifecycle", "error"]);
    expect(entries.every((entry) => Number.isFinite(Date.parse(entry.occurredAt)))).toBe(true);
  });

  it("uses an explicit cancellation reason for a Leader PM run", async () => {
    const controller = new AbortController();
    controller.abort("Leader PM 执行超过 30 秒，已自动停止本次派单。");

    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: "route",
      signal: controller.signal,
      readOnly: true,
      onLog: async () => undefined
    });

    expect(result).toMatchObject({
      success: false,
      exitCode: null,
      error: "Leader PM 执行超过 30 秒，已自动停止本次派单。"
    });
  });

  it("injects a cloud DeepSeek key only into the child environment and redacts its output", async () => {
    const apiKey = "sk-cloud-runtime-secret";
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "deepseek-cloud-session" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "message-1", type: "agent_message", text: `received ${apiKey}` }
      }),
      JSON.stringify({ type: "turn.completed" })
    ].join("\n") + "\n";
    const entries: RunLogEntry[] = [];
    let childEnvironment: Record<string, string | undefined> | undefined;
    let launchedCommand: string[] = [];

    const result = await executeWorker({
      workerKind: "deepseek",
      cwd: import.meta.dir,
      prompt: "run through cloud provider",
      signal: new AbortController().signal,
      deepSeekApiKey: apiKey,
      spawnProcess: (command, options) => {
        launchedCommand = command;
        childEnvironment = options.env;
        return Bun.spawn([
          process.execPath,
          "-e",
          `process.stdout.write(${JSON.stringify(output)});`
        ], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: process.platform !== "win32"
        });
      },
      onLog: async (entry) => { entries.push(entry); }
    });

    expect(result.success).toBe(true);
    expect(childEnvironment?.DEEPSEEK_API_KEY).toBe(apiKey);
    expect(launchedCommand.join(" ")).not.toContain(apiKey);
    expect(JSON.stringify(entries)).not.toContain(apiKey);
    expect(JSON.stringify(entries)).toContain("[REDACTED]");
  });

  it("returns on the Leader terminal event without waiting for process exit", async () => {
    const decision = JSON.stringify({
      workflowId: null,
      workflowTitle: "Fast route",
      workflowSummary: "Route immediately.",
      workerKind: "codex",
      dispatchBrief: "Start the Worker."
    });
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "fast-leader-session" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "message-1", type: "agent_message", text: decision }
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 7157,
          cached_input_tokens: 6656,
          output_tokens: 254,
          reasoning_output_tokens: 162
        }
      })
    ].join("\n") + "\n";
    let subprocess: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
    const startedAt = performance.now();

    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: "route",
      signal: new AbortController().signal,
      readOnly: true,
      completeOnTerminalEvent: true,
      spawnProcess: () => {
        subprocess = Bun.spawn([
          process.execPath,
          "-e",
          `process.stdout.write(${JSON.stringify(output)}); setInterval(() => {}, 1000);`
        ], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: process.platform !== "win32"
        });
        return subprocess;
      },
      onLog: async () => undefined
    });
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1_000);
    expect(result).toMatchObject({
      success: true,
      exitCode: 0,
      summary: decision,
      sessionId: "fast-leader-session",
      usage: {
        inputTokens: 501,
        cachedInputTokens: 6656,
        outputTokens: 254,
        reasoningOutputTokens: 162
      }
    });
    expect(subprocess).not.toBeNull();
    const reaped = await Promise.race([
      subprocess!.exited.then(() => true),
      Bun.sleep(3_000).then(() => false)
    ]);
    if (subprocess!.exitCode === null) subprocess!.kill("SIGKILL");
    expect(reaped).toBe(true);
  });
});
