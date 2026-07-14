"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { GameClient } from "../api/game-service-client";
import { EntryFlow } from "./entry-flow";

export function PlayClient({
  serviceOrigin,
}: {
  serviceOrigin: string | undefined;
}) {
  const router = useRouter();
  const client = useMemo(() => {
    if (!serviceOrigin) return null;
    try {
      return new GameClient(serviceOrigin);
    } catch {
      return null;
    }
  }, [serviceOrigin]);

  if (!client) {
    return (
      <section aria-live="polite" className="safe-table-state">
        The game service is not configured for this release environment.
      </section>
    );
  }

  return <EntryFlow client={client} onNavigate={(path) => router.push(path)} />;
}
