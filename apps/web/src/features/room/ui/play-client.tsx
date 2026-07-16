"use client";

import { useRouter } from "next/navigation";
import { useGameClient } from "../hooks/use-game-client";
import { EntryFlow } from "./entry-flow";

export function PlayClient({
  serviceOrigin,
}: {
  serviceOrigin: string | undefined;
}) {
  const router = useRouter();
  const client = useGameClient(serviceOrigin);

  if (!client) {
    return (
      <section aria-live="polite" className="safe-table-state">
        The game service is not configured for this release environment.
      </section>
    );
  }

  return <EntryFlow client={client} onNavigate={(path) => router.push(path)} />;
}
