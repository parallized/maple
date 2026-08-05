import { describe, expect, it } from "bun:test";
import { sortTagsForDisplay } from "@maple/board-ui";

describe("tag display ordering", () => {
  it("renders the same tag set in the same order no matter the stored order", () => {
    const fromLeft = sortTagsForDisplay(["界面", "ui调整"], "zh");
    const fromRight = sortTagsForDisplay(["ui调整", "界面"], "zh");
    expect(fromLeft).toEqual(fromRight);
    expect(fromLeft).toHaveLength(2);
  });

  it("stays deterministic across repeated calls", () => {
    const tags = ["后端", "数据库", "前端", "ui调整", "界面"];
    expect(sortTagsForDisplay(tags, "zh")).toEqual(sortTagsForDisplay(tags, "zh"));
    expect(sortTagsForDisplay(tags, "en")).toEqual(sortTagsForDisplay(tags, "en"));
  });

  it("keeps single or empty tag lists untouched", () => {
    expect(sortTagsForDisplay([], "zh")).toEqual([]);
    expect(sortTagsForDisplay(["界面"], "zh")).toEqual(["界面"]);
  });
});
