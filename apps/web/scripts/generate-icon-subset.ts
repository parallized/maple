import { icons as mingcuteSource } from "@iconify-json/mingcute";
import { icons as logosSource } from "@iconify-json/logos";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const webRoot = resolve(import.meta.dir, "..");
const scanRoots = [
  join(webRoot, "src"),
  resolve(webRoot, "../../packages/client-ui/src"),
  resolve(webRoot, "../../packages/board-ui/src")
];

type IconSource = typeof mingcuteSource;

function scan(pattern: RegExp): Set<string> {
  const requested = new Set<string>();
  function walk(path: string) {
    for (const name of readdirSync(path)) {
      const entry = join(path, name);
      if (statSync(entry).isDirectory()) {
        walk(entry);
        continue;
      }
      if (!/\.(?:ts|tsx)$/.test(name)) continue;
      const content = readFileSync(entry, "utf8");
      for (const match of content.matchAll(pattern)) requested.add(match[1]!);
    }
  }
  for (const root of scanRoots) walk(root);
  return requested;
}

function buildCollection(source: IconSource, requested: Set<string>, label: string, outputName: string) {
  const selectedIcons: typeof source.icons = {};
  const selectedAliases: NonNullable<typeof source.aliases> = {};

  function include(name: string) {
    if (source.icons[name]) {
      selectedIcons[name] = source.icons[name]!;
      return;
    }
    const alias = source.aliases?.[name];
    if (!alias) throw new Error(`Missing ${label} icon: ${name}`);
    selectedAliases[name] = alias;
    include(alias.parent);
  }

  for (const name of requested) include(name);

  const outputPath = join(webRoot, "src/generated", outputName);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      prefix: source.prefix,
      width: source.width,
      height: source.height,
      icons: selectedIcons,
      aliases: selectedAliases
    })}\n`,
    "utf8"
  );
  console.log(`[maple-web] generated ${requested.size} ${label} icons`);
}

buildCollection(mingcuteSource, scan(/mingcute:([a-z0-9-]+)/g), "MingCute", "mingcute.json");
buildCollection(logosSource, scan(/logos:([a-z0-9-]+)/g), "Logos", "logos.json");
