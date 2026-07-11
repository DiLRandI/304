import type { RoomProjection } from "@three-zero-four/contracts";
import { describe, expect, it } from "vitest";
import { applyProjection } from "../src/lib/room-state.js";

function projection(eventVersion: number): RoomProjection {
  return {
    roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
    inviteCode: "304-abcdefghijkl",
    eventVersion,
    status: "in_hand",
    viewerSeatIndex: 0,
    view: {},
  };
}

describe("room projection state", () => {
  it("ignores stale projections and requests a snapshot after a version gap", () => {
    const current = projection(7);

    expect(applyProjection(current, projection(6))).toEqual({
      projection: current,
      needsResync: false,
    });
    expect(applyProjection(current, projection(8))).toEqual({
      projection: projection(8),
      needsResync: false,
    });
    expect(applyProjection(current, projection(9))).toEqual({
      projection: projection(9),
      needsResync: true,
    });
  });
});
