import { parseCliArgs, type ParsedArgs } from "../args";

/** Maple Local treats an empty command line as direct startup, not help. */
export function parseStandaloneArgs(argv: string[]): ParsedArgs {
  return parseCliArgs(argv.length === 0 ? ["tui"] : argv);
}
