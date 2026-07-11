"use client";

import type { GameAction } from "@three-zero-four/contracts";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useRoomController } from "../hooks/use-room-controller";
import { GameClient } from "../lib/game-client";
import { GameTable } from "./game-table";
import { RoomLobby } from "./room-lobby";

export function RoomClient({
  roomReference,
  serviceOrigin,
}: {
  roomReference: string;
  serviceOrigin: string | undefined;
}) {
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

  return <ConnectedRoom client={client} roomReference={roomReference} />;
}

function ConnectedRoom({
  client,
  roomReference,
}: {
  client: GameClient;
  roomReference: string;
}) {
  const router = useRouter();
  const controller = useRoomController(roomReference, client);
  const submit = (action: GameAction) => {
    void controller.submit(action);
  };
  const leave = () => {
    void controller.leave().then((exit) => {
      if (exit) router.replace("/play");
    });
  };

  if (controller.loading && !controller.projection) {
    return (
      <section aria-live="polite" className="safe-table-state">
        Loading your private table…
      </section>
    );
  }

  if (!controller.projection) {
    return (
      <section aria-live="polite" className="safe-table-state">
        <p>{controller.error ?? "This private room is unavailable."}</p>
        <button onClick={() => void controller.retry()} type="button">
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="room-shell">
      {controller.error ? (
        <p aria-live="polite" className="room-error" role="status">
          {controller.error}
        </p>
      ) : null}
      {controller.projection.status === "lobby" ? (
        <RoomLobby
          leave={leave}
          projection={controller.projection}
          start={() => void controller.start()}
        />
      ) : (
        <GameTable
          connection={controller.connection}
          leave={leave}
          projection={controller.projection}
          submit={submit}
        />
      )}
    </section>
  );
}
