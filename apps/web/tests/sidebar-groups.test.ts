import { describe, expect, it } from "bun:test";
import { groupProjectsByRunner, type Project, type RunnerSummary } from "@maple/board-ui";

function runner(id: string, projectIds: string[]): RunnerSummary {
  return {
    id,
    name: `Runner ${id}`,
    hostname: `${id}-host`,
    platform: "win32/x64",
    state: "online",
    lastSeenAt: "2026-07-27T12:00:00.000Z",
    projectIds,
  };
}

function project(id: string): Project {
  return {
    id,
    name: `项目 ${id}`,
    directory: `/projects/${id}`,
    tasks: [],
  };
}

describe("sidebar runner-project grouping", () => {
  it("groups projects under their bound runner", () => {
    const { groups, unassigned } = groupProjectsByRunner(
      [runner("r1", ["1", "2"]), runner("r2", ["3"])],
      [project("1"), project("2"), project("3")]
    );
    expect(groups.map((group) => group.runner.id)).toEqual(["r1", "r2"]);
    expect(groups.map((group) => group.projects.map((item) => item.id))).toEqual([["1", "2"], ["3"]]);
    expect(unassigned).toEqual([]);
  });

  it("keeps unbound projects in the fallback list", () => {
    const { groups, unassigned } = groupProjectsByRunner(
      [runner("r1", ["1"])],
      [project("1"), project("2")]
    );
    expect(groups[0]?.projects.map((item) => item.id)).toEqual(["1"]);
    expect(unassigned.map((item) => item.id)).toEqual(["2"]);
  });

  it("falls back to a flat list when there are no runners", () => {
    const { groups, unassigned } = groupProjectsByRunner([], [project("1"), project("2")]);
    expect(groups).toEqual([]);
    expect(unassigned.map((item) => item.id)).toEqual(["1", "2"]);
  });
});
