import { BoardApp } from "@maple/board-ui";
import type { AuthSessionResponse } from "@maple/protocol";
import { useMemo } from "react";
import "@maple/board-ui/styles.css";
import "@maple/board-ui/radius-overrides.css";
import "@maple/board-ui/badge-overrides.css";
import type { DashboardApi } from "./api/client";
import pkg from "../package.json";
import { createServerPlatform } from "./board/server-platform";
import { AccountControl } from "./components/AccountControl";
import { buildAccountSettingsTabs } from "./components/account-settings";

type DashboardPageProps = {
  api: DashboardApi;
  session: AuthSessionResponse;
  onSession: (next: AuthSessionResponse) => void;
  onSignedOut: () => void;
};

export function DashboardPage({ api, session, onSession, onSignedOut }: DashboardPageProps) {
  const platform = useMemo(
    () => createServerPlatform(api, {
      onUnauthorized: onSignedOut,
      storageScope: `${session.user.id}:${session.workspace.id}`
    }),
    [api, session.user.id, session.workspace.id, onSignedOut]
  );

  return (
    <BoardApp
      key={session.workspace.id}
      platform={platform}
      version={pkg.version}
      settingsExtraTabs={buildAccountSettingsTabs({ api, session, onSession, onSignedOut })}
      sidebarFooter={({ openSettings }) => (
        <AccountControl
          api={api}
          session={session}
          onSession={onSession}
          onSignedOut={onSignedOut}
          onOpenSettings={openSettings}
        />
      )}
    />
  );
}
