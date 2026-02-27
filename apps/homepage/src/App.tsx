import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";

type Feature = {
  icon: string;
  title: string;
  description: string;
};

function ImageSlot({
  src,
  alt,
  label,
  className,
}: {
  src: string;
  alt: string;
  label: string;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <div
        className={[
          "flex items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white/60",
          "text-sm text-neutral-500",
          className ?? "",
        ].join(" ")}
        aria-label={label}
        role="img"
      >
        <div className="max-w-[32ch] text-center leading-relaxed">
          <div className="font-medium text-neutral-700">IMAGE PLACEHOLDER</div>
          <div className="mt-1">{label}</div>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={["rounded-2xl border border-neutral-200 bg-white object-cover", className ?? ""].join(" ")}
      loading="lazy"
      onError={() => setMissing(true)}
    />
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-medium tracking-[0.16em] text-neutral-500">{eyebrow}</div>
      <h2
        className="mt-3 text-balance text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {title}
      </h2>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-neutral-600 md:text-base">
        {description}
      </p>
    </div>
  );
}

export function App() {
  const features = useMemo<Feature[]>(
    () => [
      {
        icon: "mingcute:magic-2-line",
        title: "可执行任务卡",
        description: "每张卡都能一键启动 Worker，并通过 MCP 自动回写状态与产出。",
      },
      {
        icon: "mingcute:layout-line",
        title: "看板即交付",
        description: "待办、队列、进行中、阻塞、确认与完成路径清晰可控。",
      },
      {
        icon: "mingcute:shield-check-line",
        title: "本地优先，打包一致",
        description: "桌面端可离线运行，打包后的使用体验与开发环境一致。",
      },
      {
        icon: "mingcute:plug-2-line",
        title: "MCP / Skills 集成",
        description: "把工具链能力封装为统一接口，让 Worker 能稳定调用与协作。",
      },
      {
        icon: "mingcute:layers-line",
        title: "跨仓库、跨目录",
        description: "一个工作空间可覆盖多个项目目录，不受单仓库边界限制。",
      },
      {
        icon: "mingcute:chart-line",
        title: "低噪声可视化",
        description: "把注意力留给下一步：最少的信息密度，最高的可读性。",
      },
    ],
    []
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-neutral-200/70 bg-neutral-50/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="#top" className="group inline-flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl border border-neutral-200 bg-white shadow-sm">
              <Icon icon="mingcute:leaf-line" className="text-lg text-neutral-800" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-neutral-900">Maple</div>
              <div className="text-xs text-neutral-500">AI Project Workspace</div>
            </div>
          </a>

          <nav className="hidden items-center gap-6 text-sm text-neutral-600 md:flex">
            <a href="#features" className="hover:text-neutral-900">
              功能
            </a>
            <a href="#workflow" className="hover:text-neutral-900">
              工作流
            </a>
            <a href="#principles" className="hover:text-neutral-900">
              原则
            </a>
          </nav>

          <a
            href="#workflow"
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            开始了解
            <Icon icon="mingcute:arrow-right-line" className="text-base" />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="mx-auto max-w-6xl px-6 pb-10 pt-14 md:pb-16 md:pt-20">
          <div className="grid items-center gap-10 md:grid-cols-[1.15fr_0.85fr] md:gap-12">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-3 py-1 text-xs text-neutral-600 shadow-sm">
                <Icon icon="mingcute:sparkles-line" className="text-sm" />
                <span>让任务从“记录”变成“执行”</span>
              </div>

              <h1
                className="mt-5 text-balance text-4xl font-semibold tracking-tight text-neutral-950 md:text-5xl"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                把看板变成
                <span className="text-neutral-700">可执行的交付流水线</span>
              </h1>

              <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-neutral-600 md:text-base">
                Maple 将任务、AI Worker 与本地工具链连接起来，让每张卡片都能一键执行、自动回写、可验证地交付。
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-50"
                >
                  查看功能
                  <Icon icon="mingcute:arrow-right-line" className="text-base text-neutral-700" />
                </a>
                <a
                  href="#principles"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-white/60"
                >
                  产品原则
                  <Icon icon="mingcute:information-line" className="text-base" />
                </a>
              </div>

              <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { label: "Worker", value: "Codex / Claude / iFlow" },
                  { label: "MCP", value: "工具可组合" },
                  { label: "Delivery", value: "状态可回写" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-neutral-200 bg-white/70 p-4 shadow-sm">
                    <div className="text-xs font-medium text-neutral-500">{item.label}</div>
                    <div className="mt-1 text-sm font-semibold text-neutral-900">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:justify-self-end">
              <ImageSlot
                src="/images/hero.png"
                alt="Maple hero preview"
                label="Hero（产品界面截图 / 主视觉）"
                className="aspect-[4/5] w-full max-w-md shadow-[0_18px_50px_rgba(0,0,0,0.10)]"
              />
              <div className="mt-3 text-center text-xs text-neutral-500">
                图片缺失时将显示占位。补齐方式见 <span className="font-medium">IMAGE_NEED.md</span>。
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-neutral-200/70 bg-white/50 py-14 md:py-18">
          <div className="mx-auto max-w-6xl px-6">
            <SectionTitle
              eyebrow="FEATURES"
              title="像 Notion 一样克制，像流水线一样可执行"
              description="不堆功能按钮，用清晰的信息结构把“下一步”交给团队和 Worker。"
            />

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-neutral-900 text-white">
                      <Icon icon={feature.icon} className="text-lg" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-neutral-900">{feature.title}</div>
                      <p className="mt-1 text-sm leading-relaxed text-neutral-600">{feature.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <ImageSlot
                src="/images/screenshot-board.png"
                alt="Maple board screenshot"
                label="功能图 1（看板 / 任务执行）"
                className="aspect-video w-full"
              />
              <ImageSlot
                src="/images/screenshot-settings.png"
                alt="Maple settings screenshot"
                label="功能图 2（安装 / Worker 配置）"
                className="aspect-video w-full"
              />
            </div>
          </div>
        </section>

        <section id="workflow" className="py-14 md:py-18">
          <div className="mx-auto max-w-6xl px-6">
            <SectionTitle
              eyebrow="WORKFLOW"
              title="把执行路径固定下来，把不确定性交给 Worker"
              description="从任务到产出，过程可追踪、状态可回写、结果可确认。"
            />

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "选定任务",
                  desc: "用状态与标签快速定位下一步；阻塞与需要更多信息一目了然。",
                  icon: "mingcute:checkbox-line",
                },
                {
                  step: "02",
                  title: "一键执行",
                  desc: "选择合适的 Worker，让它通过 MCP 获取上下文、执行并持续输出日志。",
                  icon: "mingcute:play-circle-line",
                },
                {
                  step: "03",
                  title: "回写与交付",
                  desc: "Worker 回写状态、报告与标签；你只需要做关键确认与发布动作。",
                  icon: "mingcute:check-circle-line",
                },
              ].map((item) => (
                <div key={item.step} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium tracking-[0.2em] text-neutral-500">STEP {item.step}</div>
                    <Icon icon={item.icon} className="text-xl text-neutral-700" />
                  </div>
                  <div className="mt-3 text-lg font-semibold text-neutral-900">{item.title}</div>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-600">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-900">想要一张能“自己推进”的看板</div>
                  <div className="mt-1 text-sm text-neutral-600">
                    先把任务结构与状态跑通，再把执行入口交给 Worker。
                  </div>
                </div>
                <a
                  href="#top"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  回到顶部
                  <Icon icon="mingcute:arrow-up-line" className="text-base" />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="principles" className="border-t border-neutral-200/70 bg-white/50 py-14 md:py-18">
          <div className="mx-auto max-w-6xl px-6">
            <SectionTitle
              eyebrow="PRINCIPLES"
              title="克制的界面，确定的流程，可扩展的能力"
              description="为了长期可维护与可交付，Maple 选择把复杂性放在能力层，而不是把按钮堆在界面上。"
            />

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {[
                {
                  title: "任务是第一等实体",
                  desc: "状态、标签、报告与版本被明确记录，让协作围绕交付而不是围绕提交。",
                  icon: "mingcute:tag-2-line",
                },
                {
                  title: "工具链可组合",
                  desc: "MCP/Skills 把上下文与工具能力标准化，让 Worker 的执行更稳定、更可复用。",
                  icon: "mingcute:link-2-line",
                },
                {
                  title: "低噪声表达",
                  desc: "遵循 Notion 风格：留白、弱分隔、低噪声配色，让信息更清晰。",
                  icon: "mingcute:layout-2-line",
                },
                {
                  title: "面向打包用户",
                  desc: "默认以桌面端打包体验为准，避免只在开发环境可用的流程。",
                  icon: "mingcute:box-2-line",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 place-items-center rounded-xl border border-neutral-200 bg-neutral-50">
                      <Icon icon={item.icon} className="text-lg text-neutral-800" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-neutral-900">{item.title}</div>
                      <div className="mt-1 text-sm leading-relaxed text-neutral-600">{item.desc}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-neutral-50/80 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl border border-neutral-200 bg-white shadow-sm">
                <Icon icon="mingcute:leaf-line" className="text-lg text-neutral-800" />
              </span>
              <div>
                <div className="text-sm font-semibold text-neutral-900">Maple</div>
                <div className="text-xs text-neutral-500">Cross-platform AI-agent project workspace</div>
              </div>
            </div>
            <div className="text-xs text-neutral-500">
              © {new Date().getFullYear()} Maple. Built for clarity, shipped with confidence.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

