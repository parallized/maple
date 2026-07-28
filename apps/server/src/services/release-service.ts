import type {
  HomeStatsResponse,
  RecordInstallShDownloadResponse,
  VersionHistoryResponse
} from "@maple/protocol";
import type { Database } from "bun:sqlite";
import {
  DownloadStatisticsRepository,
  INSTALL_SH_SOURCE
} from "../repositories/download-statistics-repository";
import { RELEASE_CATALOG, SERVER_VERSION } from "../releases/catalog";

export class ReleaseService {
  private readonly downloads: DownloadStatisticsRepository;

  constructor(database: Database) {
    this.downloads = new DownloadStatisticsRepository(database);
  }

  homeStats(): HomeStatsResponse {
    return {
      version: SERVER_VERSION,
      installShDownloads: this.downloads.total(INSTALL_SH_SOURCE)
    };
  }

  versionHistory(): VersionHistoryResponse {
    const downloads = this.downloads.countsByVersion(INSTALL_SH_SOURCE);
    return {
      currentVersion: SERVER_VERSION,
      releases: RELEASE_CATALOG.map((release) => ({
        ...release,
        changes: [...release.changes],
        installShDownloads: downloads.get(release.version) ?? 0
      }))
    };
  }

  recordInstallSh(eventId: string, networkIdentity: string): RecordInstallShDownloadResponse {
    const result = this.downloads.record(SERVER_VERSION, eventId, networkIdentity, INSTALL_SH_SOURCE);
    return {
      version: SERVER_VERSION,
      installShDownloads: result.count,
      counted: result.counted
    };
  }
}

