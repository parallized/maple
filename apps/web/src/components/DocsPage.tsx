import { applyUiFont } from "@maple/board-ui";
import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";

/**
 * Maple Code 使用文档页（/docs）。
 * 极简布局：左侧分组树，右侧文章内容；与官网同一套视觉语言。
 */

const MORANDI_PURPLE = "#a08fb8";
const MORANDI_SAGE = "#9aae9a";

/* ── 文档内容模型 ── */

type DocBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "tip"; text: string };

type DocArticle = { id: string; title: string; blocks: DocBlock[] };
type DocGroup = { name: string; items: DocArticle[] };

const DOC_GROUPS: DocGroup[] = [
  {
    name: "开始使用",
    items: [
      {
        id: "install",
        title: "安装与接入",
        blocks: [
          { type: "p", text: "Maple 由 Server 与 Runner 组成：Server 提供看板与调度，Runner 在你的主机上真正执行任务。一条命令即可完成安装。" },
          { type: "code", lang: "macOS / Linux", text: "curl -fsSL https://maple.parallized.cn/install.sh | sh" },
          { type: "code", lang: "Windows (PowerShell)", text: "irm https://maple.parallized.cn/install.ps1 | iex" },
          { type: "p", text: "安装完成后启动 CLI，主菜单会引导你完成后续配置。Runner 的执行环境（Node、Bun、各 Coding Agent CLI）由安装脚本自动检测并提示。" }
        ]
      },
      {
        id: "pairing",
        title: "配对 Runner",
        blocks: [
          { type: "p", text: "Runner 通过一次性配对码绑定到工作区，整个过程只需要在浏览器里确认一次。" },
          { type: "list", items: [
            "在 CLI 主菜单选择「配对执行端」，会得到一个短配对码",
            "浏览器打开确认页（已登录时会直接跳转），核对主机名后确认",
            "CLI 自动完成绑定并进入待命状态，无需重复配对"
          ] },
          { type: "tip", text: "配对凭证保存在本机 ~/.maple/cli.json，重装系统前无需解绑，重新配对会覆盖旧记录。" }
        ]
      },
      {
        id: "first-task",
        title: "派发第一个任务",
        blocks: [
          { type: "p", text: "绑定项目目录后，看板上的任务才会派发到对应主机。从绑定到完成，通常只要三步。" },
          { type: "list", items: [
            "在 CLI「项目管理」里添加本机目录，或在看板侧栏绑定项目",
            "在看板上新建任务，写清楚目标与验收标准，选择执行它的 Worker",
            "任务完成后会收到提醒，报告与验收截图自动归档"
          ] },
          { type: "tip", text: "任务描述越像「验收单」效果越好：要改什么、怎么算完成、需要跑哪些检查。" }
        ]
      }
    ]
  },
  {
    name: "日常使用",
    items: [
      {
        id: "board",
        title: "看板与任务列表",
        blocks: [
          { type: "p", text: "任务在看板上按状态流转：待办、进行中、待验收、已完成。拖拽卡片即可调整状态与顺序。" },
          { type: "p", text: "习惯列表的话，可以在「设置 → 详情展示」里切换展示类型：自优化列表保持信息密度，任务画廊把验收截图铺成卡片墙。" }
        ]
      },
      {
        id: "workers",
        title: "Worker 与模型",
        blocks: [
          { type: "p", text: "每个 Worker 是一种 Coding Agent（Claude Code、Codex、Kimi 等），由你主机上的 Runner 启动。跑哪个模型、开多少并发，都由你自己决定。" },
          { type: "list", items: [
            "按项目绑定执行端：不同项目可以跑在不同主机上",
            "按任务选择 Worker：前端、后端、测试各配各的模型",
            "会话上下文完整保留，不为窗口切换多花 token"
          ] }
        ]
      },
      {
        id: "review",
        title: "验收与截图回传",
        blocks: [
          { type: "p", text: "任务跑完不是终点。Worker 会附上执行报告，Web 任务还会自动用 Playwright 截图回写——改动到底长什么样，证据摆在那里。" },
          { type: "p", text: "截图与报告归档在任务详情里，随时可以回看。确认无误后把卡片拖进「已完成」，一次闭环结束。" }
        ]
      }
    ]
  },
  {
    name: "进阶",
    items: [
      {
        id: "cli",
        title: "CLI 交互终端",
        blocks: [
          { type: "p", text: "CLI 是 Runner 的控制中心：配对、项目绑定、领取任务、查看 Worker 运行记录都在里面完成。" },
          { type: "code", lang: "源码运行", text: "bun apps/cli/src/index.ts" },
          { type: "p", text: "连接并运行后，CLI 会进入全屏工作台：顶部是 Worker 页签，中间是实时运行记录，底部是连接状态与缓存占用。" }
        ]
      },
      {
        id: "self-host",
        title: "自托管 Server",
        blocks: [
          { type: "p", text: "Maple 可以完全自托管：数据保存在本地 SQLite，任务、截图、凭证都不出你的服务器。" },
          { type: "code", lang: "Docker Compose", text: "docker compose up -d" },
          { type: "code", lang: "源码运行", text: "bun server" },
          { type: "tip", text: "默认端口 45820。对外提供服务时建议放在 Caddy / Nginx 之后，开启 HTTPS。" }
        ]
      }
    ]
  }
];

