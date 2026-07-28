import type { CodingAgentToolStatus } from "../execution/tool-availability";
import { displayWidth } from "../terminal/style";

export const TOOL_LIST_TITLE = "工具列表";

export interface ToolListRow {
  title: boolean;
  tools: CodingAgentToolStatus[];
}

function rowWidth(row: ToolListRow): number {
  const labels = [row.title ? TOOL_LIST_TITLE : "", ...row.tools.map((tool) => tool.label)].filter(Boolean);
  return labels.reduce((width, label, index) => width + displayWidth(label) + (index > 0 ? 1 : 0), 0);
}

/** 按终端列宽完整换行，不截断 Coding Agent 名称。 */
export function toolListRows(tools: CodingAgentToolStatus[], width: number): ToolListRow[] {
  const rows: ToolListRow[] = [{ title: true, tools: [] }];
  const maxWidth = Math.max(displayWidth(TOOL_LIST_TITLE), width);

  for (const tool of tools) {
    let row = rows.at(-1)!;
    const candidate = { ...row, tools: [...row.tools, tool] };
    if (row.tools.length > 0 && rowWidth(candidate) > maxWidth) {
      row = { title: false, tools: [] };
      rows.push(row);
    }
    row.tools.push(tool);
  }

  return rows;
}
