import { useMemo } from "react";
import { BoardApp } from "@maple/board-ui";
import pkg from "../package.json";
import { createTauriPlatform } from "./platform/tauri-platform";

export function App() {
  const platform = useMemo(() => createTauriPlatform(), []);
  return <BoardApp platform={platform} version={pkg.version} />;
}
