export interface ParsedArgs {
  command: string;
  subcommand: string | null;
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const tokens = [...argv];
  const command = tokens.shift() ?? "help";
  const subcommand = command === "project" ? tokens.shift() ?? "list" : null;
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const separator = token.indexOf("=");
    if (separator > 2) {
      options[token.slice(2, separator)] = token.slice(separator + 1);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { command, subcommand, positionals, options };
}

export function stringOption(args: ParsedArgs, key: string): string | undefined {
  const value = args.options[key];
  return typeof value === "string" ? value : undefined;
}
