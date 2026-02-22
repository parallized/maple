import type { TaskStatus } from "../domain";

type PrTagInput = {
  title: string;
  status: TaskStatus;
  decisionTags: string[];
  reportContent: string;
};

type AreaRule = {
  tag: string;
  patterns: RegExp[];
};

const AREA_RULES: AreaRule[] = [
  {
    tag: "area:task-detail",
    patterns: [/task[\s-]?detail/, /任务详情/, /详情面板/, /详情编辑/, /\bdetail panel\b/]
  },
  {
    tag: "area:markdown",
    patterns: [/\bmarkdown\b/, /\bnotion\b/, /任务列表/, /列表/, /图片/, /blockquote/, /code fence/]
  },
  {
    tag: "area:ui",
    patterns: [/\bui\b/, /\bux\b/, /hover/, /按钮/, /页面/, /界面/, /样式/, /交互/, /弹窗/, /侧边栏/]
  },
  {
    tag: "area:worker",
    patterns: [/\bworker\b/, /\bclaude\b/, /\bcodex\b/, /\biflow\b/, /\bagent\b/]
  },
  {
    tag: "area:mcp",
    patterns: [/\bmcp\b/, /submit_task_report/, /finish_worker/, /query_project_todos/, /query_recent_context/]
  },
  {
    tag: "area:xterm",
    patterns: [/\bxterm\b/, /\bterminal\b/, /pty/, /控制台/]
  },
  {
    tag: "area:i18n",
    patterns: [/\bi18n\b/, /\bl10n\b/, /国际化/, /本地化/, /翻译/, /语言/]
  }
];

function includesKeyword(source: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(source));
}

function resolveTypeTag(source: string, decisionTags: string[]): string {
  const tags = decisionTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);

  if (tags.some((tag) => tag.includes("修复") || tag.includes("fix"))) return "type:fix";
  if (tags.some((tag) => tag.includes("架构") || tag.includes("refactor"))) return "type:refactor";
  if (tags.some((tag) => tag.includes("配置") || tag.includes("config"))) return "type:chore";

  if (includesKeyword(source, [/修复/, /\bfix\b/, /bug/, /hotfix/, /回归/, /错误/, /异常/, /崩溃/, /闪烁/, /flicker/])) {
    return "type:fix";
  }
  if (includesKeyword(source, [/重构/, /架构/, /拆分/, /解耦/, /\brefactor\b/, /可维护/])) {
    return "type:refactor";
  }
  if (includesKeyword(source, [/文档/, /\bdocs?\b/, /readme/, /说明/, /注释/])) {
    return "type:docs";
  }
  if (includesKeyword(source, [/配置/, /依赖/, /脚本/, /构建/, /环境/, /\bchore\b/, /\bconfig\b/, /\bdeps?\b/, /\bci\b/, /\bbuild\b/, /\btooling\b/])) {
    return "type:chore";
  }
  if (includesKeyword(source, [/新增/, /实现/, /支持/, /功能/, /\bfeature\b/, /\bfeat\b/])) {
    return "type:feat";
  }
  return "type:feat";
}

function resolveAreaTags(source: string): string[] {
  const matches = AREA_RULES.filter((rule) => includesKeyword(source, rule.patterns)).map((rule) => rule.tag);
  if (matches.length === 0) return ["area:core"];
  return matches.slice(0, 2);
}

export function generatePrStyleTags(input: PrTagInput): string[] {
  const source = `${input.title}\n${input.reportContent}\n${input.decisionTags.join(" ")}`.toLowerCase();
  const tags = [
    resolveTypeTag(source, input.decisionTags),
    ...resolveAreaTags(source)
  ];

  if (input.status === "已阻塞") tags.push("state:blocked");
  if (input.status === "需要更多信息") tags.push("state:needs-info");

  return [...new Set(tags)].slice(0, 5);
}
