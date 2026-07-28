import type { ExchangePairingRequest, ExchangePairingResponse } from "@maple/protocol";
import { createServerApp, type MapleServerApp } from "../app";
import { createDatabase } from "../database/client";
import { RunnerRepository } from "../repositories/runner-repository";
import {
  createStandaloneServerConfig,
  type StandaloneServerConfigOptions
} from "./config";
import { ensureStandaloneIdentity, type StandaloneIdentity } from "./identity";

export interface StandaloneServerHandle {
  app: MapleServerApp;
  identity: StandaloneIdentity;
  url: string;
  provisionRunner(input: Omit<ExchangePairingRequest, "code">): ExchangePairingResponse;
  stop(): void;
}

/** Starts the private loopback Server used by the Maple Local distribution. */
export async function startStandaloneServer(
  options: StandaloneServerConfigOptions
): Promise<StandaloneServerHandle> {
  const config = createStandaloneServerConfig(options);
  const database = createDatabase(config.databasePath);
  let app: MapleServerApp | null = null;
  try {
    const identity = await ensureStandaloneIdentity(database);
    app = createServerApp({ config, database, standaloneIdentity: identity });
    app.listen({ hostname: config.host, port: config.port });
    const runners = new RunnerRepository(database, config.runnerOfflineSeconds);
    let stopped = false;
    return {
      app,
      identity,
      url: config.publicUrl!,
      provisionRunner: (input) => runners.upsertCredential(identity.workspaceId, input),
      stop: () => {
        if (stopped) return;
        stopped = true;
        app?.stop();
        database.close();
      }
    };
  } catch (error) {
    try { app?.stop(); } catch { /* The listener may not have started. */ }
    database.close();
    throw error;
  }
}

