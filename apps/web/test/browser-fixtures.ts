import type { GameAction, RoomProjection } from "@three-zero-four/contracts";

export const ROOM_ID = "a0f17a73-c12d-4cbf-9167-09e5a26e73a5";

export const jackOfSpades = {
  cardId: "S_J",
  points: 30,
  rank: "J",
  suit: "spades",
};

export const sevenOfClubs = {
  cardId: "C_7",
  points: 0,
  rank: "7",
  suit: "clubs",
};

const seats = [
  {
    autopilot: false,
    connectionStatus: "online",
    difficulty: null,
    displayName: "Asha",
    handSize: 8,
    index: 0,
    isMe: true,
    seatLabel: "South",
    team: "A",
    trickPoints: 0,
    type: "human",
  },
  {
    autopilot: false,
    connectionStatus: "online",
    difficulty: "easy",
    displayName: "Bot Nimal",
    handSize: 8,
    index: 1,
    isMe: false,
    seatLabel: "West",
    team: "B",
    trickPoints: 0,
    type: "bot",
  },
  {
    autopilot: false,
    connectionStatus: "online",
    difficulty: "easy",
    displayName: "Bot Kavindi",
    handSize: 8,
    index: 2,
    isMe: false,
    seatLabel: "North",
    team: "A",
    trickPoints: 0,
    type: "bot",
  },
  {
    autopilot: false,
    connectionStatus: "online",
    difficulty: "easy",
    displayName: "Bot Sahan",
    handSize: 8,
    index: 3,
    isMe: false,
    seatLabel: "East",
    team: "B",
    trickPoints: 0,
    type: "bot",
  },
];

export const passBidAction: GameAction = { type: "PASS_BID" };

export function activeProjection(eventVersion = 1): RoomProjection {
  return {
    eventVersion,
    inviteCode: "304-abcdefghijkl",
    roomId: ROOM_ID,
    status: "in_hand",
    viewerSeatIndex: 0,
    view: {
      legalActions: [
        {
          cardId: jackOfSpades.cardId,
          faceDown: false,
          fromIndicator: false,
          type: "PLAY_CARD",
        },
      ],
      privateSeat: {
        hand: [jackOfSpades, sevenOfClubs],
        index: 0,
      },
      prompt: "Your turn: lead any legal card.",
      publicState: {
        activeSeat: 0,
        bidding: { currentBid: 160, currentBidSeat: 0 },
        handNumber: 1,
        phase: "trick_play",
        profileId: "classic_304_4p",
        seatCount: 4,
        seats,
        tokens: [11, 11],
        trick: { plays: [] },
        trump: {
          indicatorVisible: false,
          isOpen: false,
          maker: 0,
          suit: null,
        },
      },
    },
  };
}

export function lobbyProjection(eventVersion = 1): RoomProjection {
  return {
    eventVersion,
    inviteCode: "304-abcdefghijkl",
    roomId: ROOM_ID,
    status: "lobby",
    viewerSeatIndex: 0,
    view: {
      lobby: {
        ruleProfileId: "classic_304_4p",
        seats: seats.map((seat) => ({
          botDifficulty: seat.difficulty,
          displayName: seat.displayName,
          occupantType: seat.type,
          seatIndex: seat.index,
        })),
      },
    },
  };
}
