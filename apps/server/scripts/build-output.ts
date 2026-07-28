import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

export function createBuildStagingRoot(
  outputRoot: string,
  identity = `${Date.now()}-${process.pid}`
): string {
  const resolvedOutput = resolve(outputRoot);
  return join(dirname(resolvedOutput), `${basename(resolvedOutput)}.building-${identity}`);
}

export function prepareBuildStagingRoot(stagingRoot: string): void {
  removeTree(stagingRoot);
  mkdirSync(stagingRoot, { recursive: true });
}

export function discardBuildStagingRoot(stagingRoot: string): void {
  if (!existsSync(stagingRoot)) return;
  removeTree(stagingRoot);
}

export function cleanupRetiredBuilds(outputRoot: string): string[] {
  const parent = dirname(outputRoot);
  if (!existsSync(parent)) return [];

  const prefix = `${basename(outputRoot)}.retired-`;
  const warnings: string[] = [];
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const retiredRoot = join(parent, entry.name);
    try {
      removeTree(retiredRoot);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      warnings.push(`${retiredRoot} (${code})`);
    }
  }
  return warnings;
}

export function publishBuildDirectory(stagingRoot: string, outputRoot: string): string | null {
  const resolvedStaging = resolve(stagingRoot);
  const resolvedOutput = resolve(outputRoot);
  if (resolvedStaging === resolvedOutput) {
    throw new Error("Build staging directory must differ from the deployment directory.");
  }

  mkdirSync(dirname(resolvedOutput), { recursive: true });
  if (!existsSync(resolvedOutput)) {
    renameSync(resolvedStaging, resolvedOutput);
    return null;
  }

  const retiredRoot = join(
    dirname(resolvedOutput),
    `${basename(resolvedOutput)}.retired-${Date.now()}-${process.pid}`
  );
  try {
    renameSync(resolvedOutput, retiredRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    throw new Error(
      `Cannot publish the Server build because ${resolvedOutput} is in use (${code}). `
        + "The existing deployment was left unchanged.",
      { cause: error }
    );
  }

  try {
    renameSync(resolvedStaging, resolvedOutput);
  } catch (error) {
    try {
      renameSync(retiredRoot, resolvedOutput);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Failed to publish ${resolvedOutput} and restore its previous deployment.`
      );
    }
    throw error;
  }

  try {
    removeTree(retiredRoot);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return `${retiredRoot} (${code})`;
  }
}
