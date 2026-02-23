export const ACTIVE_STATUSES = ["待办", "待返工", "队列中", "进行中", "需要更多信息"] as const;
export const BLOCKED_STATUS = "已阻塞" as const;
export const DONE_STATUS = "已完成" as const;

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
export type TaskStatus = ActiveStatus | typeof BLOCKED_STATUS | typeof DONE_STATUS;

export interface TaskCard {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  description?: string;
}

export function isActiveStatus(status: string): status is ActiveStatus {
  return ACTIVE_STATUSES.includes(status as ActiveStatus);
}
