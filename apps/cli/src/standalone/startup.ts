import { parseCliArgs, type ParsedArgs } from "../args";

/** Maple Local treats an empty command line as direct startup, not help. */
export function parseStandaloneArgs(argv: string[]): ParsedArgs {
  return parseCliArgs(argv.length === 0 ? ["tui"] : argv);
}

/** Long-running Local commands participate in the repository development reload loop. */
export function isStandaloneDevelopmentCommand(argv: string[]): boolean {
  const command = parseStandaloneArgs(argv).command;
  return command === "tui" || command === "connect";
}

/** The development supervisor owns browser startup so watched restarts do not open extra tabs. */
export function shouldOpenStandaloneBrowser(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.MAPLE_STANDALONE_OPEN_BROWSER?.trim() !== "0";
}