const ALL_ARTICLES = DOC_GROUPS.flatMap((group) => group.items);

/* ── 代码块（带复制） ── */

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默。
    }
  };
  return (
    <div className="mt-4 overflow-hidden rounded-xl bg-[#101012] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="flex items-center px-4 py-2">
        <span className="font-mono text-[10.5px] tracking-wide text-zinc-500">{lang}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
        >
          <Icon icon={copied ? "mingcute:check-line" : "mingcute:copy-line"} className="text-[12px]" />
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <p className="m-0 border-t border-white/[0.05] px-4 py-3.5 font-mono text-[12.5px] leading-6 text-zinc-200">
        <span style={{ color: MORANDI_PURPLE }}>$</span> {text}
      </p>
    </div>
  );
}

/* ── 页面 ── */

export function DocsPage({
  subPath,
  onNavigate,
  onEnter
}: {
  subPath: string;
  onNavigate: (to: string) => void;
  onEnter: () => void;
}) {
  useEffect(() => {
    applyUiFont("chill-round");
  }, []);

  const articleId = subPath.replace(/^\/+/, "");
  const activeId = ALL_ARTICLES.find((article) => article.id === articleId)?.id ?? ALL_ARTICLES[0].id;
  const active = ALL_ARTICLES.find((article) => article.id === activeId)!;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeId]);

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto font-sans text-zinc-200 antialiased" style={{ background: "#0b0b0d" }}>
      {/* ── 顶栏 ── */}
      <header className="mx-auto flex w-full max-w-[1120px] items-center gap-4 px-6 py-5">
        <button type="button" onClick={() => onNavigate("/")} className="flex items-center gap-2">
          <Icon icon="mingcute:quill-pen-ai-fill" className="text-[18px]" style={{ color: MORANDI_PURPLE }} />
          <span className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Maple <span style={{ color: MORANDI_PURPLE }}>Code</span>
          </span>
        </button>
        <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-zinc-400">使用文档</span>
        <button
          type="button"
          onClick={onEnter}
          className="ml-auto rounded-full border border-white/[0.09] bg-white/[0.05] px-4 py-1.5 text-[12.5px] font-medium text-zinc-200 transition-all hover:border-white/[0.16] hover:bg-white/[0.09]"
        >
          进入控制台
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-[1120px] items-start gap-10 px-6 pb-24 pt-6">
        {/* ── 左侧树 ── */}
        <aside className="sticky top-6 hidden w-[220px] shrink-0 md:block">
          {DOC_GROUPS.map((group) => (
            <div key={group.name} className="mb-6">
              <p className="m-0 px-3 pb-2 text-[11px] font-medium tracking-[0.14em] text-zinc-600">{group.name}</p>
              {group.items.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(`/docs/${item.id}`)}
                    className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                      isActive ? "bg-white/[0.06] font-medium" : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
                    }`}
                    style={isActive ? { color: MORANDI_PURPLE } : undefined}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* ── 右侧内容 ── */}
        <article key={active.id} className="min-w-0 flex-1 pt-1 md:max-w-[680px]">
          <h1 className="m-0 text-[26px] font-semibold tracking-tight text-zinc-100">{active.title}</h1>
          {active.blocks.map((block, index) => {
            if (block.type === "p") {
              return <p key={index} className="m-0 mt-4 text-[13.5px] leading-7 text-zinc-400">{block.text}</p>;
            }
            if (block.type === "list") {
              return (
                <ul key={index} className="m-0 mt-4 flex flex-col gap-2 pl-0">
                  {block.items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-[13.5px] leading-6 text-zinc-400">
                      <span className="mt-[9px] size-1.5 shrink-0 rounded-full" style={{ background: MORANDI_PURPLE }} />
                      {item}
                    </li>
                  ))}
                </ul>
              );
            }
            if (block.type === "code") {
              return <CodeBlock key={index} lang={block.lang} text={block.text} />;
            }
            return (
              <div key={index} className="mt-4 flex items-start gap-2.5 rounded-xl bg-white/[0.03] px-4 py-3 text-[12.5px] leading-6 text-zinc-400">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: MORANDI_SAGE }} />
                {block.text}
              </div>
            );
          })}
        </article>
      </div>
    </div>
  );
}
