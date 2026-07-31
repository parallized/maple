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
        title: "安装",
        blocks: [
          { type: "p", text: "Maple 有两种用法，看你要不要多人协作、随时随地用。只想在自己电脑上跑就装本地版：数据完全自持，端口都不对外开放。要多平台、多人，就装 CLI 连服务器。" },
          { type: "p", text: "本地运行（Standalone），二选一：" },
          { type: "code", lang: "macOS / Linux", text: "curl -fsSL https://maplecode.art/install-local.sh | sh" },
          { type: "code", lang: "Windows (PowerShell)", text: "irm https://maplecode.art/install-local.ps1 | iex" },
          { type: "p", text: "装完会自动弹出浏览器页面，直接开始工作，不用登录也不用配对。" },
          { type: "p", text: "要接服务器的话，改装这个：" },
          { type: "code", lang: "macOS / Linux", text: "curl -fsSL https://maplecode.art/install.sh | sh" },
          { type: "code", lang: "Windows (PowerShell)", text: "irm https://maplecode.art/install.ps1 | iex" },
          { type: "tip", text: "建议在装 Maple 的时候顺手把本机的 Codex、Claude 这些 AI 服务调通——任务最后是靠它们干的。" }
        ]
      },
      {
        id: "pairing",
        title: "配对 Runner",
        blocks: [
          { type: "p", text: "CLI 连服务器靠一次性配对码，在浏览器里点一下确认就绑定了。" },
          { type: "list", items: [
            "CLI 主菜单选「配对执行端」，拿到一个短配对码",
            "浏览器打开确认页，核对主机名，确认",
            "绑一次就行，以后 CLI 自动待命"
          ] },
          { type: "tip", text: "配对凭证存在本机 ~/.maple/cli.json。来源不明的配对请求，别确认。" }
        ]
      },
      {
        id: "first-task",
        title: "派发第一个任务",
        blocks: [
          { type: "p", text: "任务只会派到绑定了项目目录的主机上，所以先绑目录，再下任务。" },
          { type: "list", items: [
            "在 CLI 里按 E 添加本机目录",
            "看板上新建任务，写清楚要什么、怎么算做完，挑个 Worker",
            "跑完会提醒你，报告和截图自动归档"
          ] },
          { type: "tip", text: "任务描述写得越像验收单越好使：改什么、怎么算完成、要跑哪些检查。" }
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
          { type: "p", text: "任务在看板上按状态流转：待办、进行中、待验收、已完成。拖卡片就能改状态、调顺序。" },
          { type: "p", text: "看腻看板了可以换。「设置 → 详情展示」里有自优化列表和任务画廊，画廊会把验收截图铺成一堵卡片墙。" }
        ]
      },
      {
        id: "workers",
        title: "Worker 与模型",
        blocks: [
          { type: "p", text: "Worker 就是跑在你主机上的 Coding Agent——Claude Code、Codex、Kimi 这些。用哪个模型、开多少并发，你说了算。" },
          { type: "list", items: [
            "不同项目可以绑不同主机",
            "不同任务挑不同 Worker：前端、后端、测试各配各的模型",
            "会话上下文一直在，不用为切窗口浪费 token"
          ] }
        ]
      },
      {
        id: "review",
        title: "验收与截图回传",
        blocks: [
          { type: "p", text: "跑完不算完。Worker 会交一份执行报告，Web 任务还会用 Playwright 自动截图——改动长什么样，证据都在。" },
          { type: "p", text: "报告和截图存在任务详情里，随时回看。不喜欢自动截图可以在设置里关掉，嫌糊或嫌太清晰也有档位可调。" }
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
          { type: "p", text: "CLI 是 Runner 的控制中心：配对、绑项目、领任务、看 Worker 运行记录，都在这里面。" },
          { type: "code", lang: "源码运行", text: "bun apps/cli/src/index.ts" },
          { type: "p", text: "跑起来是个全屏工作台：顶部是 Worker 页签，中间是实时运行记录，底部是连接状态和缓存占用。" }
        ]
      },
      {
        id: "self-host",
        title: "自托管 Server",
        blocks: [
          { type: "p", text: "Maple 可以完全自托管：数据就在本地 SQLite 里，任务、截图、凭证都不出你的服务器。" },
          { type: "code", lang: "Docker Compose", text: "docker compose up -d" },
          { type: "code", lang: "源码运行", text: "bun server" },
          { type: "tip", text: "默认端口 45820，要对外服务就挂到 Caddy / Nginx 后面开 HTTPS。Maple 的缓存全在 ~/.maple 里，删掉这个目录就一干二净。" }
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
      <p className="m-0 overflow-x-auto border-t border-white/[0.05] px-4 py-3.5 font-mono text-[12.5px] leading-6 whitespace-nowrap text-zinc-200">
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
      <header className="mx-auto flex w-full max-w-[1120px] items-center gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
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

      <div className="mx-auto flex w-full max-w-[1120px] items-start gap-10 px-4 pb-24 pt-4 sm:px-6 sm:pt-6">
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

        <div className="min-w-0 flex-1">
          {/* ── 移动端导航：横向滚动文章条（桌面端用左侧树） ── */}
          <nav className="mb-6 flex gap-1.5 overflow-x-auto pb-1 md:hidden" aria-label="文档导航">
            {ALL_ARTICLES.map((item) => {
              const isActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(`/docs/${item.id}`)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] transition-colors ${
                    isActive ? "bg-white/[0.08] font-medium" : "bg-white/[0.03] text-zinc-500"
                  }`}
                  style={isActive ? { color: MORANDI_PURPLE } : undefined}
                >
                  {item.title}
                </button>
              );
            })}
          </nav>

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
    </div>
  );
}
