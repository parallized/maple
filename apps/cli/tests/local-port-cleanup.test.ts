import { describe, expect, it } from "bun:test";
import {
  cleanupLocalPorts,
  parseFuserPids,
  parseLsofPids,
  parseSsPids,
  parseWindowsNetstatListeners,
  type PortCommandResult
} from "../src/standalone/port-cleanup";

function commandResult(
  stdout = "",
  exitCode = 0,
  stderr = ""
): PortCommandResult {
  return { exitCode, stdout, stderr };
}

describe("Maple Local port cleanup", () => {
  it("finds only Windows TCP listeners on the requested port", () => {
    const output = [
      "  TCP    0.0.0.0:5173       0.0.0.0:0       LISTENING       1200",
      "  TCP    [::]:5173          [::]:0          LISTENING       1200",
      "  TCP    127.0.0.1:5173     127.0.0.1:9000  ESTABLISHED     1300",
      "  TCP    0.0.0.0:45821      0.0.0.0:0       LISTENING       1400",
      "  TCP    127.0.0.1:5173     127.0.0.1:9001  TIME_WAIT       0"
    ].join("\r\n");

    expect(parseWindowsNetstatListeners(output, 5_173)).toEqual([1_200]);
    expect(parseWindowsNetstatListeners(output, 45_821)).toEqual([1_400]);
  });

  it("parses the supported Unix listener tools", () => {
    expect(parseLsofPids("1200\n1400\n1200\n")).toEqual([1_200, 1_400]);
    expect(parseFuserPids("5173/tcp:  1200 1400")).toEqual([1_200, 1_400]);
    expect(parseFuserPids(" 1200c 1400 ")).toEqual([1_200, 1_400]);
    expect(parseSsPids(
      'LISTEN 0 512 127.0.0.1:5173 0.0.0.0:* users:(("bun",pid=1200,fd=10),("node",pid=1400,fd=11))'
    )).toEqual([1_200, 1_400]);
  });

  it("kills unique Windows listeners while excluding the supervisor itself", async () => {
    let scan = 0;
    const commands: string[][] = [];
    const result = await cleanupLocalPorts([5_173, 45_821], {
      platform: "win32",
      currentPid: 9_999,
      rescanAttempts: 1,
      commandRunner: async (command) => {
        commands.push([...command]);
        if (command[0] === "taskkill.exe") return commandResult();
        scan += 1;
        if (scan > 2) return commandResult();
        return commandResult([
          "TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  1200",
          "TCP  0.0.0.0:45821 0.0.0.0:0  LISTENING  1200",
          "TCP  127.0.0.1:5173 0.0.0.0:0  LISTENING  9999"
        ].join("\n"));
      }
    });

    expect(result).toEqual({ targetedPids: [1_200], remainingPids: [] });
    expect(commands.filter((command) => command[0] === "taskkill.exe")).toEqual([
      ["taskkill.exe", "/PID", "1200", "/T", "/F"]
    ]);
  });

  it("uses TERM before KILL for a Unix listener that does not stop", async () => {
    let scan = 0;
    let alive = true;
    const signals: Array<NodeJS.Signals | 0> = [];
    const result = await cleanupLocalPorts([5_173], {
      platform: "linux",
      currentPid: 9_999,
      terminateTimeoutMs: 0,
      rescanAttempts: 1,
      commandRunner: async (command) => {
        if (command[0] !== "lsof") return null;
        scan += 1;
        return scan === 1 ? commandResult("1200\n") : commandResult("");
      },
      isProcessAlive: () => alive,
      killProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") alive = false;
      },
      wait: async () => undefined
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result).toEqual({ targetedPids: [1_200], remainingPids: [] });
  });
});
