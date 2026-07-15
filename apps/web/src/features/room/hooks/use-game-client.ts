import { useMemo } from "react";
import { GameClient } from "../api/game-service-client";

export function useGameClient(
  serviceOrigin: string | undefined,
): GameClient | null {
  return useMemo(() => {
    if (!serviceOrigin) return null;
    try {
      return new GameClient(serviceOrigin);
    } catch {
      return null;
    }
  }, [serviceOrigin]);
}
