import { describe, expect, it } from "vitest";
import { readProjectedSeat } from "../src/features/room/model/seat-view.js";

const projectedSeat = {
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
};

describe("projected seat view", () => {
  it("reads the complete public seat projection", () => {
    expect(readProjectedSeat(projectedSeat)).toEqual(projectedSeat);
  });

  it("rejects invalid team and negative count fields", () => {
    expect(readProjectedSeat({ ...projectedSeat, team: "C" })).toBeNull();
    expect(readProjectedSeat({ ...projectedSeat, handSize: -1 })).toBeNull();
  });
});
