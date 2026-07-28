import type { Database } from "bun:sqlite";
import type { RunnerRunListResponse, RunnerRunLogResponse } from "@maple/protocol";
import type { LogRow, RunnerRunRow } from "../database/rows";
import { toLog, toRunnerRun } from "../database/rows";

const RUN_SELECT = `
  SELECT a.id AS attempt_id,
         t.id AS todo_id,
         t.title AS todo_title,
         p.id AS project_id,
         p.name AS project_name,
         a.worker_kind,
         a.state,
         a.exit_code,
         a.result_summary,
         a.error,
         a.started_at,
         a.completed_at,
         a.created_at
  FROM todo_attempts a
  JOIN todos t ON t.id = a.todo_id
  JOIN projects p ON p.id = t.project_id
`;

/** Runner 运行记录只按 runner_id 读取，避免 Runner Token 越权查看其他执行端。 */
export class RunRepository {
  constructor(private readonly database: Database) {}

  listByRunner(runnerId: string, limit: number): RunnerRunListResponse {
    const rows = this.database
      .query(`${RUN_SELECT} WHERE a.runner_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT ?`)
      .all(runnerId, limit) as RunnerRunRow[];
    return { runs: rows.map(toRunnerRun) };
  }

  logsByRunner(
    runnerId: string,
    attemptId: string,
    afterId: number,
    limit: number
  ): RunnerRunLogResponse | null {
    const runRow = this.database
      .query(`${RUN_SELECT} WHERE a.runner_id = ? AND a.id = ? LIMIT 1`)
      .get(runnerId, attemptId) as RunnerRunRow | null;
    if (!runRow) return null;

    const logRows = this.database
      .query("SELECT * FROM todo_logs WHERE attempt_id = ? AND id > ? ORDER BY id ASC LIMIT ?")
      .all(attemptId, afterId, limit) as LogRow[];
    const logs = logRows.map(toLog);
    return {
      run: toRunnerRun(runRow),
      logs,
      nextAfterId: logs.at(-1)?.id ?? (afterId > 0 ? afterId : null)
    };
  }
}
