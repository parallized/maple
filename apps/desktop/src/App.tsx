import { useMemo } from "react";
import { BoardApp } from "@maple/board-ui";
import { createTauriPlatform } from "./platform/tauri-platform";

export function App() {
  const platform = useMemo(() => createTauriPlatform(), []);
  return <BoardApp platform={platform} />;
}
