import { describe, expect, it } from "bun:test";
import {
  directoryPickerMode,
  directoryPickerPlans,
  selectProjectDirectory
} from "../src/project/directory-picker";

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

  it("always uses terminal input inside WSL even when WSLg is available", () => {
    expect(directoryPickerMode("linux", {
      WSL_DISTRO_NAME: "Ubuntu",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0"
    }, "6.6.87.2-microsoft-standard-WSL2")).toBe("terminal");
  });

  it("routes WSL selection through the Runner terminal session", async () => {
    let asked = false;
    let sessionStarted = false;
    const selected = await selectProjectDirectory(undefined, {
      platform: "linux",
      env: { WSL_DISTRO_NAME: "Ubuntu", DISPLAY: ":0" },
      kernelRelease: "6.6.87.2-microsoft-standard-WSL2",
      terminalIo: {
        question: async () => {
          asked = true;
          return null;
        },
        write: () => undefined
      },
      terminalSession: async (interaction) => {
        sessionStarted = true;
        return interaction();
      }
    });

    expect(selected).toBeNull();
    expect(sessionStarted).toBe(true);
    expect(asked).toBe(true);
  });

  it("uses terminal input on headless Linux and native pickers on desktop Linux", () => {
    expect(directoryPickerMode("linux", {}, "6.8.0-generic")).toBe("terminal");
    expect(directoryPickerMode("linux", { DISPLAY: ":0" }, "6.8.0-generic")).toBe("native");
  });
});
