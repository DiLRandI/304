import type { GameplayHand, SeatIndex } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { projectDomainRoomForPlayer } from "../src/contexts/gameplay/adapters/delivery/domain-gameplay-room-presenter.js";
import type { StoredSeat } from "../src/contexts/rooms/application/room-persistence-model.js";
import {
  completedGameplayHand,
  selectedTrumpGameplayHand,
  startedGameplayHand,
} from "./support/gameplay-hand-fixture.js";

const roomId = "12f8e3e8-6729-4c46-b78a-d1a0e804c55a";
const inviteCode = "304-abcdefghijkl";

function seatsFor(hand: GameplayHand): StoredSeat[] {
  return Array.from({ length: hand.profile.seatCount }, (_, seatIndex) => ({
    botDifficulty: null,
    connectionStatus: "online" as const,
    displayName: `Player ${seatIndex + 1}`,
    occupantType: "human" as const,
    playerId: `player-${seatIndex + 1}`,
    seatIndex,
  }));
}

function roomFor(
  hostSeat: SeatIndex,
  status: "hand_result" | "in_hand" = "in_hand",
) {
  return {
    eventVersion: 7,
    hostPlayerId: `player-${hostSeat + 1}`,
    id: roomId,
    inviteCode,
    status,
  } as const;
}

describe("projectDomainRoomForPlayer", () => {
  it.each([
    { profileId: "classic_304_4p", seatCount: 4 },
    { profileId: "six_304_36", seatCount: 6 },
  ] as const)("presents the $profileId opening-hand wire contract", ({
    profileId,
    seatCount,
  }) => {
    const hand = startedGameplayHand(profileId);
    const viewerSeatIndex = hand.activeSeat;
    if (viewerSeatIndex === null) {
      throw new Error("Expected an active opening bidder");
    }
    const room = roomFor(viewerSeatIndex);

    const projection = projectDomainRoomForPlayer(
      room,
      hand,
      seatsFor(hand),
      viewerSeatIndex,
    );

    expect(projection).toMatchObject({
      eventVersion: room.eventVersion,
      inviteCode,
      roomId,
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
    expect(projection.view.privateSeat.hand).toHaveLength(4);
    expect(projection.view.publicState.seats).toHaveLength(seatCount);
    expect(projection.view.legalActions.length).toBeGreaterThan(0);
  });

  it("keeps the closed trump private in maker and opponent views", () => {
    const hand = selectedTrumpGameplayHand();
    const maker = hand.trump.maker;
    if (maker === null) throw new Error("Expected a trump maker");
    const room = roomFor(maker);
    const seats = seatsFor(hand);

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
      ((maker + 1) % 4) as SeatIndex,
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
    const hand = completedGameplayHand();
    const maker = hand.trump.maker;
    if (maker === null) throw new Error("Expected a trump maker");
    const room = roomFor(maker, "hand_result");
    const seats = seatsFor(hand);

    const hostProjection = projectDomainRoomForPlayer(room, hand, seats, maker);
    const opponentProjection = projectDomainRoomForPlayer(
      room,
      hand,
      seats,
      ((maker + 1) % 4) as SeatIndex,
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
