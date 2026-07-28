import { describe, expect, it } from "bun:test";
import { directoryPickerPlans } from "../src/project/directory-picker";

describe("native directory picker", () => {
  it("uses an STA FolderBrowserDialog on Windows", () => {
    const plans = directoryPickerPlans("win32", { SystemRoot: "C:\\Windows" });

    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0]?.executable).toEndWith("powershell.exe");
    expect(plans[0]?.args).toContain("-STA");
    expect(plans[0]?.args.join(" ")).toContain("FolderBrowserDialog");
    expect(plans[0]?.args.join(" ")).toContain("$owner.TopMost = $true");
    expect(plans[0]?.args.join(" ")).toContain("ShowDialog($owner)");
  });

  it("uses the macOS system folder chooser", () => {
    const [plan] = directoryPickerPlans("darwin", {});

    expect(plan?.executable).toBe("osascript");
    expect(plan?.args.join(" ")).toContain("choose folder");
    expect(plan?.cancelledExitCodes).toContain(1);
  });

  it("supports the common Linux desktop folder choosers", () => {
    const plans = directoryPickerPlans("linux", { DISPLAY: ":0" });

    expect(plans.map((plan) => plan.executable)).toEqual(["zenity", "kdialog", "yad"]);
    expect(plans.every((plan) => plan.args.some((argument) => argument.includes("选择 Maple 项目目录")))).toBe(true);
  });
});
