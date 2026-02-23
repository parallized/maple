import type { TaskStatus } from "../domain";
import type { UiLanguage } from "./constants";

type PrTagInput = {
  title: string;
  status: TaskStatus;
  decisionTags: string[];
  reportContent: string;
  language: UiLanguage;
};

type TypeKey = "feat" | "fix" | "refactor" | "docs" | "chore";
type AreaKey = "core" | "ui" | "task_detail" | "markdown" | "worker" | "mcp" | "xterm" | "i18n";

type AreaRule = {
  key: AreaKey;
  patterns: RegExp[];
};

const TYPE_TAGS: Record<UiLanguage, Record<TypeKey, string>> = {
  zh: {
    feat: "新功能",
    fix: "修复",
    refactor: "重构",
    docs: "文档",
    chore: "配置"
  },
  en: {
    feat: "type:feat",
    fix: "type:fix",
    refactor: "type:refactor",
    docs: "type:docs",
    chore: "type:chore"
  }
};

const AREA_TAGS: Record<UiLanguage, Record<AreaKey, string>> = {
  zh: {
    core: "核心",
    ui: "界面",
    task_detail: "详情",
    markdown: "文档格式",
    worker: "执行器",
    mcp: "协议层",
    xterm: "终端",
    i18n: "多语言"
  },
  en: {
    core: "area:core",
    ui: "area:ui",
    task_detail: "area:task-detail",
    markdown: "area:markdown",
    worker: "area:worker",
    mcp: "area:mcp",
    xterm: "area:xterm",
    i18n: "area:i18n"
  }
};

const STATE_TAGS: Record<UiLanguage, { blocked: string; needsInfo: string }> = {
  zh: {
    blocked: "阻塞",
    needsInfo: "待补充"
  },
  en: {
    blocked: "state:blocked",
    needsInfo: "state:needs-info"
  }
};

const AREA_RULES: AreaRule[] = [
  {
    key: "task_detail",
    patterns: [/task[\s-]?detail/, /任务详情/, /详情面板/, /详情编辑/, /\bdetail panel\b/]
  },
  {
    key: "markdown",
    patterns: [/\bmarkdown\b/, /\bnotion\b/, /任务列表/, /列表/, /图片/, /blockquote/, /code fence/]
  },
  {
    key: "ui",
    patterns: [/\bui\b/, /\bux\b/, /hover/, /按钮/, /页面/, /界面/, /样式/, /交互/, /弹窗/, /侧边栏/]
  },
  {
    key: "worker",
    patterns: [/\bworker\b/, /\bclaude\b/, /\bcodex\b/, /\biflow\b/, /\bagent\b/]
  },
  {
    key: "mcp",
    patterns: [/\bmcp\b/, /submit_task_report/, /finish_worker/, /query_project_todos/, /query_recent_context/]
  },
  {
    key: "xterm",
    patterns: [/\bxterm\b/, /\bterminal\b/, /pty/, /控制台/]
  },
  {
    key: "i18n",
    patterns: [/\bi18n\b/, /\bl10n\b/, /国际化/, /本地化/, /翻译/, /语言/]
  }
];

function includesKeyword(source: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(source));
}

function resolveTypeTag(source: string, decisionTags: string[], language: UiLanguage): string {
  const tags = decisionTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);

  if (tags.some((tag) => tag.includes("修复") || tag.includes("fix"))) return TYPE_TAGS[language].fix;
  if (tags.some((tag) => tag.includes("架构") || tag.includes("重构") || tag.includes("refactor"))) return TYPE_TAGS[language].refactor;
  if (tags.some((tag) => tag.includes("配置") || tag.includes("chore") || tag.includes("config"))) return TYPE_TAGS[language].chore;

  if (includesKeyword(source, [/修复/, /\bfix\b/, /bug/, /hotfix/, /回归/, /错误/, /异常/, /崩溃/, /闪烁/, /flicker/])) {
    return TYPE_TAGS[language].fix;
  }
  if (includesKeyword(source, [/重构/, /架构/, /拆分/, /解耦/, /\brefactor\b/, /可维护/])) {
    return TYPE_TAGS[language].refactor;
  }
  if (includesKeyword(source, [/文档/, /\bdocs?\b/, /readme/, /说明/, /注释/])) {
    return TYPE_TAGS[language].docs;
  }
  if (includesKeyword(source, [/配置/, /依赖/, /脚本/, /构建/, /环境/, /\bchore\b/, /\bconfig\b/, /\bdeps?\b/, /\bci\b/, /\bbuild\b/, /\btooling\b/])) {
    return TYPE_TAGS[language].chore;
  }
  if (includesKeyword(source, [/新增/, /实现/, /支持/, /功能/, /\bfeature\b/, /\bfeat\b/])) {
    return TYPE_TAGS[language].feat;
  }
  return TYPE_TAGS[language].feat;
}

function resolveAreaTags(source: string, language: UiLanguage): string[] {
  const matches = AREA_RULES
    .filter((rule) => includesKeyword(source, rule.patterns))
    .map((rule) => AREA_TAGS[language][rule.key]);
  if (matches.length === 0) return [AREA_TAGS[language].core];
  return matches.slice(0, 2);
}

export function generatePrStyleTags(input: PrTagInput): string[] {
  const source = `${input.title}\n${input.reportContent}\n${input.decisionTags.join(" ")}`.toLowerCase();
  const tags = [
    resolveTypeTag(source, input.decisionTags, input.language),
    ...resolveAreaTags(source, input.language)
  ];

  if (input.status === "已阻塞") tags.push(STATE_TAGS[input.language].blocked);
  if (input.status === "需要更多信息") tags.push(STATE_TAGS[input.language].needsInfo);

  return [...new Set(tags)].slice(0, 5);
}
