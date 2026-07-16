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

  it("matches maker and opponent views while trump is closed", () => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      initialSeats: Array.from({ length: 4 }, (_, index) => ({
        displayName: `Player ${index + 1}`,
        index,
        type: "human" as const,
        userId: `player-${index + 1}`,
      })),
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    engine.state.inviteCode = "304-abcdefghijkl";
    const apply = (action: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...action,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    const maker = engine.getSnapshot().activeSeat;
    if (maker === null) throw new Error("Expected an opening bidder");
    apply({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      apply({ type: "PASS_BID" });
    }
    const selection = engine
      .getLegalActions(maker)
      .find((action) => action.type === "SELECT_TRUMP");
    if (!selection) throw new Error("Expected a trump selection");
    apply(selection);
    const state = engine.getSnapshot();
    const room = {
      eventVersion: state.version,
      hostPlayerId: `player-${maker + 1}`,
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
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state,
    });

    for (const viewerSeatIndex of [maker, (maker + 1) % 4]) {
      const domain = projectDomainRoomForPlayer(
        room,
        hand,
        seats,
        viewerSeatIndex,
      );
      const legacy = projectRoomForPlayer(room, engine, viewerSeatIndex);

      expect(domain.view.isHost).toBe(legacy.view.isHost);
      expect(domain.view.legalActions).toEqual(legacy.view.legalActions);
      expect(domain.view.privateSeat).toEqual(legacy.view.privateSeat);
      expect(domain.view.prompt).toBe(legacy.view.prompt);
      expect(domain.view.publicState).toMatchObject({
        activeSeat: legacy.view.publicState.activeSeat,
        seats: legacy.view.publicState.seats,
        trump: legacy.view.publicState.trump,
      });
    }
  });
});
