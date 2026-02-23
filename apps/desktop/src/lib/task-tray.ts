import type { Project } from "../domain";

export type TrayTaskSnapshot = {
  unresolvedCount: number;
  inProgressCount: number;
  queuedCount: number;
  todoCount: number;
  needInfoCount: number;
  blockedCount: number;
  completedCount: number;
};

export function buildTrayTaskSnapshot(projects: Project[]): TrayTaskSnapshot {
  let inProgressCount = 0;
  let queuedCount = 0;
  let todoCount = 0;
  let needInfoCount = 0;
  let blockedCount = 0;
  let completedCount = 0;

  for (const project of projects) {
    for (const task of project.tasks) {
      switch (task.status) {
        case "进行中":
          inProgressCount += 1;
          break;
        case "队列中":
          queuedCount += 1;
          break;
        case "待办":
          todoCount += 1;
          break;
        case "待返工":
          todoCount += 1;
          break;
        case "需要更多信息":
          needInfoCount += 1;
          break;
        case "已阻塞":
          blockedCount += 1;
          break;
        case "已完成":
          completedCount += 1;
          break;
        default:
          todoCount += 1;
          break;
      }
    }
  }

  return {
    unresolvedCount: inProgressCount + queuedCount + todoCount + needInfoCount + blockedCount,
    inProgressCount,
    queuedCount,
    todoCount,
    needInfoCount,
    blockedCount,
    completedCount
  };
}
