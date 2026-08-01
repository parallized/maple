import type { RunnerCapability } from "@maple/protocol";

export const CLI_CAPABILITIES = [
  "project_manager_v1",
  "provider_credentials_v1"
] as const satisfies readonly RunnerCapability[];
