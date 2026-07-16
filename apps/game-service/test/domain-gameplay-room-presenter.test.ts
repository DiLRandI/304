import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it } from "vitest";
import { projectDomainRoomForPlayer } from "../src/contexts/gameplay/adapters/delivery/domain-gameplay-room-presenter.js";
import { projectRoomForPlayer } from "../src/contexts/gameplay/adapters/delivery/gameplay-room-presenter.js";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";
import type { StoredSeat } from "../src/contexts/rooms/application/room-persistence-model.js";

describe("projectDomainRoomForPlayer", () => {
  it.each([
    { profileId: "classic_304_4p", seatCount: 4 },
    { profileId: "six_304_36", seatCount: 6 },
  ] as const)("matches the established $profileId opening-hand wire projection", ({
    profileId,
    seatCount,
  }) => {
    const engine = new GameEngine({
      humanCount: seatCount,
      initialSeats: Array.from({ length: seatCount }, (_, index) => ({
        displayName: `Player ${index + 1}`,
        index,
        type: "human" as const,
        userId: `player-${index + 1}`,
      })),
      ruleProfile: profileId,
    });
    engine.startMatch();
    engine.state.inviteCode = "304-abcdefghijkl";
    const state = engine.getSnapshot();
    const viewerSeatIndex = state.activeSeat;
    if (viewerSeatIndex === null) {
      throw new Error("Expected an active opening bidder");
    }
    const hostPlayerId = state.seats[viewerSeatIndex]?.userId;
    if (typeof hostPlayerId !== "string") {
      throw new Error("Expected a seated host");
    }
    const room = {
      eventVersion: state.version,
      hostPlayerId,
      id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
      inviteCode: "304-abcdefghijkl",
      status: "in_hand" as const,
    };
    const seats: StoredSeat[] = state.seats.map((seat) => ({
      botDifficulty: seat.difficulty ?? null,
      connectionStatus: seat.connectionStatus ?? "disconnected",
      displayName: seat.displayName ?? null,
      occupantType: seat.type,
      playerId: typeof seat.userId === "string" ? seat.userId : null,
      seatIndex: seat.index,
    }));
    const hand = decodeGameplayHand({
      ruleProfileId: profileId,
      schemaVersion: 1,
      state,
    });

    const domainProjection = projectDomainRoomForPlayer(
      room,
      hand,
      seats,
      viewerSeatIndex,
    );
    const legacyProjection = projectRoomForPlayer(
      room,
      engine,
      viewerSeatIndex,
    );

    expect(domainProjection).toEqual(legacyProjection);
  });
});
