import { createContext, useContext } from "react";
import type { BoardPlatform } from "./types";

const PlatformContext = createContext<BoardPlatform | null>(null);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): BoardPlatform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("usePlatform must be used within a PlatformProvider");
  return platform;
}
