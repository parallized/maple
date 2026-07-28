import { describe, expect, it } from "bun:test";
import {
  extractKimiUsage,
  resolveWirePath
} from "../src/execution/adapters/kimi-wire-usage";

const SAMPLE = [
  `{"type":"config.update","profileName":"agent"}`,
  `{"type":"llm.tools_snapshot","hash":"abc","tools":[]}`,
  `{"type":"context.append_loop_event","event":{"type":"step.end","turnId":"0","step":1,"usage":{"inputOther":2226,"output":124,"inputCacheRead":19200,"inputCacheCreation":0},"finishReason":"end_turn"}}`,
  `{"type":"usage.record","model":"kimi-code/k3-256k","usage":{"inputOther":2226,"output":124,"inputCacheRead":19200,"inputCacheCreation":0},"usageScope":"turn","time":1785164389517}`
].join("\n");

describe("kimi-wire-usage", () => {
  describe("extractKimiUsage", () => {
    it("累加所有 usage.record 事件并按字段映射", () => {
      const readFile = () => SAMPLE;
      const usage = extractKimiUsage("ignored", { readFile });
      expect(usage).toEqual({
        inputTokens: 2226, // inputOther + inputCacheCreation(0)
        cachedInputTokens: 19200,
        outputTokens: 124,
        reasoningOutputTokens: 0
      });
    });

    it("多 turn 用量累加", () => {
      const readFile = () =>
        [
          `{"type":"usage.record","usage":{"inputOther":100,"output":50,"inputCacheRead":10,"inputCacheCreation":5},"usageScope":"turn"}`,
          `{"type":"usage.record","usage":{"inputOther":200,"output":80,"inputCacheRead":20,"inputCacheCreation":15},"usageScope":"turn"}`
        ].join("\n");
      const usage = extractKimiUsage("ignored", { readFile })!;
      expect(usage.inputTokens).toBe(320); // (100+5) + (200+15)
      expect(usage.cachedInputTokens).toBe(30);
      expect(usage.outputTokens).toBe(130);
    });

    it("inputCacheCreation 计入 inputTokens", () => {
      const readFile = () =>
        `{"type":"usage.record","usage":{"inputOther":0,"output":0,"inputCacheRead":0,"inputCacheCreation":500},"usageScope":"turn"}`;
      const usage = extractKimiUsage("ignored", { readFile })!;
      expect(usage.inputTokens).toBe(500);
      expect(usage.cachedInputTokens).toBe(0);
    });

    it("忽略 context.append_loop_event（去重，只认 usage.record）", () => {
      const readFile = () =>
        `{"type":"context.append_loop_event","event":{"type":"step.end","usage":{"inputOther":999,"output":1,"inputCacheRead":0,"inputCacheCreation":0}}}`;
      // 文件里只有 append_loop_event，没有 usage.record → 应返回 null
      expect(extractKimiUsage("ignored", { readFile })).toBeNull();
    });

    it("忽略非 turn scope 的 usage.record", () => {
      const readFile = () =>
        `{"type":"usage.record","usage":{"inputOther":999,"output":1,"inputCacheRead":0,"inputCacheCreation":0},"usageScope":"session"}`;
      expect(extractKimiUsage("ignored", { readFile })).toBeNull();
    });

    it("容忍损坏行与未知事件类型", () => {
      const readFile = () =>
        [
          `this is not json`,
          `{"type":"unknown.event","foo":"bar"}`,
          `{`, // 半截 JSON
          `{"type":"usage.record","usage":{"inputOther":10,"output":5,"inputCacheRead":2,"inputCacheCreation":1},"usageScope":"turn"}`
        ].join("\n");
      const usage = extractKimiUsage("ignored", { readFile })!;
      expect(usage.inputTokens).toBe(11);
      expect(usage.outputTokens).toBe(5);
    });

    it("全零用量返回 null", () => {
      const readFile = () =>
        `{"type":"usage.record","usage":{"inputOther":0,"output":0,"inputCacheRead":0,"inputCacheCreation":0},"usageScope":"turn"}`;
      expect(extractKimiUsage("ignored", { readFile })).toBeNull();
    });

    it("读文件失败返回 null 不抛", () => {
      const readFile = () => {
        throw new Error("ENOENT");
      };
      expect(extractKimiUsage("missing", { readFile })).toBeNull();
    });
  });

  describe("resolveWirePath", () => {
    const INDEX = [
      `{"sessionId":"session_aaa","sessionDir":"C:/Users/x/.kimi-code/sessions/wd_maple_abc/session_aaa","workDir":"E:/maple"}`,
      `{"sessionId":"session_bbb","sessionDir":"C:/Users/x/.kimi-code/sessions/wd_maple_abc/session_bbb","workDir":"E:/maple"}`
    ].join("\n");

    it("按 sessionId 解析出 wire.jsonl 路径", () => {
      // 注入 indexPath 与读取逻辑：通过自定义 indexPath + 桩 fs
      // 这里直接构造一个临时文件交给真实读取路径
      const tmp = import.meta.path + ".index.tmp";
      require("fs").writeFileSync(tmp, INDEX);
      try {
        const path = resolveWirePath("session_bbb", { homeDir: "unused", indexPath: tmp });
        expect(path).toBe("C:/Users/x/.kimi-code/sessions/wd_maple_abc/session_bbb/agents/main/wire.jsonl");
      } finally {
        require("fs").unlinkSync(tmp);
      }
    });

    it("未命中 sessionId 返回 null", () => {
      const tmp = import.meta.path + ".index.tmp2";
      require("fs").writeFileSync(tmp, INDEX);
      try {
        expect(resolveWirePath("session_missing", { homeDir: "unused", indexPath: tmp })).toBeNull();
      } finally {
        require("fs").unlinkSync(tmp);
      }
    });

    it("null sessionId 返回 null", () => {
      expect(resolveWirePath(null)).toBeNull();
    });

    it("index 文件不存在返回 null 不抛", () => {
      expect(
        resolveWirePath("session_aaa", { homeDir: "unused", indexPath: "/nonexistent/path/index.jsonl" })
      ).toBeNull();
    });

    it("容忍 index 中的损坏行", () => {
      const tmp = import.meta.path + ".index.tmp3";
      require("fs").writeFileSync(
        tmp,
        `garbage line\n{"sessionId":"session_aaa","sessionDir":"C:/x/session_aaa","workDir":"E:/m"}\n{broken`
      );
      try {
        expect(resolveWirePath("session_aaa", { homeDir: "unused", indexPath: tmp })).toBe(
          "C:/x/session_aaa/agents/main/wire.jsonl"
        );
      } finally {
        require("fs").unlinkSync(tmp);
      }
    });
  });
});
