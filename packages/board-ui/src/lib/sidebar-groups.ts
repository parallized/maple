import type { Project, RunnerSummary } from "../domain";

export type RunnerProjectGroup = {
  runner: RunnerSummary;
  projects: Project[];
};

/** 将项目按 Runner 归属分组；未绑定任何 Runner 的项目单独返回。 */
export function groupProjectsByRunner(
  runners: readonly RunnerSummary[],
  projects: readonly Project[]
): { groups: RunnerProjectGroup[]; unassigned: Project[] } {
  if (runners.length === 0) return { groups: [], unassigned: [...projects] };

  const groups = runners.map((runner) => ({
    runner,
    projects: projects.filter((project) => (runner.projectIds ?? []).includes(project.id)),
  }));
  const boundProjectIds = new Set<string>();
  for (const group of groups) {
    for (const project of group.projects) boundProjectIds.add(project.id);
  }
  return {
    groups,
    unassigned: projects.filter((project) => !boundProjectIds.has(project.id)),
  };
}
