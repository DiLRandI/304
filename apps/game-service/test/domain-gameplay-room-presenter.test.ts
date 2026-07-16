import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it } from "vitest";
import { projectDomainRoomForPlayer } from "../src/contexts/gameplay/adapters/delivery/domain-gameplay-room-presenter.js";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";
import type { StoredSeat } from "../src/contexts/rooms/application/room-persistence-model.js";

describe("projectDomainRoomForPlayer", () => {
  it.each([
    { profileId: "classic_304_4p", seatCount: 4 },
    { profileId: "six_304_36", seatCount: 6 },
  ] as const)("presents the $profileId opening-hand wire contract", ({
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
    expect(domainProjection).toMatchObject({
      eventVersion: state.version,
      inviteCode: room.inviteCode,
      roomId: room.id,
      status: "in_hand",
      viewerSeatIndex,
      view: {
        isHost: true,
        privateSeat: {
          displayName: `Player ${viewerSeatIndex + 1}`,
          hand: expect.any(Array),
          index: viewerSeatIndex,
          type: "human",
        },
        publicState: {
          activeSeat: viewerSeatIndex,
          phase: "four_bidding",
          profileId,
          seatCount,
          seats: expect.any(Array),
        },
      },
    });
    expect(domainProjection.view.privateSeat.hand).toHaveLength(4);
    expect(domainProjection.view.publicState.seats).toHaveLength(seatCount);
    expect(domainProjection.view.legalActions.length).toBeGreaterThan(0);
  });

  it("keeps the closed trump private in maker and opponent views", () => {
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

    const makerProjection = projectDomainRoomForPlayer(
      room,
      hand,
      seats,
      maker,
    );
    const opponentProjection = projectDomainRoomForPlayer(
      room,
      hand,
      seats,
      (maker + 1) % 4,
    );
    const indicatorId = hand.trump.indicator?.id;
    if (!indicatorId) throw new Error("Expected a private trump indicator");

    expect(makerProjection.view.isHost).toBe(true);
    expect(opponentProjection.view.isHost).toBe(false);
    expect(makerProjection.view.publicState.trump.isOpen).toBe(false);
    expect(opponentProjection.view.publicState.trump.isOpen).toBe(false);
    expect(JSON.stringify(opponentProjection)).not.toContain(indicatorId);
    expect(makerProjection.view.privateSeat.hand).toHaveLength(7);
    expect(opponentProjection.view.privateSeat.hand).toHaveLength(8);
  });

  it("presents host-only acknowledgement for a scored hand result", () => {
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
    apply({ type: "TRUMP_OPEN" });
    while (engine.getSnapshot().completedTricks.length < 8) {
      while (engine.getSnapshot().phase === "trick_play") {
        const actor = engine.getSnapshot().activeSeat;
        const play =
          actor === null
            ? null
            : engine
                .getLegalActions(actor)
                .find((action) => action.type === "PLAY_CARD");
        if (!play) throw new Error("Expected a legal card play");
        apply(play);
      }
      expect(engine.advanceTrick()).toEqual({ ok: true });
    }
    const state = engine.getSnapshot();
    expect(state.phase).toBe("hand_result");
    const room = {
      eventVersion: state.version,
      hostPlayerId: `player-${maker + 1}`,
      id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
      inviteCode: "304-abcdefghijkl",
      status: "hand_result" as const,
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

    const hostProjection = projectDomainRoomForPlayer(room, hand, seats, maker);
    const opponentProjection = projectDomainRoomForPlayer(
      room,
      hand,
      seats,
      (maker + 1) % 4,
    );

    expect(hostProjection.view.isHost).toBe(true);
    expect(hostProjection.view.legalActions).toContainEqual({
      type: "ACK_RESULT",
    });
    expect(opponentProjection.view.isHost).toBe(false);
    expect(opponentProjection.view.legalActions).not.toContainEqual({
      type: "ACK_RESULT",
    });
    expect(hostProjection.view.publicState).toMatchObject({
      activeSeat: null,
      handResult: expect.any(Object),
      phase: "hand_result",
      trickPointsPartial: false,
      trump: { isOpen: true },
    });
    expect(hostProjection.view.publicState.completedTricks).toHaveLength(8);
  });
});
