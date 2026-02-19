export type WorkerExecutionPromptInput = {
  projectName: string;
  directory: string;
  taskTitle: string;
};

export type MapleWorkerSkill = {
  id: string;
  title: string;
  objective: string;
};

export const MAPLE_WORKER_SKILLS: MapleWorkerSkill[] = [
  { id: "implement", title: "实现变更", objective: "按任务目标完成代码与结构改动，避免临时兜底方案。" },
  { id: "verify", title: "验证结果", objective: "至少执行类型检查和构建，记录关键验证输出。" },
  { id: "summarize", title: "结果归档", objective: "汇总变更、影响范围与后续风险，便于回写任务系统。" }
];

const OUTPUT_SCHEMA_HINT = "终端最后请输出一个 JSON 代码块（```json ... ```），字段包含：conclusion, changes[], verification[]。";

function renderSkillChecklist(skills: MapleWorkerSkill[]): string[] {
  return skills.map((skill, index) => `${index + 1}. ${skill.title}：${skill.objective}`);
}

export function createWorkerExecutionPrompt(input: WorkerExecutionPromptInput): string {
  const skillLines = renderSkillChecklist(MAPLE_WORKER_SKILLS);
  return [
    "[Maple Worker Task]",
    `Project: ${input.projectName}`,
    `Directory: ${input.directory}`,
    `Task: ${input.taskTitle}`,
    "请执行任务，并通过 Maple Skills 完成落地与归档。",
    "执行优先技能：",
    ...skillLines,
    OUTPUT_SCHEMA_HINT
  ].join("\n");
}
