import type { Database } from "bun:sqlite";

export function touchRevision(database: Database): number {
  database.run("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'");
  return readRevision(database);
}

export function readRevision(database: Database): number {
  const row = database.query("SELECT value FROM metadata WHERE key = 'revision'").get() as { value: string } | null;
  return Number.parseInt(row?.value ?? "0", 10) || 0;
}
