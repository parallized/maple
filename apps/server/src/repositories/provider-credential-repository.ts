import type { Database } from "bun:sqlite";
import { touchRevision } from "../database/revision";
import { nowIso } from "../lib/time";

export type StoredProvider = "deepseek";

interface ProviderCredentialRow {
  encrypted_secret: string;
}

/** SQLite persistence for workspace-scoped, already-encrypted Provider secrets. */
export class ProviderCredentialRepository {
  constructor(private readonly database: Database) {}

  has(workspaceId: string, provider: StoredProvider): boolean {
    return Boolean(this.database
      .query("SELECT 1 FROM provider_credentials WHERE workspace_id = ? AND provider = ?")
      .get(workspaceId, provider));
  }

  read(workspaceId: string, provider: StoredProvider): string | null {
    const row = this.database
      .query("SELECT encrypted_secret FROM provider_credentials WHERE workspace_id = ? AND provider = ?")
      .get(workspaceId, provider) as ProviderCredentialRow | null;
    return row?.encrypted_secret ?? null;
  }

  write(workspaceId: string, provider: StoredProvider, encryptedSecret: string): void {
    const now = nowIso();
    this.database.run(
      `INSERT INTO provider_credentials(workspace_id, provider, encrypted_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET
         encrypted_secret = excluded.encrypted_secret,
         updated_at = excluded.updated_at`,
      [workspaceId, provider, encryptedSecret, now, now]
    );
    touchRevision(this.database);
  }

  remove(workspaceId: string, provider: StoredProvider): boolean {
    const removed = this.database.run(
      "DELETE FROM provider_credentials WHERE workspace_id = ? AND provider = ?",
      [workspaceId, provider]
    ).changes > 0;
    if (removed) touchRevision(this.database);
    return removed;
  }
}
