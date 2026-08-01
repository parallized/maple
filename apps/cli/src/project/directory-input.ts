import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveProjectDirectory } from "./inspect";

export interface TerminalDirectoryIo {
  question(prompt: string, signal?: AbortSignal): Promise<string | null>;
  write(message: string): void;
}

interface TerminalStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

function terminalStreamsAvailable(streams: TerminalStreams): boolean {
  return Boolean(streams.stdin.isTTY && streams.stdout.isTTY);
}

async function askTerminalLine(
  streams: TerminalStreams,
  prompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) return null;
  const readline = createInterface({ input: streams.stdin, output: streams.stdout });
  return new Promise<string | null>((complete) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      complete(value);
    };
    const abort = () => {
      finish(null);
      readline.close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    readline.once("SIGINT", abort);
    readline.once("close", () => finish(null));
    readline.question(prompt).then(
      (answer) => finish(answer),
      () => finish(null)
    );
  }).finally(() => readline.close());
}

function defaultTerminalIo(
  streams: TerminalStreams = { stdin: process.stdin, stdout: process.stdout }
): TerminalDirectoryIo {
  if (!terminalStreamsAvailable(streams)) {
    throw new Error("当前 Runner 没有可交互终端，无法输入项目目录。");
  }
  return {
    question: (prompt, signal) => askTerminalLine(streams, prompt, signal),
    write: (message) => streams.stdout.write(`${message}\n`)
  };
}

export function normalizeTerminalDirectoryInput(
  value: string,
  cwd = process.cwd(),
  userHome = homedir()
): string {
  let input = value.trim();
  if (
    input.length >= 2
    && ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'")))
  ) {
    input = input.slice(1, -1).trim();
  }
  if (input === "~") return resolve(userHome);
  if (input.startsWith("~/")) return resolve(join(userHome, input.slice(2)));
  return resolve(cwd, input);
}

function confirmationValue(value: string): boolean | null {
  const answer = value.trim().toLowerCase();
  if (answer === "y" || answer === "yes" || answer === "是") return true;
  if (!answer || answer === "n" || answer === "no" || answer === "否") return false;
  return null;
}

export async function selectProjectDirectoryInTerminal(
  signal?: AbortSignal,
  providedIo?: TerminalDirectoryIo
): Promise<string | null> {
  const io = providedIo ?? defaultTerminalIo();
  for (;;) {
    if (signal?.aborted) return null;
    const input = await io.question("请输入项目目录（Ctrl+C 取消）：", signal);
    if (input === null || signal?.aborted) return null;
    if (!input.trim()) {
      io.write("请输入一个有效的项目目录。");
      continue;
    }

    let projectDirectory: string;
    try {
      projectDirectory = resolveProjectDirectory(normalizeTerminalDirectoryInput(input));
    } catch (error) {
      io.write(`路径不可用：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    io.write(`已定位项目目录：\n  ${projectDirectory}`);
    for (;;) {
      const answer = await io.question("是否是这个文件夹？[y/N]：", signal);
      if (answer === null || signal?.aborted) return null;
      const confirmed = confirmationValue(answer);
      if (confirmed === true) return projectDirectory;
      if (confirmed === false) break;
      io.write("请输入 y 或 n。");
    }
  }
}
